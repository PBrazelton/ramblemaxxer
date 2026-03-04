/**
 * shared/solver.js
 *
 * The constraint solver for Ramblemaxxer.
 * Framework-agnostic — works in Node (server) or browser (client).
 *
 * Given a student's course list + declared programs + the degree requirements,
 * returns a complete picture of:
 *   - Which requirement slots are filled
 *   - Which courses are double-counted (overlaps) and against which budget
 *   - Remaining requirements per program
 *   - High-efficiency course suggestions
 *   - Credit totals
 */

// ── Types (JSDoc) ──────────────────────────────────────────────────────────
/**
 * @typedef {Object} StudentCourse
 * @property {string} code         - e.g. "PLSC 102"
 * @property {number} semester     - 0=transfer, 1-N relative semesters
 * @property {string} status       - 'transfer'|'complete'|'enrolled'|'planned'
 * @property {number} [creditsOverride]
 */

/**
 * @typedef {Object} SolverResult
 * @property {Object} programs     - per-program slot fill status
 * @property {Object} overlaps     - overlap budget usage
 * @property {Object} credits      - total, complete, enrolled, planned
 * @property {string[]} remaining  - human-readable list of unfilled requirements
 * @property {Object[]} suggestions - high-efficiency untaken courses
 */

// ── Overlap rules (hardcoded from Loyola catalog) ─────────────────────────
const OVERLAP_RULES = {
  // Max courses that can double-count between GLST and ALL other majors/minors combined
  glstMajorOverlapMax: 4,
  // Max courses from any single dept in GLST elective slots (required core exempt)
  glstElectiveDeptMax: 3,
  // CAS default: each major needs min 21 unique credits
  casUniqueCreditsPerMajor: 21,
};

/**
 * Core solver function.
 *
 * @param {StudentCourse[]} studentCourses
 * @param {string[]} declaredPrograms  - e.g. ['PLSC-BA', 'GLST-BA', 'CORE']
 * @param {Object} coursesDb           - the courses.json catalog
 * @param {Object} degreeRequirements  - the degree_requirements.json
 * @param {Object} programTags         - the course_program_tags.json
 * @returns {SolverResult}
 */
