/**
 * server/routes/plans.js
 *
 * Semester planner CRUD + plannable-courses + validate.
 * Mounted under /api/students so paths are /me/plans/...
 */

const express = require("express");
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
  if (!m) return 1;
  const year = parseInt(m[2]);
  const season = m[1] === "Spring" ? 0 : m[1] === "Summer" ? 1 : 2;
  return year * 3 + season;
}

/** Validate term format: "Fall 2026", "Spring 2025", etc. */
const TERM_RE = /^(Fall|Spring|Summer)\s+\d{4}$/;

/** Generate future terms from current term through grad_year */
function generateFutureTerms(gradYear) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const endYear = gradYear || year + 3; // default 3 academic years out

  const currentTerm = month >= 8 ? `Fall ${year}` : month >= 5 ? `Summer ${year}` : `Spring ${year}`;
  const currentOrder = termOrder(currentTerm);

  // Generate all Spring/Summer/Fall for each year, filter to current..grad
  const terms = [];
  for (let y = year; y <= endYear; y++) {
    for (const season of ["Spring", "Summer", "Fall"]) {
      const t = `${season} ${y}`;
      const ord = termOrder(t);
      if (ord < currentOrder) continue;
      // Stop after Spring of grad year (students graduate in May)
      if (y === endYear && season !== "Spring") continue;
      terms.push(t);
    }
  }
  return terms;
}

// ── GET /me/plans ─────────────────────────────────────────────────────────
router.get("/me/plans", (req, res) => {
  const plans = db.prepare(`
    SELECT sp.id, sp.name, sp.is_active, sp.created_at, sp.updated_at,
           COUNT(pc.id) as course_count,
           COALESCE(SUM(c.credits), 0) as total_credits
    FROM student_plans sp
    LEFT JOIN plan_courses pc ON pc.plan_id = sp.id
    LEFT JOIN courses c ON c.code = pc.course_code
    WHERE sp.user_id = ? AND sp.is_active = 1
    GROUP BY sp.id
    ORDER BY sp.updated_at DESC
  `).all(req.session.userId);
  res.json(plans);
});

// ── POST /me/plans ────────────────────────────────────────────────────────
router.post("/me/plans", (req, res) => {
  const { name } = req.body || {};
  db.transaction(() => {
    // Deactivate any existing active plans (single-active-plan enforcement)
    db.prepare("UPDATE student_plans SET is_active = 0 WHERE user_id = ? AND is_active = 1")
      .run(req.session.userId);
    db.prepare("INSERT INTO student_plans (user_id, name) VALUES (?, ?)")
      .run(req.session.userId, name || "My Plan");
  })();

  const plan = db.prepare("SELECT * FROM student_plans WHERE user_id = ? AND is_active = 1")
    .get(req.session.userId);
  res.status(201).json(plan);
});

