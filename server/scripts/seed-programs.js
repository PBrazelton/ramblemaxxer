/**
 * server/scripts/seed-programs.js
 * Reads data/degree_requirements.json and upserts into the programs,
 * program_categories, category_eligible_courses, overlap_rules,
 * and core_waivers tables.
 *
 * Idempotent + additive: only touches programs defined in the JSON file.
 * Admin-created programs (not in JSON) are preserved across deploys.
 *
 * Usage: node server/scripts/seed-programs.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "..", "db", "ramblemaxxer.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

const degreeReqs = require("../../data/degree_requirements.json");

const insertProgram = db.prepare(`
  INSERT INTO programs (code, name, type, department, college, total_credits,
    unique_credits_required, double_dip_policy, core_waivers, notes,
    elective_pool_by_region)
  VALUES (@code, @name, @type, @department, @college, @total_credits,
    @unique_credits_required, @double_dip_policy, @core_waivers, @notes,
    @elective_pool_by_region)
`);

const insertCategory = db.prepare(`
  INSERT INTO program_categories (program_code, name, description, slots,
    credits_per_slot, sort_order, tier_structure, wildcard, is_fixed,
    constraints, notes)
  VALUES (@program_code, @name, @description, @slots, @credits_per_slot,
    @sort_order, @tier_structure, @wildcard, @is_fixed, @constraints, @notes)
`);

const insertEligibleCourse = db.prepare(`
  INSERT INTO category_eligible_courses (category_id, course_code, is_required, notes)
  VALUES (@category_id, @course_code, @is_required, @notes)
`);

const insertOverlapRule = db.prepare(`
  INSERT INTO overlap_rules (program_a, program_b, overlap_type,
    max_shared_courses, max_from_single_dept, constraint_source, details, notes)
  VALUES (@program_a, @program_b, @overlap_type, @max_shared_courses,
    @max_from_single_dept, @constraint_source, @details, @notes)
`);

const insertCoreWaiver = db.prepare(`
  INSERT INTO core_waivers (program_code, waived_area)
  VALUES (@program_code, @waived_area)
`);

const upsertProgram = db.prepare(`
  INSERT INTO programs (code, name, type, department, college, total_credits,
    unique_credits_required, double_dip_policy, core_waivers, notes,
    elective_pool_by_region)
  VALUES (@code, @name, @type, @department, @college, @total_credits,
    @unique_credits_required, @double_dip_policy, @core_waivers, @notes,
    @elective_pool_by_region)
  ON CONFLICT(code) DO UPDATE SET
    name=excluded.name, type=excluded.type, department=excluded.department,
    college=excluded.college, total_credits=excluded.total_credits,
    unique_credits_required=excluded.unique_credits_required,
    double_dip_policy=excluded.double_dip_policy, core_waivers=excluded.core_waivers,
    notes=excluded.notes, elective_pool_by_region=excluded.elective_pool_by_region,
    updated_at=datetime('now')
`);

const seed = db.transaction(() => {
  // Build set of JSON-defined program codes so we only touch those
  const jsonCodes = degreeReqs.programs.map(p => p.code);
  const placeholders = jsonCodes.map(() => "?").join(",");

  // Clear children ONLY for JSON-defined programs (preserve admin-created ones)
  if (jsonCodes.length > 0) {
    db.prepare(`
      DELETE FROM category_eligible_courses
      WHERE category_id IN (SELECT id FROM program_categories WHERE program_code IN (${placeholders}))
    `).run(...jsonCodes);
    db.prepare(`DELETE FROM program_categories WHERE program_code IN (${placeholders})`).run(...jsonCodes);
  }
  // Overlap rules: delete JSON-sourced rules (CAS|DEFAULT + pair rules from JSON)
  // Admin-created overlap rules are attached to admin-created programs, which aren't in jsonCodes
  db.prepare("DELETE FROM overlap_rules WHERE program_b = 'DEFAULT'").run();
  if (jsonCodes.length > 0) {
    db.prepare(`DELETE FROM overlap_rules WHERE program_a IN (${placeholders}) OR program_b IN (${placeholders})`).run(...jsonCodes, ...jsonCodes);
  }
  // Core waivers: clear all (they include future programs and are cheap to rebuild)
  db.prepare("DELETE FROM core_waivers").run();

  let programCount = 0;
  let categoryCount = 0;
  let eligibleCount = 0;

  // 1. Programs + categories + eligible courses
  for (const prog of degreeReqs.programs) {
    upsertProgram.run({
      code: prog.code,
      name: prog.name,
      type: prog.type,
      department: prog.department || null,
      college: prog.college || null,
      total_credits: prog.total_credits || null,
      unique_credits_required: prog.unique_credits_required || null,
      double_dip_policy: prog.double_dip_policy || null,
      core_waivers: prog.core_waivers ? JSON.stringify(prog.core_waivers) : null,
      notes: prog.notes ? JSON.stringify(prog.notes) : null,
      elective_pool_by_region: prog.elective_pool_by_region
        ? JSON.stringify(prog.elective_pool_by_region)
        : null,
    });
    programCount++;

    for (let i = 0; i < (prog.categories || []).length; i++) {
      const cat = prog.categories[i];

      // Determine wildcard and is_fixed
      const isWildcard = typeof cat.eligible_courses === "string";
      const isFixed = !!cat.eligible_courses_fixed;

      const catResult = insertCategory.run({
        program_code: prog.code,
        name: cat.name,
        description: cat.description || null,
        slots: cat.slots,
        credits_per_slot: cat.credits_per_slot || 3,
        sort_order: i,
        tier_structure: cat.tier_structure || null,
        wildcard: isWildcard ? cat.eligible_courses : null,
        is_fixed: isFixed ? 1 : 0,
        constraints: cat.constraints ? JSON.stringify(cat.constraints) : null,
        notes: cat.notes || null,
      });
      categoryCount++;

      const categoryId = catResult.lastInsertRowid;

      // Insert eligible courses
      if (isFixed && cat.eligible_courses_fixed) {
        for (const entry of cat.eligible_courses_fixed) {
          insertEligibleCourse.run({
            category_id: categoryId,
            course_code: entry.course,
            is_required: entry.required ? 1 : 0,
            notes: null,
          });
          eligibleCount++;
        }
      } else if (Array.isArray(cat.eligible_courses)) {
        for (const code of cat.eligible_courses) {
          insertEligibleCourse.run({
            category_id: categoryId,
            course_code: code,
            is_required: 0,
            notes: null,
          });
          eligibleCount++;
        }
      }
      // CORE categories with no eligible_courses → zero rows (critical for solver)
    }
  }

  // 2. Overlap rules
  let overlapCount = 0;

  // CAS default as a special row
  const casDefault = degreeReqs.overlap_rules?.cas_default;
  if (casDefault) {
    insertOverlapRule.run({
      program_a: "CAS",
      program_b: "DEFAULT",
      overlap_type: null,
      max_shared_courses: null,
      max_from_single_dept: null,
      constraint_source: null,
      details: casDefault.description || null,
      notes: JSON.stringify({
        major_unique_credits: casDefault.major_unique_credits,
        minor_unique_credits: casDefault.minor_unique_credits,
        notes: casDefault.notes,
      }),
    });
    overlapCount++;
  }

  // Pair rules
  for (const pair of degreeReqs.overlap_rules?.pairs || []) {
    const [a, b] = pair.programs;
    insertOverlapRule.run({
      program_a: a,
      program_b: b,
      overlap_type: pair.overlap_type || null,
      max_shared_courses: pair.max_shared_courses || null,
      max_from_single_dept: null,
      constraint_source: pair.constraint_source || null,
      details: pair.details || null,
      notes: pair.notes ? JSON.stringify(pair.notes) : null,
    });
    overlapCount++;
  }

  // 3. Core waivers (includes future programs not yet in programs table)
  let waiverCount = 0;
  for (const [progCode, areas] of Object.entries(degreeReqs.core_waivers_by_program || {})) {
    for (const area of areas) {
      insertCoreWaiver.run({
        program_code: progCode,
        waived_area: area,
      });
      waiverCount++;
    }
  }

  console.log(`  Programs: ${programCount}`);
  console.log(`  Categories: ${categoryCount}`);
  console.log(`  Eligible courses: ${eligibleCount}`);
  console.log(`  Overlap rules: ${overlapCount}`);
  console.log(`  Core waivers: ${waiverCount}`);
});

try {
  seed();
  console.log("✓ Program data seeded successfully");
} catch (err) {
  console.error("✗ Failed to seed programs:", err.message);
  process.exit(1);
} finally {
  db.close();
}
