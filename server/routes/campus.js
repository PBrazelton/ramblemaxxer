/**
 * server/routes/campus.js
 *
 * GET /api/campus/buildings   — all campus buildings with coordinates
 * GET /api/campus/my-day      — student's classes for a specific day with buildings + transitions
 */

const express = require("express");
const db = require("../db/connection");
const { requireAuth } = require("./auth");
const { resolveBuilding, walkingMinutes } = require("../lib/buildings");

const router = express.Router();

// ── Helpers ──────────────────────────────────────────────────────────────

const DAY_MAP = { 0: null, 1: "Mo", 2: "Tu", 3: "We", 4: "Th", 5: "Fr", 6: null };

function parseDays(days) {
  if (!days || days === "TBA") return [];
  const result = [];
  let i = 0;
  while (i < days.length) {
    if (days[i] === "M" && days[i + 1] === "o") { result.push("Mo"); i += 2; }
    else if (days[i] === "T" && days[i + 1] === "u") { result.push("Tu"); i += 2; }
    else if (days[i] === "T" && days[i + 1] === "h") { result.push("Th"); i += 2; }
    else if (days[i] === "W" && days[i + 1] === "e") { result.push("We"); i += 2; }
    else if (days[i] === "F" && days[i + 1] === "r") { result.push("Fr"); i += 2; }
    else if (days[i] === "S" && days[i + 1] === "a") { result.push("Sa"); i += 2; }
    else if (days[i] === "S" && days[i + 1] === "u") { result.push("Su"); i += 2; }
    else { i++; }
  }
  return result;
}

