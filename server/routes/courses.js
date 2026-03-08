/**
 * server/routes/courses.js
 * GET /api/courses             - full catalog (optional dept filter + limit)
 * GET /api/courses/search      - FTS5 search with prefix matching
 * GET /api/courses/departments - department list with counts
 * GET /api/courses/for-slot    - eligible courses for a requirement slot
 * GET /api/courses/:code       - single course with tags + cross-listings
 */

const express = require("express");
const { allCourses, programMap } = require("../lib/catalog");
const { requireAuth } = require("./auth");
const db = require("../db/connection");

const router = express.Router();

// Check if courses table has data (DB-backed mode)
let dbMode = false;
try {
  const row = db.prepare("SELECT COUNT(*) as count FROM courses").get();
  dbMode = row && row.count > 0;
} catch (e) { /* table doesn't exist */ }

// ── Helper: hydrate a DB row into a course object with junction data ────────
function hydrateCourse(row) {
  if (!row) return null;
  const tags = db.prepare(
    "SELECT tag FROM course_interdisciplinary_tags WHERE course_code = ?"
  ).all(row.code).map(r => r.tag);
  const crossListings = db.prepare(
    "SELECT cross_listed_code FROM course_cross_listings WHERE course_code = ?"
  ).all(row.code).map(r => r.cross_listed_code);

  return {
    code: row.code,
    department: row.department,
    number: row.number,
    title: row.title,
    credits: row.credits,
    credits_min: row.credits_min,
    credits_max: row.credits_max,
    prerequisites: row.prerequisites,
    knowledge_area: row.knowledge_area,
    interdisciplinary_options: tags,
    cross_listings: crossListings,
    engaged_learning: !!row.engaged_learning,
    writing_intensive: !!row.writing_intensive,
    description: row.description,
  };
}

// ── GET /api/courses ────────────────────────────────────────────────────────
router.get("/", (req, res) => {
  const { dept, limit } = req.query;

  if (dbMode) {
    let sql = "SELECT * FROM courses";
    const params = [];
    if (dept) { sql += " WHERE department = ?"; params.push(dept.toUpperCase()); }
    sql += " ORDER BY department, number";
    if (limit) { sql += " LIMIT ?"; params.push(parseInt(limit, 10)); }
    const rows = db.prepare(sql).all(...params);
    return res.json(rows.map(hydrateCourse));
  }

  let results = [...allCourses.values()];
  if (dept) results = results.filter(c => c.department === dept.toUpperCase());
  if (limit) results = results.slice(0, parseInt(limit, 10));
  res.json(results);
});

// ── GET /api/courses/search ─────────────────────────────────────────────────
router.get("/search", (req, res) => {
  const { q, dept, glstOnly, limit } = req.query;
  const maxResults = Math.min(parseInt(limit, 10) || 50, 200);

  if (dbMode && q) {
    try {
      // FTS5 prefix matching: "biol*" matches "biology", "BIOL 101", etc.
      const ftsQuery = q.replace(/[^\w\s]/g, "").trim();
      if (!ftsQuery) return res.json([]);

      let sql = `
        SELECT c.* FROM courses_fts f
        JOIN courses c ON c.id = f.rowid
        WHERE courses_fts MATCH ?
      `;
      const params = [`"${ftsQuery}"*`];

      if (dept) { sql += " AND c.department = ?"; params.push(dept.toUpperCase()); }
      sql += ` ORDER BY rank LIMIT ?`;
      params.push(maxResults);

      const rows = db.prepare(sql).all(...params);
      let results = rows.map(hydrateCourse);

      if (glstOnly === "true") {
        results = results.filter(c => c.interdisciplinary_options.includes("Global Studies"));
      }

      return res.json(results);
    } catch (e) {
      // FTS error — fall through to LIKE fallback
    }
  }

  // Fallback: in-memory search (JSON mode or FTS failure)
  let results = [...allCourses.values()];
  if (q) {
    const term = q.toLowerCase();
    results = results.filter(c => c.code.toLowerCase().includes(term) || (c.title||"").toLowerCase().includes(term));
  }
  if (dept) results = results.filter(c => c.department === dept.toUpperCase());
  if (glstOnly === "true") results = results.filter(c => c.interdisciplinary_options?.includes("Global Studies"));
  res.json(results.slice(0, maxResults));
});

