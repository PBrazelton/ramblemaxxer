/**
 * db/init.js
 * Creates (or re-creates) the SQLite database and applies the schema.
 * Safe to re-run — uses CREATE TABLE IF NOT EXISTS throughout.
 *
 * Usage: node server/db/init.js
 */

const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "ramblemaxxer.db");
const SCHEMA_PATH = path.join(__dirname, "schema.sql");

const schema = fs.readFileSync(SCHEMA_PATH, "utf8");
const db = new Database(DB_PATH);

// Enable WAL mode for better concurrent read performance
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

// Execute the schema file (exec handles multiple statements and comments natively)
db.exec(schema);

// Migration: add pinned_program column if it doesn't exist
try {
  db.prepare("ALTER TABLE student_courses ADD COLUMN pinned_program TEXT").run();
  console.log("  Migrated: added pinned_program column");
} catch (e) { /* already exists */ }

// Migration: add satisfies_json column for transfer credit requirement mappings
try {
  db.prepare("ALTER TABLE student_courses ADD COLUMN satisfies_json TEXT").run();
  console.log("  Migrated: added satisfies_json column");
} catch (e) { /* already exists */ }

// Migration: widen unique constraint from (user_id, course_code) to (user_id, course_code, semester)
// SQLite can't ALTER constraints, so rebuild the table if the old constraint exists
try {
  // Check if the old constraint is still in place by trying a dummy duplicate
  const testRow = db.prepare("SELECT id, user_id, course_code, semester FROM student_courses LIMIT 1").get();
  if (testRow) {
    // Try inserting a duplicate (user_id, course_code) with different semester — if it fails, old constraint is active
    const testStmt = db.prepare("INSERT INTO student_courses (user_id, course_code, semester, status) VALUES (?, ?, ?, ?)");
    try {
      testStmt.run(testRow.user_id, testRow.course_code, "__MIGRATION_TEST__", "planned");
      // If we get here, constraint already allows it (or was already migrated) — clean up test row
      db.prepare("DELETE FROM student_courses WHERE user_id = ? AND course_code = ? AND semester = '__MIGRATION_TEST__'").run(testRow.user_id, testRow.course_code);
    } catch (e) {
      if (e.code === "SQLITE_CONSTRAINT_UNIQUE") {
        // Old constraint is active — rebuild table
        console.log("  Migrating: widening student_courses unique constraint to include semester...");
        db.exec(`
          CREATE TABLE student_courses_new (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            course_code TEXT NOT NULL,
            semester TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'planned',
            credits_override INTEGER,
            note TEXT,
            satisfies_json TEXT,
            created_at TEXT NOT NULL DEFAULT (datetime('now')),
            pinned_program TEXT,
            UNIQUE(user_id, course_code, semester)
          );
          INSERT INTO student_courses_new SELECT id, user_id, course_code, semester, status, credits_override, note, satisfies_json, created_at, pinned_program FROM student_courses;
          DROP TABLE student_courses;
          ALTER TABLE student_courses_new RENAME TO student_courses;
        `);
        console.log("  Migrated: student_courses unique constraint now includes semester");
      }
    }
  }
} catch (e) { /* table may not exist yet — schema.sql will create it correctly */ }

// Migration: add section + class_number to student_courses (for enrolled section tracking)
try {
  db.prepare("ALTER TABLE student_courses ADD COLUMN section TEXT").run();
  console.log("  Migrated: added section column to student_courses");
} catch (e) { /* already exists */ }
try {
  db.prepare("ALTER TABLE student_courses ADD COLUMN class_number TEXT").run();
  console.log("  Migrated: added class_number column to student_courses");
} catch (e) { /* already exists */ }

// Migration: add active column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN active INTEGER NOT NULL DEFAULT 1").run();
  console.log("  Migrated: added active column");
} catch (e) { /* already exists */ }

// Migration: add privacy column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN privacy TEXT NOT NULL DEFAULT 'private'").run();
  console.log("  Migrated: added privacy column");
} catch (e) { /* already exists */ }

// Migration: add provider column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN provider TEXT NOT NULL DEFAULT 'local'").run();
  console.log("  Migrated: added provider column");
} catch (e) { /* already exists */ }

// Migration: add provider_id column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN provider_id TEXT").run();
  console.log("  Migrated: added provider_id column");
} catch (e) { /* already exists */ }

// Migration: add avatar_url column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN avatar_url TEXT").run();
  console.log("  Migrated: added avatar_url column");
} catch (e) { /* already exists */ }

// Migration: create unique index on provider + provider_id
try {
  db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_provider ON users(provider, provider_id) WHERE provider_id IS NOT NULL").run();
  console.log("  Migrated: added provider unique index");
} catch (e) { /* already exists */ }