function parseTime(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

// ── GET /api/campus/buildings ────────────────────────────────────────────

router.get("/buildings", (req, res) => {
  try {
    const rows = db.prepare("SELECT id, name, code, campus, lat, lng, address FROM campus_buildings").all();
    res.json(rows);
  } catch (e) {
    res.json([]);
  }
});

// ── GET /api/campus/my-day ──────────────────────────────────────────────

router.get("/my-day", requireAuth, (req, res) => {
  const { date, term } = req.query;
  if (!date || !term) return res.status(400).json({ error: "date and term required" });

  // Derive day of week from date
  const d = new Date(date + "T12:00:00"); // noon to avoid timezone issues
  const dayCode = DAY_MAP[d.getDay()];
  if (!dayCode) return res.json({ date, dayOfWeek: null, classes: [], transitions: [] }); // weekend

  const dayNames = { Mo: "Monday", Tu: "Tuesday", We: "Wednesday", Th: "Thursday", Fr: "Friday" };

  // Get student's enrolled courses for this term
  const studentCourses = db.prepare(`
    SELECT sc.course_code, sc.semester, sc.section, sc.class_number,
           c.title, c.credits, c.department
    FROM student_courses sc
    LEFT JOIN courses c ON c.code = sc.course_code
    WHERE sc.user_id = ? AND sc.semester = ? AND sc.status IN ('enrolled', 'complete')
  `).all(req.session.userId, term);

  // Also get plan courses for this term
  const planCourses = db.prepare(`
    SELECT pc.course_code, pc.term as semester, pc.section, pc.class_number,
           c.title, c.credits, c.department
    FROM plan_courses pc
    LEFT JOIN courses c ON c.code = pc.course_code
    WHERE pc.plan_id IN (SELECT id FROM student_plans WHERE user_id = ? AND is_active = 1)
      AND pc.term = ?
  `).all(req.session.userId, term);

  // Merge: enrolled first, then plan (skip duplicates)
  const seenCodes = new Set();
  const allCourses = [];
  for (const c of studentCourses) {
    if (c.section) { seenCodes.add(c.course_code); allCourses.push(c); }
  }
  for (const c of planCourses) {
    if (c.section && !seenCodes.has(c.course_code)) { seenCodes.add(c.course_code); allCourses.push(c); }
  }

  // For each course with a section, look up the offering to get days/times/location
  const classes = [];
  for (const c of allCourses) {
    const offering = db.prepare(`
      SELECT days, start_time, end_time, location, instructor, instruction_mode
      FROM course_offerings
      WHERE course_code = ? AND term = ? AND section = ?
    `).get(c.course_code, term, c.section);

    if (!offering || !offering.days || offering.days === "TBA") continue;

    // Check if this class meets on the requested day
    const meetDays = parseDays(offering.days);
    if (!meetDays.includes(dayCode)) continue;

    const building = resolveBuilding(offering.location);
    const dept = c.department || c.course_code.split(" ")[0];

    classes.push({
      courseCode: c.course_code,
      title: c.title || c.course_code,
      section: c.section,
      instructor: offering.instructor,
      startTime: offering.start_time,
      endTime: offering.end_time,
      startMin: parseTime(offering.start_time),
      endMin: parseTime(offering.end_time),
      location: offering.location,
      building: building ? { name: building.name, lat: building.lat, lng: building.lng, campus: building.campus } : null,
      department: dept,
      instructionMode: offering.instruction_mode,
    });
  }

  // Sort by start time
  classes.sort((a, b) => a.startMin - b.startMin);

  // Compute transitions between consecutive classes
  const transitions = [];
  for (let i = 0; i < classes.length - 1; i++) {
    const from = classes[i];
    const to = classes[i + 1];
    const gapMinutes = to.startMin - from.endMin;
    const fromBuilding = from.building ? resolveBuilding(from.location) : null;
    const toBuilding = to.building ? resolveBuilding(to.location) : null;
    const walkMin = walkingMinutes(fromBuilding, toBuilding);
    const isCrossCampus = fromBuilding && toBuilding && fromBuilding.campus !== toBuilding.campus;
    const isSameBuilding = fromBuilding && toBuilding && fromBuilding.name === toBuilding.name;

    transitions.push({
      from: from.courseCode,
      fromBuilding: from.building?.name || null,
      to: to.courseCode,
      toBuilding: to.building?.name || null,
      gapMinutes,
      walkMinutes: walkMin,
      isCrossCampus,
      isSameBuilding,
      urgency: walkMin === null ? "unknown"
        : isSameBuilding ? "none"
        : gapMinutes - walkMin > 30 ? "comfortable"
        : gapMinutes - walkMin > 15 ? "normal"
        : gapMinutes - walkMin > 5 ? "tight"
        : "critical",
    });
  }

  res.json({
    date,
    dayOfWeek: dayCode,
    dayName: dayNames[dayCode] || dayCode,
    classes,
    transitions,
  });
});

// ── Friend graph helper ──────────────────────────────────────────────────
// Friends = users connected via the invite chain (I invited them OR they invited me)
// Respects privacy: only returns users with privacy = 'friends'

function getFriendIds(userId) {
  // People I invited
  const invited = db.prepare(
    "SELECT id FROM users WHERE invited_by = ? AND active = 1 AND privacy = 'friends'"
  ).all(userId).map(r => r.id);
  // Person who invited me
  const inviter = db.prepare(
    "SELECT invited_by FROM users WHERE id = ?"
  ).get(userId);
  if (inviter?.invited_by) {
    const inv = db.prepare(
      "SELECT id FROM users WHERE id = ? AND active = 1 AND privacy = 'friends'"
    ).get(inviter.invited_by);
    if (inv) invited.push(inv.id);
  }
  // Second-degree: people invited by the same person who invited me (siblings)
  if (inviter?.invited_by) {
    const siblings = db.prepare(
      "SELECT id FROM users WHERE invited_by = ? AND id != ? AND active = 1 AND privacy = 'friends'"
    ).all(inviter.invited_by, userId);
    for (const s of siblings) {
      if (!invited.includes(s.id)) invited.push(s.id);
    }
  }
  return invited;
}

// Get a friend's classes for a specific day (same logic as my-day, but for another user)
function getFriendDayClasses(friendId, term, dayCode) {
  const courses = db.prepare(`
    SELECT sc.course_code, sc.section, c.title, c.department
    FROM student_courses sc
    LEFT JOIN courses c ON c.code = sc.course_code
    WHERE sc.user_id = ? AND sc.semester = ? AND sc.status IN ('enrolled', 'complete') AND sc.section IS NOT NULL
  `).all(friendId, term);

  const classes = [];
  for (const c of courses) {
    const offering = db.prepare(
      "SELECT days, start_time, end_time, location FROM course_offerings WHERE course_code = ? AND term = ? AND section = ?"
    ).get(c.course_code, term, c.section);
    if (!offering || !offering.days || offering.days === "TBA") continue;
    const meetDays = parseDays(offering.days);
    if (!meetDays.includes(dayCode)) continue;
    const building = resolveBuilding(offering.location);
    classes.push({
      courseCode: c.course_code,
      title: c.title,
      startMin: parseTime(offering.start_time),
      endMin: parseTime(offering.end_time),
      building: building ? { name: building.name, lat: building.lat, lng: building.lng, campus: building.campus } : null,
    });
  }
  classes.sort((a, b) => a.startMin - b.startMin);
  return classes;
}

// ── GET /api/campus/friends-nearby ──────────────────────────────────────

router.get("/friends-nearby", requireAuth, (req, res) => {
  const { date, term, time } = req.query;
  if (!date || !term) return res.status(400).json({ error: "date and term required" });

  const d = new Date(date + "T12:00:00");
  const dayCode = DAY_MAP[d.getDay()];
  if (!dayCode) return res.json([]); // weekend

  const timeMin = time ? parseInt(time) : null;
  const friendIds = getFriendIds(req.session.userId);
  if (friendIds.length === 0) return res.json([]);

  const friends = [];
  for (const fid of friendIds) {
    const user = db.prepare("SELECT id, name, avatar_url FROM users WHERE id = ?").get(fid);
    if (!user) continue;

    const classes = getFriendDayClasses(fid, term, dayCode);
    if (classes.length === 0) continue; // no classes today = not on campus

    // Infer position at the given time
    const atMin = timeMin ?? (new Date().getHours() * 60 + new Date().getMinutes());
    let status = "off_campus";
    let location = null;
    let freeUntil = null;
    let inClassUntil = null;

    for (let i = 0; i < classes.length; i++) {
      const c = classes[i];
      if (atMin >= c.startMin && atMin < c.endMin) {
        status = "in_class";
        location = c.building;
        inClassUntil = c.endMin;
        break;
      }
      if (atMin < c.startMin) {
        status = "free";
        location = i > 0 ? classes[i - 1].building : c.building;
        freeUntil = c.startMin;
        break;
      }
    }
    // After all classes
    if (status === "off_campus" && classes.length > 0 && atMin >= classes[classes.length - 1].endMin) {
      status = "done";
      location = classes[classes.length - 1].building;
    }

    friends.push({
      id: user.id,
      name: user.name,
      avatarUrl: user.avatar_url,
      initials: user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2),
      status,
      location,
      freeUntil: freeUntil ? freeUntil : null,
      inClassUntil: inClassUntil ? inClassUntil : null,
    });
  }

  res.json(friends);
});