// ── GET /api/courses/departments ────────────────────────────────────────────
router.get("/departments", (req, res) => {
  if (dbMode) {
    const rows = db.prepare(
      "SELECT department, COUNT(*) as count FROM courses GROUP BY department ORDER BY department"
    ).all();
    return res.json(rows);
  }

  // Fallback: count from in-memory map
  const counts = {};
  for (const c of allCourses.values()) {
    counts[c.department] = (counts[c.department] || 0) + 1;
  }
  res.json(
    Object.entries(counts)
      .map(([department, count]) => ({ department, count }))
      .sort((a, b) => a.department.localeCompare(b.department))
  );
});

// ── GET /api/courses/for-slot ───────────────────────────────────────────────
router.get("/for-slot", requireAuth, (req, res) => {
  const { programId, categoryName } = req.query;
  const userId = req.session.userId;

  const programDef = programMap.get(programId);
  if (!programDef) return res.status(404).json({ error: "Program not found" });
  const categoryDef = programDef.categories.find(c => c.name === categoryName);
  if (!categoryDef) return res.status(404).json({ error: "Category not found" });

  // Build eligible course list
  const eligible = getEligibleCodes(categoryDef);

  // Student's taken courses
  const taken = new Set(
    db.prepare("SELECT course_code FROM student_courses WHERE user_id = ?")
      .all(userId).map(r => r.course_code)
  );

  // Friends: users I invited + user who invited me, with privacy = 'friends'
  const friendCourses = getFriendsWithCourses(userId);

  const results = eligible.map(code => {
    const course = allCourses.get(code);
    if (!course) return null;
    return {
      code: course.code,
      title: course.title,
      credits: course.credits,
      description: course.description,
      prerequisites: course.prerequisites,
      knowledge_area: course.knowledge_area,
      interdisciplinary_options: course.interdisciplinary_options,
      engaged_learning: course.engaged_learning,
      writing_intensive: course.writing_intensive,
      department: course.department,
      number: course.number,
      alreadyTaken: taken.has(code),
      friends: friendCourses[code] || [],
    };
  }).filter(Boolean);

  // Sort: untaken first, then by friend count desc, then alphabetical
  results.sort((a, b) => {
    if (a.alreadyTaken !== b.alreadyTaken) return a.alreadyTaken ? 1 : -1;
    return b.friends.length - a.friends.length || a.code.localeCompare(b.code);
  });

  res.json(results);
});

function getEligibleCodes(categoryDef) {
  const ec = categoryDef.eligible_courses;
  const ecf = categoryDef.eligible_courses_fixed;
  if (ecf) return ecf.map(e => e.course);
  if (Array.isArray(ec)) return ec;
  if (ec === "ANY_PLSC_200_PLUS")
    return [...allCourses.values()]
      .filter(c => c.department === "PLSC" && c.number >= 200)
      .map(c => c.code);
  if (ec === "ANY_GLST_TAGGED")
    return [...allCourses.values()]
      .filter(c => c.interdisciplinary_options?.includes("Global Studies"))
      .map(c => c.code);
  return [];
}

function getFriendsWithCourses(userId) {
  const iInvited = db.prepare(
    "SELECT id FROM users WHERE invited_by = ? AND active = 1"
  ).all(userId).map(r => r.id);
  const whoInvitedMe = db.prepare(
    "SELECT invited_by FROM users WHERE id = ?"
  ).get(userId)?.invited_by;
  const friendIds = [...iInvited, whoInvitedMe].filter(Boolean);
  if (friendIds.length === 0) return {};

  const placeholders = friendIds.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT sc.course_code, u.id, u.name
    FROM student_courses sc
    JOIN users u ON u.id = sc.user_id
    WHERE sc.user_id IN (${placeholders})
      AND u.privacy = 'friends'
      AND u.active = 1
  `).all(...friendIds);

  return rows.reduce((acc, row) => {
    if (!acc[row.course_code]) acc[row.course_code] = [];
    acc[row.course_code].push({ id: row.id, name: row.name });
    return acc;
  }, {});
}

// ── GET /api/courses/:code ──────────────────────────────────────────────────
router.get("/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");

  if (dbMode) {
    const row = db.prepare("SELECT * FROM courses WHERE code = ?").get(code);
    if (!row) return res.status(404).json({ error: "Course not found" });
    const course = hydrateCourse(row);
    // Attach term availability from course_terms
    try {
      course.terms = db.prepare(
        "SELECT term, section_count FROM course_terms WHERE course_code = ? ORDER BY term"
      ).all(code);
    } catch (e) { course.terms = []; }
    return res.json(course);
  }

  const course = allCourses.get(code);
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json(course);
});

module.exports = router;
