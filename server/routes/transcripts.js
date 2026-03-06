/**
 * server/routes/transcripts.js
 *
 * POST /api/transcript/parse   — upload PDF, parse + match, return results
 * POST /api/transcript/confirm — save matched courses to student_courses
 */

const express = require("express");
const multer = require("multer");
const { requireAuth } = require("./auth");
const { parseTranscript } = require("../lib/transcript-parser");
const { matchTranscript } = require("../lib/transcript-matcher");
const db = require("../db/connection");
const { solve, getSuggestions } = require("../../shared/solver");
const { courseMap, programMap, degreeRequirements } = require("../lib/catalog");

const router = express.Router();
router.use(requireAuth);

// multer: memory storage, 2MB max, single file field "file"
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
});

// ── POST /api/transcript/parse ──────────────────────────────────────────────
router.post("/parse", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Validate PDF: check MIME type and magic bytes
    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "File must be a PDF" });
    }
    if (!req.file.buffer.slice(0, 5).toString().startsWith("%PDF")) {
      return res.status(400).json({ error: "File does not appear to be a valid PDF" });
    }

    // Parse PDF
    const transcript = await parseTranscript(req.file.buffer);

    // Debug: log parse result
    const totalCourses = transcript.terms.reduce((s, t) => s + t.courses.length, 0);
    console.log("[transcript] terms:", transcript.terms.length,
      "courses:", totalCourses,
      "transfer:", transcript.transferCredits.items.length,
      "warnings:", transcript.warnings);
    for (const t of transcript.terms) {
      console.log(`  ${t.name}: ${t.courses.length} courses`, t.courses.map(c => c.code));
    }
    if (totalCourses === 0) {
      // Dump raw text for debugging
      const pdfParse = require("pdf-parse");
      const { text } = await pdfParse(req.file.buffer);
      console.log("[transcript] Raw PDF text (first 3000 chars):\n", text.slice(0, 3000));
    }

    // Match against courses DB
    const matches = matchTranscript(transcript);

    // Group by term
    const termGroups = {};
    for (const m of matches) {
      if (!termGroups[m.term]) termGroups[m.term] = [];
      termGroups[m.term].push({
        code: m.parsed.code,
        title: m.parsed.title,
        credits: m.parsed.credits,
        creditsEarned: m.parsed.creditsEarned,
        grade: m.parsed.grade,
        status: m.parsed.status,
        matchedCode: m.match?.code || null,
        matchedTitle: m.match?.title || null,
        matchType: m.matchType,
        confidence: m.confidence,
      });
    }

    // Build ordered term list
    const termOrder = (name) => {
      if (name === "Transfer") return 0;
      const m = name.match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
      if (!m) return 1;
      const year = parseInt(m[2]);
      const season = m[1] === "Spring" ? 0 : m[1] === "Summer" ? 1 : 2;
      return year * 3 + season;
    };

    const terms = Object.entries(termGroups)
      .sort(([a], [b]) => termOrder(a) - termOrder(b))
      .map(([name, courses]) => ({ name, courses }));

    // Summary stats
    const total = matches.length;
    const exact = matches.filter(m => m.matchType === "exact").length;
    const fuzzy = matches.filter(m => ["suffix_strip", "suffix_add", "cross_listing", "fts_fuzzy"].includes(m.matchType)).length;
    const unmatched = matches.filter(m => m.matchType === "unmatched").length;

    res.json({
      student: transcript.student,
      terms,
      transferCredits: transcript.transferCredits,
      cumGpa: transcript.cumGpa,
      cumCreditsEarned: transcript.cumCreditsEarned,
      summary: { total, exact, fuzzy, unmatched },
      warnings: transcript.warnings,
    });
  } catch (err) {
    console.error("Transcript parse error:", err);
    res.status(500).json({ error: "Failed to parse transcript" });
  }
});

// ── POST /api/transcript/confirm ────────────────────────────────────────────
router.post("/confirm", (req, res) => {
  try {
    const { courses, transferCredits, programs, gradYear } = req.body;

    if (!Array.isArray(courses)) {
      return res.status(400).json({ error: "courses must be an array" });
    }

    const userId = req.session.userId;

    db.transaction(() => {
      // 1. Update grad_year if provided
      if (gradYear) {
        db.prepare("UPDATE users SET grad_year = ? WHERE id = ?").run(gradYear, userId);
      }

      // 2. Set programs (delete + re-insert)
      if (Array.isArray(programs) && programs.length > 0) {
        db.prepare("DELETE FROM student_programs WHERE user_id = ?").run(userId);
        const insertProg = db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)");
        for (const pid of programs) {
          insertProg.run(userId, pid);
        }
      }

      // 3. Insert courses
      const insertCourse = db.prepare(`
        INSERT OR IGNORE INTO student_courses (user_id, course_code, semester, status)
        VALUES (?, ?, ?, ?)
      `);

      for (const c of courses) {
        const code = (c.matchedCode || c.code).toUpperCase();
        insertCourse.run(userId, code, c.semester, c.status);
      }

      // 4. Insert transfer credit items
      if (transferCredits?.items) {
        for (const t of transferCredits.items) {
          const code = (t.matchedCode || t.code).toUpperCase();
          insertCourse.run(userId, code, "Transfer", "transfer");
        }
      }
    })();

    // 5. Run solver
    const courseRows = db.prepare(`
      SELECT course_code as code, semester, status,
             credits_override as creditsOverride,
             pinned_program as pinnedProgram
      FROM student_courses WHERE user_id = ?
    `).all(userId);

    const programRows = db.prepare(`
      SELECT program_id FROM student_programs WHERE user_id = ?
    `).all(userId);

    const declaredPrograms = programRows.map(r => r.program_id);
    const result = solve(courseRows, declaredPrograms, courseMap, programMap, degreeRequirements);
    const suggestions = getSuggestions(result, courseMap, programMap, declaredPrograms);

    res.json({ ok: true, ...result, suggestions });
  } catch (err) {
    console.error("Transcript confirm error:", err);
    res.status(500).json({ error: "Failed to save transcript data" });
  }
});

module.exports = router;
