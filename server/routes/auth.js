/**
 * server/routes/auth.js
 * POST /api/auth/login
 * POST /api/auth/logout
 * POST /api/auth/register  (requires valid invite token)
 * POST /api/auth/invite    (logged-in users can generate invite links)
 * GET  /api/auth/me        (returns current session user)
 */

const express = require("express");
const bcrypt = require("bcryptjs");
const crypto = require("crypto");
const db = require("../db/connection");

const router = express.Router();

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare("SELECT id, email, name, role, grad_year FROM users WHERE id = ?")
    .get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Session invalid" });
  res.json(user);
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  req.session.userId = user.id;
  res.json({ id: user.id, email: user.email, name: user.name, role: user.role, grad_year: user.grad_year });
});

// ── POST /api/auth/logout ──────────────────────────────────────────────────
router.post("/logout", (req, res) => {
  req.session.destroy();
  res.json({ ok: true });
});

// ── POST /api/auth/register ────────────────────────────────────────────────
router.post("/register", (req, res) => {
  const { token, email, name, password, grad_year } = req.body;
  if (!token || !email || !name || !password) {
    return res.status(400).json({ error: "token, email, name, and password are required" });
  }

  const invite = db.prepare(`
    SELECT * FROM invites
    WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token);

  if (!invite) return res.status(400).json({ error: "Invalid or expired invite link" });

  // Check email not already registered
  const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (existing) return res.status(400).json({ error: "An account with that email already exists" });

  const passwordHash = bcrypt.hashSync(password, 10);

  const registerAndMarkUsed = db.transaction(() => {
    const { lastInsertRowid: userId } = db.prepare(`
      INSERT INTO users (email, name, password_hash, role, grad_year, invited_by)
      VALUES (?, ?, ?, 'student', ?, ?)
    `).run(email.toLowerCase().trim(), name, passwordHash, grad_year || null, invite.invited_by);

    db.prepare("UPDATE invites SET used_at = datetime('now') WHERE id = ?").run(invite.id);

    // Default programs — can be configured after signup
    db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)").run(userId, "CORE");

    return userId;
  });

  const userId = registerAndMarkUsed();
  req.session.userId = userId;
  res.status(201).json({ id: userId, email, name, role: "student" });
});

// ── POST /api/auth/invite ──────────────────────────────────────────────────
router.post("/invite", requireAuth, (req, res) => {
  const { email } = req.body; // optional pre-fill
  const token = crypto.randomBytes(24).toString("hex");

  db.prepare(`
    INSERT INTO invites (token, invited_by, email) VALUES (?, ?, ?)
  `).run(token, req.session.userId, email || null);

  const inviteUrl = `${process.env.APP_URL || "http://localhost:5173"}/register?token=${token}`;
  res.json({ token, inviteUrl });
});

// ── Middleware ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Authentication required" });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
