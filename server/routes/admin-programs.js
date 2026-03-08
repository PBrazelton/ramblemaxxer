/**
 * server/routes/admin-programs.js
 * Admin CRUD API for program definitions.
 *
 * GET    /api/admin/programs                  - list all (active + inactive)
 * GET    /api/admin/programs/:code            - full program detail
 * POST   /api/admin/programs                  - create program
 * PUT    /api/admin/programs/:code            - update program (delete + reinsert)
 * DELETE /api/admin/programs/:code            - deactivate or hard delete
 * PUT    /api/admin/programs/:code/activate   - reactivate
 * GET    /api/admin/programs/courses/filter    - filter courses by dept/number
 */

const express = require("express");
const db = require("../db/connection");
const { clearProgramCache } = require("../lib/catalog");

const router = express.Router();

// ── requireAdmin middleware ──────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  if (!req.session.userId) return res.status(401).json({ error: "Not logged in" });
  const user = db.prepare("SELECT role FROM users WHERE id = ?").get(req.session.userId);
  if (!user || user.role !== "admin") return res.status(403).json({ error: "Admin only" });
  next();
}

router.use(requireAdmin);

// ── Validation helpers ───────────────────────────────────────────────────────
const CODE_RE = /^[A-Z0-9]{2,6}(-[A-Z0-9]{2,6})?$/;
const VALID_TYPES = ["major", "minor", "core", "college", "requirement"];

function validateProgram(body) {
  if (!body.code || !CODE_RE.test(body.code)) return "Invalid program code";
  if (!body.name || !body.name.trim()) return "Name is required";
  if (!VALID_TYPES.includes(body.type)) return "Invalid type";
  if ((body.type === "major" || body.type === "minor") && (!Array.isArray(body.categories) || body.categories.length === 0)) {
    return "Major/minor programs need at least one category";
  }
  if (body.categories) {
    for (const cat of body.categories) {
      if (!cat.name || !cat.name.trim()) return "Each category needs a name";
      if (!cat.slots || cat.slots < 1) return "Each category needs at least 1 slot";
    }
  }
  return null;
}

// ── Prepared statements ──────────────────────────────────────────────────────
const insertProgram = db.prepare(`
  INSERT INTO programs (code, name, type, department, college, total_credits,
    unique_credits_required, double_dip_policy, core_waivers, notes,
    elective_pool_by_region, is_active)
  VALUES (@code, @name, @type, @department, @college, @total_credits,
    @unique_credits_required, @double_dip_policy, @core_waivers, @notes,
    @elective_pool_by_region, 1)
`);

