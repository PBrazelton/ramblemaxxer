/**
 * server/routes/offerings.js
 * GET /api/offerings/terms              - list all scraped terms
 * GET /api/offerings/available          - batch: which courses have offerings in a term
 * GET /api/offerings/:code              - all offerings for a course (all terms)
 * GET /api/offerings/:code/:term        - offerings for a course in a specific term
 */

const express = require("express");
const db = require("../db/connection");

const router = express.Router();

// ── GET /api/offerings/terms ──────────────────────────────────────────────
router.get("/terms", (req, res) => {
  const rows = db.prepare(
    "SELECT DISTINCT term FROM course_terms ORDER BY term"
  ).all();
  res.json(rows.map(r => r.term));
});

// ── GET /api/offerings/available ──────────────────────────────────────────
// ?term=Fall+2025&codes=PLSC+102,HIST+101
router.get("/available", (req, res) => {
  const { term, codes } = req.query;
  if (!term || !codes) return res.status(400).json({ error: "term and codes required" });

  const codeList = codes.split(",").map(c => c.trim()).filter(Boolean).slice(0, 100);
  if (codeList.length === 0) return res.json({});

  const placeholders = codeList.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT course_code, section_count FROM course_terms
     WHERE term = ? AND course_code IN (${placeholders})`
  ).all(term, ...codeList);

  const result = {};
  for (const row of rows) {
    result[row.course_code] = row.section_count;
  }
  res.json(result);
});

// ── GET /api/offerings/:code ──────────────────────────────────────────────
router.get("/:code", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  const rows = db.prepare(
    `SELECT * FROM course_offerings WHERE course_code = ? ORDER BY term, section`
  ).all(code);
  res.json(rows);
});

// ── GET /api/offerings/:code/:term ────────────────────────────────────────
router.get("/:code/:term", (req, res) => {
  const code = req.params.code.toUpperCase().replace("-", " ");
  const term = req.params.term;

  // Collect all codes to search (primary + cross-listed)
  const codes = [code];
  try {
    const crossListings = db.prepare(
      "SELECT cross_listed_code FROM course_cross_listings WHERE course_code = ? UNION SELECT course_code FROM course_cross_listings WHERE cross_listed_code = ?"
    ).all(code, code);
    for (const cl of crossListings) {
      if (!codes.includes(cl.cross_listed_code || cl.course_code)) {
        codes.push(cl.cross_listed_code || cl.course_code);
      }
    }
  } catch (e) { /* table may not exist */ }

  let rows;
  const placeholders = codes.map(() => "?").join(",");
  try {
    rows = db.prepare(`
      SELECT co.*,
             COALESCE(pr.overall_rating, pr2.overall_rating) AS rmp_rating,
             COALESCE(pr.num_ratings, pr2.num_ratings) AS rmp_num_ratings,
             COALESCE(pr.difficulty, pr2.difficulty) AS rmp_difficulty,
             COALESCE(pr.would_take_again, pr2.would_take_again) AS rmp_would_take_again,
             COALESCE(pr.rmp_url, pr2.rmp_url) AS rmp_url
      FROM course_offerings co
      LEFT JOIN instructor_rmp_matches irm ON irm.instructor_name = co.instructor
      LEFT JOIN professor_ratings pr ON pr.rmp_id = irm.rmp_id
      LEFT JOIN instructor_rmp_matches irm2 ON co.instructor LIKE '%,%'
        AND irm2.instructor_name = TRIM(SUBSTR(co.instructor, 1, INSTR(co.instructor, ',') - 1))
      LEFT JOIN professor_ratings pr2 ON pr2.rmp_id = irm2.rmp_id
      WHERE co.course_code IN (${placeholders}) AND co.term = ?
      ORDER BY co.section
    `).all(...codes, term);
  } catch (e) {
    rows = db.prepare(
      `SELECT * FROM course_offerings WHERE course_code IN (${placeholders}) AND term = ? ORDER BY section`
    ).all(...codes, term);
  }
  res.json(rows);
});

module.exports = router;
