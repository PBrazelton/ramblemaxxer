/**
 * server/routes/dev.js
 *
 * Dev-only persona system for testing. All routes gated by NODE_ENV check.
 * These endpoints MUST NOT be accessible in production.
 *
 * GET  /api/dev/personas           — list available personas
 * POST /api/dev/personas/:id/activate — create/reset + login as persona
 * GET  /api/dev/personas/current   — which persona is the current session?
 * POST /api/dev/personas/reset     — reload current persona's data
 */

const express = require("express");
const fs = require("fs");
const path = require("path");
const bcrypt = require("bcryptjs");
const db = require("../db/connection");

const router = express.Router();

// ── Belt-and-suspenders: block everything in production ─────────────────────
if (process.env.NODE_ENV === "production") {
  router.use((req, res) => res.status(404).json({ error: "Not found" }));
  module.exports = router;
  return;
}

// ── Load all persona definitions ────────────────────────────────────────────
const PERSONAS_DIR = path.join(__dirname, "../dev/personas");
let personas = [];

function loadPersonas() {
  personas = [];
  const files = fs.readdirSync(PERSONAS_DIR)
    .filter(f => f.endsWith(".json"))
    .sort();
  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(PERSONAS_DIR, file), "utf8"));
      personas.push(data);
    } catch (e) {
      console.error(`[dev] Failed to load persona ${file}:`, e.message);
    }
  }
  console.log(`[dev] Loaded ${personas.length} test personas`);
}
loadPersonas();

const DEV_PASSWORD_HASH = bcrypt.hashSync("dev123", 10);

// ── GET /api/dev/personas ───────────────────────────────────────────────────
router.get("/personas", (req, res) => {
  res.json(personas.map(p => ({
    id: p.id,
    name: p.name,
    label: p.label,
    color: p.color,
    description: p.description,
  })));
});

// ── POST /api/dev/personas/:id/activate ─────────────────────────────────────
router.post("/personas/:id/activate", (req, res) => {
  const persona = personas.find(p => p.id === req.params.id);
  if (!persona) return res.status(404).json({ error: "Persona not found" });

  const userId = db.transaction(() => {
    // 1. Create or find user
    let user = db.prepare("SELECT id FROM users WHERE email = ?").get(persona.email);
    let uid;

    if (user) {
      uid = user.id;
      // Clear existing data
      db.prepare("DELETE FROM student_courses WHERE user_id = ?").run(uid);
      db.prepare("DELETE FROM plan_courses WHERE plan_id IN (SELECT id FROM student_plans WHERE user_id = ?)").run(uid);
      db.prepare("DELETE FROM student_plans WHERE user_id = ?").run(uid);
      db.prepare("DELETE FROM student_programs WHERE user_id = ?").run(uid);
      db.prepare("UPDATE users SET name = ?, grad_year = ?, onboarding_step = ?, role = 'student', active = 1 WHERE id = ?")
        .run(persona.name, persona.gradYear || null, persona.onboardingComplete ? 0 : (persona.onboardingStep || null), uid);
    } else {
      const result = db.prepare(`
        INSERT INTO users (email, name, password_hash, role, grad_year, onboarding_step)
        VALUES (?, ?, ?, 'student', ?, ?)
      `).run(
        persona.email, persona.name, DEV_PASSWORD_HASH,
        persona.gradYear || null,
        persona.onboardingComplete ? 0 : (persona.onboardingStep || null)
      );
      uid = result.lastInsertRowid;
    }

    // 2. Insert programs (always include CORE + CAS-GRAD)
    const allPrograms = [...new Set([...(persona.programs || []), "CORE", "CAS-GRAD"])];
    const insertProg = db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)");
    for (const pid of allPrograms) {
      insertProg.run(uid, pid);
    }

    // 3. Insert courses
    const insertCourse = db.prepare(`
      INSERT INTO student_courses (user_id, course_code, semester, status)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of persona.courses || []) {
      insertCourse.run(uid, c.code, c.term, c.status);
    }

    // 4. Insert transfer credits
    const insertXfer = db.prepare(`
      INSERT INTO student_courses (user_id, course_code, semester, status, credits_override, note)
      VALUES (?, ?, 'Transfer', 'transfer', ?, ?)
    `);
    for (const t of persona.transferCredits || []) {
      insertXfer.run(uid, t.code, t.credits || 3, t.label || null);
    }

    return uid;
  })();

  // 5. Log in as this user
  req.session.userId = userId;

  const onboardingStep = persona.onboardingComplete ? 0 : (persona.onboardingStep || null);

  res.json({
    ok: true,
    user: {
      id: userId,
      email: persona.email,
      name: persona.name,
      role: "student",
      grad_year: persona.gradYear,
      onboarding_step: onboardingStep,
    },
    persona: persona.id,
  });
});

// ── GET /api/dev/personas/current ───────────────────────────────────────────
router.get("/personas/current", (req, res) => {
  if (!req.session.userId) return res.json({ persona: null });

  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  if (!user || !user.email.endsWith("@dev.ramblemaxxer.com")) {
    return res.json({ persona: null });
  }

  const persona = personas.find(p => p.email === user.email);
  res.json({
    persona: persona ? {
      id: persona.id,
      name: persona.name,
      label: persona.label,
      color: persona.color,
    } : null,
  });
});

// ── POST /api/dev/personas/reset ────────────────────────────────────────────
router.post("/personas/reset", (req, res) => {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });

  const user = db.prepare("SELECT email FROM users WHERE id = ?").get(req.session.userId);
  if (!user || !user.email.endsWith("@dev.ramblemaxxer.com")) {
    return res.status(400).json({ error: "Not a persona user" });
  }

  // Reload persona files (in case they were edited)
  loadPersonas();
  const freshPersona = personas.find(p => p.email === user.email);
  if (!freshPersona) return res.status(404).json({ error: "Persona definition not found" });

  const uid = req.session.userId;

  db.transaction(() => {
    db.prepare("DELETE FROM student_courses WHERE user_id = ?").run(uid);
    db.prepare("DELETE FROM plan_courses WHERE plan_id IN (SELECT id FROM student_plans WHERE user_id = ?)").run(uid);
    db.prepare("DELETE FROM student_plans WHERE user_id = ?").run(uid);
    db.prepare("DELETE FROM student_programs WHERE user_id = ?").run(uid);
    db.prepare("UPDATE users SET name = ?, grad_year = ?, onboarding_step = ? WHERE id = ?")
      .run(freshPersona.name, freshPersona.gradYear || null, freshPersona.onboardingComplete ? 0 : (freshPersona.onboardingStep || null), uid);

    const allPrograms = [...new Set([...(freshPersona.programs || []), "CORE", "CAS-GRAD"])];
    const insertProg = db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)");
    for (const pid of allPrograms) {
      insertProg.run(uid, pid);
    }

    const insertCourse = db.prepare(`
      INSERT INTO student_courses (user_id, course_code, semester, status)
      VALUES (?, ?, ?, ?)
    `);
    for (const c of freshPersona.courses || []) {
      insertCourse.run(uid, c.code, c.term, c.status);
    }

    const insertXfer = db.prepare(`
      INSERT INTO student_courses (user_id, course_code, semester, status, credits_override, note)
      VALUES (?, ?, 'Transfer', 'transfer', ?, ?)
    `);
    for (const t of freshPersona.transferCredits || []) {
      insertXfer.run(uid, t.code, t.credits || 3, t.label || null);
    }
  })();

  res.json({ ok: true });
});

module.exports = router;
