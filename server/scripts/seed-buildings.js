/**
 * server/scripts/seed-buildings.js
 *
 * Populates campus_buildings table with LUC building coordinates.
 * Idempotent — INSERT OR REPLACE. Safe to re-run.
 *
 * Usage: node server/scripts/seed-buildings.js
 */

const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH = process.env.DATABASE_PATH || path.join(__dirname, "../db/ramblemaxxer.db");
const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");

const BUILDINGS = [
  // ── Lake Shore Campus ──────────────────────────────────────────────
  { name: "Crown Center", code: "CROWN", campus: "lake_shore", lat: 41.99979, lng: -87.65764, aliases: ["Crown Center", "Crown Ctr"], address: "1032 W Sheridan Rd" },
  { name: "Mundelein Center", code: "MUND", campus: "lake_shore", lat: 42.00087, lng: -87.65752, aliases: ["Mundelein Center", "Mundelein Ctr"], address: "1032 W Sheridan Rd" },
  { name: "Cuneo Hall", code: "CUNEO", campus: "lake_shore", lat: 42.00044, lng: -87.65680, aliases: ["Cuneo Hall"], address: "1032 W Loyola Ave" },
  { name: "Dumbach Hall", code: "DUMB", campus: "lake_shore", lat: 42.00017, lng: -87.65704, aliases: ["Dumbach Hall", "Dumbach"], address: "6525 N Sheridan Rd" },
  { name: "Information Commons", code: "IC", campus: "lake_shore", lat: 42.00027, lng: -87.65824, aliases: ["Information Commons", "IC"], address: "6501 N Kenmore Ave" },
  { name: "Cudahy Library", code: "CUDLIB", campus: "lake_shore", lat: 42.00000, lng: -87.65740, aliases: ["Cudahy Library"], address: "6525 N Sheridan Rd" },
  { name: "Cudahy Science", code: "CUDSCI", campus: "lake_shore", lat: 42.00068, lng: -87.65777, aliases: ["Cudahy Science"], address: "6525 N Kenmore Ave" },
  { name: "Flanner Hall", code: "FLAN", campus: "lake_shore", lat: 42.00063, lng: -87.65698, aliases: ["Flanner Hall"], address: "6525 N Sheridan Rd" },
  { name: "Piper Hall", code: "PIPER", campus: "lake_shore", lat: 42.00108, lng: -87.65690, aliases: ["Piper Hall"], address: "6525 N Sheridan Rd" },
  { name: "Life Science Building", code: "LSB", campus: "lake_shore", lat: 42.00050, lng: -87.65850, aliases: ["Life Science Building"], address: "1032 W Sheridan Rd" },
  { name: "Institute for Environmental Sustainability", code: "IES", campus: "lake_shore", lat: 42.00098, lng: -87.65870, aliases: ["Inst for Env Sust", "Institute for Environmental Sustainability", "IES"], address: "6349 N Kenmore Ave" },
  { name: "Sullivan Center", code: "SULL", campus: "lake_shore", lat: 41.99950, lng: -87.65780, aliases: ["Sullivan Center"], address: "6339 N Sheridan Rd" },
  { name: "Alfie Hall", code: "ALFIE", campus: "lake_shore", lat: 41.99970, lng: -87.65640, aliases: ["Alfie Hall"], address: "6323 N Sheridan Rd" },
  { name: "Ralph Arnold Annex", code: "RAA", campus: "lake_shore", lat: 41.99960, lng: -87.65720, aliases: ["Ralph Arnold Annex"], address: "6525 N Sheridan Rd" },
  { name: "Maguire Hall", code: "MAG", campus: "lake_shore", lat: 42.00030, lng: -87.65660, aliases: ["Maguire Hall"], address: "6525 N Sheridan Rd" },
  { name: "FLEX Lab", code: "FLEX", campus: "lake_shore", lat: 42.00020, lng: -87.65810, aliases: ["FLEX Lab", "FLEX LAb"], address: "1032 W Sheridan Rd" },
  { name: "BVM", code: "BVM", campus: "lake_shore", lat: 42.00105, lng: -87.65760, aliases: ["BVM"], address: "6363 N Sheridan Rd" },

  // ── Water Tower Campus ─────────────────────────────────────────────
  { name: "Corboy Law Center", code: "CORBOY", campus: "water_tower", lat: 41.89890, lng: -87.62880, aliases: ["Corboy Law Center"], address: "25 E Pearson St" },
  { name: "Schreiber Center", code: "SCHREIB", campus: "water_tower", lat: 41.89860, lng: -87.62830, aliases: ["Schreiber Center"], address: "16 E Pearson St" },
  { name: "School of Communication", code: "COMM", campus: "water_tower", lat: 41.89915, lng: -87.62780, aliases: ["School of COMM", "School of Communication"], address: "820 N Michigan Ave" },

  // ── Health Sciences Campus ─────────────────────────────────────────
  { name: "Marcella Niehoff School of Nursing", code: "SON", campus: "health_sciences", lat: 41.86610, lng: -87.83830, aliases: ["Marcella Niehoff SON"], address: "2160 S 1st Ave, Maywood" },
  { name: "Stritch School of Medicine", code: "SSOM", campus: "health_sciences", lat: 41.86590, lng: -87.83800, aliases: ["SSOM Room 345", "SSOM Room 375", "SSOM"], address: "2160 S 1st Ave, Maywood" },
  { name: "Loyola University Medical Center", code: "LUMC", campus: "health_sciences", lat: 41.86600, lng: -87.83750, aliases: ["Loyola University Medical Cent"], address: "2160 S 1st Ave, Maywood" },
];

const insert = db.prepare(`
  INSERT OR REPLACE INTO campus_buildings (name, code, campus, lat, lng, aliases, address)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

db.transaction(() => {
  for (const b of BUILDINGS) {
    insert.run(b.name, b.code, b.campus, b.lat, b.lng, JSON.stringify(b.aliases), b.address || null);
  }
})();

console.log(`✓ Seeded ${BUILDINGS.length} campus buildings`);

// Verify
const count = db.prepare("SELECT COUNT(*) as c FROM campus_buildings").get().c;
const byCampus = db.prepare("SELECT campus, COUNT(*) as c FROM campus_buildings GROUP BY campus").all();
console.log(`  Total: ${count}`);
for (const { campus, c } of byCampus) console.log(`  ${campus}: ${c}`);

db.close();
