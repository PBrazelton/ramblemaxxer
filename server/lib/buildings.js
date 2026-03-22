/**
 * server/lib/buildings.js
 *
 * Building resolution: location string → building record with coordinates.
 * Walking time calculations between buildings.
 */

const db = require("../db/connection");

let _buildingCache = null;

/** Load and cache all buildings with their aliases */
function getBuildingLookup() {
  if (_buildingCache) return _buildingCache;
  const rows = db.prepare("SELECT * FROM campus_buildings").all();
  const byName = new Map();
  for (const b of rows) {
    const record = { ...b, aliases: b.aliases ? JSON.parse(b.aliases) : [] };
    byName.set(b.name.toLowerCase(), record);
    if (b.code) byName.set(b.code.toLowerCase(), record);
    for (const alias of record.aliases) {
      byName.set(alias.toLowerCase(), record);
    }
  }
  _buildingCache = byName;
  return byName;
}

/** Parse location string → building name, or null */
function parseLocation(locationStr) {
  if (!locationStr) return null;
  const s = locationStr.trim();
  if (!s || s === "TBA" || s === "Online" || s === "Off Campus" || s === "See Notes") return null;

  // Handle comma-separated multi-part: skip TBA/See Notes prefixes, take first real building
  let first = s;
  if (s.includes(",")) {
    const parts = s.split(",").map(p => p.trim());
    first = parts.find(p => p && p !== "TBA" && p !== "See Notes" && p !== "Online") || parts[0];
  }

  // "Building Name - Room NNN"
  if (first.includes(" - ")) return first.split(" - ")[0].trim();

  // "Building Name-Room NNN" (no spaces around dash)
  if (first.includes("-Room")) return first.split("-Room")[0].trim();

  // "Building Name--RMNNN"
  if (first.includes("--")) return first.split("--")[0].trim();

  // "SSOM Room 345" or "BVM" — check if the whole string (minus trailing digits) is a known building
  const withoutRoom = first.replace(/\s*Room\s*\d+.*$/i, "").trim();
  if (withoutRoom) return withoutRoom;

  return first;
}

/** Resolve a location string to a building record, or null */
function resolveBuilding(locationStr) {
  const buildingName = parseLocation(locationStr);
  if (!buildingName) return null;
  const lookup = getBuildingLookup();
  return lookup.get(buildingName.toLowerCase()) || null;
}

/** Haversine distance in miles between two {lat, lng} points */
function haversineDistance(a, b) {
  const R = 3958.8; // Earth radius in miles
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLng = (b.lng - a.lng) * Math.PI / 180;
  const x = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** Walking time in minutes between two building records. Cross-campus = 25 min. */
function walkingMinutes(buildingA, buildingB) {
  if (!buildingA || !buildingB) return null;
  if (buildingA.name === buildingB.name) return 0;
  if (buildingA.campus !== buildingB.campus) return 25; // cross-campus hardcoded
  const dist = haversineDistance(buildingA, buildingB);
  return Math.max(1, Math.ceil(dist * 20)); // 20 min/mile pace
}

module.exports = { parseLocation, resolveBuilding, haversineDistance, walkingMinutes };
