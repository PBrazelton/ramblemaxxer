/**
 * shared/solver.js — Complete rewrite against real data schemas.
 * Framework-agnostic: works in Node or browser via bundler.
 */

const CORE_KA_MAP = {
  "Artistic Knowledge and Inquiry":                  ["Artistic Knowledge"],
  "College Writing Seminar":                         ["College Writing Seminar"],
  "Ethical Knowledge and Inquiry":                   ["Ethical Knowledge"],
  "Quantitative Knowledge and Inquiry":              ["Quantitative Knowledge"],
  "Historical Knowledge and Inquiry":                ["Foundational Historical Knowledge","Tier 2 Historical Knowledge"],
  "Literary Knowledge and Inquiry":                  ["Foundational Literary Knowledge","Tier 2 Literary Knowledge"],
  "Philosophical Knowledge and Inquiry":             ["Foundational Philosophical Knowledge","Tier 2 Philosophical Knowledge"],
  "Scientific Knowledge and Inquiry":                ["Scientific Knowledge"],
  "Societal and Cultural Knowledge and Inquiry":     ["Foundational Societal Knowledge","Tier 2 Societal Knowledge"],
  "Theological and Religious Knowledge and Inquiry": ["Foundational Theological Knowledge","Tier 2 Theological Knowledge"],
};

function buildCourseMap(catalogArray, supplementalArray) {
  const map = new Map();
  for (const c of catalogArray) map.set(c.code, c);
  for (const c of supplementalArray) { if (!map.has(c.code)) map.set(c.code, c); }
  return map;
}

function buildProgramMap(degreeReqs) {
  const map = new Map();
  for (const p of degreeReqs.programs) map.set(p.code, p);
  return map;
}

function _addSlotAssignment(assignments, code, programCode, categoryName) {
  if (!assignments[code]) assignments[code] = [];
  assignments[code].push({ programCode, categoryName });
}

/** Build set of all courses in GLST elective_pool_by_region */
function buildGlstElectivePool(programDef) {
  const pool = new Set();
  if (programDef?.elective_pool_by_region) {
    for (const courses of Object.values(programDef.elective_pool_by_region)) {
      for (const code of courses) pool.add(code);
    }
  }
  return pool;
}

function courseMatchesEligible(code, course, category, assignedInProgram, glstPool) {
  const ec = category.eligible_courses;
  const ecf = category.eligible_courses_fixed;
  if (ecf) return ecf.some(e => e.course === code);
  if (Array.isArray(ec)) return ec.includes(code);
  if (ec === "ANY_PLSC_200_PLUS")
    return course?.department === "PLSC" && course?.number >= 200 && !assignedInProgram.has(code);
  if (ec === "ANY_GLST_TAGGED")
    return (course?.interdisciplinary_options?.includes("Global Studies") || glstPool?.has(code)) ?? false;
  const elecMatch = typeof ec === "string" && ec.match(/^ANY_([A-Z]+)_ELECTIVE$/);
  if (elecMatch) return course?.department === elecMatch[1] && !assignedInProgram.has(code);
  return false;
}

