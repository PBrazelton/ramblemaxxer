/**
 * server/routes/courses.js
 * GET /api/courses         - full catalog
 * GET /api/courses/:code   - single course
 * GET /api/courses/search  - search by title or dept
 */

const express = require("express");
const courses = require("../../data/courses.json");
const programTags = require("../../data/course_program_tags.json");

const router = express.Router();

router.get("/", (req, res) => {
  res.json(courses);
});

router.get("/search", (req, res) => {
  const { q, dept, glstOnly } = req.query;
  let results = Object.entries(courses).map(([code, data]) => ({ code, ...data }));

  if (q) {
    const term = q.toLowerCase();
    results = results.filter(
      (c) => c.code.toLowerCase().includes(term) || (c.title || "").toLowerCase().includes(term)
    );
  }
  if (dept) {
    results = results.filter((c) => c.dept === dept.toUpperCase());
  }
  if (glstOnly === "true") {
    results = results.filter((c) => c.glstTag === true);
  }

  res.json(results.slice(0, 50));
});

router.get("/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  const course = courses[code];
  if (!course) return res.status(404).json({ error: "Course not found" });
  res.json({ code, ...course, tags: programTags[code] || {} });
});

module.exports = router;