// ── GET /api/campus/overlaps ────────────────────────────────────────────

router.get("/overlaps", requireAuth, (req, res) => {
  const { date, term } = req.query;
  if (!date || !term) return res.status(400).json({ error: "date and term required" });

  const d = new Date(date + "T12:00:00");
  const dayCode = DAY_MAP[d.getDay()];
  if (!dayCode) return res.json([]); // weekend

  const friendIds = getFriendIds(req.session.userId);
  if (friendIds.length === 0) return res.json([]);

  // Get my classes for the day
  const myClasses = getFriendDayClasses(req.session.userId, term, dayCode);
  if (myClasses.length === 0) return res.json([]);

  // Build my free windows (gaps between classes, min 20 min)
  const myFreeWindows = [];
  for (let i = 0; i < myClasses.length - 1; i++) {
    const gapStart = myClasses[i].endMin;
    const gapEnd = myClasses[i + 1].startMin;
    if (gapEnd - gapStart >= 20) {
      const lastBuilding = myClasses[i].building;
      myFreeWindows.push({ start: gapStart, end: gapEnd, building: lastBuilding });
    }
  }
  // Before first class (if gap from day start is useful — skip for now)
  // After last class
  if (myClasses.length > 0) {
    const lastEnd = myClasses[myClasses.length - 1].endMin;
    const lastBuilding = myClasses[myClasses.length - 1].building;
    myFreeWindows.push({ start: lastEnd, end: lastEnd + 120, building: lastBuilding }); // 2hr window after last class
  }

  const overlaps = [];
  for (const fid of friendIds) {
    const user = db.prepare("SELECT id, name, avatar_url FROM users WHERE id = ?").get(fid);
    if (!user) continue;

    const friendClasses = getFriendDayClasses(fid, term, dayCode);
    if (friendClasses.length === 0) continue;

    // Build friend's free windows
    const friendFreeWindows = [];
    for (let i = 0; i < friendClasses.length - 1; i++) {
      const gapStart = friendClasses[i].endMin;
      const gapEnd = friendClasses[i + 1].startMin;
      if (gapEnd - gapStart >= 20) {
        friendFreeWindows.push({ start: gapStart, end: gapEnd, building: friendClasses[i].building });
      }
    }
    if (friendClasses.length > 0) {
      const lastEnd = friendClasses[friendClasses.length - 1].endMin;
      friendFreeWindows.push({ start: lastEnd, end: lastEnd + 120, building: friendClasses[friendClasses.length - 1].building });
    }

    // Find overlapping free windows
    for (const myW of myFreeWindows) {
      for (const fW of friendFreeWindows) {
        const overlapStart = Math.max(myW.start, fW.start);
        const overlapEnd = Math.min(myW.end, fW.end);
        if (overlapEnd - overlapStart >= 20) {
          // Check same campus
          if (myW.building && fW.building && myW.building.campus !== fW.building.campus) continue;
          const walk = walkingMinutes(
            myW.building ? resolveBuilding(myW.building.name) || myW.building : null,
            fW.building ? resolveBuilding(fW.building.name) || fW.building : null
          );
          overlaps.push({
            friend: { id: user.id, name: user.name, initials: user.name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2) },
            startMin: overlapStart,
            endMin: overlapEnd,
            durationMin: overlapEnd - overlapStart,
            myBuilding: myW.building?.name || null,
            friendBuilding: fW.building?.name || null,
            walkMinutes: walk,
          });
        }
      }
    }
  }

  // Sort by start time, deduplicate by friend
  overlaps.sort((a, b) => a.startMin - b.startMin);
  res.json(overlaps);
});

module.exports = router;
