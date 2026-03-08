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

-- Course catalog (scraped from catalog.luc.edu + enriched from local JSON)
CREATE TABLE IF NOT EXISTS courses (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  code              TEXT    NOT NULL UNIQUE,     -- e.g. 'PLSC 100'
  department        TEXT    NOT NULL,            -- e.g. 'PLSC'
  number            INTEGER NOT NULL,            -- e.g. 100
  title             TEXT    NOT NULL,
  credits           INTEGER,                     -- typical credit value
  credits_min       INTEGER,                     -- for variable-credit courses
  credits_max       INTEGER,
  prerequisites     TEXT,                        -- free-text from catalog
  knowledge_area    TEXT,                        -- Core knowledge area
  engaged_learning  INTEGER NOT NULL DEFAULT 0,  -- boolean flag
  writing_intensive INTEGER NOT NULL DEFAULT 0,  -- boolean flag
  description       TEXT,
  catalog_year      TEXT,                        -- e.g. '2025-2026'
  created_at        TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at        TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_courses_department ON courses(department);
CREATE INDEX IF NOT EXISTS idx_courses_dept_number ON courses(department, number);

-- Interdisciplinary program tags (many-to-many)
CREATE TABLE IF NOT EXISTS course_interdisciplinary_tags (
  course_code TEXT NOT NULL,
  tag         TEXT NOT NULL,
  PRIMARY KEY (course_code, tag),
  FOREIGN KEY (course_code) REFERENCES courses(code) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_course_tags_tag ON course_interdisciplinary_tags(tag);

-- Cross-listed course equivalences
CREATE TABLE IF NOT EXISTS course_cross_listings (
  course_code       TEXT NOT NULL,
  cross_listed_code TEXT NOT NULL,
  PRIMARY KEY (course_code, cross_listed_code),
  FOREIGN KEY (course_code) REFERENCES courses(code) ON DELETE CASCADE
);

-- Full-text search on courses
CREATE VIRTUAL TABLE IF NOT EXISTS courses_fts USING fts5(
  code, title, description, department, knowledge_area,
  content='courses',
  content_rowid='id'
);

-- FTS sync triggers
CREATE TRIGGER IF NOT EXISTS courses_ai AFTER INSERT ON courses BEGIN
  INSERT INTO courses_fts(rowid, code, title, description, department, knowledge_area)
  VALUES (new.id, new.code, new.title, new.description, new.department, new.knowledge_area);
END;

CREATE TRIGGER IF NOT EXISTS courses_ad AFTER DELETE ON courses BEGIN
  INSERT INTO courses_fts(courses_fts, rowid, code, title, description, department, knowledge_area)
  VALUES ('delete', old.id, old.code, old.title, old.description, old.department, old.knowledge_area);
END;

CREATE TRIGGER IF NOT EXISTS courses_au AFTER UPDATE ON courses BEGIN
  INSERT INTO courses_fts(courses_fts, rowid, code, title, description, department, knowledge_area)
  VALUES ('delete', old.id, old.code, old.title, old.description, old.department, old.knowledge_area);
  INSERT INTO courses_fts(rowid, code, title, description, department, knowledge_area)
  VALUES (new.id, new.code, new.title, new.description, new.department, new.knowledge_area);
END;

-- Program definitions (degree requirements moved from JSON to DB)
CREATE TABLE IF NOT EXISTS programs (
  code                    TEXT PRIMARY KEY,
  name                    TEXT NOT NULL,
  type                    TEXT NOT NULL,  -- 'major' | 'core' | 'college' | 'requirement'
  department              TEXT,
  college                 TEXT,
  total_credits           INTEGER,
  unique_credits_required INTEGER,
  double_dip_policy       TEXT,
  core_waivers            TEXT,  -- JSON array
  notes                   TEXT,  -- JSON array
  elective_pool_by_region TEXT,  -- JSON object (GLST-BA only)
  is_active               INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at              TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS program_categories (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  program_code    TEXT NOT NULL REFERENCES programs(code) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  slots           INTEGER NOT NULL,
  credits_per_slot INTEGER NOT NULL DEFAULT 3,
  sort_order      INTEGER NOT NULL DEFAULT 0,
  tier_structure  TEXT,    -- 'single' | 'foundation_plus_tier2' (CORE only)
  wildcard        TEXT,    -- 'ANY_PLSC_200_PLUS' | 'ANY_GLST_TAGGED' | null
  is_fixed        INTEGER NOT NULL DEFAULT 0,  -- 1 = eligible_courses_fixed shape
  constraints     TEXT,    -- JSON (GLST Electives only)
  notes           TEXT,
  UNIQUE(program_code, name)
);

CREATE INDEX IF NOT EXISTS idx_program_categories_program ON program_categories(program_code);

CREATE TABLE IF NOT EXISTS category_eligible_courses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category_id INTEGER NOT NULL REFERENCES program_categories(id) ON DELETE CASCADE,
  course_code TEXT NOT NULL,
  is_required INTEGER NOT NULL DEFAULT 0,
  notes       TEXT,
  UNIQUE(category_id, course_code)
);

CREATE INDEX IF NOT EXISTS idx_cat_eligible_category ON category_eligible_courses(category_id);
CREATE INDEX IF NOT EXISTS idx_cat_eligible_course ON category_eligible_courses(course_code);

CREATE TABLE IF NOT EXISTS overlap_rules (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  program_a             TEXT NOT NULL,
  program_b             TEXT NOT NULL,
  overlap_type          TEXT,           -- 'waiver' | null
  max_shared_courses    INTEGER,
  max_from_single_dept  INTEGER,
  constraint_source     TEXT,
  details               TEXT,
  notes                 TEXT,  -- JSON array
  UNIQUE(program_a, program_b)
);

CREATE INDEX IF NOT EXISTS idx_overlap_rules_programs ON overlap_rules(program_a, program_b);

CREATE TABLE IF NOT EXISTS core_waivers (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  program_code  TEXT NOT NULL,
  waived_area   TEXT NOT NULL,
  UNIQUE(program_code, waived_area)
);

-- Course offering sections scraped from LOCUS
CREATE TABLE IF NOT EXISTS course_offerings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  course_code     TEXT NOT NULL,        -- e.g. 'PLSC 102'
  term            TEXT NOT NULL,        -- e.g. 'Fall 2025', 'Spring 2026'
  section         TEXT NOT NULL,        -- e.g. '001', '002'
  instructor      TEXT,
  days            TEXT,                 -- e.g. 'MWF', 'TR'
  start_time      TEXT,                 -- e.g. '10:00'
  end_time        TEXT,                 -- e.g. '10:50'
  location        TEXT,
  enrollment_cap  INTEGER,
  enrollment_current INTEGER,
  class_number    TEXT,                 -- PeopleSoft class_nbr
  instruction_mode TEXT,               -- 'In Person', 'Online', 'Hybrid'
  scraped_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(course_code, term, class_number)
);

CREATE INDEX IF NOT EXISTS idx_offerings_course ON course_offerings(course_code);
CREATE INDEX IF NOT EXISTS idx_offerings_term ON course_offerings(term);

-- Denormalized term availability (one row per course+term, faster lookups)
CREATE TABLE IF NOT EXISTS course_terms (
  course_code   TEXT NOT NULL,
  term          TEXT NOT NULL,
  section_count INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (course_code, term)
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
