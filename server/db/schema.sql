-- Ramblemaxxer SQLite schema
-- Run via: node server/db/init.js

-- Users (students + any admin)
CREATE TABLE IF NOT EXISTS users (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  email       TEXT    NOT NULL UNIQUE,
  name        TEXT    NOT NULL,
  password_hash TEXT,            -- nullable for OAuth users
  role        TEXT    NOT NULL DEFAULT 'student', -- 'student' | 'admin'
  grad_year   INTEGER,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  invited_by  INTEGER REFERENCES users(id),
  provider    TEXT    NOT NULL DEFAULT 'local',  -- 'local' | 'google'
  provider_id TEXT,
  avatar_url  TEXT
);

-- Password reset tokens
CREATE TABLE IF NOT EXISTS password_resets (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT    NOT NULL UNIQUE,
  expires_at  TEXT    NOT NULL,
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- Declared programs per student (majors, minors, core)
CREATE TABLE IF NOT EXISTS student_programs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  program_id  TEXT    NOT NULL,  -- e.g. 'PLSC-BA', 'GLST-BA', 'CORE'
  declared_at TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, program_id)
);

-- Each course a student has taken, is enrolled in, or plans to take
CREATE TABLE IF NOT EXISTS student_courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT    NOT NULL,  -- e.g. 'PLSC 102'
  semester    INTEGER NOT NULL,  -- 1=Fall23, 2=Spring24, etc. (relative to student)
  status      TEXT    NOT NULL DEFAULT 'planned', -- 'transfer' | 'complete' | 'enrolled' | 'planned'
  credits_override INTEGER,      -- override if transfer credit differs
  note        TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, course_code)
);

-- Slot assignments: which requirement slot does a course fill for a student?
-- Computed by the solver but stored for persistence / override
CREATE TABLE IF NOT EXISTS slot_assignments (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  course_code TEXT    NOT NULL,
  program_id  TEXT    NOT NULL,
  slot_id     TEXT    NOT NULL,  -- e.g. 'foundation-1', 'elective-3'
  is_overlap  INTEGER NOT NULL DEFAULT 0,  -- 1 if this is a double-counted slot
  UNIQUE(user_id, course_code, program_id, slot_id)
);

-- Invite tokens (Penelope invites her friends)
CREATE TABLE IF NOT EXISTS invites (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  token       TEXT    NOT NULL UNIQUE,
  invited_by  INTEGER NOT NULL REFERENCES users(id),
  email       TEXT,              -- pre-filled email if desired
  used_at     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT    NOT NULL DEFAULT (datetime('now', '+7 days'))
);
