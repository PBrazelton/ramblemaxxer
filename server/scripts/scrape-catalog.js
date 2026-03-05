/**
 * server/scripts/scrape-catalog.js
 * Scrapes the full LUC course catalog from catalog.luc.edu.
 *
 * Usage: node server/scripts/scrape-catalog.js
 * Output: data/scraped-catalog.json
 *
 * HTML structure per course:
 *   .courseblock
 *     .detail-code strong        → "PLSC 100"
 *     .detail-title strong       → "Political Theory"
 *     .detail-hours_html strong  → "(3 Credit Hours)" or "(1-6 Credit Hours)"
 *     .detail-prereqs            → prerequisite text
 *     .detail-knowledge          → "Knowledge Area: Tier 2 Philosophical Knowledge"
 *     .detail-engaged            → "This course satisfies the Engaged Learning requirement."
 *     .detail-interdisc          → "Interdisciplinary Option: Global Studies"
 *     .detail-equiv              → cross-listed course links
 *     .courseblockextra           → description text (first non-hidden one)
 */

const cheerio = require("cheerio");
const fs = require("fs");
const path = require("path");
const https = require("https");

const BASE_URL = "https://catalog.luc.edu";
const INDEX_URL = `${BASE_URL}/course-descriptions/`;
const OUTPUT_PATH = path.join(__dirname, "../../data/scraped-catalog.json");
const DELAY_MS = 300;

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Ramblemaxxer-Catalog-Scraper/1.0" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return fetch(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString()));
      res.on("error", reject);
    }).on("error", reject);
  });
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getDepartmentSlugs() {
  const html = await fetch(INDEX_URL);
  const $ = cheerio.load(html);
  const slugs = [];
  $('a[href^="/course-descriptions/"]').each((_, el) => {
    const href = $(el).attr("href");
    const match = href.match(/^\/course-descriptions\/([a-z0-9]+)\/$/);
    if (match) slugs.push(match[1]);
  });
  // Deduplicate (some links appear multiple times)
  return [...new Set(slugs)];
}

function parseCredits(text) {
  if (!text) return { credits: null, credits_min: null, credits_max: null };
  // "(3 Credit Hours)" or "(1-6 Credit Hours)"
  const range = text.match(/(\d+)\s*-\s*(\d+)/);
  if (range) {
    const min = parseInt(range[1], 10);
    const max = parseInt(range[2], 10);
    return { credits: max, credits_min: min, credits_max: max };
  }
  const single = text.match(/(\d+)/);
  if (single) {
    const val = parseInt(single[1], 10);
    return { credits: val, credits_min: val, credits_max: val };
  }
  return { credits: null, credits_min: null, credits_max: null };
}

function parseDepartmentPage(html) {
  const $ = cheerio.load(html);
  const courses = [];

  $(".courseblock").each((_, block) => {
    const $block = $(block);

    // Code: "PLSC 100"
    const codeText = $block.find(".detail-code strong").first().text().trim();
    if (!codeText) return;

    // Title
    const title = $block.find(".detail-title strong").first().text().trim();

    // Credits
    const hoursText = $block.find(".detail-hours_html strong").first().text().trim();
    const { credits, credits_min, credits_max } = parseCredits(hoursText);

    // Department + number from code
    const codeParts = codeText.match(/^([A-Z]+)\s+(\d+)/);
    const department = codeParts ? codeParts[1] : codeText.split(/\s+/)[0];
    const number = codeParts ? parseInt(codeParts[2], 10) : 0;

    // Prerequisites
    const prereqEl = $block.find(".detail-prereqs");
    let prerequisites = null;
    if (prereqEl.length) {
      prerequisites = prereqEl.text().replace(/^Pre-requisites:\s*/i, "").trim() || null;
    }

    // Knowledge area
    const kaEl = $block.find(".detail-knowledge");
    let knowledge_area = null;
    if (kaEl.length) {
      knowledge_area = kaEl.text().replace(/^Knowledge Area:\s*/i, "").trim() || null;
    }

    // Engaged learning
    const engagedEl = $block.find(".detail-engaged");
    const engaged_learning = engagedEl.length > 0 &&
      engagedEl.text().toLowerCase().includes("engaged learning");

    // Description (first non-hidden courseblockextra)
    let description = null;
    $block.find(".courseblockextra").each((_, extra) => {
      const $extra = $(extra);
      if ($extra.hasClass("bubble-hidden") || $extra.hasClass("coursedraw-hidden")) return;
      const text = $extra.text().trim();
      if (text && !description) description = text;
    });

    // Interdisciplinary options
    const interdisciplinary_options = [];
    $block.find(".detail-interdisc").each((_, el) => {
      const text = $(el).text().replace(/^Interdisciplinary Option:\s*/i, "").trim();
      if (text) interdisciplinary_options.push(text);
    });

    // Cross-listings from equivalencies
    const cross_listings = [];
    $block.find(".detail-equiv a.bubblelink").each((_, el) => {
      const crossCode = $(el).text().trim();
      if (crossCode && crossCode !== codeText) cross_listings.push(crossCode);
    });

    courses.push({
      code: codeText,
      department,
      number,
      title,
      credits,
      credits_min,
      credits_max,
      prerequisites,
      knowledge_area,
      engaged_learning,
      writing_intensive: false, // not in catalog HTML — overlaid by seeder from courses.json
      description,
      interdisciplinary_options,
      cross_listings,
    });
  });

  return courses;
}

async function main() {
  console.log("Fetching department index...");
  const slugs = await getDepartmentSlugs();
  console.log(`Found ${slugs.length} departments\n`);

  const allCourses = [];
  const seen = new Set();
  let errors = 0;

  for (let i = 0; i < slugs.length; i++) {
    const slug = slugs[i];
    const url = `${BASE_URL}/course-descriptions/${slug}/`;

    try {
      const html = await fetch(url);
      const courses = parseDepartmentPage(html);

      let added = 0;
      for (const c of courses) {
        if (!seen.has(c.code)) {
          seen.add(c.code);
          allCourses.push(c);
          added++;
        }
      }

      const pct = ((i + 1) / slugs.length * 100).toFixed(0);
      console.log(`  [${pct}%] ${slug}: ${courses.length} courses (${added} new)`);
    } catch (err) {
      console.error(`  [ERR] ${slug}: ${err.message}`);
      errors++;
    }

    if (i < slugs.length - 1) await sleep(DELAY_MS);
  }

  // Sort by department then number
  allCourses.sort((a, b) => a.department.localeCompare(b.department) || a.number - b.number);

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allCourses, null, 2));

  console.log(`\n--- Summary ---`);
  console.log(`Total courses: ${allCourses.length}`);
  console.log(`Departments scraped: ${slugs.length}`);
  console.log(`Errors: ${errors}`);
  console.log(`Output: ${OUTPUT_PATH}`);

  // Department breakdown
  const deptCounts = {};
  for (const c of allCourses) {
    deptCounts[c.department] = (deptCounts[c.department] || 0) + 1;
  }
  const topDepts = Object.entries(deptCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log(`\nTop 10 departments:`);
  for (const [dept, count] of topDepts) {
    console.log(`  ${dept}: ${count}`);
  }
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