// Migration: create password_resets table
db.exec(`
  CREATE TABLE IF NOT EXISTS password_resets (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token       TEXT    NOT NULL UNIQUE,
    expires_at  TEXT    NOT NULL,
    used_at     TEXT,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration: create courses table
db.exec(`
  CREATE TABLE IF NOT EXISTS courses (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    code              TEXT    NOT NULL UNIQUE,
    department        TEXT    NOT NULL,
    number            INTEGER NOT NULL,
    title             TEXT    NOT NULL,
    credits           INTEGER,
    credits_min       INTEGER,
    credits_max       INTEGER,
    prerequisites     TEXT,
    knowledge_area    TEXT,
    engaged_learning  INTEGER NOT NULL DEFAULT 0,
    writing_intensive INTEGER NOT NULL DEFAULT 0,
    description       TEXT,
    catalog_year      TEXT,
    created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_courses_dept_number ON courses(department, number)").run();
} catch (e) { /* already exists */ }

// Migration: create course_interdisciplinary_tags table
db.exec(`
  CREATE TABLE IF NOT EXISTS course_interdisciplinary_tags (
    course_code TEXT NOT NULL,
    tag         TEXT NOT NULL,
    PRIMARY KEY (course_code, tag),
    FOREIGN KEY (course_code) REFERENCES courses(code) ON DELETE CASCADE
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_course_tags_tag ON course_interdisciplinary_tags(tag)").run();
} catch (e) { /* already exists */ }

// Migration: create course_cross_listings table
db.exec(`
  CREATE TABLE IF NOT EXISTS course_cross_listings (
    course_code       TEXT NOT NULL,
    cross_listed_code TEXT NOT NULL,
    PRIMARY KEY (course_code, cross_listed_code),
    FOREIGN KEY (course_code) REFERENCES courses(code) ON DELETE CASCADE
  )
`);

// Migration: create FTS5 virtual table + triggers for courses
try {
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
      code, title, description, department, knowledge_area,
      content='courses',
      content_rowid='id'
    )
  `);
} catch (e) { /* FTS already exists */ }

try {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS courses_ai AFTER INSERT ON courses BEGIN
      INSERT INTO courses_fts(rowid, code, title, description, department, knowledge_area)
      VALUES (new.id, new.code, new.title, new.description, new.department, new.knowledge_area);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS courses_ad AFTER DELETE ON courses BEGIN
      INSERT INTO courses_fts(courses_fts, rowid, code, title, description, department, knowledge_area)
      VALUES ('delete', old.id, old.code, old.title, old.description, old.department, old.knowledge_area);
    END
  `);
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS courses_au AFTER UPDATE ON courses BEGIN
      INSERT INTO courses_fts(courses_fts, rowid, code, title, description, department, knowledge_area)
      VALUES ('delete', old.id, old.code, old.title, old.description, old.department, old.knowledge_area);
      INSERT INTO courses_fts(rowid, code, title, description, department, knowledge_area)
      VALUES (new.id, new.code, new.title, new.description, new.department, new.knowledge_area);
    END
  `);
} catch (e) { /* triggers already exist */ }

// Migration: convert Penelope's integer semesters to string terms
try {
  const penelope = db.prepare("SELECT id FROM users WHERE email = 'penelope@brazelton.net'").get();
  if (penelope) {
    const check = db.prepare("SELECT semester FROM student_courses WHERE user_id = ? LIMIT 1").get(penelope.id);
    if (check && /^\d+$/.test(String(check.semester))) {
      const map = { 0: 'Transfer', 1: 'Fall 2024', 2: 'Spring 2025', 3: 'Fall 2025', 4: 'Spring 2026', 5: 'Fall 2026', 6: 'Spring 2027' };
      for (const [old, term] of Object.entries(map)) {
        db.prepare("UPDATE student_courses SET semester = ? WHERE semester = ? AND user_id = ?")
          .run(term, parseInt(old), penelope.id);
      }
      console.log("  Migrated: Penelope's semesters to string terms");
    }
  }
} catch (e) { /* already migrated */ }