function solve(studentCourses, declaredPrograms, courseMap, programMap, degreeReqs) {
  const taken = new Map();
  for (const sc of studentCourses) {
    const cat = courseMap.get(sc.code) || {};
    taken.set(sc.code, { ...cat, ...sc, credits: sc.creditsOverride ?? cat.credits ?? 3, pinnedProgram: sc.pinnedProgram || null });
  }

  const waivedCore = new Set();
  for (const pc of declaredPrograms) {
    for (const w of (degreeReqs.core_waivers_by_program?.[pc] || [])) waivedCore.add(w);
  }

  const result = {
    programs: {},
    overlaps: { glstMajorUsed: 0, glstMajorMax: 4, glstElectiveDeptUsage: {}, glstElectiveDeptMax: 3 },
    credits: { total: 0, complete: 0, enrolled: 0, planned: 0 },
    waivedCoreCategories: [...waivedCore],
    slotAssignments: {},
    remaining: [],
  };

  for (const [, course] of taken) {
    result.credits.total += course.credits;
    if (course.status === "complete" || course.status === "transfer") result.credits.complete += course.credits;
    else if (course.status === "enrolled") result.credits.enrolled += course.credits;
    else result.credits.planned += course.credits;
  }

  const isPinBlocked = (code, progCode) => {
    const c = taken.get(code);
    return c?.pinnedProgram && c.pinnedProgram !== progCode;
  };

  for (const progCode of declaredPrograms) {
    const pd = programMap.get(progCode);
    if (!pd) continue;

    const glstPool = progCode === "GLST-BA" ? buildGlstElectivePool(pd) : new Set();
    const progResult = { code: progCode, name: pd.name, type: pd.type,
      totalCredits: pd.total_credits || null, categories: [], creditsApplied: 0, isComplete: true };
    const assignedInProgram = new Set();

    // First pass: specific (non-wildcard) categories
    for (const category of pd.categories) {
      const catResult = { name: category.name, description: category.description || null,
        slotsNeeded: category.slots, slots: [], isSatisfied: false, isWaived: false };

      if (pd.type === "core") {
        if (waivedCore.has(category.name)) {
          catResult.isWaived = true; catResult.isSatisfied = true;
          catResult.slots = [{ code: "WAIVED", title: "Waived by major", status: "waived" }];
          progResult.categories.push(catResult); continue;
        }
        const keywords = CORE_KA_MAP[category.name] || [];
        const isTwoTier = category.tier_structure === "foundation_plus_tier2";

        if (isTwoTier) {
          let t1 = null, t2 = null;
          for (const [code, course] of taken) {
            if (assignedInProgram.has(code) || isPinBlocked(code, progCode)) continue;
            const ka = course.knowledge_area;
            if (!ka || !keywords.includes(ka)) continue;
            if (ka === "Scientific Knowledge") {
              // AP Bio covers both tiers — single entry marked as covering both
              catResult.slots.push({ code, title: course.title, status: course.status, coversBothTiers: true });
              assignedInProgram.add(code);
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
              t1 = true; t2 = true;
              break;
            }
            if (!t1 && ka.startsWith("Foundational")) {
              t1 = { code, title: course.title, status: course.status };
              assignedInProgram.add(code);
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
            } else if (!t2 && ka.startsWith("Tier 2")) {
              t2 = { code, title: course.title, status: course.status };
              assignedInProgram.add(code);
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
            }
            if (t1 && t2) break;
          }
          if (t1 && typeof t1 === "object") catResult.slots.push(t1);
          if (t2 && typeof t2 === "object") catResult.slots.push(t2);
        } else {
          for (const [code, course] of taken) {
            if (assignedInProgram.has(code) || isPinBlocked(code, progCode)) continue;
            const ka = course.knowledge_area;
            if (Array.isArray(category.eligible_courses)) {
              if (!category.eligible_courses.includes(code)) continue;
            } else {
              if (!ka || !keywords.includes(ka)) continue;
            }
            catResult.slots.push({ code, title: course.title, status: course.status });
            assignedInProgram.add(code);
            _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
            break;
          }
        }

      } else if (pd.type === "college") {
        if (category.name === "Writing Intensive") {
          for (const [code, course] of taken) {
            if (catResult.slots.length >= category.slots) break;
            if (isPinBlocked(code, progCode)) continue;
            if (course.writing_intensive) {
              catResult.slots.push({ code, title: course.title, status: course.status });
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
            }
          }
        } else if (category.name === "Foreign Language") {
          for (const [code, course] of taken) {
            if (isPinBlocked(code, progCode)) continue;
            if (course.department === "SPAN" && course.number >= 102) {
              catResult.slots.push({ code, title: course.title, status: course.status });
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name); break;
            }
          }
        } else if (category.name === "Engaged Learning") {
          for (const [code, course] of taken) {
            if (isPinBlocked(code, progCode)) continue;
            if (course.engaged_learning) {
              catResult.slots.push({ code, title: course.title, status: course.status });
              _addSlotAssignment(result.slotAssignments, code, progCode, category.name); break;
            }
          }
        } else if (category.name === "UNIV 101" && taken.has("UNIV 101")) {
          const c = taken.get("UNIV 101");
          catResult.slots.push({ code: "UNIV 101", title: c.title, status: c.status });
          _addSlotAssignment(result.slotAssignments, "UNIV 101", progCode, category.name);
        }

      } else if (pd.type === "requirement") {
        for (const code of (category.eligible_courses || [])) {
          if (taken.has(code)) {
            const c = taken.get(code);
            catResult.slots.push({ code, title: c.title, status: c.status });
            _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
          }
        }

      } else {
        // major — skip wildcards for now
        const isWildcard = typeof category.eligible_courses === "string";
        if (isWildcard) { catResult._isWildcard = true; catResult._glstPool = glstPool; progResult.categories.push(catResult); continue; }
        for (const [code, course] of taken) {
          if (catResult.slots.length >= category.slots) break;
          if (assignedInProgram.has(code) || isPinBlocked(code, progCode)) continue;
          if (courseMatchesEligible(code, course, category, assignedInProgram, glstPool)) {
            catResult.slots.push({ code, title: course.title, status: course.status });
            assignedInProgram.add(code);
            _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
          }
        }
      }

      // Count filled slots (coversBothTiers counts as 2)
      catResult.filledCount = catResult.slots.reduce((n, s) => n + (s.coversBothTiers ? 2 : 1), 0);
      catResult.isSatisfied = catResult.isWaived || catResult.filledCount >= category.slots;

      // Accumulate credits for all filled slots
      for (const slot of catResult.slots) {
        if (slot.code !== "WAIVED") {
          const c = taken.get(slot.code);
          if (c) progResult.creditsApplied += c.credits;
        }
      }

      progResult.categories.push(catResult);
    }

    // Second pass: wildcard elective categories
    for (const catResult of progResult.categories) {
      if (!catResult._isWildcard) continue;
      const wcGlstPool = catResult._glstPool || new Set();
      delete catResult._isWildcard;
      delete catResult._glstPool;
      const category = pd.categories.find(c => c.name === catResult.name);
      if (!category) continue;
      for (const [code, course] of taken) {
        if (catResult.slots.length >= category.slots) break;
        if (assignedInProgram.has(code) || isPinBlocked(code, progCode)) continue;
        if (courseMatchesEligible(code, course, category, assignedInProgram, wcGlstPool)) {
          catResult.slots.push({ code, title: course.title, status: course.status });
          assignedInProgram.add(code);
          _addSlotAssignment(result.slotAssignments, code, progCode, category.name);
        }
      }
      catResult.filledCount = catResult.slots.length;
      catResult.isSatisfied = catResult.filledCount >= category.slots;
      for (const slot of catResult.slots) {
        if (slot.code !== "WAIVED") {
          const c = taken.get(slot.code);
          if (c) progResult.creditsApplied += c.credits;
        }
      }
    }

    progResult.isComplete = progResult.categories.every(c => c.isSatisfied);
    result.programs[progCode] = progResult;
  }

  // Overlap tracking
  for (const [, assignments] of Object.entries(result.slotAssignments)) {
    const progs = new Set(assignments.map(a => a.programCode));
    if (progs.has("GLST-BA") && progs.has("PLSC-BA")) result.overlaps.glstMajorUsed++;
  }
  const glstElectives = result.programs["GLST-BA"]?.categories.find(c => c.name === "GLST Electives");
  if (glstElectives) {
    for (const slot of glstElectives.slots) {
      const dept = slot.code.split(" ")[0];
      result.overlaps.glstElectiveDeptUsage[dept] = (result.overlaps.glstElectiveDeptUsage[dept] || 0) + 1;
    }
  }

  // Remaining
  for (const [, prog] of Object.entries(result.programs)) {
    for (const cat of prog.categories) {
      if (!cat.isSatisfied && !cat.isWaived) {
        const need = cat.slotsNeeded - (cat.filledCount || 0);
        result.remaining.push({ program: prog.code, programName: prog.name,
          category: cat.name, needed: need,
          label: `${prog.name}: ${cat.name} — needs ${need} more course${need !== 1 ? "s" : ""}` });
      }
    }
  }

  return result;
}