// ── GET /me/plans/:id ─────────────────────────────────────────────────────
router.get("/me/plans/:id", (req, res) => {
  const plan = db.prepare("SELECT * FROM student_plans WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const courses = db.prepare(`
    SELECT pc.course_code, pc.term, pc.section, pc.class_number,
           c.title, c.credits, c.department, c.knowledge_area,
           c.engaged_learning, c.writing_intensive
    FROM plan_courses pc
    LEFT JOIN courses c ON c.code = pc.course_code
    WHERE pc.plan_id = ?
    ORDER BY pc.term, pc.course_code
  `).all(plan.id);

  // Sort by term order
  courses.sort((a, b) => termOrder(a.term) - termOrder(b.term) || a.course_code.localeCompare(b.course_code));

  res.json({ ...plan, courses });
});

// ── PUT /me/plans/:id ─────────────────────────────────────────────────────
// Full replace of plan courses (auto-save target)
router.put("/me/plans/:id", (req, res) => {
  const plan = db.prepare("SELECT id FROM student_plans WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  const { courses, name } = req.body;
  if (!Array.isArray(courses)) return res.status(400).json({ error: "courses array required" });

  // Validate each course entry
  const valid = [];
  for (const c of courses) {
    if (!c.course_code || typeof c.course_code !== "string") continue;
    if (!c.term || !TERM_RE.test(c.term)) continue;
    valid.push(c);
  }

  db.transaction(() => {
    if (name !== undefined) {
      db.prepare("UPDATE student_plans SET name = ?, updated_at = datetime('now') WHERE id = ?")
        .run(name, plan.id);
    } else {
      db.prepare("UPDATE student_plans SET updated_at = datetime('now') WHERE id = ?")
        .run(plan.id);
    }
    db.prepare("DELETE FROM plan_courses WHERE plan_id = ?").run(plan.id);
    const insert = db.prepare(
      "INSERT INTO plan_courses (plan_id, course_code, term, section, class_number) VALUES (?, ?, ?, ?, ?)"
    );
    for (const c of valid) {
      insert.run(plan.id, c.course_code, c.term, c.section || null, c.class_number || null);
    }
  })();

  res.json({ ok: true });
});

// ── DELETE /me/plans/:id ──────────────────────────────────────────────────
router.delete("/me/plans/:id", (req, res) => {
  db.prepare("UPDATE student_plans SET is_active = 0 WHERE id = ? AND user_id = ?")
    .run(req.params.id, req.session.userId);
  res.json({ ok: true });
});

// ── GET /me/plannable-courses ─────────────────────────────────────────────
// Courses that fill remaining requirement slots, with term availability
router.get("/me/plannable-courses", (req, res) => {
  const { planId, term, program } = req.query;

  // Get student's current courses
  const courseRows = db.prepare(`
    SELECT course_code as code, semester, status,
           credits_override as creditsOverride,
           pinned_program as pinnedProgram
    FROM student_courses WHERE user_id = ?
  `).all(req.session.userId);

  const programRows = db.prepare("SELECT program_id FROM student_programs WHERE user_id = ?")
    .all(req.session.userId);
  const declaredPrograms = programRows.map(r => r.program_id);

  // Run solver against current courses
  const solverResult = solve(courseRows, declaredPrograms, courseMap, programMap, degreeRequirements);

  // Get plan courses to exclude
  const excludeCodes = new Set();
  if (planId) {
    const planCourses = db.prepare(
      "SELECT course_code FROM plan_courses WHERE plan_id = ? AND plan_id IN (SELECT id FROM student_plans WHERE user_id = ?)"
    ).all(planId, req.session.userId);
    for (const pc of planCourses) excludeCodes.add(pc.course_code);
  }

  // Get suggestions with minFills=1 for planner (includes single-fill courses)
  const suggestions = getSuggestions(solverResult, courseMap, programMap, declaredPrograms, {
    minFills: 1,
    excludeCodes,
  });

  // Augment with term availability (batched to avoid SQLite variable limits)
  const codes = suggestions.map(s => s.code);
  if (codes.length > 0) {
    const BATCH = 200;
    const termMap = {};
    try {
      for (let i = 0; i < codes.length; i += BATCH) {
        const chunk = codes.slice(i, i + BATCH);
        const placeholders = chunk.map(() => "?").join(",");
        const terms = db.prepare(
          `SELECT course_code, term FROM course_terms WHERE course_code IN (${placeholders})`
        ).all(...chunk);
        for (const t of terms) {
          if (!termMap[t.course_code]) termMap[t.course_code] = [];
          termMap[t.course_code].push(t.term);
        }
      }
      for (const s of suggestions) s.terms = termMap[s.code] || [];
    } catch (e) {
      for (const s of suggestions) s.terms = [];
    }
  }

  // Filter by term if specified
  let filtered = suggestions;
  if (term) {
    filtered = filtered.filter(s => s.terms.includes(term));
  }
  // Filter by program if specified
  if (program) {
    filtered = filtered.filter(s => s.fills.some(f => f.startsWith(programMap.get(program)?.name || program)));
  }

  // Get user's grad year for generating future terms
  const user = db.prepare("SELECT grad_year FROM users WHERE id = ?").get(req.session.userId);
  const futureTerms = generateFutureTerms(user?.grad_year);

  // Get scraped terms for availability reference (sorted chronologically)
  let scrapedTerms = [];
  try {
    scrapedTerms = db.prepare("SELECT DISTINCT term FROM course_terms")
      .all().map(r => r.term).sort((a, b) => termOrder(a) - termOrder(b));
  } catch (e) { /* table may not exist */ }

  res.json({
    courses: filtered,
    remaining: solverResult.remaining,
    programs: solverResult.programs,
    overlaps: solverResult.overlaps,
    credits: solverResult.credits,
    futureTerms,
    scrapedTerms,
  });
});

// ── POST /me/plans/:id/validate ───────────────────────────────────────────
// Run solver with plan courses as "planned" status, return warnings
router.post("/me/plans/:id/validate", (req, res) => {
  const plan = db.prepare("SELECT id FROM student_plans WHERE id = ? AND user_id = ?")
    .get(req.params.id, req.session.userId);
  if (!plan) return res.status(404).json({ error: "Plan not found" });

  // Get student's actual courses
  const courseRows = db.prepare(`
    SELECT course_code as code, semester, status,
           credits_override as creditsOverride,
           pinned_program as pinnedProgram
    FROM student_courses WHERE user_id = ?
  `).all(req.session.userId);

  // Get plan courses
  const planCourses = db.prepare(`
    SELECT pc.course_code as code, pc.term as semester, pc.section, pc.class_number
    FROM plan_courses pc WHERE pc.plan_id = ?
  `).all(plan.id);

  // Merge: actual + plan courses (plan as "planned" status)
  const merged = [
    ...courseRows,
    ...planCourses
      .filter(pc => !courseRows.some(cr => cr.code === pc.code))
      .map(pc => ({ code: pc.code, semester: pc.semester, status: "planned" })),
  ];

  const programRows = db.prepare("SELECT program_id FROM student_programs WHERE user_id = ?")
    .all(req.session.userId);
  const declaredPrograms = programRows.map(r => r.program_id);

  const result = solve(merged, declaredPrograms, courseMap, programMap, degreeRequirements);

  // Build warnings
  const warnings = [];

  // Check overlap violations
  for (const [key, pair] of Object.entries(result.overlaps.pairs || {})) {
    if (pair.max && pair.count > pair.max) {
      warnings.push({
        type: "overlap",
        message: `${key.replace("|", " / ")} overlap: ${pair.count}/${pair.max} courses shared (${pair.count - pair.max} over limit)`,
      });
    }
  }

  // Check credit overload per term (>18 is a warning)
  const termCredits = {};
  for (const c of merged) {
    if (!c.semester || c.semester === "Transfer") continue;
    const course = courseMap.get(c.code);
    const cr = c.creditsOverride || course?.credits || 3;
    termCredits[c.semester] = (termCredits[c.semester] || 0) + cr;
  }
  for (const [term, cr] of Object.entries(termCredits)) {
    if (cr > 18) {
      warnings.push({ type: "credit_overload", message: `${term}: ${cr} credits (over 18 credit limit)` });
    }
  }

  // Time conflict detection on selected sections — group by plan term, query with term filter
  const sectionsWithTerms = planCourses.filter(pc => pc.section && pc.class_number);
  if (sectionsWithTerms.length >= 2) {
    // Group plan courses by their planned term
    const planByTerm = {};
    for (const s of sectionsWithTerms) {
      if (!planByTerm[s.semester]) planByTerm[s.semester] = [];
      planByTerm[s.semester].push(s);
    }

    try {
      for (const [term, termSections] of Object.entries(planByTerm)) {
        if (termSections.length < 2) continue;
        const classNumbers = termSections.map(s => s.class_number);
        const placeholders = classNumbers.map(() => "?").join(",");
        const offerings = db.prepare(
          `SELECT course_code, term, section, days, start_time, end_time, class_number
           FROM course_offerings WHERE term = ? AND class_number IN (${placeholders})`
        ).all(term, ...classNumbers);

        for (let i = 0; i < offerings.length; i++) {
          for (let j = i + 1; j < offerings.length; j++) {
            const a = offerings[i], b = offerings[j];
            if (hasTimeConflict(a, b)) {
              warnings.push({
                type: "time_conflict",
                message: `${a.course_code} ${a.section} and ${b.course_code} ${b.section} overlap on ${term} (${a.days} ${a.start_time}-${a.end_time} vs ${b.days} ${b.start_time}-${b.end_time})`,
              });
            }
          }
        }
      }
    } catch (e) { /* offerings table may not exist */ }
  }

  res.json({ result, warnings });
});

/** Check if two sections have a time conflict */
function hasTimeConflict(a, b) {
  if (!a.days || !b.days || !a.start_time || !b.start_time || a.days === "TBA" || b.days === "TBA") return false;

  // Check day overlap
  const daysA = parseDays(a.days);
  const daysB = parseDays(b.days);
  const sharedDays = daysA.filter(d => daysB.includes(d));
  if (sharedDays.length === 0) return false;

  // Check time overlap
  const startA = parseTime(a.start_time), endA = parseTime(a.end_time);
  const startB = parseTime(b.start_time), endB = parseTime(b.end_time);
  return startA < endB && startB < endA;
}

function parseDays(days) {
  const result = [];
  let i = 0;
  while (i < days.length) {
    if (days[i] === "T" && days[i + 1] === "h") { result.push("Th"); i += 2; }
    else { result.push(days[i]); i++; }
  }
  return result;
}

function parseTime(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

module.exports = router;