// Migration: create programs table
db.exec(`
  CREATE TABLE IF NOT EXISTS programs (
    code                    TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    type                    TEXT NOT NULL,
    department              TEXT,
    college                 TEXT,
    total_credits           INTEGER,
    unique_credits_required INTEGER,
    double_dip_policy       TEXT,
    core_waivers            TEXT,
    notes                   TEXT,
    elective_pool_by_region TEXT,
    is_active               INTEGER NOT NULL DEFAULT 1,
    created_at              TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration: create program_categories table
db.exec(`
  CREATE TABLE IF NOT EXISTS program_categories (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    program_code    TEXT NOT NULL REFERENCES programs(code) ON DELETE CASCADE,
    name            TEXT NOT NULL,
    description     TEXT,
    slots           INTEGER NOT NULL,
    credits_per_slot INTEGER NOT NULL DEFAULT 3,
    sort_order      INTEGER NOT NULL DEFAULT 0,
    tier_structure  TEXT,
    wildcard        TEXT,
    is_fixed        INTEGER NOT NULL DEFAULT 0,
    constraints     TEXT,
    notes           TEXT,
    UNIQUE(program_code, name)
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_program_categories_program ON program_categories(program_code)").run();
} catch (e) { /* already exists */ }

// Migration: create category_eligible_courses table
db.exec(`
  CREATE TABLE IF NOT EXISTS category_eligible_courses (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL REFERENCES program_categories(id) ON DELETE CASCADE,
    course_code TEXT NOT NULL,
    is_required INTEGER NOT NULL DEFAULT 0,
    notes       TEXT,
    UNIQUE(category_id, course_code)
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_cat_eligible_category ON category_eligible_courses(category_id)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_cat_eligible_course ON category_eligible_courses(course_code)").run();
} catch (e) { /* already exists */ }

// Migration: create overlap_rules table
db.exec(`
  CREATE TABLE IF NOT EXISTS overlap_rules (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    program_a             TEXT NOT NULL,
    program_b             TEXT NOT NULL,
    overlap_type          TEXT,
    max_shared_courses    INTEGER,
    max_from_single_dept  INTEGER,
    constraint_source     TEXT,
    details               TEXT,
    notes                 TEXT,
    UNIQUE(program_a, program_b)
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_overlap_rules_programs ON overlap_rules(program_a, program_b)").run();
} catch (e) { /* already exists */ }

// Migration: create core_waivers table
db.exec(`
  CREATE TABLE IF NOT EXISTS core_waivers (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    program_code  TEXT NOT NULL,
    waived_area   TEXT NOT NULL,
    UNIQUE(program_code, waived_area)
  )
`);

// Migration: create course_offerings table
db.exec(`
  CREATE TABLE IF NOT EXISTS course_offerings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    course_code     TEXT NOT NULL,
    term            TEXT NOT NULL,
    section         TEXT NOT NULL,
    instructor      TEXT,
    days            TEXT,
    start_time      TEXT,
    end_time        TEXT,
    location        TEXT,
    enrollment_cap  INTEGER,
    enrollment_current INTEGER,
    class_number    TEXT,
    instruction_mode TEXT,
    scraped_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(course_code, term, class_number)
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_offerings_course ON course_offerings(course_code)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_offerings_term ON course_offerings(term)").run();
} catch (e) { /* already exists */ }

// Migration: create course_terms table
db.exec(`
  CREATE TABLE IF NOT EXISTS course_terms (
    course_code   TEXT NOT NULL,
    term          TEXT NOT NULL,
    section_count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (course_code, term)
  )
`);

// Migration: create student_plans table
db.exec(`
  CREATE TABLE IF NOT EXISTS student_plans (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name        TEXT    NOT NULL DEFAULT 'My Plan',
    is_active   INTEGER NOT NULL DEFAULT 1,
    created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now'))
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_student_plans_user ON student_plans(user_id)").run();
} catch (e) { /* already exists */ }

// Migration: create plan_courses table
db.exec(`
  CREATE TABLE IF NOT EXISTS plan_courses (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    plan_id      INTEGER NOT NULL REFERENCES student_plans(id) ON DELETE CASCADE,
    course_code  TEXT    NOT NULL,
    term         TEXT    NOT NULL,
    section      TEXT,
    class_number TEXT,
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(plan_id, course_code)
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_plan_courses_plan ON plan_courses(plan_id)").run();
} catch (e) { /* already exists */ }

// Migration: add onboarding_step column to users
try {
  db.prepare("ALTER TABLE users ADD COLUMN onboarding_step INTEGER").run();
  console.log("  Migrated: added onboarding_step column");
} catch (e) { /* already exists */ }

// Migration: fix UCLR 100 → UCLR 100C for Penelope
try {
  const result = db.prepare("UPDATE student_courses SET course_code = 'UCLR 100C' WHERE course_code = 'UCLR 100'").run();
  if (result.changes > 0) console.log("  Migrated: UCLR 100 → UCLR 100C");
} catch (e) { /* already fixed */ }

// Migration: create feedback table
db.exec(`
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    category TEXT,
    message TEXT NOT NULL,
    screenshot BLOB,
    errors TEXT,
    context TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'new',
    admin_notes TEXT,
    github_issue_url TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    resolved_at TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  )
`);
try {
  db.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_status ON feedback(status)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_user ON feedback(user_id)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_category ON feedback(category)").run();
  db.prepare("CREATE INDEX IF NOT EXISTS idx_feedback_created ON feedback(created_at)").run();
} catch (e) { /* already exist */ }

db.close();
console.log(`✓ Database initialized at ${DB_PATH}`);
