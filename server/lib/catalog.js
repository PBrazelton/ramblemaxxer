/**
 * server/lib/catalog.js
 * Shared course and program maps — built once at startup.
 * Import from here instead of duplicating in each route file.
 */

const { buildCourseMap, buildProgramMap } = require("../../shared/solver");

const coursesArray = require("../../data/courses.json");
const supplementalArray = require("../../data/courses-supplemental.json");
const degreeRequirements = require("../../data/degree_requirements.json");

const courseMap = buildCourseMap(coursesArray, supplementalArray);
const programMap = buildProgramMap(degreeRequirements);

// Full merged map (same as courseMap but useful for route files that had their own)
const allCourses = new Map();
for (const c of coursesArray) allCourses.set(c.code, c);
for (const c of supplementalArray) { if (!allCourses.has(c.code)) allCourses.set(c.code, c); }

module.exports = { courseMap, programMap, degreeRequirements, allCourses, coursesArray, supplementalArray };
