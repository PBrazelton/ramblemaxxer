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

db.close();
console.log(`✓ Database initialized at ${DB_PATH}`);
