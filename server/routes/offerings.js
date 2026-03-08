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
  const rows = db.prepare(
    `SELECT * FROM course_offerings WHERE course_code = ? AND term = ? ORDER BY section`
  ).all(code, term);
  res.json(rows);
});

module.exports = router;
