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

// Migration: fix UCLR 100 → UCLR 100C for Penelope
try {
  const result = db.prepare("UPDATE student_courses SET course_code = 'UCLR 100C' WHERE course_code = 'UCLR 100'").run();
  if (result.changes > 0) console.log("  Migrated: UCLR 100 → UCLR 100C");
} catch (e) { /* already fixed */ }

db.close();
console.log(`✓ Database initialized at ${DB_PATH}`);
