/**
 * server/lib/transcript-parser.js
 * Pure function: PDF buffer → structured transcript object.
 *
 * Parses LUC unofficial transcripts (clean text layer, no OCR needed).
 * LUC PDF text is concatenated — no spaces between fields:
 *   HIST104Global History since 15003.0003.000  A12.000
 */

const pdfParse = require("pdf-parse");

// Term header pattern
const TERM_HEADER = /^(Fall|Spring|Summer)\s+(\d{4})$/;

// LUC concatenated course line:
//   DEPT + NUMBER + optional suffix + Title + attempted(x.xxx) + earned(x.xxx) + optional(spaces+grade) + qualityPoints(xx.xxx)
// Examples:
//   HIST104Global History since 15003.0003.000  A12.000
//   UCLR100CInterpreting Lit - ClassStud3.0003.000  A12.000
//   UNIV101First Year Seminar1.0001.000  P0.000
//   ANTH100Globalization & Local Cultures3.0000.000  0.000  (no grade, enrolled)
//
// Suffix detection: only treat trailing letter as suffix if it's followed by a
// non-alphabetic char (i.e. not the start of a title word). UCLR100C has "I" next
// (start of "Interpreting"), but the C is the suffix because the DB has "UCLR 100C".
// We try both interpretations and pick the one that matches the DB.

// Also handle spaced format in case some transcripts have it
const COURSE_LINE_SPACED = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(.+?)\s+(\d+\.\d{3})\s+(\d+\.\d{3})\s+([A-Z][+-]?|P|W|WF|I|AU|NR)?\s*(\d+\.\d{3})?$/;

// Transfer totals
const TRANSFER_TOTALS = /Transfer\s+Totals\s*:\s*(\d+\.\d{3})/i;

// Cumulative totals — "Cum GPA4.000Cum Totals52.00045.000132.000" or spaced
const CUM_LINE = /Cum\s*GPA\s*:?\s*(\d+\.\d{2,3})\s*Cum\s*Totals\s*(\d+\.\d{3})\s*(\d+\.\d{3})/i;

// Student info
const STUDENT_NAME = /^Name\s*:\s*(.+)/i;
const STUDENT_ID = /^Student\s*ID\s*:\s*(\d+)/i;

// Skip lines
const SKIP_PATTERNS = [
  /^Program:/i,
  /^CourseDescription/i,
  /^Term\s+GPA/i,
  /^Cum\s+GPA/i,
  /^Topic:/i,
  /^Public\s+Performance/i,
  /^UNOFFICIAL/i,
  /^Page\s+\d/i,
  /^Birthdate/i,
  /^Print\s+Date/i,
  /^Beginning\s+of/i,
  /^End\s+of/i,
  /^Undergraduate\s+Career/i,
  /^Test\s+Credits/i,
  /^Earned$/i,
];

/**
 * Parse a PDF transcript buffer into structured data.
 */
async function parseTranscript(buffer) {
  const { text } = await pdfParse(buffer);
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const result = {
    student: { name: null, id: null },
    transferCredits: { total: 0, items: [] },
    terms: [],
    cumGpa: null,
    cumCreditsEarned: 0,
    warnings: [],
  };

  let currentTerm = null;
  let inTransfer = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Skip noise lines
    if (SKIP_PATTERNS.some(p => p.test(line))) continue;

    // Student name
    const nameMatch = line.match(STUDENT_NAME);
    if (nameMatch) {
      result.student.name = nameMatch[1].trim();
      continue;
    }

    // Student ID
    const idMatch = line.match(STUDENT_ID);
    if (idMatch) {
      result.student.id = idMatch[1];
      continue;
    }

    // Transfer totals
    const transferMatch = line.match(TRANSFER_TOTALS);
    if (transferMatch) {
      result.transferCredits.total = parseFloat(transferMatch[1]);
      inTransfer = true;
      currentTerm = null;
      continue;
    }

    // Term header
    const termMatch = line.match(TERM_HEADER);
    if (termMatch) {
      inTransfer = false;
      currentTerm = { name: `${termMatch[1]} ${termMatch[2]}`, courses: [] };
      result.terms.push(currentTerm);
      continue;
    }

    // Try spaced course line first (cleaner format)
    const spacedMatch = line.match(COURSE_LINE_SPACED);
    if (spacedMatch) {
      const course = buildCourse(spacedMatch);
      if (currentTerm) currentTerm.courses.push(course);
      continue;
    }

    // Try concatenated course line (LUC format)
    if (currentTerm) {
      const course = parseConcatLine(line);
      if (course) {
        currentTerm.courses.push(course);
        continue;
      }
    }

    // Cumulative line
    const cumMatch = line.match(CUM_LINE);
    if (cumMatch) {
      result.cumGpa = parseFloat(cumMatch[1]);
      result.cumCreditsEarned = parseFloat(cumMatch[3]);
      continue;
    }

    // Topic line (attached to previous course)
    if (/^Topic:/.test(line) && currentTerm && currentTerm.courses.length > 0) {
      const topic = line.replace(/^Topic:\s*/, "").trim();
      currentTerm.courses[currentTerm.courses.length - 1].topic = topic;
      continue;
    }
  }

  // If we got transfer total but no transfer items, create a placeholder
  if (result.transferCredits.total > 0 && result.transferCredits.items.length === 0) {
    result.transferCredits.items.push({
      code: "TRANSFER",
      department: "TRANSFER",
      number: "000",
      title: "Transfer Credits (Test/AP)",
      credits: result.transferCredits.total,
      creditsEarned: result.transferCredits.total,
      grade: null,
      status: "transfer",
    });
  }

  // Validate
  const totalCourses = result.terms.reduce((s, t) => s + t.courses.length, 0);
  if (totalCourses === 0 && result.transferCredits.items.length === 0) {
    result.warnings.push("No courses found — this may not be a valid LUC transcript");
  }

  return result;
}

