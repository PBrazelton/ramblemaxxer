/**
 * server/lib/transcript-parser.js
 * Pure function: PDF buffer → structured transcript object.
 *
 * Parses LUC official and unofficial transcripts (clean text layer, no OCR needed).
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
const TRANSFER_TOTALS = /Transfer\s+Totals?\s*:\s*(\d+\.\d{3})/i;

// Transfer source headers
const TRANSFER_FROM = /^Transfer\s+Credits?\s*(?:from\s+(.+))?$/i;
const TEST_CREDITS_HEADER = /^Test\s+Credits?$/i;

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
  /^OFFICIAL/i,
  /^Registrar/i,
  /^Loyola\s+University/i,
  /^Applied\s+Toward/i,
  /^Page\s+\d/i,
  /^Birthdate/i,
  /^Print\s+Date/i,
  /^Beginning\s+of/i,
  /^End\s+of/i,
  /^Undergraduate\s+Career/i,
  /^Earned$/i,
];

/**
 * Parse a PDF transcript buffer into structured data.
 */
async function parseTranscript(buffer) {
  const { text } = await pdfParse(buffer);
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  // Debug: dump raw lines to file for diagnosis
  if (process.env.NODE_ENV !== "production") {
    const fs = require("fs");
    const path = require("path");
    const debugPath = path.join(__dirname, "../../data/transcript-debug.txt");
    const debugLines = lines.map((l, i) => `${i}: ${l}`).join("\n");
    fs.writeFileSync(debugPath, `Total lines: ${lines.length}\n\n${debugLines}\n`);
    console.log(`[transcript] wrote ${lines.length} raw lines to ${debugPath}`);
  }

  const result = {
    student: { name: null, id: null },
    transferCredits: { total: 0, sources: [], items: [] },
    terms: [],
    cumGpa: null,
    cumCreditsEarned: 0,
    warnings: [],
  };

  let currentTerm = null;
  let inTransfer = false;
  let currentTransferSource = null;

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

    // Transfer source headers: "Transfer Credits from Rock Valley College" or "Test Credits"
    const transferFromMatch = line.match(TRANSFER_FROM);
    if (transferFromMatch) {
      currentTransferSource = { type: "institution", name: transferFromMatch[1]?.trim() || null };
      inTransfer = true;
      currentTerm = null;
      continue;
    }
    const testCreditsMatch = line.match(TEST_CREDITS_HEADER);
    if (testCreditsMatch) {
      currentTransferSource = { type: "test", name: null };
      inTransfer = true;
      currentTerm = null;
      continue;
    }

    // Transfer totals — accumulate (multiple transfer sections)
    const transferMatch = line.match(TRANSFER_TOTALS);
    if (transferMatch) {
      const credits = parseFloat(transferMatch[1]);
      result.transferCredits.total += credits;
      if (currentTransferSource) {
        result.transferCredits.sources.push({ ...currentTransferSource, credits });
        currentTransferSource = null;
      }
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
      if (inTransfer) {
        course.status = "transfer";
        result.transferCredits.items.push(course);
      } else if (currentTerm) {
        currentTerm.courses.push(course);
      }
      continue;
    }

    // Try concatenated course line (LUC format)
    if (currentTerm || inTransfer) {
      const course = parseConcatLine(line);
      if (course) {
        if (inTransfer) {
          course.status = "transfer";
          result.transferCredits.items.push(course);
        } else {
          currentTerm.courses.push(course);
        }
        continue;
      }
    }

    // Try multi-line course format (official transcripts — each field on its own line):
    //   ENVS           <- dept (2-5 uppercase letters alone)
    //   101            <- number (3 digits + optional suffix)
    //   Title Text     <- title
    //   3.000          <- attempted credits
    //   3.000          <- earned credits
    //   A-             <- grade (optional — missing for enrolled courses)
    //   11.010         <- quality points
    if ((currentTerm || inTransfer) && /^[A-Z]{2,5}$/.test(line)) {
      const dept = line;
      const numLine = lines[i + 1];
      const titleLine = lines[i + 2];

      if (numLine && /^\d{3}[A-Z]?$/.test(numLine) && titleLine && !/^\d+\.\d{3}$/.test(titleLine)) {
        const number = numLine;
        const title = titleLine;
        let j = i + 3;

        // Read attempted credits
        const attemptedStr = lines[j];
        if (!attemptedStr || !/^\d+\.\d{3}$/.test(attemptedStr)) {
          // Not a valid multi-line course — fall through
        } else {
          const attempted = parseFloat(attemptedStr);
          j++;

          // Read earned credits
          const earnedStr = lines[j];
          const earned = (earnedStr && /^\d+\.\d{3}$/.test(earnedStr)) ? parseFloat(earnedStr) : 0;
          if (earnedStr && /^\d+\.\d{3}$/.test(earnedStr)) j++;

          // Next line: grade or quality points?
          let grade = null;
          const maybeGrade = lines[j];
          if (maybeGrade && /^[A-Z][+-]?$|^P$|^W$|^WF$|^I$|^AU$|^NR$/.test(maybeGrade)) {
            grade = maybeGrade;
            j++;
            // Skip quality points line
            if (lines[j] && /^\d+\.\d{3}$/.test(lines[j])) j++;
          } else if (maybeGrade && /^\d+\.\d{3}$/.test(maybeGrade)) {
            // No grade, this is quality points — skip it
            j++;
          }

          // Skip "Writing Intensive" annotation if present
          if (lines[j] && /^Writing Intensive$/i.test(lines[j])) j++;

          // Handle Topic: line
          let topic = null;
          if (lines[j] && /^Topic:/.test(lines[j])) {
            topic = lines[j].replace(/^Topic:\s*/, "").trim();
            j++;
          }

          let status;
          if (grade === "W" || grade === "WF") {
            status = "withdrawn";
          } else if (earned > 0 && grade && grade !== "NR") {
            status = "complete";
          } else if (attempted > 0 && (!grade || grade === "NR")) {
            status = "enrolled";
          } else {
            status = "enrolled";
          }

          const course = {
            code: `${dept} ${number}`,
            department: dept,
            number,
            title: title.trim(),
            credits: attempted,
            creditsEarned: earned,
            grade,
            status,
          };
          if (topic) course.topic = topic;

          if (inTransfer) {
            course.status = "transfer";
            result.transferCredits.items.push(course);
          } else if (currentTerm) {
            currentTerm.courses.push(course);
          }

          // Advance i to just before the next unprocessed line (loop will i++)
          i = j - 1;
          continue;
        }
      }
    }

    // Cumulative line — single-line format
    const cumMatch = line.match(CUM_LINE);
    if (cumMatch) {
      result.cumGpa = parseFloat(cumMatch[1]);
      result.cumCreditsEarned = parseFloat(cumMatch[3]);
      continue;
    }

    // Cumulative line — multi-line format:
    //   "Cum GPA" / "3.868" / "Cum Totals" / "73.000" / "71.000" / "189.060"
    if (/^Cum\s+GPA:?$/i.test(line) && lines[i + 1] && /^\d+\.\d{2,3}$/.test(lines[i + 1])) {
      result.cumGpa = parseFloat(lines[i + 1]);
      // Look for "Cum Totals" after the GPA value
      if (lines[i + 2] && /^Cum\s+Totals/i.test(lines[i + 2])) {
        // Skip attempted (i+3), read earned (i+4)
        if (lines[i + 4] && /^\d+\.\d{3}$/.test(lines[i + 4])) {
          result.cumCreditsEarned = parseFloat(lines[i + 4]);
        }
        i += 5; // skip past all cum lines
      } else {
        i += 1;
      }
      continue;
    }

    // Topic line (attached to previous course)
    if (/^Topic:/.test(line) && currentTerm && currentTerm.courses.length > 0) {
      const topic = line.replace(/^Topic:\s*/, "").trim();
      currentTerm.courses[currentTerm.courses.length - 1].topic = topic;
      continue;
    }
  }

  // Post-processing: infer status for courses missing numeric columns
  for (const term of result.terms) {
    const hasCompleted = term.courses.some(c => c.creditsEarned > 0);
    for (const c of term.courses) {
      if (c.inferred) {
        c.status = hasCompleted ? "complete" : "enrolled";
      }
    }
  }

  // If we got transfer total but no transfer items, create placeholders
  if (result.transferCredits.total > 0 && result.transferCredits.items.length === 0) {
    if (result.transferCredits.sources.length > 0) {
      // One placeholder per source
      for (const src of result.transferCredits.sources) {
        const title = src.type === "test"
          ? "Test/AP Credits"
          : `Transfer Credits from ${src.name || "Unknown Institution"}`;
        result.transferCredits.items.push({
          code: "TRANSFER",
          department: "TRANSFER",
          number: "000",
          title,
          credits: src.credits,
          creditsEarned: src.credits,
          grade: null,
          status: "transfer",
        });
      }
    } else {
      // Backward compat: single generic placeholder
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
  if (!backMatch) {
    // Fallback: line has dept + number + title but no numeric columns
    // (common in official transcripts for some course lines)
    let fallbackTitle;
    let fallbackNum;
    if (maybeSuffix) {
      if (rest.length > 0 && rest[0] === rest[0].toLowerCase() && rest[0] !== rest[0].toUpperCase()) {
        fallbackNum = num;
        fallbackTitle = maybeSuffix + rest;
      } else {
        fallbackNum = num + maybeSuffix;
        fallbackTitle = rest;
      }
    } else {
      fallbackNum = num;
      fallbackTitle = rest;
    }
    fallbackTitle = fallbackTitle.trim();
    // Require title length >= 3 to avoid false positives on noise lines
    if (fallbackTitle.length < 3) return null;
    return {
      code: `${dept} ${fallbackNum}`,
      department: dept,
      number: fallbackNum,
      title: fallbackTitle,
      credits: null,
      creditsEarned: null,
      grade: null,
      status: null,
      inferred: true,
    };
  }

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
