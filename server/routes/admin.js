/**
 * server/routes/admin.js
 *
 * GET  /api/admin/students          — list all students with stats
 * GET  /api/admin/students/:id      — single student's solve result
 * GET  /api/admin/invites           — invite tree
 * POST /api/admin/invites           — generate an invite link
 * PUT  /api/admin/users/:id         — update user (name, role, grad_year, active)
 * POST /api/admin/users/:id/reset-password — set a temp password
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db/connection");
const { solve, getSuggestions } = require("../../shared/solver");
const { courseMap, programMap, degreeRequirements } = require("../lib/catalog");
const { sendInviteEmail } = require("../lib/email");

const router = express.Router();

// ── requireAdmin middleware ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

router.use(requireAdmin);

// ── GET /api/admin/students ──────────────────────────────────────────────────
router.get("/students", (req, res) => {
  const students = db.prepare(`
    SELECT u.id, u.name, u.email, u.role, u.grad_year, u.created_at,
           u.invited_by, u.active,
           COUNT(sc.id) as course_count,
           inviter.name as invited_by_name
    FROM users u
    LEFT JOIN student_courses sc ON sc.user_id = u.id
    LEFT JOIN users inviter ON inviter.id = u.invited_by
    WHERE u.role = 'student'
    GROUP BY u.id
    ORDER BY u.created_at ASC
  `).all();
  res.json(students);
});

// ── GET /api/admin/students/:id ──────────────────────────────────────────────
router.get("/students/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  const user = db.prepare(
    "SELECT id, name, email, grad_year, role FROM users WHERE id = ?"
  ).get(userId);
  if (!user) return res.status(404).json({ error: "Student not found" });

  const courseRows = db.prepare(`
    SELECT course_code as code, semester, status,
           credits_override as creditsOverride, pinned_program as pinnedProgram
    FROM student_courses WHERE user_id = ?
  `).all(userId);
  const programRows = db.prepare(
    "SELECT program_id FROM student_programs WHERE user_id = ?"
  ).all(userId);
  const declaredPrograms = programRows.map(r => r.program_id);

  const result = solve(courseRows, declaredPrograms, courseMap, programMap, degreeRequirements);
  const suggestions = getSuggestions(result, courseMap, programMap, declaredPrograms);
  res.json({ user, ...result, suggestions });
});

// ── GET /api/admin/invites ───────────────────────────────────────────────────
router.get("/invites", (req, res) => {
  const invites = db.prepare(`
    SELECT i.id, i.token, i.email, i.created_at, i.expires_at, i.used_at,
           inviter.id as inviter_id, inviter.name as inviter_name,
           invitee.id as invitee_id, invitee.name as invitee_name
    FROM invites i
    JOIN users inviter ON inviter.id = i.invited_by
    LEFT JOIN users invitee ON invitee.email = i.email AND invitee.invited_by = inviter.id
    ORDER BY i.created_at DESC
  `).all();
  res.json(invites);
});

// ── POST /api/admin/invites ──────────────────────────────────────────────────
router.post("/invites", async (req, res) => {
  const { email } = req.body;
  const token = crypto.randomBytes(24).toString("hex");

  db.prepare(`
    INSERT INTO invites (token, invited_by, email) VALUES (?, ?, ?)
  `).run(token, req.session.userId, email || null);

  const inviteUrl = `${process.env.APP_URL || "http://localhost:5175"}/#/register?token=${token}`;

  // Send invite email if address provided
  if (email) {
    const admin = db.prepare("SELECT name FROM users WHERE id = ?").get(req.session.userId);
    try {
      await sendInviteEmail(email, inviteUrl, admin?.name || "Ramblemaxxer");
    } catch (e) {
      console.error("Failed to send invite email:", e.message);
    }
  }

  res.json({ token, inviteUrl, emailSent: !!email });
});

// ── PUT /api/admin/users/:id ─────────────────────────────────────────────────
router.put("/users/:id", (req, res) => {
  const userId = parseInt(req.params.id);
  const { name, role, grad_year, active } = req.body;

  // Don't let admin deactivate themselves
  if (userId === req.session.userId && active === 0) {
    return res.status(400).json({ error: "Cannot deactivate your own account" });
  }

  db.prepare(`
    UPDATE users
    SET name = COALESCE(?, name),
        role = COALESCE(?, role),
        grad_year = COALESCE(?, grad_year),
        active = COALESCE(?, active)
    WHERE id = ?
  `).run(name ?? null, role ?? null, grad_year ?? null, active ?? null, userId);

  res.json({ ok: true });
});

// ── POST /api/admin/users/:id/reset-password ─────────────────────────────────
router.post("/users/:id/reset-password", (req, res) => {
  const userId = parseInt(req.params.id);
  const tempPassword = Math.random().toString(36).slice(2, 10);
  const hash = bcrypt.hashSync(tempPassword, 10);
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?")
    .run(hash, userId);
  res.json({ tempPassword, note: "Share this with the student. It cannot be retrieved again." });
});

module.exports = router;
