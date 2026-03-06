/**
 * server/scripts/seed-courses.js
 * Loads scraped catalog JSON + local enrichment data into the courses table.
 *
 * Merge strategy:
 *   1. Insert all scraped courses (base layer — includes knowledge_area, engaged_learning)
 *   2. Overlay writing_intensive + engaged_learning from data/courses.json (original 224)
 *   3. Insert data/courses-supplemental.json entries (transfer credits, manual additions)
 *   4. Backfill: any course in courses.json not found in scraped data gets inserted
 *   5. Populate junction tables (clear + re-insert per course)
 *   6. Rebuild FTS index
 *
 * Idempotent via INSERT OR REPLACE on code.
 *
 * Usage: node server/scripts/seed-courses.js
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "../db/ramblemaxxer.db");
const SCRAPED_PATH = path.join(__dirname, "../../data/scraped-catalog.json");
const COURSES_PATH = path.join(__dirname, "../../data/courses.json");
const SUPPLEMENTAL_PATH = path.join(__dirname, "../../data/courses-supplemental.json");

function loadJSON(filepath) {
  if (!fs.existsSync(filepath)) return [];
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

function main() {
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  // Verify tables exist
  const tableCheck = db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='courses'"
  ).get();
  if (!tableCheck) {
    console.error("Error: courses table does not exist. Run `npm run db:init` first.");
    process.exit(1);
  }

  const scraped = loadJSON(SCRAPED_PATH);
  const original = loadJSON(COURSES_PATH);
  const supplemental = loadJSON(SUPPLEMENTAL_PATH);

  console.log(`Scraped catalog: ${scraped.length} courses`);
  console.log(`Original courses.json: ${original.length} courses`);
  console.log(`Supplemental: ${supplemental.length} courses`);

  // Build enrichment maps from original courses.json
  const originalMap = new Map();
  for (const c of original) originalMap.set(c.code, c);

  const upsertCourse = db.prepare(`
    INSERT INTO courses (code, department, number, title, credits, credits_min, credits_max,
      prerequisites, knowledge_area, engaged_learning, writing_intensive, description,
      catalog_year, updated_at)
    VALUES (@code, @department, @number, @title, @credits, @credits_min, @credits_max,
      @prerequisites, @knowledge_area, @engaged_learning, @writing_intensive, @description,
      @catalog_year, datetime('now'))
    ON CONFLICT(code) DO UPDATE SET
      department = excluded.department,
      number = excluded.number,
      title = excluded.title,
      credits = excluded.credits,
      credits_min = COALESCE(excluded.credits_min, courses.credits_min),
      credits_max = COALESCE(excluded.credits_max, courses.credits_max),
      prerequisites = COALESCE(excluded.prerequisites, courses.prerequisites),
      knowledge_area = COALESCE(excluded.knowledge_area, courses.knowledge_area),
      engaged_learning = MAX(excluded.engaged_learning, courses.engaged_learning),
      writing_intensive = MAX(excluded.writing_intensive, courses.writing_intensive),
      description = COALESCE(excluded.description, courses.description),
      catalog_year = COALESCE(excluded.catalog_year, courses.catalog_year),
      updated_at = datetime('now')
  `);

  const clearTags = db.prepare("DELETE FROM course_interdisciplinary_tags WHERE course_code = ?");
  const insertTag = db.prepare(
    "INSERT OR IGNORE INTO course_interdisciplinary_tags (course_code, tag) VALUES (?, ?)"
  );
  const clearCrossListings = db.prepare("DELETE FROM course_cross_listings WHERE course_code = ?");
  const insertCrossListing = db.prepare(
    "INSERT OR IGNORE INTO course_cross_listings (course_code, cross_listed_code) VALUES (?, ?)"
  );

  const insertOne = db.transaction((course, tags, crossListings) => {
    upsertCourse.run(course);

    // Junction tables: clear + re-insert
    clearTags.run(course.code);
    for (const tag of tags) insertTag.run(course.code, tag);

    clearCrossListings.run(course.code);
    for (const cl of crossListings) insertCrossListing.run(course.code, cl);
  });

  function toRow(c, catalogYear) {
    // Handle credits that may be a number or an object { min, max }
    let credits = c.credits;
    let creditsMin = c.credits_min || null;
    let creditsMax = c.credits_max || null;
    if (credits && typeof credits === "object") {
      creditsMin = credits.min || null;
      creditsMax = credits.max || null;
      credits = creditsMax; // use max as default
    }
    return {
      code: c.code,
      department: c.department || c.code.split(/\s+/)[0],
      number: c.number || 0,
      title: c.title || "",
      credits: typeof credits === "number" ? credits : null,
      credits_min: typeof creditsMin === "number" ? creditsMin : null,
      credits_max: typeof creditsMax === "number" ? creditsMax : null,
      prerequisites: c.prerequisites || null,
      knowledge_area: c.knowledge_area || null,
      engaged_learning: c.engaged_learning ? 1 : 0,
      writing_intensive: c.writing_intensive ? 1 : 0,
      description: c.description || null,
      catalog_year: catalogYear,
    };
  }

  const insertAll = db.transaction(() => {
    let count = 0;
    const seenCodes = new Set();

    // 1. Insert scraped courses (base layer)
    for (const c of scraped) {
      const row = toRow(c, "2025-2026");
      insertOne(row, c.interdisciplinary_options || [], c.cross_listings || []);
      seenCodes.add(c.code);
      count++;
    }
    console.log(`  Inserted ${count} scraped courses`);

    // 2. Overlay enrichment from courses.json (writing_intensive, engaged_learning, knowledge_area)
    let enriched = 0;
    for (const c of original) {
      if (seenCodes.has(c.code)) {
        // Only overlay WI/EL flags + knowledge_area if original has them
        const row = toRow(c, "2025-2026");
        upsertCourse.run(row);

        // Re-insert tags from original if present (may have better data)
        if (c.interdisciplinary_options?.length) {
          clearTags.run(c.code);
          for (const tag of c.interdisciplinary_options) insertTag.run(c.code, tag);
        }
        enriched++;
      }
    }
    console.log(`  Enriched ${enriched} courses from courses.json`);

    // 3. Insert supplemental courses (transfer credits, manual additions)
    let supCount = 0;
    for (const c of supplemental) {
      const row = toRow(c, null);
      insertOne(row, c.interdisciplinary_options || [], c.cross_listings || []);
      seenCodes.add(c.code);
      supCount++;
    }
    console.log(`  Inserted/updated ${supCount} supplemental courses`);

    // 4. Backfill: courses in courses.json not found in scraped data
    let backfilled = 0;
    for (const c of original) {
      if (!seenCodes.has(c.code)) {
        const row = toRow(c, null);
        insertOne(row, c.interdisciplinary_options || [], c.cross_listings || []);
        seenCodes.add(c.code);
        backfilled++;
      }
    }
    if (backfilled > 0) console.log(`  Backfilled ${backfilled} courses from courses.json`);

    return seenCodes.size;
  });

  console.log("\nSeeding courses...");
  const total = insertAll();

  // 6. Rebuild FTS index
  console.log("\nRebuilding FTS index...");
  try {
    db.exec("INSERT INTO courses_fts(courses_fts) VALUES('rebuild')");
    console.log("  FTS index rebuilt");
  } catch (e) {
    console.error("  FTS rebuild error:", e.message);
  }

  // Final stats
  const dbCount = db.prepare("SELECT COUNT(*) as count FROM courses").get().count;
  const tagCount = db.prepare("SELECT COUNT(*) as count FROM course_interdisciplinary_tags").get().count;
  const crossCount = db.prepare("SELECT COUNT(*) as count FROM course_cross_listings").get().count;
  const deptCount = db.prepare("SELECT COUNT(DISTINCT department) as count FROM courses").get().count;

  console.log(`\n--- Summary ---`);
  console.log(`Total courses in DB: ${dbCount}`);
  console.log(`Departments: ${deptCount}`);
  console.log(`Interdisciplinary tags: ${tagCount}`);
  console.log(`Cross-listings: ${crossCount}`);

  // Verify original 224 are present
  let missing = 0;
  for (const c of [...original, ...supplemental]) {
    const row = db.prepare("SELECT code FROM courses WHERE code = ?").get(c.code);
    if (!row) {
      console.error(`  MISSING: ${c.code}`);
      missing++;
    }
  }
  if (missing === 0) {
    console.log(`All ${original.length + supplemental.length} original+supplemental courses present`);
  } else {
    console.error(`${missing} courses missing!`);
  }

  db.close();
}

main();
