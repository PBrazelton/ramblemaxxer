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

// ── Term ordering helper ──────────────────────────────────────────────────
function termOrder(semester) {
  if (!semester || semester === "Transfer") return 0;
  const m = String(semester).match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
  if (!m) return 1; // unknown terms sort after Transfer
  const year = parseInt(m[2]);
  const season = m[1] === "Spring" ? 0 : m[1] === "Summer" ? 1 : 2;
  return year * 3 + season;
}

// ── GET /api/students/me/courses ──────────────────────────────────────────
router.get("/me/courses", (req, res) => {
  const rows = db.prepare(`
    SELECT course_code as code, semester, status, credits_override, note
    FROM student_courses WHERE user_id = ?
  `).all(req.session.userId);
  rows.sort((a, b) => termOrder(a.semester) - termOrder(b.semester) || a.code.localeCompare(b.code));
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

// ── POST /api/students/me/courses/bulk ────────────────────────────────────
router.post("/me/courses/bulk", (req, res) => {
  const { courses } = req.body;
  if (!Array.isArray(courses) || courses.length === 0) {
    return res.status(400).json({ error: "courses array required" });
  }
  if (courses.length > 20) {
    return res.status(400).json({ error: "Maximum 20 courses per request" });
  }

  const added = [];
  const skipped = [];

  db.transaction(() => {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO student_courses (user_id, course_code, semester, status, credits_override, note)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const c of courses) {
      if (!c.code || !c.semester || !c.status) { skipped.push(c.code || "unknown"); continue; }
      const info = insert.run(
        req.session.userId, c.code.toUpperCase(), c.semester, c.status,
        c.creditsOverride || null, c.note || null
      );
      if (info.changes > 0) added.push(c.code.toUpperCase());
      else skipped.push(c.code.toUpperCase());
    }
  })();

  // Run solver and return result
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

  res.json({ ...result, suggestions, added, skipped });
});

// ── POST /api/students/me/transfer-credits ────────────────────────────────
router.post("/me/transfer-credits", (req, res) => {
  const { credits } = req.body;
  if (!Array.isArray(credits) || credits.length === 0) {
    return res.status(400).json({ error: "credits array required" });
  }

  const added = [];
  const skipped = [];
  let syntheticIdx = 0;

  db.transaction(() => {
    // Find next synthetic index
    const maxRow = db.prepare(
      "SELECT course_code FROM student_courses WHERE user_id = ? AND course_code LIKE 'XFER %' ORDER BY course_code DESC LIMIT 1"
    ).get(req.session.userId);
    if (maxRow) {
      const m = maxRow.course_code.match(/XFER XXXX-(\d+)/);
      if (m) syntheticIdx = parseInt(m[1]);
    }

    const insert = db.prepare(`
      INSERT OR IGNORE INTO student_courses (user_id, course_code, semester, status, credits_override, note)
      VALUES (?, ?, 'Transfer', 'transfer', ?, ?)
    `);

    for (const c of credits) {
      const code = c.satisfiesCode ? c.satisfiesCode.toUpperCase() : `XFER XXXX-${++syntheticIdx}`;
      const info = insert.run(req.session.userId, code, c.creditHours || 3, c.label || null);
      if (info.changes > 0) added.push(code);
      else skipped.push(code);
    }
  })();

  // Run solver and return result
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

  res.json({ ...result, suggestions, added, skipped });
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

  // Augment with term info
  const semesters = [...new Set(courseRows.map(r => r.semester).filter(Boolean))];
  semesters.sort((a, b) => termOrder(a) - termOrder(b));
  const nonTransfer = semesters.filter(s => s !== "Transfer");
  const latestTerm = nonTransfer.length > 0 ? nonTransfer[nonTransfer.length - 1] : null;

  res.json({ ...result, suggestions, latestTerm, semesters });
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
