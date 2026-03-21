/**
 * server/scripts/scrape-rmp.js
 *
 * Scrapes RateMyProfessor data for all instructors found in course_offerings.
 * Hits RMP's GraphQL API directly (the npm package is outdated).
 * Incremental: skips names already in instructor_rmp_matches.
 *
 * Usage: node server/scripts/scrape-rmp.js [--force]
 *   --force: re-scrape all names, not just new ones
 */

const Database = require("better-sqlite3");
const path = require("path");
const { GraphQLClient, gql } = require("graphql-request");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "../db/ramblemaxxer.db");
const DELAY_MS = 200;
const force = process.argv.includes("--force");

const RMP_URL = "https://www.ratemyprofessors.com/graphql";
const RMP_AUTH = "Basic dGVzdDp0ZXN0"; // public auth token used by RMP's own frontend

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

const SEARCH_SCHOOL = gql`
  query SearchSchools($query: SchoolSearchQuery!) {
    newSearch { schools(query: $query) { edges { node { id name city state } } } }
  }
`;

const SEARCH_TEACHER = gql`
  query SearchTeachers($text: String!, $schoolID: ID!) {
    newSearch {
      teachers(query: { text: $text, schoolID: $schoolID }) {
        edges {
          node {
            id firstName lastName department
            avgRating avgDifficulty numRatings
            wouldTakeAgainPercent legacyId
            school { id name }
          }
        }
      }
    }
  }
`;

