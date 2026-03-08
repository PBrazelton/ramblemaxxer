/**
 * server/scripts/scrape-locus.js
 * Scrapes course offering data from LOCUS (via molo.luc.edu class search).
 *
 * Usage:
 *   node server/scripts/scrape-locus.js                         # current + next term
 *   node server/scripts/scrape-locus.js --term "Spring 2026"    # specific term
 *   node server/scripts/scrape-locus.js --dept PLSC             # single department
 *   node server/scripts/scrape-locus.js --term "Spring 2026" --dept PLSC
 *
 * The molo.luc.edu class search is a public REST API:
 *   1. GET  /app/catalog/classSearch → HTML page with CSRF cookie + subject list
 *   2. POST /app/catalog/getClassSearch → HTML results for a subject+term
 *
 * Output goes directly into the course_offerings + course_terms SQLite tables.
 */

const https = require("https");
const cheerio = require("cheerio");
const Database = require("better-sqlite3");
const path = require("path");

const SEARCH_PAGE = "https://molo.luc.edu/app/catalog/classSearch";
const SEARCH_API = "https://molo.luc.edu/app/catalog/getClassSearch";
const DELAY_MS = 500;
const USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "../db/ramblemaxxer.db");

// ── CLI args ─────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {};
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--term" && args[i + 1]) opts.term = args[++i];
    if (args[i] === "--dept" && args[i + 1]) opts.dept = args[++i].toUpperCase();
  }
  return opts;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────

