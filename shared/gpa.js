/**
 * shared/gpa.js — GPA computation, grade scale, syllabus calculator math.
 * ES module — imported by client (Vite). Server-side, the only validation
 * function (isValidGrade) is small enough to inline at call sites.
 *
 * LUC policy:
 *  - Plus/minus grades on standard 4.0 scale
 *  - F and WF count as 0.0 quality points (toward GPA)
 *  - W, I, AU, NR, P, NP excluded from GPA math
 *  - Repeated courses: most recent attempt counts; earlier attempts excluded
 *  - Transfer credits excluded from GPA (separate status)
 */

// ── Letter → quality points ─────────────────────────────────────────────────
export const LETTER_TO_POINTS = {
  "A":  4.0,
  "A-": 3.7,
  "B+": 3.3,
  "B":  3.0,
  "B-": 2.7,
  "C+": 2.3,
  "C":  2.0,
  "C-": 1.7,
  "D+": 1.3,
  "D":  1.0,
  "D-": 0.7,
  "F":  0.0,
  "WF": 0.0,
};

// Grades that exist in records but don't factor into GPA
export const NON_GPA_GRADES = new Set(["P", "NP", "W", "I", "AU", "NR"]);

// All recognized grade values (for input validation)
export const ALL_GRADES = [
  "A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F",
  "P", "NP", "W", "WF", "I", "AU", "NR",
];

const GRADE_SET = new Set(ALL_GRADES);

export function isValidGrade(g) {
  return g == null || g === "" || GRADE_SET.has(g);
}

export function letterToPoints(letter) {
  if (letter == null) return null;
  return LETTER_TO_POINTS[letter] ?? null;
}

// ── Default percentage → letter scale (LUC standard) ────────────────────────
export const DEFAULT_SCALE = [
  { letter: "A",  min: 93 },
  { letter: "A-", min: 90 },
  { letter: "B+", min: 87 },
  { letter: "B",  min: 83 },
  { letter: "B-", min: 80 },
  { letter: "C+", min: 77 },
  { letter: "C",  min: 73 },
  { letter: "C-", min: 70 },
  { letter: "D+", min: 67 },
  { letter: "D",  min: 63 },
  { letter: "D-", min: 60 },
  { letter: "F",  min: 0  },
];

export function pctToLetter(pct, scale) {
  const s = (scale && scale.length > 0) ? scale : DEFAULT_SCALE;
  // scale must be sorted descending by min
  const sorted = [...s].sort((a, b) => b.min - a.min);
  for (const tier of sorted) {
    if (pct >= tier.min) return tier.letter;
  }
  return "F";
}

// ── Term ordering (v1: Fall > Summer > Spring; "Transfer" excluded) ─────────
const SEASON_RANK = { fall: 3, summer: 2, spring: 1 };

export function parseSemester(sem) {
  if (!sem || sem === "Transfer") return null;
  const m = String(sem).match(/^(Fall|Spring|Summer)\s+(\d{4})$/i);
  if (!m) return null;
  const season = m[1].toLowerCase();
  const year = parseInt(m[2], 10);
  return { year, season, rank: SEASON_RANK[season] || 0 };
}

export function compareSemesters(a, b) {
  // returns positive if a is more recent than b
  const pa = parseSemester(a);
  const pb = parseSemester(b);
  if (!pa && !pb) return 0;
  if (!pa) return -1;
  if (!pb) return 1;
  if (pa.year !== pb.year) return pa.year - pb.year;
  return pa.rank - pb.rank;
}

// ── Most-recent-attempt filter (LUC repeat-replace policy) ──────────────────
export function mostRecentAttempts(courses) {
  // Group by code, keep only the row with the latest semester. Transfer rows
  // are kept (they have no semester to compare and don't replace LUC grades).
  const byCode = new Map();
  for (const c of courses) {
    if (c.status === "transfer") {
      // Transfer rows kept verbatim — they don't participate in repeat-replace
      const key = `__transfer__${c.code}__${c.semester || ""}`;
      byCode.set(key, c);
      continue;
    }
    const existing = byCode.get(c.code);
    if (!existing) {
      byCode.set(c.code, c);
    } else {
      const cmp = compareSemesters(c.semester, existing.semester);
      if (cmp > 0) byCode.set(c.code, c);
    }
  }
  return Array.from(byCode.values());
}

// ── GPA computation ─────────────────────────────────────────────────────────
export function getCredits(course, courseMap) {
  if (course.creditsOverride != null) return course.creditsOverride;
  const fromMap = courseMap?.get?.(course.code);
  if (fromMap?.credits != null) return fromMap.credits;
  return 3;
}

export function computeGPA(courses, courseMap) {
  // Apply most-recent filter
  const filtered = mostRecentAttempts(courses);
  let totalPoints = 0;
  let totalCredits = 0;
  let gradedCount = 0;
  let untalliedCredits = 0; // P/W/I/etc. credits that "count" toward graduation but not GPA

  for (const c of filtered) {
    if (c.status === "transfer" || c.status === "planned") continue;
    if (!c.grade) continue;
    if (NON_GPA_GRADES.has(c.grade)) {
      untalliedCredits += getCredits(c, courseMap);
      continue;
    }
    const pts = letterToPoints(c.grade);
    if (pts == null) continue;
    const credits = getCredits(c, courseMap);
    totalPoints += pts * credits;
    totalCredits += credits;
    gradedCount++;
  }

  return {
    gpa: totalCredits > 0 ? totalPoints / totalCredits : null,
    totalCredits,
    gradedCount,
    untalliedCredits,
  };
}

