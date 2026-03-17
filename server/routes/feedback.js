/**
 * server/routes/feedback.js
 *
 * POST /api/feedback           — submit feedback (auth required)
 * GET  /api/feedback/admin     — list feedback (admin only)
 * GET  /api/feedback/admin/:id — single feedback detail (admin only)
 * PATCH /api/feedback/admin/:id — update status/notes (admin only)
 */

const express = require("express");
const multer = require("multer");
const { requireAuth } = require("./auth");
const db = require("../db/connection");

const router = express.Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

const VALID_CATEGORIES = ["bug", "confusing", "idea", "other"];
const VALID_STATUSES = ["new", "reviewed", "filed", "resolved", "wontfix"];

// ── POST /api/feedback ──────────────────────────────────────────────────────
router.post("/", requireAuth, upload.single("screenshot"), (req, res) => {
  const userId = req.session.userId;
  const { message, category, errors, context } = req.body;

  if (!message || message.length < 5 || message.length > 2000) {
    return res.status(400).json({ error: "Message must be 5-2000 characters" });
  }
  if (category && !VALID_CATEGORIES.includes(category)) {
    return res.status(400).json({ error: "Invalid category" });
  }

  // Rate limit: check last successful submission
  const last = db.prepare(
    "SELECT created_at FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 1"
  ).get(userId);
  if (last) {
    const elapsed = Date.now() - new Date(last.created_at + "Z").getTime();
    if (elapsed < 60000) {
      return res.status(429).json({ error: "Please wait before submitting again" });
    }
  }

  const screenshot = req.file ? req.file.buffer : null;
  const result = db.prepare(`
    INSERT INTO feedback (user_id, category, message, screenshot, errors, context)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, category || null, message, screenshot, errors || null, context || "{}");

  res.json({ ok: true, id: result.lastInsertRowid });
});

// ── GET /api/feedback/admin ─────────────────────────────────────────────────
router.get("/admin", requireAdmin, (req, res) => {
  const { status, category, page = 1, limit = 20 } = req.query;
  const p = Math.max(1, parseInt(page));
  const lim = Math.min(50, Math.max(1, parseInt(limit)));
  const offset = (p - 1) * lim;

  let where = [];
  let params = [];
  if (status) { where.push("f.status = ?"); params.push(status); }
  if (category) { where.push("f.category = ?"); params.push(category); }
  const whereClause = where.length ? "WHERE " + where.join(" AND ") : "";

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM feedback f ${whereClause}`
  ).get(...params).count;

  const items = db.prepare(`
    SELECT f.id, f.user_id, f.category, f.message, f.status, f.context,
           f.admin_notes, f.github_issue_url, f.created_at, f.resolved_at,
           u.name as user_name, u.email as user_email
    FROM feedback f
    JOIN users u ON u.id = f.user_id
    ${whereClause}
    ORDER BY f.created_at DESC
    LIMIT ? OFFSET ?
  `).all(...params, lim, offset);

  res.json({ items, total, page: p, limit: lim });
});

// ── GET /api/feedback/admin/:id ─────────────────────────────────────────────
router.get("/admin/:id", requireAdmin, (req, res) => {
  const row = db.prepare(`
    SELECT f.*, u.name as user_name, u.email as user_email
    FROM feedback f
    JOIN users u ON u.id = f.user_id
    WHERE f.id = ?
  `).get(req.params.id);

  if (!row) return res.status(404).json({ error: "Not found" });

  row.screenshot = row.screenshot ? row.screenshot.toString("base64") : null;
  try { row.errors = JSON.parse(row.errors); } catch { row.errors = null; }
  try { row.context = JSON.parse(row.context); } catch { row.context = null; }

  res.json(row);
});

// ── PATCH /api/feedback/admin/:id ───────────────────────────────────────────
router.patch("/admin/:id", requireAdmin, (req, res) => {
  const { status, adminNotes, githubIssueUrl } = req.body;

  if (status && !VALID_STATUSES.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }

  const existing = db.prepare("SELECT id, status FROM feedback WHERE id = ?").get(req.params.id);
  if (!existing) return res.status(404).json({ error: "Not found" });

  const sets = [];
  const params = [];
  if (status !== undefined) {
    sets.push("status = ?");
    params.push(status);
    if (status === "resolved" && existing.status !== "resolved") {
      sets.push("resolved_at = datetime('now')");
    }
    if (status !== "resolved") {
      sets.push("resolved_at = NULL");
    }
  }
  if (adminNotes !== undefined) { sets.push("admin_notes = ?"); params.push(adminNotes); }
  if (githubIssueUrl !== undefined) { sets.push("github_issue_url = ?"); params.push(githubIssueUrl); }

  if (sets.length === 0) return res.json({ ok: true });

  params.push(req.params.id);
  db.prepare(`UPDATE feedback SET ${sets.join(", ")} WHERE id = ?`).run(...params);
  res.json({ ok: true });
});

module.exports = router;