/**
 * Parse a concatenated LUC course line like:
 *   HIST104Global History since 15003.0003.000  A12.000
 *   UCLR100CInterpreting Lit - ClassStud3.0003.000  A12.000
 *
 * Strategy: extract dept + number from front, credits/grade/points from back,
 * everything in between is the title. For the suffix ambiguity (is the letter
 * after the number part of the code or the title?), try with suffix first
 * (checking against known suffixed codes), then without.
 */
function parseConcatLine(line) {
  // Must start with 2-5 uppercase letters followed by 3 digits
  const front = line.match(/^([A-Z]{2,5})(\d{3})([A-Z]?)(.*)/);
  if (!front) return null;

  const [, dept, num, maybeSuffix, rest] = front;

  // Must end with decimal patterns: attempted + earned + optional grade + points
  // Work backwards: find the credit decimals in the rest
  const backMatch = rest.match(/^(.+?)(\d+\.\d{3})(\d+\.\d{3})\s{0,3}([A-Z][+-]?|P|W|WF|I|AU|NR)?\s*(\d+\.\d{3})$/);
  if (!backMatch) return null;

  const [, rawTitle, attempted, earned, grade, points] = backMatch;

  // Decide if maybeSuffix is part of the course code or the title
  let finalNum, title;
  if (maybeSuffix) {
    // If the title would start with a lowercase letter when we include the suffix
    // in the code, that's wrong — title should start uppercase. But LUC titles
    // always start uppercase, so check if removing suffix gives a valid title start.
    // Simpler: just try both and see which code exists in DB later.
    // For now, include suffix only if the remaining title starts with uppercase.
    // e.g. UCLR100C + "Interpreting..." → suffix is C, title starts with I (uppercase) ✓
    // e.g. HIST104 + "Global..." → no suffix, but regex captured G as suffix
    //      with suffix: HIST 104G, title = "lobal History..." starts lowercase ✗
    //      without suffix: HIST 104, title = "Global History..." starts uppercase ✓
    if (rawTitle.length > 0 && rawTitle[0] === rawTitle[0].toLowerCase() && rawTitle[0] !== rawTitle[0].toUpperCase()) {
      // Title starts lowercase → suffix was eaten from title, put it back
      finalNum = num;
      title = maybeSuffix + rawTitle;
    } else {
      // Title starts uppercase — suffix is genuinely part of course code
      finalNum = num + maybeSuffix;
      title = rawTitle;
    }
  } else {
    finalNum = num;
    title = rawTitle;
  }

  const attemptedNum = parseFloat(attempted);
  const earnedNum = parseFloat(earned);

  let status;
  if (grade === "W" || grade === "WF") {
    status = "withdrawn";
  } else if (earnedNum > 0 && grade && grade !== "NR") {
    status = "complete";
  } else if (attemptedNum > 0 && (!grade || grade === "NR")) {
    status = "enrolled";
  } else {
    status = "enrolled";
  }

  return {
    code: `${dept} ${finalNum}`,
    department: dept,
    number: finalNum,
    title: title.trim(),
    credits: attemptedNum,
    creditsEarned: earnedNum,
    grade: grade || null,
    status,
  };
}

/**
 * Build a course object from a regex match (works for both concat and spaced).
 */
function buildCourse(match) {
  const [, dept, num, title, attempted, earned, grade] = match;
  const earnedNum = parseFloat(earned);
  const attemptedNum = parseFloat(attempted);

  let status;
  if (grade === "W" || grade === "WF") {
    status = "withdrawn";
  } else if (earnedNum > 0 && grade && grade !== "NR") {
    status = "complete";
  } else if (attemptedNum > 0 && (!grade || grade === "NR")) {
    status = "enrolled";
  } else {
    status = "enrolled";
  }

  return {
    code: `${dept} ${num}`,
    department: dept,
    number: num,
    title: title.trim(),
    credits: attemptedNum,
    creditsEarned: earnedNum,
    grade: grade || null,
    status,
  };
}

module.exports = { parseTranscript };
