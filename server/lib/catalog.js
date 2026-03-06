/**
 * server/lib/catalog.js
 * Shared course and program maps — built once at startup.
 * Import from here instead of duplicating in each route file.
 *
 * Loads courses from DB (courses table) if populated,
 * falls back to static JSON files if the table is empty.
 *
 * Loads programs from DB (programs table) if populated,
 * falls back to static JSON (degree_requirements.json).
 */

const { buildCourseMap, buildProgramMap } = require("../../shared/solver");
const db = require("../db/connection");

const coursesArray = require("../../data/courses.json");
const supplementalArray = require("../../data/courses-supplemental.json");
const degreeRequirementsJSON = require("../../data/degree_requirements.json");

// ── Programs from DB ────────────────────────────────────────────────────────

function loadProgramsFromDB() {
  // Check if programs table exists and has active rows
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM programs WHERE is_active = 1").get();
    if (!row || row.count === 0) return null;
  } catch (e) {
    return null;
  }

  // Load all active programs
  const programs = db.prepare("SELECT * FROM programs WHERE is_active = 1").all();

  // Load all categories ordered by sort_order
  const categories = db.prepare(
    "SELECT pc.* FROM program_categories pc JOIN programs p ON pc.program_code = p.code WHERE p.is_active = 1 ORDER BY pc.program_code, pc.sort_order"
  ).all();

  // Load all eligible courses
  const eligibleCourses = db.prepare(
    "SELECT ce.* FROM category_eligible_courses ce JOIN program_categories pc ON ce.category_id = pc.id JOIN programs p ON pc.program_code = p.code WHERE p.is_active = 1"
  ).all();

  // Load all core waivers
  const coreWaivers = db.prepare("SELECT * FROM core_waivers").all();

  // Build lookup: category_id → eligible courses
  const eligibleByCat = {};
  for (const ec of eligibleCourses) {
    if (!eligibleByCat[ec.category_id]) eligibleByCat[ec.category_id] = [];
    eligibleByCat[ec.category_id].push(ec);
  }

  // Build lookup: program_code → categories
  const catsByProgram = {};
  for (const cat of categories) {
    if (!catsByProgram[cat.program_code]) catsByProgram[cat.program_code] = [];
    catsByProgram[cat.program_code].push(cat);
  }

  // Build program objects matching exact solver shape
  const programList = programs.map((prog) => {
    const progObj = {
      code: prog.code,
      name: prog.name,
      type: prog.type,
    };

    if (prog.department) progObj.department = prog.department;
    if (prog.total_credits) progObj.total_credits = prog.total_credits;
    if (prog.unique_credits_required) progObj.unique_credits_required = prog.unique_credits_required;
    if (prog.double_dip_policy) progObj.double_dip_policy = prog.double_dip_policy;
    if (prog.core_waivers) progObj.core_waivers = JSON.parse(prog.core_waivers);
    if (prog.notes) progObj.notes = JSON.parse(prog.notes);
    if (prog.elective_pool_by_region) progObj.elective_pool_by_region = JSON.parse(prog.elective_pool_by_region);

    progObj.categories = (catsByProgram[prog.code] || []).map((cat) => {
      const catObj = {
        name: cat.name,
        slots: cat.slots,
      };

      if (cat.description) catObj.description = cat.description;
      if (cat.credits_per_slot !== 3) catObj.credits_per_slot = cat.credits_per_slot;
      else catObj.credits_per_slot = 3;
      if (cat.tier_structure) catObj.tier_structure = cat.tier_structure;
      if (cat.notes) catObj.notes = cat.notes;
      if (cat.constraints) catObj.constraints = JSON.parse(cat.constraints);

      const eligible = eligibleByCat[cat.id] || [];

      if (cat.wildcard) {
        // Wildcard category → eligible_courses is a string
        catObj.eligible_courses = cat.wildcard;
      } else if (cat.is_fixed) {
        // Fixed category → eligible_courses_fixed array
        catObj.eligible_courses_fixed = eligible.map((ec) => {
          const entry = { course: ec.course_code };
          if (ec.is_required) entry.required = true;
          return entry;
        });
      } else if (eligible.length > 0) {
        // Normal category → eligible_courses array of strings
        catObj.eligible_courses = eligible.map((ec) => ec.course_code);
      }
      // CORE categories with no eligible courses and no wildcard → DO NOT set eligible_courses

      return catObj;
    });

    return progObj;
  });

  // Build core_waivers_by_program
  const coreWaiversByProgram = {};
  for (const w of coreWaivers) {
    if (!coreWaiversByProgram[w.program_code]) coreWaiversByProgram[w.program_code] = [];
    coreWaiversByProgram[w.program_code].push(w.waived_area);
  }

  return {
    programs: programList,
    core_waivers_by_program: coreWaiversByProgram,
  };
}

