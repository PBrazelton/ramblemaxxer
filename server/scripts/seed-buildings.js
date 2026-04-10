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
  // Coordinates sourced from OpenStreetMap building outlines (center points)
  { name: "Crown Center", code: "CROWN", campus: "lake_shore", lat: 42.00120, lng: -87.65667, aliases: ["Crown Center", "Crown Ctr", "Edward Crown Center for the Humanities"], address: "1001 W Loyola Ave" },
  { name: "Mundelein Center", code: "MUND", campus: "lake_shore", lat: 41.99872, lng: -87.65660, aliases: ["Mundelein Center", "Mundelein Ctr"], address: "1032 N Sheridan Rd" },
  { name: "Cuneo Hall", code: "CUNEO", campus: "lake_shore", lat: 41.99922, lng: -87.65732, aliases: ["Cuneo Hall"], address: "6430 N Kenmore Ave" },
  { name: "Dumbach Hall", code: "DUMB", campus: "lake_shore", lat: 42.00046, lng: -87.65786, aliases: ["Dumbach Hall", "Dumbach"], address: "6474 N Kenmore Ave" },
  { name: "Information Commons", code: "IC", campus: "lake_shore", lat: 42.00026, lng: -87.65625, aliases: ["Information Commons", "IC"], address: "6501 N Kenmore Ave" },
  { name: "Cudahy Library", code: "CUDLIB", campus: "lake_shore", lat: 42.00075, lng: -87.65687, aliases: ["Cudahy Library"], address: "6515 N Kenmore Ave" },
  { name: "Cudahy Science Hall", code: "CUDSCI", campus: "lake_shore", lat: 41.99979, lng: -87.65775, aliases: ["Cudahy Science", "Cudahy Science Hall"], address: "6460 N Kenmore Ave" },
  { name: "Flanner Hall", code: "FLAN", campus: "lake_shore", lat: 41.99860, lng: -87.65831, aliases: ["Flanner Hall"], address: "1068 W Sheridan Rd" },
  { name: "Piper Hall", code: "PIPER", campus: "lake_shore", lat: 41.99867, lng: -87.65555, aliases: ["Piper Hall"], address: "970 W Sheridan Rd" },
  { name: "Quinlan Life Sciences Center", code: "LSB", campus: "lake_shore", lat: 41.99861, lng: -87.65769, aliases: ["Life Science Building", "Quinlan Life Sciences", "Quinlan Life Sciences Center"], address: "1050 W Sheridan Rd" },
  { name: "Institute for Environmental Sustainability", code: "IES", campus: "lake_shore", lat: 41.99758, lng: -87.65663, aliases: ["Inst for Env Sust", "Institute for Environmental Sustainability", "IES"], address: "6349 N Kenmore Ave" },
  { name: "Sullivan Center", code: "SULL", campus: "lake_shore", lat: 41.99782, lng: -87.65508, aliases: ["Sullivan Center", "Sullivan Center for Student Services"], address: "6339 N Sheridan Rd" },
  { name: "Alfie Norville Practice Facility", code: "ALFIE", campus: "lake_shore", lat: 42.00125, lng: -87.65909, aliases: ["Alfie Hall", "Alfie Norville Practice Facility"], address: "1109 W Loyola Ave" },
  { name: "de Nobili Hall", code: "RAA", campus: "lake_shore", lat: 41.99782, lng: -87.65747, aliases: ["de Nobili Hall", "Ralph Arnold Annex"], address: "6350 N Kenmore Ave" },
  { name: "Madonna Della Strada Chapel", code: "MDSC", campus: "lake_shore", lat: 41.99956, lng: -87.65626, aliases: ["Madonna Della Strada", "Madonna Della Strada Chapel"], address: "6453 N Kenmore Ave" },
  { name: "BVM Hall", code: "BVM", campus: "lake_shore", lat: 41.99796, lng: -87.65667, aliases: ["BVM", "BVM Hall"], address: "6365 N Sheridan Rd" },

  // ── Water Tower Campus ─────────────────────────────────────────────
  { name: "Corboy Law Center", code: "CORBOY", campus: "water_tower", lat: 41.89715, lng: -87.62716, aliases: ["Corboy Law Center"], address: "25 E Pearson St" },
  { name: "Schreiber Center", code: "SCHREIB", campus: "water_tower", lat: 41.89778, lng: -87.62784, aliases: ["Schreiber Center"], address: "16 E Pearson St" },
  { name: "School of Communication", code: "COMM", campus: "water_tower", lat: 41.89730, lng: -87.62754, aliases: ["School of COMM", "School of Communication"], address: "820 N Michigan Ave" },
  { name: "Maguire Hall", code: "MAG", campus: "water_tower", lat: 41.89700, lng: -87.62750, aliases: ["Maguire Hall"], address: "1 E Pearson St" },

  // ── Health Sciences Campus ─────────────────────────────────────────
  { name: "Marcella Niehoff School of Nursing", code: "SON", campus: "health_sciences", lat: 41.85850, lng: -87.83530, aliases: ["Marcella Niehoff SON"], address: "2160 S 1st Ave, Maywood" },
  { name: "Stritch School of Medicine", code: "SSOM", campus: "health_sciences", lat: 41.86040, lng: -87.83540, aliases: ["SSOM Room 345", "SSOM Room 375", "SSOM"], address: "2160 S 1st Ave, Maywood" },
  { name: "Loyola University Medical Center", code: "LUMC", campus: "health_sciences", lat: 41.85827, lng: -87.83516, aliases: ["Loyola University Medical Cent"], address: "2160 S 1st Ave, Maywood" },
];

const insert = db.prepare(`
  INSERT OR REPLACE INTO campus_buildings (name, code, campus, lat, lng, aliases, address)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

// Clean slate — delete all rows then re-insert. Prevents stale rows when buildings are renamed.
db.transaction(() => {
  db.prepare("DELETE FROM campus_buildings").run();
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
