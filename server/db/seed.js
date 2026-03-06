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

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "ramblemaxxer.db");
const db = new Database(DB_PATH);
db.pragma("foreign_keys = ON");

// ── Penelope's course list (source of truth from handoff doc) ──────────────
// status: 'transfer' | 'complete' | 'enrolled' | 'planned'
// semester: string term (e.g. "Fall 2024", "Transfer")
const PENELOPE_COURSES = [
  // Transfer
  { code: "AP BIO",   semester: "Transfer", status: "transfer" },
  { code: "AP PSYCH", semester: "Transfer", status: "transfer" },

  // Fall 2024
  { code: "HIST 104",  semester: "Fall 2024", status: "complete" },
  { code: "PLSC 102",  semester: "Fall 2024", status: "complete" },
  { code: "PLSC 103",  semester: "Fall 2024", status: "complete" },
  { code: "THEO 186",  semester: "Fall 2024", status: "complete" },
  { code: "UCLR 100C", semester: "Fall 2024", status: "complete" },
  { code: "UNIV 101",  semester: "Fall 2024", status: "complete" },

  // Spring 2025
  { code: "PLSC 101", semester: "Spring 2025", status: "complete" },
  { code: "PLSC 202", semester: "Spring 2025", status: "complete" },
  { code: "PLSC 362", semester: "Spring 2025", status: "complete" },
  { code: "PHIL 130", semester: "Spring 2025", status: "complete" },
  { code: "THEO 100", semester: "Spring 2025", status: "complete" },
  { code: "UCWR 110", semester: "Spring 2025", status: "complete" },

  // Fall 2025
  { code: "GLST 101", semester: "Fall 2025", status: "complete" },
  { code: "ANTH 100", semester: "Fall 2025", status: "complete" },
  { code: "PLSC 252", semester: "Fall 2025", status: "complete" },
  { code: "PLSC 216", semester: "Fall 2025", status: "complete" },
  { code: "HIST 210", semester: "Fall 2025", status: "complete" },
  { code: "SPAN 102", semester: "Fall 2025", status: "complete" },

  // Spring 2026 (enrolled)
  { code: "PLSC 311", semester: "Spring 2026", status: "enrolled" },
  { code: "PLSC 367", semester: "Spring 2026", status: "enrolled" },
  { code: "ANTH 321", semester: "Spring 2026", status: "enrolled" },
  { code: "PLSC 337", semester: "Spring 2026", status: "enrolled" },
  { code: "LITR 284", semester: "Spring 2026", status: "enrolled" },
  { code: "SPAN 103", semester: "Spring 2026", status: "enrolled" },

  // Fall 2026 (planned, abroad)
  { code: "FNAR 113", semester: "Fall 2026", status: "planned" },
  { code: "ENGL 290", semester: "Fall 2026", status: "planned" },
  { code: "PHIL 287", semester: "Fall 2026", status: "planned" },
  { code: "THEO 278", semester: "Fall 2026", status: "planned" },
  { code: "ANTH 216", semester: "Fall 2026", status: "planned" },

  // Spring 2027 (future)
  { code: "SPAN 104", semester: "Spring 2027", status: "planned" },
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
