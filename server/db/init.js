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

const DB_PATH = path.join(__dirname, "ramblemaxxer.db");
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

db.close();
console.log(`✓ Database initialized at ${DB_PATH}`);