// ── Syllabus calculator ─────────────────────────────────────────────────────
/**
 * categories: [{ name, weight (0-1 or 0-100), scoreEarned, scoreOut, scenario }]
 *   - if scoreEarned/scoreOut both present → "earned" entry, contributes (scoreEarned/scoreOut)*100 * weight
 *   - else if scenario present (0-100) → projected, contributes scenario * weight
 *   - else → unfilled, weight remains "open"
 *
 * scaleOverride: optional [{letter, min}, ...]
 *
 * Returns:
 *   { weightSum, currentPct (earned-only), projectedPct (earned + scenarios),
 *     projectedLetter, openWeight, isComplete }
 */
export function computeWeightedScore({ categories, scaleOverride } = {}) {
  if (!Array.isArray(categories) || categories.length === 0) {
    return { weightSum: 0, currentPct: null, projectedPct: null, projectedLetter: null, openWeight: 1, isComplete: false };
  }

  // Normalize weights (allow 0-1 or 0-100; if any > 1, treat all as 0-100)
  const weights = categories.map(c => Number(c.weight) || 0);
  const useHundred = weights.some(w => w > 1);
  const norm = weights.map(w => (useHundred ? w / 100 : w));
  const weightSum = norm.reduce((a, b) => a + b, 0);

  let earnedWeighted = 0;
  let earnedWeight = 0;
  let scenarioWeighted = 0;
  let scenarioWeight = 0;
  let openWeight = 0;

  categories.forEach((cat, i) => {
    const w = norm[i];
    const earnedOk = cat.scoreEarned != null && cat.scoreEarned !== "" &&
                     cat.scoreOut != null && cat.scoreOut !== "" && Number(cat.scoreOut) > 0;
    if (earnedOk) {
      const pct = (Number(cat.scoreEarned) / Number(cat.scoreOut)) * 100;
      earnedWeighted += pct * w;
      earnedWeight += w;
    } else if (cat.scenario != null && cat.scenario !== "") {
      const pct = Number(cat.scenario);
      scenarioWeighted += pct * w;
      scenarioWeight += w;
    } else {
      openWeight += w;
    }
  });

  const currentPct = earnedWeight > 0 ? earnedWeighted / earnedWeight : null;
  const totalKnownWeight = earnedWeight + scenarioWeight;
  const projectedPct = totalKnownWeight > 0
    ? (earnedWeighted + scenarioWeighted) / totalKnownWeight
    : null;
  const projectedLetter = projectedPct != null ? pctToLetter(projectedPct, scaleOverride) : null;

  return {
    weightSum,
    currentPct,
    projectedPct,
    projectedLetter,
    openWeight,
    isComplete: openWeight < 0.001,
    scaleUsed: scaleOverride && scaleOverride.length > 0 ? scaleOverride : DEFAULT_SCALE,
  };
}

/**
 * Final-scenarios row: given remaining open weight, project final letter
 * for various scenario percentages on the remaining work.
 */
export function finalScenarios({ categories, scaleOverride } = {}, scenarios = [60, 70, 80, 90, 100]) {
  if (!Array.isArray(categories) || categories.length === 0) return [];
  const result = computeWeightedScore({ categories, scaleOverride });
  if (result.openWeight < 0.001) return []; // nothing open

  // Compute earned-only contribution
  const weights = categories.map(c => Number(c.weight) || 0);
  const useHundred = weights.some(w => w > 1);
  const norm = weights.map(w => (useHundred ? w / 100 : w));

  let earnedWeighted = 0;
  let earnedScenarioWeighted = 0;
  categories.forEach((cat, i) => {
    const w = norm[i];
    const earnedOk = cat.scoreEarned != null && cat.scoreEarned !== "" &&
                     cat.scoreOut != null && cat.scoreOut !== "" && Number(cat.scoreOut) > 0;
    if (earnedOk) {
      const pct = (Number(cat.scoreEarned) / Number(cat.scoreOut)) * 100;
      earnedWeighted += pct * w;
    } else if (cat.scenario != null && cat.scenario !== "") {
      earnedScenarioWeighted += Number(cat.scenario) * w;
    }
  });
  const fixedWeighted = earnedWeighted + earnedScenarioWeighted;

  return scenarios.map(s => {
    const finalPct = fixedWeighted + s * result.openWeight;
    const letter = pctToLetter(finalPct, scaleOverride);
    return { scenarioPct: s, finalPct, letter };
  });
}

// ── Quick-mode GPA projection (mix of completed grades + per-class quick letter) ─
/**
 * courses: existing student_courses (with grades)
 * quickGrades: { [`${code}|${semester}`]: letter } for current-term courses (ephemeral, in-memory).
 *              Composite key avoids collisions for repeated courses across terms.
 * courseMap: shared courseMap for credits
 */
export function computeProjectedGPA(courses, quickGrades, courseMap) {
  if (!quickGrades) return computeGPA(courses, courseMap);
  const merged = courses.map(c => {
    const key = `${c.code}|${c.semester}`;
    if (quickGrades[key] && !c.grade) return { ...c, grade: quickGrades[key] };
    return c;
  });
  return computeGPA(merged, courseMap);
}

