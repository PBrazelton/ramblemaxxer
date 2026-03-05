/**
 * db/seed.js
 * Seeds the database with Penelope + Paul if they don't already exist.
 * Fully idempotent — safe to run on every deploy.
 *
 * Usage: node server/db/seed.js
 */

const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const path = require("path");

const DB_PATH = path.join(__dirname, "ramblemaxxer.db");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// ── Penelope's course list (source of truth from handoff doc) ──────────────
// status: 'transfer' | 'complete' | 'enrolled' | 'planned'
// semester: 1=Fall23, 2=Spring24, 3=Fall24, 4=Spring25(current), 5=Fall25(abroad), 6+=future
const PENELOPE_COURSES = [
  // Transfer
  { code: "AP BIO",   semester: 0, status: "transfer" },
  { code: "AP PSYCH", semester: 0, status: "transfer" },

  // Semester 1: Fall 2023
  { code: "HIST 104", semester: 1, status: "complete" },
  { code: "PLSC 102", semester: 1, status: "complete" },
  { code: "PLSC 103", semester: 1, status: "complete" },
  { code: "THEO 186", semester: 1, status: "complete" },
  { code: "UCLR 100", semester: 1, status: "complete" },
  { code: "UNIV 101", semester: 1, status: "complete" },

  // Semester 2: Spring 2024
  { code: "PLSC 101", semester: 2, status: "complete" },
  { code: "PLSC 202", semester: 2, status: "complete" },
  { code: "PLSC 362", semester: 2, status: "complete" },
  { code: "PHIL 130", semester: 2, status: "complete" },
  { code: "THEO 100", semester: 2, status: "complete" },
  { code: "UCWR 110", semester: 2, status: "complete" },

  // Semester 3: Fall 2024
  { code: "GLST 101", semester: 3, status: "complete" },
  { code: "ANTH 100", semester: 3, status: "complete" },
  { code: "PLSC 252", semester: 3, status: "complete" },
  { code: "PLSC 216", semester: 3, status: "complete" },
  { code: "HIST 210", semester: 3, status: "complete" },
  { code: "SPAN 102", semester: 3, status: "complete" },

  // Semester 4: Spring 2025 (enrolled)
  { code: "PLSC 311", semester: 4, status: "enrolled" },
  { code: "PLSC 367", semester: 4, status: "enrolled" },
  { code: "ANTH 321", semester: 4, status: "enrolled" },
  { code: "PLSC 337", semester: 4, status: "enrolled" },
  { code: "LITR 284", semester: 4, status: "enrolled" },
  { code: "SPAN 103", semester: 4, status: "enrolled" },

  // Semester 5: Fall 2025 (planned, abroad)
  { code: "FNAR 113", semester: 5, status: "planned" },
  { code: "ENGL 290", semester: 5, status: "planned" },
  { code: "PHIL 287", semester: 5, status: "planned" },
  { code: "THEO 278", semester: 5, status: "planned" },
  { code: "ANTH 216", semester: 5, status: "planned" },

  // Future (unscheduled)
  { code: "SPAN 104", semester: 6, status: "planned" },
];

const PENELOPE_PROGRAMS = ["PLSC-BA", "GLST-BA", "CORE", "CAS-GRAD", "SPAN-LANG"];

// ── Seed ──────────────────────────────────────────────────────────────────
const seedPenelope = db.transaction(() => {
  const existing = db.prepare("SELECT id FROM users WHERE email = ?")
    .get("penelope@brazelton.net");

  if (existing) {
    console.log(`  Penelope already exists (id=${existing.id}), skipping`);
    return;
  }

  const passwordHash = bcrypt.hashSync("peeps", 10);
  const { lastInsertRowid: userId } = db.prepare(`
    INSERT INTO users (email, name, password_hash, role, grad_year)
    VALUES (?, ?, ?, ?, ?)
  `).run("penelope@brazelton.net", "Penelope", passwordHash, "student", 2027);

  console.log(`  Created user: Penelope (id=${userId})`);

  // Programs
  const insertProgram = db.prepare(
    "INSERT OR IGNORE INTO student_programs (user_id, program_id) VALUES (?, ?)"
  );
  for (const prog of PENELOPE_PROGRAMS) {
    insertProgram.run(userId, prog);
  }
  console.log(`  Inserted ${PENELOPE_PROGRAMS.length} programs`);

  // Courses
  const insertCourse = db.prepare(
    "INSERT OR IGNORE INTO student_courses (user_id, course_code, semester, status) VALUES (?, ?, ?, ?)"
  );
  for (const c of PENELOPE_COURSES) {
    insertCourse.run(userId, c.code, c.semester, c.status);
  }
  console.log(`  Inserted ${PENELOPE_COURSES.length} courses`);
});

seedPenelope();

// Paul — admin
const existingPaul = db.prepare("SELECT id FROM users WHERE email = ?")
  .get("paul@ramblemaxxer.com");
if (existingPaul) {
  console.log(`  Paul already exists (id=${existingPaul.id}), skipping`);
} else {
  const paulHash = bcrypt.hashSync("changeme-admin", 10);
  db.prepare(`
    INSERT INTO users (email, name, password_hash, role, invited_by)
    VALUES (?, ?, ?, 'admin', NULL)
  `).run("paul@ramblemaxxer.com", "Paul", paulHash);
  console.log("  Created admin: Paul");
}

db.close();
console.log("✓ Seed complete (idempotent — existing data preserved).");