const updateProgram = db.prepare(`
  UPDATE programs SET name=@name, type=@type, department=@department,
    college=@college, total_credits=@total_credits,
    unique_credits_required=@unique_credits_required,
    double_dip_policy=@double_dip_policy, core_waivers=@core_waivers,
    notes=@notes, elective_pool_by_region=@elective_pool_by_region,
    updated_at=datetime('now')
  WHERE code=@code
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

// ── Helper: insert categories, eligible courses, waivers, overlap rules ──────
function insertChildren(code, body) {
  // Categories + eligible courses
  for (let i = 0; i < (body.categories || []).length; i++) {
    const cat = body.categories[i];
    const isWildcard = !!cat.wildcard;
    const isFixed = !!cat.isFixed;

    const catResult = insertCategory.run({
      program_code: code,
      name: cat.name,
      description: cat.description || null,
      slots: cat.slots,
      credits_per_slot: cat.creditsPerSlot || 3,
      sort_order: i,
      tier_structure: cat.tierStructure || null,
      wildcard: isWildcard ? cat.wildcard : null,
      is_fixed: isFixed ? 1 : 0,
      constraints: cat.constraints ? JSON.stringify(cat.constraints) : null,
      notes: cat.notes || null,
    });

    const categoryId = catResult.lastInsertRowid;

    if (cat.eligibleCourses && Array.isArray(cat.eligibleCourses)) {
      for (const entry of cat.eligibleCourses) {
        const courseCode = typeof entry === "string" ? entry : entry.courseCode;
        const isRequired = typeof entry === "object" ? (entry.isRequired ? 1 : 0) : 0;
        insertEligibleCourse.run({
          category_id: categoryId,
          course_code: courseCode,
          is_required: isRequired,
          notes: typeof entry === "object" ? (entry.notes || null) : null,
        });
      }
    }
  }

  // Core waivers
  for (const area of (body.coreWaivers || [])) {
    insertCoreWaiver.run({ program_code: code, waived_area: area });
  }

  // Overlap rules
  for (const rule of (body.overlapRules || [])) {
    const [a, b] = [code, rule.partnerProgram].sort();
    insertOverlapRule.run({
      program_a: a,
      program_b: b,
      overlap_type: rule.overlapType || null,
      max_shared_courses: rule.maxSharedCourses || null,
      max_from_single_dept: rule.maxFromSingleDept || null,
      constraint_source: rule.constraintSource || null,
      details: rule.details || null,
      notes: rule.notes ? JSON.stringify(rule.notes) : null,
    });
  }
}

// ── GET / — List all programs ────────────────────────────────────────────────
router.get("/", (req, res) => {
  try {
    const programs = db.prepare(`
      SELECT p.code, p.name, p.type, p.department, p.college,
        p.total_credits, p.is_active, p.created_at, p.updated_at,
        (SELECT COUNT(*) FROM program_categories pc WHERE pc.program_code = p.code) AS category_count,
        (SELECT COUNT(DISTINCT sp.user_id) FROM student_programs sp WHERE sp.program_id = p.code) AS student_count
      FROM programs p
      ORDER BY p.is_active DESC, p.type, p.name
    `).all();
    res.json(programs);
  } catch (e) {
    res.status(500).json({ error: "Failed to load programs" });
  }
});

// ── GET /courses/filter — Filter courses by department/number ────────────────
// Must be before /:code to avoid matching "courses" as a code
router.get("/courses/filter", (req, res) => {
  const { dept, minNumber } = req.query;
  if (!dept) return res.status(400).json({ error: "dept is required" });

  const min = parseInt(minNumber) || 0;
  const courses = db.prepare(`
    SELECT code, title, credits, department, number
    FROM courses
    WHERE department = ? AND number >= ?
    ORDER BY code
  `).all(dept.toUpperCase(), min);

  res.json(courses);
});

// ── GET /:code — Full program detail ─────────────────────────────────────────
router.get("/:code", (req, res) => {
  const { code } = req.params;
  const program = db.prepare("SELECT * FROM programs WHERE code = ?").get(code);
  if (!program) return res.status(404).json({ error: "Program not found" });

  // Parse JSON fields
  if (program.core_waivers) program.core_waivers = JSON.parse(program.core_waivers);
  if (program.notes) program.notes = JSON.parse(program.notes);
  if (program.elective_pool_by_region) program.elective_pool_by_region = JSON.parse(program.elective_pool_by_region);

  // Student count
  program.student_count = db.prepare(
    "SELECT COUNT(DISTINCT user_id) as cnt FROM student_programs WHERE program_id = ?"
  ).get(code).cnt;

  // Categories with eligible courses
  const categories = db.prepare(
    "SELECT * FROM program_categories WHERE program_code = ? ORDER BY sort_order"
  ).all(code);

  program.categories = categories.map((cat) => {
    if (cat.constraints) cat.constraints = JSON.parse(cat.constraints);
    const eligible = db.prepare(
      "SELECT course_code, is_required, notes FROM category_eligible_courses WHERE category_id = ?"
    ).all(cat.id);
    cat.eligible_courses = eligible;
    return cat;
  });

  // Overlap rules
  program.overlap_rules = db.prepare(
    "SELECT * FROM overlap_rules WHERE program_a = ? OR program_b = ?"
  ).all(code, code).map((r) => {
    if (r.notes) r.notes = JSON.parse(r.notes);
    return r;
  });

  // Core waivers
  program.core_waivers_list = db.prepare(
    "SELECT waived_area FROM core_waivers WHERE program_code = ?"
  ).all(code).map(r => r.waived_area);

  res.json(program);
});

// ── POST / — Create program ─────────────────────────────────────────────────
router.post("/", (req, res) => {
  const body = req.body;
  const err = validateProgram(body);
  if (err) return res.status(400).json({ error: err });

  try {
    db.transaction(() => {
      insertProgram.run({
        code: body.code,
        name: body.name,
        type: body.type,
        department: body.department || null,
        college: body.college || null,
        total_credits: body.totalCredits || null,
        unique_credits_required: body.uniqueCreditsRequired || null,
        double_dip_policy: body.doubleDipPolicy || null,
        core_waivers: body.coreWaivers ? JSON.stringify(body.coreWaivers) : null,
        notes: body.notes ? JSON.stringify(body.notes) : null,
        elective_pool_by_region: body.electivePoolByRegion ? JSON.stringify(body.electivePoolByRegion) : null,
      });
      insertChildren(body.code, body);
    })();
    clearProgramCache();
    res.status(201).json({ ok: true, code: body.code });
  } catch (e) {
    if (e.message.includes("UNIQUE constraint")) {
      return res.status(409).json({ error: `Program ${body.code} already exists` });
    }
    console.error("Failed to create program:", e.message);
    res.status(500).json({ error: "Failed to create program" });
  }
});

// ── PUT /:code — Update program (delete children + reinsert) ─────────────────
router.put("/:code", (req, res) => {
  const { code } = req.params;
  const body = { ...req.body, code };
  const err = validateProgram(body);
  if (err) return res.status(400).json({ error: err });

  const existing = db.prepare("SELECT code FROM programs WHERE code = ?").get(code);
  if (!existing) return res.status(404).json({ error: "Program not found" });

  try {
    db.transaction(() => {
      // Delete children in FK order
      db.prepare(`
        DELETE FROM category_eligible_courses
        WHERE category_id IN (SELECT id FROM program_categories WHERE program_code = ?)
      `).run(code);
      db.prepare("DELETE FROM program_categories WHERE program_code = ?").run(code);
      db.prepare("DELETE FROM overlap_rules WHERE program_a = ? OR program_b = ?").run(code, code);
      db.prepare("DELETE FROM core_waivers WHERE program_code = ?").run(code);

      // Update program row
      updateProgram.run({
        code,
        name: body.name,
        type: body.type,
        department: body.department || null,
        college: body.college || null,
        total_credits: body.totalCredits || null,
        unique_credits_required: body.uniqueCreditsRequired || null,
        double_dip_policy: body.doubleDipPolicy || null,
        core_waivers: body.coreWaivers ? JSON.stringify(body.coreWaivers) : null,
        notes: body.notes ? JSON.stringify(body.notes) : null,
        elective_pool_by_region: body.electivePoolByRegion ? JSON.stringify(body.electivePoolByRegion) : null,
      });

      // Re-insert children
      insertChildren(code, body);
    })();
    clearProgramCache();
    res.json({ ok: true, code });
  } catch (e) {
    console.error("Failed to update program:", e.message);
    res.status(500).json({ error: "Failed to update program" });
  }
});

// ── PUT /:code/activate — Reactivate program ────────────────────────────────
router.put("/:code/activate", (req, res) => {
  const { code } = req.params;
  const existing = db.prepare("SELECT code FROM programs WHERE code = ?").get(code);
  if (!existing) return res.status(404).json({ error: "Program not found" });

  db.prepare("UPDATE programs SET is_active = 1, updated_at = datetime('now') WHERE code = ?").run(code);
  clearProgramCache();
  res.json({ ok: true });
});

// ── DELETE /:code — Deactivate or hard delete ────────────────────────────────
router.delete("/:code", (req, res) => {
  const { code } = req.params;
  const existing = db.prepare("SELECT code FROM programs WHERE code = ?").get(code);
  if (!existing) return res.status(404).json({ error: "Program not found" });

  const studentCount = db.prepare(
    "SELECT COUNT(DISTINCT user_id) as cnt FROM student_programs WHERE program_id = ?"
  ).get(code).cnt;

  if (req.query.deactivate === "true") {
    db.prepare("UPDATE programs SET is_active = 0, updated_at = datetime('now') WHERE code = ?").run(code);
    clearProgramCache();
    return res.json({ ok: true, action: "deactivated" });
  }

  // Hard delete — blocked if students are enrolled
  if (studentCount > 0) {
    return res.status(409).json({
      error: `Cannot delete: ${studentCount} student(s) enrolled. Deactivate instead.`,
    });
  }

  db.transaction(() => {
    db.prepare(`
      DELETE FROM category_eligible_courses
      WHERE category_id IN (SELECT id FROM program_categories WHERE program_code = ?)
    `).run(code);
    db.prepare("DELETE FROM program_categories WHERE program_code = ?").run(code);
    db.prepare("DELETE FROM overlap_rules WHERE program_a = ? OR program_b = ?").run(code, code);
    db.prepare("DELETE FROM core_waivers WHERE program_code = ?").run(code);
    db.prepare("DELETE FROM programs WHERE code = ?").run(code);
  })();
  clearProgramCache();
  res.json({ ok: true, action: "deleted" });
});

module.exports = router;
