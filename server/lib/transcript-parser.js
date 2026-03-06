/**
 * server/lib/transcript-parser.js
 * Pure function: PDF buffer → structured transcript object.
 *
 * Parses LUC unofficial transcripts (clean text layer, no OCR needed).
 * Splits by term blocks, extracts course lines with code/title/credits/grade/status.
 */

const pdfParse = require("pdf-parse");

// Term header pattern: "Fall 2024", "Spring 2025", "Summer 2023"
const TERM_HEADER = /^(Fall|Spring|Summer)\s+(\d{4})$/;

// Course line: DEPT NUM  Title  attempted  earned  grade  quality_points
// e.g. "PLSC 102  Intro to Political Science  3.000  3.000  A  12.000"
const COURSE_LINE = /^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(.+?)\s+(\d+\.\d{3})\s+(\d+\.\d{3})\s+([A-Z][+-]?|P|W|WF|I|AU|NR)?\s*(\d+\.\d{3})?$/;

// Transfer credit header
const TRANSFER_HEADER = /^Transfer\s+Credit/i;

// Cumulative totals line
const CUM_LINE = /Cumulative\s+.*?(\d+\.\d{3})\s+(\d+\.\d{3})\s+.*?(\d+\.\d{2,3})/i;

// Student info patterns
const STUDENT_NAME = /^Name\s*:\s*(.+)/i;
const STUDENT_ID = /^Student\s*ID\s*:\s*(\d+)/i;

/**
 * Parse a PDF transcript buffer into structured data.
 * @param {Buffer} buffer - PDF file buffer
 * @returns {Promise<Object>} - { student, transferCredits, terms[], cumGpa, cumCreditsEarned, warnings[] }
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

    // Transfer credit section
    if (TRANSFER_HEADER.test(line)) {
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

    // Course line
    const courseMatch = line.match(COURSE_LINE);
    if (courseMatch) {
      const [, dept, num, title, attempted, earned, grade, qualityPoints] = courseMatch;
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

      const course = {
        code: `${dept} ${num}`,
        department: dept,
        number: num,
        title: title.trim(),
        credits: attemptedNum,
        creditsEarned: earnedNum,
        grade: grade || null,
        status,
      };

      if (inTransfer) {
        course.status = "transfer";
        result.transferCredits.items.push(course);
        result.transferCredits.total += earnedNum;
      } else if (currentTerm) {
        currentTerm.courses.push(course);
      }
      continue;
    }

    // Fallback: try to parse course line by splitting from the right on decimals
    if ((currentTerm || inTransfer) && /^[A-Z]{2,5}\s+\d{3}/.test(line)) {
      const parsed = parseFallbackCourseLine(line);
      if (parsed) {
        if (inTransfer) {
          parsed.status = "transfer";
          result.transferCredits.items.push(parsed);
          result.transferCredits.total += parsed.creditsEarned;
        } else if (currentTerm) {
          currentTerm.courses.push(parsed);
        }
        continue;
      }
    }

    // Cumulative line
    const cumMatch = line.match(CUM_LINE);
    if (cumMatch) {
      result.cumCreditsEarned = parseFloat(cumMatch[2]);
      result.cumGpa = parseFloat(cumMatch[3]);
      continue;
    }
  }

  // Validate
  if (result.terms.length === 0 && result.transferCredits.items.length === 0) {
    result.warnings.push("No courses found — this may not be a valid LUC transcript");
  }

  return result;
}

/**
 * Fallback parser for course lines that don't match the strict regex.
 * Tries to extract dept, number, and any trailing decimals for credits.
 */
function parseFallbackCourseLine(line) {
  const deptMatch = line.match(/^([A-Z]{2,5})\s+(\d{3}[A-Z]?)\s+(.+)/);
  if (!deptMatch) return null;

  const [, dept, num, rest] = deptMatch;

  // Extract decimals from the right side
  const decimals = rest.match(/(\d+\.\d{3})/g);
  let title = rest;
  let credits = 3; // default
  let creditsEarned = 0;
  let grade = null;

  if (decimals && decimals.length >= 2) {
    credits = parseFloat(decimals[0]);
    creditsEarned = parseFloat(decimals[1]);
    // Strip decimals and grade from title
    title = rest.replace(/\s+\d+\.\d{3}/g, "").trim();
    // Check for grade
    const gradeMatch = title.match(/\s+([A-Z][+-]?|P|W|WF|I|AU|NR)\s*$/);
    if (gradeMatch) {
      grade = gradeMatch[1];
      title = title.slice(0, -gradeMatch[0].length).trim();
    }
  }

  let status;
  if (grade === "W" || grade === "WF") status = "withdrawn";
  else if (creditsEarned > 0 && grade) status = "complete";
  else status = "enrolled";

  return {
    code: `${dept} ${num}`,
    department: dept,
    number: num,
    title,
    credits,
    creditsEarned,
    grade,
    status,
  };
}

module.exports = { parseTranscript };
