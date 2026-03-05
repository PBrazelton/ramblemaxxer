/**
 * server/routes/courses.js
 * GET /api/courses           - full catalog
 * GET /api/courses/search    - search by title or dept
 * GET /api/courses/for-slot  - eligible courses for a requirement slot
 * GET /api/courses/:code     - single course
 */

const express = require("express");
const { allCourses, programMap } = require("../lib/catalog");
const { requireAuth } = require("./auth");
const db = require("../db/connection");

const router = express.Router();

router.get("/", (req, res) => {
  res.json([...allCourses.values()]);
});

router.get("/search", (req, res) => {
  const { q, dept, glstOnly } = req.query;
  let results = [...allCourses.values()];
  if (q) {
    const term = q.toLowerCase();
    results = results.filter(c => c.code.toLowerCase().includes(term) || (c.title||"").toLowerCase().includes(term));
  }
  if (dept) results = results.filter(c => c.department === dept.toUpperCase());
  if (glstOnly === "true") results = results.filter(c => c.interdisciplinary_options?.includes("Global Studies"));
  res.json(results.slice(0, 50));
});

// ── GET /api/courses/for-slot ────────────────────────────────────────────────
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

router.get("/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  const course = allCourses.get(code);
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json(course);
});

module.exports = router;