function solve(studentCourses, declaredPrograms, coursesDb, degreeRequirements, programTags) {
  // Build a lookup: code → student course record + catalog data
  const taken = new Map();
  for (const sc of studentCourses) {
    const catalog = coursesDb[sc.code] || {};
    taken.set(sc.code, { ...sc, ...catalog, credits: sc.creditsOverride ?? catalog.credits ?? 3 });
  }

  // Build a lookup: code → which programs/slots it can fill
  // programTags format: { "PLSC 102": { "PLSC-BA": ["foundation"], "GLST-BA": ["core"] }, ... }
  const tags = programTags || {};

  const result = {
    programs: {},
    overlaps: {
      glstMajorUsed: 0,
      glstMajorMax: OVERLAP_RULES.glstMajorOverlapMax,
      glstElectiveDeptUsage: {},
      glstElectiveDeptMax: OVERLAP_RULES.glstElectiveDeptMax,
    },
    credits: { total: 0, complete: 0, enrolled: 0, planned: 0 },
    slotAssignments: {},  // code → { programId, slotId }[]
    remaining: [],
    suggestions: [],
  };

  // ── Credit totals ────────────────────────────────────────────────────────
  for (const [code, course] of taken) {
    result.credits.total += course.credits;
    if (course.status === "complete" || course.status === "transfer") {
      result.credits.complete += course.credits;
    } else if (course.status === "enrolled") {
      result.credits.enrolled += course.credits;
    } else {
      result.credits.planned += course.credits;
    }
  }

  // ── Per-program slot filling ─────────────────────────────────────────────
  for (const programId of declaredPrograms) {
    const programDef = degreeRequirements[programId];
    if (!programDef) continue;

    result.programs[programId] = {
      name: programDef.name,
      totalCredits: programDef.totalCredits,
      categories: [],
      filledSlots: 0,
      totalSlots: 0,
      creditsApplied: 0,
    };

    for (const category of programDef.categories) {
      const catResult = {
        id: category.id,
        name: category.name,
        slotsNeeded: category.slotsNeeded,
        slots: [],
        isSatisfied: false,
      };

      let filled = 0;
      const eligibleCourses = [];

      for (const [code, course] of taken) {
        const courseTags = tags[code]?.[programId] || [];
        if (courseTags.includes(category.id)) {
          eligibleCourses.push({ code, course, tags: courseTags });
        }
      }

      // Greedy fill: assign courses to slots up to slotsNeeded
      for (const { code, course } of eligibleCourses) {
        if (filled >= category.slotsNeeded) break;
        catResult.slots.push({ code, title: course.title, status: course.status });

        // Track slot assignments
        if (!result.slotAssignments[code]) result.slotAssignments[code] = [];
        result.slotAssignments[code].push({ programId, slotId: category.id });

        filled++;
        result.programs[programId].creditsApplied += course.credits;
      }

      catResult.isSatisfied = filled >= category.slotsNeeded;
      catResult.filledCount = filled;
      result.programs[programId].filledSlots += filled;
      result.programs[programId].totalSlots += category.slotsNeeded;
      result.programs[programId].categories.push(catResult);

      if (!catResult.isSatisfied) {
        const remaining = category.slotsNeeded - filled;
        result.remaining.push(
          `${programId}: ${category.name} — needs ${remaining} more course${remaining > 1 ? "s" : ""}`
        );
      }
    }
  }

  // ── Overlap tracking ─────────────────────────────────────────────────────
  for (const [code, assignments] of Object.entries(result.slotAssignments)) {
    if (assignments.length > 1) {
      // Check if one of the programs is GLST
      const glstAssignment = assignments.find((a) => a.programId === "GLST-BA");
      const otherAssignment = assignments.find((a) => a.programId !== "GLST-BA");
      if (glstAssignment && otherAssignment) {
        result.overlaps.glstMajorUsed++;
      }
    }
  }

  // GLST elective dept usage
  if (result.programs["GLST-BA"]) {
    for (const cat of result.programs["GLST-BA"].categories) {
      if (cat.id === "elective") {
        for (const slot of cat.slots) {
          const dept = slot.code.split(" ")[0];
          result.overlaps.glstElectiveDeptUsage[dept] =
            (result.overlaps.glstElectiveDeptUsage[dept] || 0) + 1;
        }
      }
    }
  }

  return result;
}

/**
 * Given a solver result and the full course catalog, return courses not yet
 * taken that would fill 2+ requirement slots (high-efficiency suggestions).
 *
 * @param {SolverResult} solverResult
 * @param {Object} coursesDb
 * @param {Object} programTags
 * @param {string[]} declaredPrograms
 * @returns {Object[]}
 */
function getSuggestions(solverResult, coursesDb, programTags, declaredPrograms) {
  const takenCodes = new Set(
    Object.keys(solverResult.slotAssignments)
  );

  const suggestions = [];

  for (const [code, catalog] of Object.entries(coursesDb)) {
    if (takenCodes.has(code)) continue;

    const tags = programTags[code] || {};
    let boxCount = 0;
    const fills = [];

    for (const programId of declaredPrograms) {
      const programSlots = tags[programId] || [];
      for (const slotId of programSlots) {
        const cat = solverResult.programs[programId]?.categories.find((c) => c.id === slotId);
        if (cat && !cat.isSatisfied) {
          boxCount++;
          fills.push(`${programId}: ${cat.name}`);
        }
      }
    }

    if (boxCount >= 2) {
      suggestions.push({ code, ...catalog, boxCount, fills });
    }
  }

  return suggestions.sort((a, b) => b.boxCount - a.boxCount);
}

// ── Export (works in both Node and browser via bundler) ───────────────────
if (typeof module !== "undefined") {
  module.exports = { solve, getSuggestions, OVERLAP_RULES };
}