function getSuggestions(solverResult, courseMap, programMap, declaredPrograms) {
  const takenCodes = new Set();
  for (const prog of Object.values(solverResult.programs))
    for (const cat of prog.categories)
      for (const slot of cat.slots) takenCodes.add(slot.code);

  const unsatisfied = [];
  for (const progCode of declaredPrograms) {
    const prog = solverResult.programs[progCode];
    if (!prog) continue;
    const pd = programMap.get(progCode);
    for (const cat of prog.categories) {
      if (!cat.isSatisfied && !cat.isWaived) {
        const catDef = pd?.categories.find(c => c.name === cat.name);
        if (catDef) unsatisfied.push({ progCode, cat: catDef, progName: prog.name });
      }
    }
  }

  const suggestions = [];
  for (const [code, course] of courseMap) {
    if (takenCodes.has(code) || code.startsWith("AP ")) continue;
    const fills = [];
    for (const { progCode: pc, cat, progName } of unsatisfied) {
      const sgPool = pc === "GLST-BA" ? buildGlstElectivePool(programMap.get(pc)) : new Set();
      if (courseMatchesEligible(code, course, cat, takenCodes, sgPool)) fills.push(`${progName}: ${cat.name}`);
    }
    if (fills.length >= 2) suggestions.push({ code, title: course.title, credits: course.credits,
      department: course.department, fills, boxCount: fills.length,
      engaged_learning: course.engaged_learning, writing_intensive: course.writing_intensive });
  }
  return suggestions.sort((a, b) => b.boxCount - a.boxCount);
}

if (typeof module !== "undefined") {
  module.exports = { solve, getSuggestions, buildCourseMap, buildProgramMap };
}
