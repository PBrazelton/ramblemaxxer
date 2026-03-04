/**
 * server/routes/courses.js
 * GET /api/courses         - full catalog
 * GET /api/courses/:code   - single course
 * GET /api/courses/search  - search by title or dept
 */

const express = require("express");
const coursesArray = require("../../data/courses.json");
const supplemental = require("../../data/courses-supplemental.json");

// Merge into a single map for lookups
const allCourses = new Map();
for (const c of coursesArray) allCourses.set(c.code, c);
for (const c of supplemental) { if (!allCourses.has(c.code)) allCourses.set(c.code, c); }

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

router.get("/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  const course = allCourses.get(code);
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json(course);
});

module.exports = router;
