/**
 * server/lib/rmp.js
 * Shared RMP (RateMyProfessor) search and upsert helpers.
 * Used by both scrape-rmp.js and admin.js endpoints.
 */

const { GraphQLClient, gql } = require("graphql-request");

const RMP_URL = "https://www.ratemyprofessors.com/graphql";
const RMP_AUTH = "Basic dGVzdDp0ZXN0"; // public auth token used by RMP's own frontend

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

let lucSchoolId = null;

/**
 * Find the LUC school ID on RMP (cached after first call).
 */
async function getLucSchoolId() {
  if (lucSchoolId) return lucSchoolId;
  const client = new GraphQLClient(RMP_URL, { headers: { Authorization: RMP_AUTH } });
  const data = await client.request(SEARCH_SCHOOL, { query: { text: "Loyola University Chicago" } });
  const luc = data.newSearch.schools.edges.find(e =>
    e.node.name === "Loyola University Chicago" && e.node.state === "IL"
  )?.node;
  if (!luc) throw new Error("LUC not found on RMP");
  lucSchoolId = luc.id;
  return lucSchoolId;
}

/**
 * Search RMP for professors matching a name at LUC.
 * @param {string} name — professor name to search
 * @returns {Array} — array of { rmpId, firstName, lastName, department, rating, difficulty, wouldTakeAgain, numRatings, url }
 */
async function searchRmpProfessors(name) {
  const schoolID = await getLucSchoolId();
  const client = new GraphQLClient(RMP_URL, { headers: { Authorization: RMP_AUTH } });
  const data = await client.request(SEARCH_TEACHER, { text: name, schoolID });
  const teachers = (data.newSearch?.teachers?.edges || []).map(e => e.node);
  return teachers.slice(0, 10).map(t => ({
    rmpId: String(t.id),
    firstName: t.firstName,
    lastName: t.lastName,
    department: t.department || null,
    rating: t.avgRating,
    difficulty: t.avgDifficulty,
    wouldTakeAgain: t.wouldTakeAgainPercent >= 0 ? t.wouldTakeAgainPercent : null,
    numRatings: t.numRatings,
    url: `https://www.ratemyprofessors.com/professor/${t.legacyId}`,
  }));
}

/**
 * Upsert a professor rating into the professor_ratings table.
 * @param {object} db — better-sqlite3 database instance
 * @param {object} prof — { rmpId, firstName, lastName, department, rating, difficulty, wouldTakeAgain, numRatings, url }
 */
function upsertProfessorRating(db, prof) {
  db.prepare(`
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
  `).run(
    prof.rmpId, prof.firstName, prof.lastName, prof.department,
    prof.rating, prof.difficulty, prof.wouldTakeAgain, prof.numRatings, prof.url
  );
}

module.exports = { searchRmpProfessors, upsertProfessorRating, getLucSchoolId, SEARCH_TEACHER, RMP_URL, RMP_AUTH };
