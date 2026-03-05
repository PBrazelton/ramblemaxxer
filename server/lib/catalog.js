/**
 * server/lib/catalog.js
 * Shared course and program maps — built once at startup.
 * Import from here instead of duplicating in each route file.
 *
 * Loads courses from DB (courses table) if populated,
 * falls back to static JSON files if the table is empty.
 */

const { buildCourseMap, buildProgramMap } = require("../../shared/solver");
const db = require("../db/connection");

const coursesArray = require("../../data/courses.json");
const supplementalArray = require("../../data/courses-supplemental.json");
const degreeRequirements = require("../../data/degree_requirements.json");

const programMap = buildProgramMap(degreeRequirements);

function loadCoursesFromDB() {
  // Check if courses table exists and has data
  try {
    const row = db.prepare("SELECT COUNT(*) as count FROM courses").get();
    if (!row || row.count === 0) return null;
  } catch (e) {
    // Table doesn't exist yet
    return null;
  }

  const rows = db.prepare("SELECT * FROM courses ORDER BY department, number").all();
  const allTags = db.prepare("SELECT course_code, tag FROM course_interdisciplinary_tags").all();
  const allCross = db.prepare("SELECT course_code, cross_listed_code FROM course_cross_listings").all();

  // Build lookup maps for junction tables
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

// Try DB first, fall back to JSON
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

module.exports = { courseMap, programMap, degreeRequirements, allCourses, coursesArray, supplementalArray };