function pickBestMatch(offeringName, results) {
  const parts = offeringName.trim().split(/\s+/);
  let firstName = parts[0].replace(/\.$/, "");
  const lastName = parts[parts.length - 1];

  // If first token is a single letter (initial), use second token if available
  if (firstName.length === 1 && parts.length > 2) {
    firstName = parts[1].replace(/\.$/, "");
  }

  const normLast = lastName.toLowerCase().replace(/[''`]/g, "'");
  const normFirst = firstName.toLowerCase().replace(/[''`]/g, "'");

  // Exact last name + first name starts with same letter
  for (const t of results) {
    const tLast = t.lastName.toLowerCase().replace(/[''`]/g, "'");
    const tFirst = t.firstName.toLowerCase().replace(/[''`]/g, "'");
    if (tLast === normLast && tFirst.startsWith(normFirst.charAt(0))) {
      return t;
    }
  }

  // Fallback: exact last name, only if unique match
  const lastMatches = results.filter(t =>
    t.lastName.toLowerCase().replace(/[''`]/g, "'") === normLast
  );
  if (lastMatches.length === 1) return lastMatches[0];

  return null;
}

async function main() {
  const client = new GraphQLClient(RMP_URL, { headers: { Authorization: RMP_AUTH } });

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");

  // Step 1: Find LUC school
  console.log("Searching for Loyola University Chicago on RMP...");
  const schoolData = await client.request(SEARCH_SCHOOL, { query: { text: "Loyola University Chicago" } });
  const luc = schoolData.newSearch.schools.edges.find(e =>
    e.node.name === "Loyola University Chicago" && e.node.state === "IL"
  )?.node;
  if (!luc) throw new Error("LUC not found on RMP");
  console.log(`School: ${luc.name} (ID: ${luc.id})`);

  // Step 2: Get distinct instructor names
  const instructorRows = db.prepare(
    "SELECT DISTINCT instructor FROM course_offerings WHERE instructor IS NOT NULL"
  ).all();

  const allNames = new Set();
  const compositeNames = [];
  for (const row of instructorRows) {
    const parts = row.instructor.split(",").map(n => n.trim()).filter(Boolean);
    if (parts.length > 1) {
      compositeNames.push({ composite: row.instructor, individuals: parts });
    }
    for (const name of parts) {
      if (name && name !== "Staff" && name !== "TBA" && name.length > 2) {
        allNames.add(name);
      }
    }
  }
  console.log(`Unique instructor names: ${allNames.size} (from ${instructorRows.length} offering rows)`);

  // Step 3: Skip cached names (unless --force)
  const existingMatches = force ? new Set() : new Set(
    db.prepare("SELECT instructor_name FROM instructor_rmp_matches").all()
      .map(r => r.instructor_name)
  );
  const namesToLookup = [...allNames].filter(n => !existingMatches.has(n));
  console.log(`New names to look up: ${namesToLookup.length} (${existingMatches.size} cached)${force ? " (--force)" : ""}`);

  // Step 4: Prepared statements
  const insertRating = db.prepare(`
    INSERT INTO professor_ratings (rmp_id, first_name, last_name, department,
      overall_rating, difficulty, would_take_again, num_ratings, rmp_url, scraped_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    ON CONFLICT(rmp_id) DO UPDATE SET
      first_name = excluded.first_name,
      last_name = excluded.last_name,
      department = excluded.department,
      overall_rating = excluded.overall_rating,
      difficulty = excluded.difficulty,
      would_take_again = excluded.would_take_again,
      num_ratings = excluded.num_ratings,
      rmp_url = excluded.rmp_url,
      scraped_at = datetime('now')
  `);
  const insertMatch = db.prepare(`
    INSERT INTO instructor_rmp_matches (instructor_name, rmp_id, match_quality)
    VALUES (?, ?, ?)
    ON CONFLICT(instructor_name) DO UPDATE SET
      rmp_id = excluded.rmp_id,
      match_quality = excluded.match_quality
  `);

  let matched = 0, noMatch = 0, errors = 0;

  for (let i = 0; i < namesToLookup.length; i++) {
    const name = namesToLookup[i];
    const pct = ((i + 1) / namesToLookup.length * 100).toFixed(0);

    try {
      const data = await client.request(SEARCH_TEACHER, { text: name, schoolID: luc.id });
      const teachers = (data.newSearch?.teachers?.edges || []).map(e => e.node);

      if (teachers.length === 0) {
        insertMatch.run(name, null, "none");
        noMatch++;
        if (i % 50 === 0) console.log(`  [${pct}%] ${name} — no results`);
        await sleep(DELAY_MS);
        continue;
      }

      const best = pickBestMatch(name, teachers);

      if (best) {
        const rmpId = String(best.id);
        insertRating.run(
          rmpId, best.firstName, best.lastName, best.department || null,
          best.avgRating, best.avgDifficulty,
          best.wouldTakeAgainPercent >= 0 ? best.wouldTakeAgainPercent : null,
          best.numRatings,
          `https://www.ratemyprofessors.com/professor/${best.legacyId}`
        );
        insertMatch.run(name, rmpId, "auto");
        matched++;
        console.log(`  [${pct}%] ${name} → ${best.firstName} ${best.lastName} ★${best.avgRating} (${best.numRatings})`);
      } else {
        insertMatch.run(name, null, "none");
        noMatch++;
        if (i % 50 === 0) console.log(`  [${pct}%] ${name} — no confident match`);
      }
    } catch (err) {
      console.error(`  [${pct}%] ${name}: ERROR ${err.message?.slice(0, 100)}`);
      errors++;
    }

    if (i < namesToLookup.length - 1) await sleep(DELAY_MS);
  }

  // Step 5: Map composite instructor strings to first instructor's rmp_id
  let compositeMatched = 0;
  for (const { composite, individuals } of compositeNames) {
    if (existingMatches.has(composite) && !force) continue;
    const firstName = individuals[0];
    const firstMatch = db.prepare(
      "SELECT rmp_id FROM instructor_rmp_matches WHERE instructor_name = ?"
    ).get(firstName);
    if (firstMatch?.rmp_id) {
      insertMatch.run(composite, firstMatch.rmp_id, "auto");
      compositeMatched++;
    } else {
      insertMatch.run(composite, null, "none");
    }
  }

  db.close();

  console.log(`\n--- Summary ---`);
  console.log(`Matched: ${matched}, No match: ${noMatch}, Errors: ${errors}`);
  console.log(`Composite instructor strings linked: ${compositeMatched}`);

  const db2 = new Database(DB_PATH);
  const totalProfs = db2.prepare("SELECT COUNT(*) as c FROM professor_ratings").get().c;
  const totalMatched = db2.prepare("SELECT COUNT(*) as c FROM instructor_rmp_matches WHERE rmp_id IS NOT NULL").get().c;
  const totalUnmatched = db2.prepare("SELECT COUNT(*) as c FROM instructor_rmp_matches WHERE rmp_id IS NULL").get().c;
  db2.close();
  console.log(`DB totals: ${totalProfs} professors, ${totalMatched} matched, ${totalUnmatched} unmatched`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