// ── Courses from DB ─────────────────────────────────────────────────────────

function loadCoursesFromDB() {
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM courses").get();
    if (!row || row.count === 0) return null;
  } catch (e) {
    return null;
  }

  const rows = db.prepare("SELECT * FROM courses ORDER BY department, number").all();
  const allTags = db.prepare("SELECT course_code, tag FROM course_interdisciplinary_tags").all();
  const allCross = db.prepare("SELECT course_code, cross_listed_code FROM course_cross_listings").all();

  const tagMap = {};
  for (const t of allTags) {
    if (!tagMap[t.course_code]) tagMap[t.course_code] = [];
    tagMap[t.course_code].push(t.tag);
  }
  const crossMap = {};
  for (const c of allCross) {
    if (!crossMap[c.course_code]) crossMap[c.course_code] = [];
    crossMap[c.course_code].push(c.cross_listed_code);
  }

  return rows.map((r) => ({
    code: r.code,
    department: r.department,
    number: r.number,
    title: r.title,
    credits: r.credits,
    credits_min: r.credits_min,
    credits_max: r.credits_max,
    prerequisites: r.prerequisites,
    knowledge_area: r.knowledge_area,
    interdisciplinary_options: tagMap[r.code] || [],
    cross_listings: crossMap[r.code] || [],
    engaged_learning: !!r.engaged_learning,
    writing_intensive: !!r.writing_intensive,
    description: r.description,
  }));
}

// ── Initialize at startup ───────────────────────────────────────────────────

// Programs: DB first, JSON fallback
let degreeRequirements;
let programMap;

const dbPrograms = loadProgramsFromDB();
if (dbPrograms) {
  console.log(`  Catalog: loaded ${dbPrograms.programs.length} programs from DB`);
  degreeRequirements = dbPrograms;
  programMap = buildProgramMap(dbPrograms);
} else {
  console.log("  Catalog: using static JSON for programs (programs table empty or missing)");
  degreeRequirements = degreeRequirementsJSON;
  programMap = buildProgramMap(degreeRequirementsJSON);
}

// Courses: DB first, JSON fallback
const dbCourses = loadCoursesFromDB();
let allCourses;
let courseMap;

if (dbCourses) {
  console.log(`  Catalog: loaded ${dbCourses.length} courses from DB`);
  allCourses = new Map();
  for (const c of dbCourses) allCourses.set(c.code, c);
  courseMap = new Map(allCourses);
} else {
  console.log("  Catalog: using static JSON (courses table empty or missing)");
  courseMap = buildCourseMap(coursesArray, supplementalArray);
  allCourses = new Map();
  for (const c of coursesArray) allCourses.set(c.code, c);
  for (const c of supplementalArray) { if (!allCourses.has(c.code)) allCourses.set(c.code, c); }
}

// Cache invalidation for future admin use
function clearProgramCache() {
  const fresh = loadProgramsFromDB();
  if (fresh) {
    degreeRequirements = fresh;
    programMap = buildProgramMap(fresh);
  } else {
    degreeRequirements = degreeRequirementsJSON;
    programMap = buildProgramMap(degreeRequirementsJSON);
  }
}

module.exports = { courseMap, programMap, degreeRequirements, allCourses, coursesArray, supplementalArray, clearProgramCache };
