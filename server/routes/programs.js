/**
 * server/routes/programs.js
 * Public endpoints for program definitions (no auth required).
 *
 * GET /api/programs                              - list active programs
 * GET /api/programs/:code                        - full program detail
 * GET /api/programs/:code/eligible-courses/:catId - eligible courses for one category
 */

const express = require("express");
const db = require("../db/connection");

const router = express.Router();

// List active programs (summary)
router.get("/", (req, res) => {
  try {
    const programs = db.prepare(`
      SELECT p.code, p.name, p.type, p.department, p.total_credits,
        (SELECT COUNT(*) FROM program_categories pc WHERE pc.program_code = p.code) AS category_count
      FROM programs p
      WHERE p.is_active = 1
      ORDER BY p.type, p.name
    `).all();
    res.json(programs);
  } catch (e) {
    res.status(500).json({ error: "Failed to load programs" });
  }
});

// Full program detail with categories, eligible courses, overlap rules
router.get("/:code", (req, res) => {
  const { code } = req.params;

  const program = db.prepare("SELECT * FROM programs WHERE code = ? AND is_active = 1").get(code);
  if (!program) return res.status(404).json({ error: "Program not found" });

  // Parse JSON fields
  if (program.core_waivers) program.core_waivers = JSON.parse(program.core_waivers);
  if (program.notes) program.notes = JSON.parse(program.notes);
  if (program.elective_pool_by_region) program.elective_pool_by_region = JSON.parse(program.elective_pool_by_region);

  // Categories with eligible courses
  const categories = db.prepare(
    "SELECT * FROM program_categories WHERE program_code = ? ORDER BY sort_order"
  ).all(code);

  program.categories = categories.map((cat) => {
    if (cat.constraints) cat.constraints = JSON.parse(cat.constraints);

    const eligible = db.prepare(
      "SELECT course_code, is_required, notes FROM category_eligible_courses WHERE category_id = ?"
    ).all(cat.id);

    cat.eligible_courses = eligible;
    return cat;
  });

  // Overlap rules involving this program
  program.overlap_rules = db.prepare(
    "SELECT * FROM overlap_rules WHERE program_a = ? OR program_b = ?"
  ).all(code, code).map((r) => {
    if (r.notes) r.notes = JSON.parse(r.notes);
    return r;
  });

  res.json(program);
});

// Eligible courses for one category, joined with courses table
router.get("/:code/eligible-courses/:categoryId", (req, res) => {
  const { code, categoryId } = req.params;

  // Verify the category belongs to this program
  const cat = db.prepare(
    "SELECT * FROM program_categories WHERE id = ? AND program_code = ?"
  ).get(categoryId, code);
  if (!cat) return res.status(404).json({ error: "Category not found" });

  const courses = db.prepare(`
    SELECT ce.course_code, ce.is_required, ce.notes AS eligibility_notes,
      c.title, c.credits, c.department, c.number, c.knowledge_area,
      c.writing_intensive, c.engaged_learning, c.description
    FROM category_eligible_courses ce
    LEFT JOIN courses c ON c.code = ce.course_code
    WHERE ce.category_id = ?
    ORDER BY ce.course_code
  `).all(categoryId);

  res.json({ category: cat.name, wildcard: cat.wildcard, courses });
});

module.exports = router;
