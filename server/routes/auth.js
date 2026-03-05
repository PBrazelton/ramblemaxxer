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
const passport = require("../lib/passport");
const { sendInviteEmail, sendPasswordResetEmail } = require("../lib/email");

const router = express.Router();
const APP_URL = process.env.APP_URL || "http://localhost:5175";

// ── GET /api/auth/me ───────────────────────────────────────────────────────
router.get("/me", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare(
    "SELECT id, email, name, role, grad_year, privacy, provider, avatar_url FROM users WHERE id = ?"
  ).get(req.session.userId);
  if (!user) return res.status(401).json({ error: "Session invalid" });
  res.json(user);
});

// ── POST /api/auth/login ───────────────────────────────────────────────────
router.post("/login", (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: "Email and password required" });

  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email.toLowerCase().trim());
  if (!user || !user.password_hash || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.active === 0) {
    return res.status(403).json({ error: "Account deactivated" });
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
router.post("/invite", requireAuth, async (req, res) => {
  const { email } = req.body; // optional pre-fill
  const token = crypto.randomBytes(24).toString("hex");

  db.prepare(`
    INSERT INTO invites (token, invited_by, email) VALUES (?, ?, ?)
  `).run(token, req.session.userId, email || null);

  const inviteUrl = `${APP_URL}/#/register?token=${token}`;

  // Send invite email if an email was provided
  if (email) {
    const inviter = db.prepare("SELECT name FROM users WHERE id = ?").get(req.session.userId);
    try {
      await sendInviteEmail(email, inviteUrl, inviter?.name || "A friend");
    } catch (e) {
      console.error("[invite email error]", e);
    }
  }

  res.json({ token, inviteUrl });
});

// ── GET /api/auth/google ──────────────────────────────────────────────────
router.get("/google", (req, res, next) => {
  // Stash invite token in session so callback can use it
  if (req.query.token) req.session.inviteToken = req.query.token;
  passport.authenticate("google", { scope: ["profile", "email"], session: false })(req, res, next);
});

// ── GET /api/auth/google/callback ─────────────────────────────────────────
router.get("/google/callback",
  (req, res, next) => {
    passport.authenticate("google", { session: false }, (err, user, info) => {
      if (err) {
        console.error("[google oauth error]", err);
        return res.redirect(`${APP_URL}/#/login?error=oauth_error`);
      }
      if (!user) {
        const msg = encodeURIComponent(info?.message || "Google sign-in failed");
        return res.redirect(`${APP_URL}/#/login?error=${msg}`);
      }
      req.session.userId = user.id;
      res.redirect(`${APP_URL}/#/`);
    })(req, res, next);
  }
);

// ── POST /api/auth/forgot-password ────────────────────────────────────────
router.post("/forgot-password", async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Email required" });

  const user = db.prepare("SELECT id, provider FROM users WHERE email = ?")
    .get(email.toLowerCase().trim());

  // Always return ok to avoid email enumeration
  if (!user || user.provider !== "local") {
    return res.json({ ok: true });
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour

  db.prepare(`
    INSERT INTO password_resets (user_id, token, expires_at) VALUES (?, ?, ?)
  `).run(user.id, token, expiresAt);

  try {
    await sendPasswordResetEmail(email.toLowerCase().trim(), token);
  } catch (e) {
    console.error("[reset email error]", e);
  }

  res.json({ ok: true });
});

// ── POST /api/auth/reset-password ─────────────────────────────────────────
router.post("/reset-password", (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "Token and password required" });
  if (password.length < 8) return res.status(400).json({ error: "Password must be at least 8 characters" });

  const reset = db.prepare(`
    SELECT * FROM password_resets
    WHERE token = ? AND used_at IS NULL AND expires_at > datetime('now')
  `).get(token);

  if (!reset) return res.status(400).json({ error: "Invalid or expired reset link" });

  const hash = bcrypt.hashSync(password, 10);

  db.transaction(() => {
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, reset.user_id);
    db.prepare("UPDATE password_resets SET used_at = datetime('now') WHERE id = ?").run(reset.id);
  })();

  res.json({ ok: true });
});

// ── Middleware ─────────────────────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Authentication required" });
  next();
}

module.exports = router;
module.exports.requireAuth = requireAuth;
