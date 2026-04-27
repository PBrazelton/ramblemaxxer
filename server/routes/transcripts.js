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

// Inline grade validation (mirrors shared/gpa.js ALL_GRADES)
const VALID_GRADES = new Set([
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F",
  "P", "NP", "W", "WF", "I", "AU", "NR",
]);
function isValidGrade(g) { return g == null || g === "" || VALID_GRADES.has(g); }

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

    // Log parse summary for testing
    const totalCourses = transcript.terms.reduce((s, t) => s + t.courses.length, 0);
    console.log("[transcript] parsed:", totalCourses, "courses across", transcript.terms.length, "terms",
      transcript.warnings.length ? `(${transcript.warnings.length} warnings)` : "");

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
        inferred: m.parsed.inferred || false,
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
    const inferred = matches.filter(m => m.parsed.inferred).length;

    res.json({
      student: transcript.student,
      terms,
      transferCredits: transcript.transferCredits,
      cumGpa: transcript.cumGpa,
      cumCreditsEarned: transcript.cumCreditsEarned,
      summary: { total, exact, fuzzy, unmatched, inferred },
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

      // 2. Set programs (always delete + re-insert to avoid stale declarations)
      db.prepare("DELETE FROM student_programs WHERE user_id = ?").run(userId);
      if (Array.isArray(programs) && programs.length > 0) {
        const insertProg = db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)");
        for (const pid of programs) {
          insertProg.run(userId, pid);
        }
      }

      // 3. UPSERT courses from transcript. On re-import we preserve manual
      //    fields (grade_plan_json, note, pinned_program, satisfies_json,
      //    section, class_number) and only refresh transcript-sourced fields
      //    (status, grade). Pre-existing rows that aren't in the transcript
      //    are left alone — student may have manually added them.
      const upsertCourse = db.prepare(`
        INSERT INTO student_courses (user_id, course_code, semester, status, grade)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(user_id, course_code, semester) DO UPDATE SET
          status = excluded.status,
          grade = COALESCE(excluded.grade, student_courses.grade)
      `);

      for (const c of courses) {
        const code = (c.matchedCode || c.code).toUpperCase();
        const grade = isValidGrade(c.grade) ? (c.grade || null) : null;
        upsertCourse.run(userId, code, c.semester, c.status, grade);
      }

      // 4. UPSERT transfer credit items
      if (transferCredits?.items) {
        for (const t of transferCredits.items) {
          const code = (t.matchedCode || t.code).toUpperCase();
          upsertCourse.run(userId, code, "Transfer", "transfer", null);
        }
      }

      // 5. Set onboarding_step = 4 (server-authoritative)
      db.prepare("UPDATE users SET onboarding_step = 4 WHERE id = ?").run(userId);
    })();

    // 5. Run solver
    const courseRows = db.prepare(`
      SELECT course_code as code, semester, status,
             credits_override as creditsOverride,
             pinned_program as pinnedProgram,
             satisfies_json as satisfiesJson
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
