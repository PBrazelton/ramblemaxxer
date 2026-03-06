/**
 * server/lib/transcript-matcher.js
 * Matches parsed transcript courses against the courses DB table.
 *
 * Strategy (in order):
 * 1. Exact match by code
 * 2. Suffix strip (UCLR 100C → UCLR 100, and reverse)
 * 3. Cross-listing lookup
 * 4. FTS fuzzy match using department + title words
 * 5. Unmatched bucket
 */

const db = require("../db/connection");

// Prepared statements (lazy-init)
let stmts = null;
function getStmts() {
  if (stmts) return stmts;
  stmts = {
    exact: db.prepare("SELECT * FROM courses WHERE code = ?"),
    crossList: db.prepare(`
      SELECT c.* FROM courses c
      JOIN course_cross_listings x ON x.course_code = c.code
      WHERE x.cross_listed_code = ?
    `),
    fts: db.prepare(`
      SELECT c.* FROM courses_fts f
      JOIN courses c ON c.id = f.rowid
      WHERE courses_fts MATCH ?
      LIMIT 5
    `),
  };
  return stmts;
}

/**
 * Match a single parsed course against the DB.
 * @param {Object} parsed - { code, department, number, title, ... }
 * @returns {{ match: Object|null, matchType: string, confidence: number }}
 */
function matchCourse(parsed) {
  const s = getStmts();
  const code = parsed.code;

  // 1. Exact match
  const exact = s.exact.get(code);
  if (exact) return { match: exact, matchType: "exact", confidence: 1.0 };

  // 2. Suffix strip: try removing trailing letter (UCLR 100C → UCLR 100)
  const suffixStripped = code.replace(/([A-Z])$/, "");
  if (suffixStripped !== code) {
    const m = s.exact.get(suffixStripped);
    if (m) return { match: m, matchType: "suffix_strip", confidence: 0.9 };
  }

  // 2b. Reverse: try adding common suffixes
  for (const suffix of ["A", "B", "C"]) {
    const m = s.exact.get(code + suffix);
    if (m) return { match: m, matchType: "suffix_add", confidence: 0.85 };
  }

  // 3. Cross-listing
  const cross = s.crossList.get(code);
  if (cross) return { match: cross, matchType: "cross_listing", confidence: 0.9 };

  // 4. FTS fuzzy — use dept + first meaningful title words
  try {
    const titleWords = parsed.title
      .replace(/[^a-zA-Z0-9\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2)
      .slice(0, 3)
      .join(" ");

    if (titleWords) {
      const query = `${parsed.department} ${titleWords}`;
      // FTS5 requires proper quoting for multi-word queries
      const ftsResults = s.fts.all(`"${query.replace(/"/g, '""')}"`);

      // Try unquoted prefix match if quoted fails
      const results = ftsResults.length > 0 ? ftsResults
        : s.fts.all(query.split(/\s+/).map(w => w + "*").join(" "));

      if (results.length > 0) {
        // Pick best match: same department preferred
        const sameDept = results.find(r => r.department === parsed.department);
        const best = sameDept || results[0];
        return { match: best, matchType: "fts_fuzzy", confidence: sameDept ? 0.7 : 0.5 };
      }
    }
  } catch (e) {
    // FTS query syntax error — skip fuzzy matching
  }

  // 5. Unmatched
  return { match: null, matchType: "unmatched", confidence: 0 };
}

/**
 * Match all parsed transcript courses against the DB.
 * @param {Object} transcript - Output of parseTranscript()
 * @returns {Object[]} - Array of { parsed, match, matchType, confidence, term }
 */
function matchTranscript(transcript) {
  const results = [];

  // Match transfer credit items
  for (const parsed of transcript.transferCredits.items) {
    const { match, matchType, confidence } = matchCourse(parsed);
    results.push({ parsed, match, matchType, confidence, term: "Transfer" });
  }

  // Match term courses
  for (const term of transcript.terms) {
    for (const parsed of term.courses) {
      const { match, matchType, confidence } = matchCourse(parsed);
      results.push({ parsed, match, matchType, confidence, term: term.name });
    }
  }

  return results;
}

module.exports = { matchCourse, matchTranscript };
