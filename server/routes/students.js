/**
 * server/routes/students.js
 *
 * GET  /api/students/me/courses        - get my course list
 * POST /api/students/me/courses        - add a course
 * PUT  /api/students/me/courses/:code  - update a course (status, semester)
 * DELETE /api/students/me/courses/:code
 *
 * GET  /api/students/me/solve          - run the constraint solver, return full result
 * GET  /api/students/me/programs       - get declared programs
 * POST /api/students/me/programs       - add a program
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const db = require("../db/connection");
const { requireAuth } = require("./auth");
const { solve, getSuggestions } = require("../../shared/solver");
const { courseMap, programMap, degreeRequirements } = require("../lib/catalog");

const router = express.Router();
router.use(requireAuth);

// ── GET /api/students/me/courses ──────────────────────────────────────────
router.get("/me/courses", (req, res) => {
  const rows = db.prepare(`
    SELECT course_code as code, semester, status, credits_override, note
    FROM student_courses WHERE user_id = ? ORDER BY semester, course_code
  `).all(req.session.userId);
  res.json(rows);
});

// ── POST /api/students/me/courses ─────────────────────────────────────────
router.post("/me/courses", (req, res) => {
  const { code, semester, status, creditsOverride, note } = req.body;
  if (!code || semester === undefined || !status) {
    return res.status(400).json({ error: "code, semester, and status are required" });
  }

  try {
    db.prepare(`
      INSERT INTO student_courses (user_id, course_code, semester, status, credits_override, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(req.session.userId, code.toUpperCase(), semester, status, creditsOverride || null, note || null);
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.message.includes("UNIQUE")) {
      return res.status(409).json({ error: "Course already in your list" });
    }
    throw e;
  }
});

// ── PUT /api/students/me/courses/:code ────────────────────────────────────
router.put("/me/courses/:code", (req, res) => {
  const { semester, status, creditsOverride, note, pinnedProgram } = req.body;
  const code = req.params.code.toUpperCase().replace("-", " ");

  const current = db.prepare(
    "SELECT pinned_program FROM student_courses WHERE user_id = ? AND course_code = ?"
  ).get(req.session.userId, code);

  db.prepare(`
    UPDATE student_courses
    SET semester = COALESCE(?, semester),
        status = COALESCE(?, status),
        credits_override = COALESCE(?, credits_override),
        note = COALESCE(?, note),
        pinned_program = ?
    WHERE user_id = ? AND course_code = ?
  `).run(
    semester ?? null, status ?? null, creditsOverride ?? null, note ?? null,
    pinnedProgram !== undefined ? pinnedProgram : (current?.pinned_program ?? null),
    req.session.userId, code
  );

  res.json({ ok: true });
});

// ── DELETE /api/students/me/courses/:code ─────────────────────────────────
router.delete("/me/courses/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  db.prepare("DELETE FROM student_courses WHERE user_id = ? AND course_code = ?")
    .run(req.session.userId, code);
  res.json({ ok: true });
});

// ── GET /api/students/me/solve ────────────────────────────────────────────
router.get("/me/solve", (req, res) => {
  const courseRows = db.prepare(`
    SELECT course_code as code, semester, status,
           credits_override as creditsOverride,
           pinned_program as pinnedProgram
    FROM student_courses WHERE user_id = ?
  `).all(req.session.userId);

  const programRows = db.prepare(`
    SELECT program_id FROM student_programs WHERE user_id = ?
  `).all(req.session.userId);

  const declaredPrograms = programRows.map((r) => r.program_id);

  const result = solve(courseRows, declaredPrograms, courseMap, programMap, degreeRequirements);
  const suggestions = getSuggestions(result, courseMap, programMap, declaredPrograms);

  res.json({ ...result, suggestions });
});

// ── GET /api/students/me/programs ─────────────────────────────────────────
router.get("/me/programs", (req, res) => {
  const rows = db.prepare("SELECT program_id FROM student_programs WHERE user_id = ?")
    .all(req.session.userId);
  res.json(rows.map((r) => r.program_id));
});

// ── POST /api/students/me/programs ────────────────────────────────────────
router.post("/me/programs", (req, res) => {
  const { programId } = req.body;
  if (!programId) return res.status(400).json({ error: "programId required" });
  db.prepare("INSERT OR IGNORE INTO student_programs (user_id, program_id) VALUES (?, ?)")
    .run(req.session.userId, programId);
  res.status(201).json({ ok: true });
});

// ── PUT /api/students/me/settings ────────────────────────────────────────
router.put("/me/settings", (req, res) => {
  const { privacy, name, grad_year } = req.body;
  if (privacy && !["private", "friends"].includes(privacy)) {
    return res.status(400).json({ error: "privacy must be 'private' or 'friends'" });
  }

  const updates = [];
  const params = [];
  if (privacy) { updates.push("privacy = ?"); params.push(privacy); }
  if (name !== undefined) { updates.push("name = ?"); params.push(name); }
  if (grad_year !== undefined) { updates.push("grad_year = ?"); params.push(grad_year); }

  if (updates.length === 0) return res.status(400).json({ error: "No fields to update" });

  params.push(req.session.userId);
  db.prepare(`UPDATE users SET ${updates.join(", ")} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

// ── PUT /api/students/me/password ───────────────────────────────────────
router.put("/me/password", (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current and new password required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  const user = db.prepare("SELECT password_hash, provider FROM users WHERE id = ?")
    .get(req.session.userId);
  if (!user || user.provider !== "local") {
    return res.status(400).json({ error: "Password change not available for this account" });
  }
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(401).json({ error: "Current password is incorrect" });
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, req.session.userId);
  res.json({ ok: true });
});

// ── PUT /api/students/me/programs ───────────────────────────────────────
router.put("/me/programs", (req, res) => {
  const { programs } = req.body; // array of program IDs to be declared
  if (!Array.isArray(programs)) {
    return res.status(400).json({ error: "programs must be an array" });
  }

  db.transaction(() => {
    db.prepare("DELETE FROM student_programs WHERE user_id = ?").run(req.session.userId);
    const insert = db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)");
    for (const pid of programs) {
      insert.run(req.session.userId, pid);
    }
  })();

  res.json({ ok: true });
});

module.exports = router;