function httpGet(url, cookies = "") {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    https.get(url, {
      headers: { "User-Agent": USER_AGENT, Cookie: cookies },
    }, (res) => {
      const setCookies = res.headers["set-cookie"] || [];
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        body: Buffer.concat(chunks).toString(),
        cookies: parseCookies(setCookies),
        statusCode: res.statusCode,
      }));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function httpPost(url, formData, cookies = "") {
  const body = new URLSearchParams(formData).toString();
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const req = https.request({
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: "POST",
      headers: {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "X-Requested-With": "XMLHttpRequest",
        "Referer": SEARCH_PAGE,
        Cookie: cookies,
      },
    }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({
        body: Buffer.concat(chunks).toString(),
        statusCode: res.statusCode,
      }));
      res.on("error", reject);
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function parseCookies(setCookieHeaders) {
  const cookies = {};
  for (const header of setCookieHeaders) {
    const [pair] = header.split(";");
    const [name, ...valueParts] = pair.split("=");
    cookies[name.trim()] = valueParts.join("=").trim();
  }
  return cookies;
}

function cookieString(cookies) {
  return Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Term code mapping ────────────────────────────────────────────────────

// molo.luc.edu uses 4-digit term codes. Extract available terms from the page.
function extractTerms($) {
  const terms = [];
  $("select#term option").each((_, el) => {
    const value = $(el).val();
    const text = $(el).text().trim();
    if (value && text !== "Select Term") {
      terms.push({ code: value, name: text });
    }
  });
  return terms;
}

function extractSubjects($) {
  const subjects = [];
  $("script").each((_, el) => {
    const text = $(el).html() || "";
    const match = text.match(/subjects\s*:\s*(\[[\s\S]*?\])\s*,\s*\w/);
    if (match) {
      try {
        const parsed = JSON.parse(match[1]);
        for (const s of parsed) subjects.push({ code: s.subject, name: s.descr });
      } catch (e) { /* parse error, skip */ }
    }
  });
  return subjects;
}

// ── Session management ───────────────────────────────────────────────────

async function initSession() {
  console.log("Initializing session...");
  const res = await httpGet(SEARCH_PAGE);
  if (res.statusCode !== 200) throw new Error(`Failed to load search page: HTTP ${res.statusCode}`);

  const $ = cheerio.load(res.body);
  const terms = extractTerms($);
  const subjects = extractSubjects($);

  // Get CSRF token from cookie
  const csrfToken = res.cookies.CSRFCookie;
  if (!csrfToken) throw new Error("No CSRF cookie found");

  console.log(`  CSRF token: ${csrfToken.substring(0, 8)}...`);
  console.log(`  Terms: ${terms.map(t => t.name).join(", ")}`);
  console.log(`  Subjects: ${subjects.length}`);

  return { cookies: res.cookies, csrfToken, terms, subjects };
}

// ── Result parsing ───────────────────────────────────────────────────────

function decimalToTime(decimal) {
  if (!decimal || isNaN(decimal)) return null;
  const hours = Math.floor(decimal);
  const minutes = Math.round((decimal - hours) * 60);
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function parseDays(dataAttr) {
  // data-days='["M","W","F"]' or similar
  try {
    const days = JSON.parse(dataAttr);
    const map = { M: "Mo", T: "Tu", W: "We", R: "Th", F: "Fr", S: "Sa", U: "Su" };
    return days.map(d => map[d] || d).join("");
  } catch {
    return dataAttr || null;
  }
}

function parseInstructionMode(code) {
  const modes = {
    P: "In Person", ON: "Online", HY: "Hybrid", HF: "HyFlex",
    DR: "Directed Research", IS: "Independent Study", CP: "Clinical Practicum",
  };
  return modes[code] || code || null;
}

function parseSearchResults(html, termName) {
  const $ = cheerio.load(html);
  const sections = [];

  // Check for error/warning
  if (html.includes("search took too long")) {
    return { sections, error: "timeout" };
  }

  // Each course group has a .secondary-head followed by section .section-content divs
  let currentCourse = null;

  $(".secondary-head, .section-content").each((_, el) => {
    const $el = $(el);

    if ($el.hasClass("secondary-head")) {
      // e.g., "PLSC 102 - International Relations in an Age of Globalization"
      const text = $el.text().trim();
      const match = text.match(/^([A-Z]+\s+\d+\w*)\s*-\s*(.*)/);
      if (match) {
        currentCourse = { code: match[1], title: match[2].trim() };
      }
      return;
    }

    if (!$el.hasClass("section-content") || !currentCourse) return;

    // Parse data attributes
    const dataEnrlStat = $el.attr("data-enrl_stat");
    const dataDays = $el.attr("data-days");
    const dataStart = parseFloat($el.attr("data-start"));
    const dataEnd = parseFloat($el.attr("data-end"));
    const dataMode = $el.attr("data-instruct_mode");

    // Parse text content
    const bodyTexts = {};
    $el.find(".section-body").each((_, body) => {
      const text = $(body).text().trim();
      if (text.startsWith("Section:")) bodyTexts.section = text;
      else if (text.startsWith("Days/Times:")) bodyTexts.times = text;
      else if (text.startsWith("Room:")) bodyTexts.room = text;
      else if (text.startsWith("Instructor:")) bodyTexts.instructor = text;
      else if (text.startsWith("Status:")) bodyTexts.status = text;
    });

    // Parse section number and class number
    // "Section: 001-LEC (1080)" → section=001, classNumber=1080
    const sectionMatch = bodyTexts.section?.match(/Section:\s*(\d+)-\w+\s*\((\d+)\)/);
    if (!sectionMatch) return; // Skip malformed sections

    const section = sectionMatch[1];
    const classNumber = sectionMatch[2];

    // Skip canceled sections
    const status = bodyTexts.status?.replace("Status:", "").trim();
    if (status === "Cancelled" || status === "Canceled") return;

    // Parse instructor
    let instructor = bodyTexts.instructor?.replace("Instructor:", "").trim() || null;
    if (instructor === "Staff" || instructor === "TBA") instructor = null;

    // Parse location
    const location = bodyTexts.room?.replace("Room:", "").trim() || null;

    // Parse days and times
    const days = parseDays(dataDays);
    const startTime = decimalToTime(dataStart);
    const endTime = decimalToTime(dataEnd);

    // Enrollment status: O=Open, C=Closed, W=Waitlist
    const isOpen = dataEnrlStat === "O";

    sections.push({
      course_code: currentCourse.code,
      term: termName,
      section,
      instructor,
      days: days || "TBA",
      start_time: startTime,
      end_time: endTime,
      location,
      enrollment_cap: null,   // Not in search results, would need detail page
      enrollment_current: null,
      class_number: classNumber,
      instruction_mode: parseInstructionMode(dataMode),
    });
  });

  return { sections, error: null };
}

// ── DB writes ────────────────────────────────────────────────────────────

function writeTermToDB(db, termName, allSections) {
  const insertOffering = db.prepare(`
    INSERT OR REPLACE INTO course_offerings
      (course_code, term, section, instructor, days, start_time, end_time,
       location, enrollment_cap, enrollment_current, class_number, instruction_mode)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const writeTerm = db.transaction((term, rows) => {
    // Clear old data for this term
    db.prepare("DELETE FROM course_offerings WHERE term = ?").run(term);

    for (const r of rows) {
      insertOffering.run(
        r.course_code, r.term, r.section, r.instructor,
        r.days, r.start_time, r.end_time, r.location,
        r.enrollment_cap, r.enrollment_current,
        r.class_number, r.instruction_mode
      );
    }

    // Rebuild course_terms for this term
    db.prepare("DELETE FROM course_terms WHERE term = ?").run(term);
    db.prepare(`
      INSERT INTO course_terms (course_code, term, section_count)
      SELECT course_code, term, COUNT(*) FROM course_offerings
      WHERE term = ? GROUP BY course_code, term
    `).run(term);
  });

  writeTerm(termName, allSections);
}

// ── Determine which terms to scrape ──────────────────────────────────────

function guessCurrentTerms(availableTerms) {
  // Pick the two most relevant academic terms (skip Summer/J-term/Winter)
  const academic = availableTerms.filter(t =>
    t.name.startsWith("Fall") || t.name.startsWith("Spring")
  );
  // Return the most recent two, or all academic terms if fewer
  return academic.slice(0, 2);
}

function findTermByName(availableTerms, name) {
  // Fuzzy match: "Spring 2026" matches "Spring 2026"
  const lower = name.toLowerCase();
  return availableTerms.find(t => t.name.toLowerCase() === lower);
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();

  // Init session
  const session = await initSession();
  const cookieStr = cookieString(session.cookies);

  // Determine terms to scrape
  let termsToScrape;
  if (opts.term) {
    const found = findTermByName(session.terms, opts.term);
    if (!found) {
      console.error(`Term "${opts.term}" not found. Available: ${session.terms.map(t => t.name).join(", ")}`);
      process.exit(1);
    }
    termsToScrape = [found];
  } else {
    termsToScrape = guessCurrentTerms(session.terms);
    if (termsToScrape.length === 0) termsToScrape = session.terms.slice(0, 2);
  }
  console.log(`\nTerms to scrape: ${termsToScrape.map(t => t.name).join(", ")}`);

  // Determine subjects
  let subjects = session.subjects;
  if (opts.dept) {
    subjects = subjects.filter(s => s.code === opts.dept);
    if (subjects.length === 0) {
      console.error(`Department "${opts.dept}" not found. Check subject codes.`);
      process.exit(1);
    }
  }
  console.log(`Subjects to scrape: ${subjects.length}\n`);

  // Open DB
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  let totalSections = 0;
  let totalErrors = 0;

  for (const term of termsToScrape) {
    console.log(`\n═══ ${term.name} (${term.code}) ═══`);
    const termSections = [];
    let subjectErrors = 0;

    for (let i = 0; i < subjects.length; i++) {
      const subject = subjects[i];
      const pct = ((i + 1) / subjects.length * 100).toFixed(0);

      try {
        const res = await httpPost(SEARCH_API, {
          CSRFToken: session.csrfToken,
          term: term.code,
          subject: subject.code,
        }, cookieStr);

        if (res.statusCode !== 200) {
          console.error(`  [${pct}%] ${subject.code}: HTTP ${res.statusCode}`);
          subjectErrors++;
          continue;
        }

        const { sections, error } = parseSearchResults(res.body, term.name);

        if (error === "timeout") {
          console.error(`  [${pct}%] ${subject.code}: server timeout — retrying...`);
          // Wait and retry once
          await sleep(2000);
          const retry = await httpPost(SEARCH_API, {
            CSRFToken: session.csrfToken,
            term: term.code,
            subject: subject.code,
          }, cookieStr);
          const retryResult = parseSearchResults(retry.body, term.name);
          if (retryResult.error) {
            console.error(`  [${pct}%] ${subject.code}: retry failed, skipping`);
            subjectErrors++;
          } else {
            termSections.push(...retryResult.sections);
            console.log(`  [${pct}%] ${subject.code}: ${retryResult.sections.length} sections (retry)`);
          }
        } else {
          termSections.push(...sections);
          if (sections.length > 0) {
            console.log(`  [${pct}%] ${subject.code}: ${sections.length} sections`);
          }
        }
      } catch (err) {
        console.error(`  [${pct}%] ${subject.code}: ${err.message}`);
        subjectErrors++;
      }

      if (i < subjects.length - 1) await sleep(DELAY_MS);
    }

    // Write to DB
    if (termSections.length > 0) {
      writeTermToDB(db, term.name, termSections);
      console.log(`\n  → Wrote ${termSections.length} sections for ${term.name}`);
    } else {
      console.log(`\n  → No sections found for ${term.name}`);
    }

    totalSections += termSections.length;
    totalErrors += subjectErrors;
  }

  db.close();

  console.log(`\n--- Summary ---`);
  console.log(`Terms scraped: ${termsToScrape.map(t => t.name).join(", ")}`);
  console.log(`Total sections: ${totalSections}`);
  console.log(`Subject errors: ${totalErrors}`);
  console.log(`Database: ${DB_PATH}`);

  // Verify
  const verifyDb = new Database(DB_PATH);
  const offeringCount = verifyDb.prepare("SELECT COUNT(*) as c FROM course_offerings").get().c;
  const termCount = verifyDb.prepare("SELECT COUNT(*) as c FROM course_terms").get().c;
  const termList = verifyDb.prepare("SELECT term, COUNT(*) as c FROM course_offerings GROUP BY term").all();
  verifyDb.close();

  console.log(`\nDB state: ${offeringCount} offerings, ${termCount} course-terms`);
  for (const t of termList) {
    console.log(`  ${t.term}: ${t.c} sections`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
