/**
 * client/src/pages/CampusDay.jsx
 * Campus Day tab — map, day timeline, walking transitions, day sidebar.
 */

import { useState, useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Polyline, Tooltip, Marker, useMap, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { COLORS, FONT, TYPE, BORDER, SURFACE, TEXT, BTN, api, cardStyle } from "../lib/ui.jsx";

// Inject pulse animation CSS once
if (typeof document !== "undefined" && !document.getElementById("campus-day-styles")) {
  const style = document.createElement("style");
  style.id = "campus-day-styles";
  style.textContent = `
    @keyframes campus-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(111,66,193,0.4); } 50% { box-shadow: 0 0 0 6px rgba(111,66,193,0); } }
    .campus-next-pulse { animation: campus-pulse 2s ease-in-out infinite; }
  `;
  document.head.appendChild(style);
}

// CTA Red Line approximate route (Loyola → Chicago/State via key stops)
const RED_LINE_PATH = [
  [42.0019, -87.6607],  // Loyola station
  [41.9804, -87.6590],  // Granville
  [41.9662, -87.6586],  // Thorndale
  [41.9474, -87.6555],  // Lawrence
  [41.9256, -87.6536],  // Belmont
  [41.9107, -87.6497],  // Fullerton
  [41.8979, -87.6328],  // Chicago/State
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime12(timeStr) {
  if (!timeStr) return "";
  const [h, m] = timeStr.split(":").map(Number);
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m || 0).padStart(2, "0")} ${ampm}`;
}

function formatMinutes(min) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
}

function toLocalDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function parseLocalDate(str) {
  const [y, m, d] = str.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function getWeekDates(referenceDate) {
  const d = parseLocalDate(referenceDate);
  const day = d.getDay(); // 0=Sun
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  const dates = [];
  for (let i = 0; i < 5; i++) {
    const dt = new Date(monday);
    dt.setDate(monday.getDate() + i);
    dates.push(toLocalDateStr(dt));
  }
  return dates;
}

function getDefaultDate() {
  const now = new Date();
  const day = now.getDay();
  if (day >= 1 && day <= 5) return toLocalDateStr(now);
  // Weekend → next Monday
  const mon = new Date(now);
  mon.setDate(now.getDate() + (day === 0 ? 1 : 8 - day));
  return toLocalDateStr(mon);
}

function getNowMinutes() {
  const now = new Date();
  return now.getHours() * 60 + now.getMinutes();
}

const DAY_ABBR = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const URGENCY_COLORS = {
  comfortable: "#22863a",
  normal: TEXT.secondary,
  tight: "#b08800",
  critical: "#c43b2d",
  unknown: TEXT.muted,
  none: TEXT.muted,
};

// ── Building Markers (zoom-aware) ────────────────────────────────────────────

function BuildingMarkers({ classes, transitions, activeClass, nextClass, currentMin, friends = [] }) {
  const [zoom, setZoom] = useState(16);
  const map = useMap();

  useMapEvents({
    zoomend: () => setZoom(map.getZoom()),
  });

  const useFlags = zoom >= 16;
  const withBuildings = classes.filter(c => c.building);

  // Compute stagger offsets for overlapping flags at detail zoom
  const staggerOffsets = useMemo(() => {
    if (!useFlags) return {};
    const offsets = {};
    // Group markers by building (same building = stack)
    const byBuilding = {};
    for (const c of withBuildings) {
      const key = c.building.name;
      if (!byBuilding[key]) byBuilding[key] = [];
      byBuilding[key].push(c.courseCode);
    }
    // Also check for nearby buildings (within ~0.0003 degrees ≈ 30m)
    const sorted = [...withBuildings].sort((a, b) => {
      const isNextA = nextClass?.courseCode === a.courseCode ? -1 : 0;
      const isNextB = nextClass?.courseCode === b.courseCode ? -1 : 0;
      return isNextA - isNextB || a.startMin - b.startMin;
    });
    let usedSlots = [];
    for (const c of sorted) {
      let offset = 0;
      for (const used of usedSlots) {
        const dLat = Math.abs(c.building.lat - used.lat);
        const dLng = Math.abs(c.building.lng - used.lng);
        if (dLat < 0.0004 && dLng < 0.0004) {
          offset = Math.max(offset, used.offset + 1);
        }
      }
      offsets[c.courseCode] = offset;
      usedSlots.push({ lat: c.building.lat, lng: c.building.lng, offset });
    }
    return offsets;
  }, [useFlags, withBuildings, nextClass]);

  return (
    <>
      {/* Building markers */}
      {withBuildings.map((c, i) => {
        const isPast = currentMin > c.endMin;
        const isActive = activeClass?.courseCode === c.courseCode;
        const isNext = nextClass?.courseCode === c.courseCode;
        const dept = c.department || c.courseCode.split(" ")[0];
        const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";

        if (!useFlags) {
          // Dot mode (zoom 15 and below)
          return (
            <CircleMarker key={`${c.courseCode}-${i}`} center={[c.building.lat, c.building.lng]}
              radius={6}
              pathOptions={{
                fillColor: isPast ? "#ccc" : color,
                fillOpacity: isPast ? 0.5 : 0.9,
                color: isPast ? "#aaa" : color,
                weight: 1.5,
              }}>
              <Tooltip direction="top" offset={[0, -8]}>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs }}>
                  {c.building.name} · {c.courseCode} · {formatTime12(c.startTime)}
                </span>
              </Tooltip>
            </CircleMarker>
          );
        }

        // Flag mode (zoom 16+) — use DivIcon for rich HTML markers
        const staggerPx = (staggerOffsets[c.courseCode] || 0) * 42;
        const flagHtml = `
          <div style="display:flex;flex-direction:column;align-items:center;">
            <div class="${isNext ? "campus-next-pulse" : ""}" style="
              background:${isPast ? "#f5f2ed" : "#fffbf0"};
              border:1.5px solid ${isPast ? "#ddd" : color};
              border-left:3px solid ${isPast ? "#ccc" : color};
              border-radius:4px;padding:2px 6px;white-space:nowrap;
              font-family:'DM Mono',monospace;
              opacity:${isPast ? 0.5 : 1};
              box-shadow:0 1px 3px rgba(0,0,0,0.1);
              ${isNext ? `outline:2px solid ${color};outline-offset:1px;` : ""}
            ">
              <div style="font-size:11px;font-weight:700;color:${isPast ? "#999" : color}">${c.courseCode}</div>
              <div style="font-size:9px;color:#706b66">${c.building.name}</div>
            </div>
            ${staggerPx > 0 ? `<div style="width:1px;height:${staggerPx}px;background:#ccc"></div>` : ""}
          </div>
        `;

        const icon = L.divIcon({
          html: flagHtml,
          className: "",
          iconSize: [0, 0],
          iconAnchor: [0, staggerPx + 30],
        });

        return (
          <Marker key={`${c.courseCode}-${i}`} position={[c.building.lat, c.building.lng]} icon={icon} />
        );
      })}

      {/* Walking paths */}
      {transitions.map((t, i) => {
        const from = classes[i]?.building;
        const to = classes[i + 1]?.building;
        if (!from || !to || from.name === to.name) return null;
        return (
          <Polyline key={i} positions={[[from.lat, from.lng], [to.lat, to.lng]]}
            pathOptions={{ color: URGENCY_COLORS[t.urgency] || "#999", weight: 2, dashArray: "6,8", opacity: 0.6 }} />
        );
      })}

      {/* Red Line route (shown when cross-campus transition exists) */}
      {transitions.some(t => t.isCrossCampus) && (
        <Polyline positions={RED_LINE_PATH}
          pathOptions={{ color: "#c43b2d", weight: 3, opacity: 0.4, dashArray: "8,6" }}>
          <Tooltip sticky>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs }}>CTA Red Line · ~25 min</span>
          </Tooltip>
        </Polyline>
      )}

      {/* Friend markers */}
      {friends.filter(f => f.location?.lat).map(f => {
        const icon = L.divIcon({
          html: `<div style="
            width:26px;height:26px;border-radius:50%;
            background:#e8e4df;border:2px solid #fff;
            display:flex;align-items:center;justify-content:center;
            font-family:'DM Mono',monospace;font-size:10px;font-weight:700;color:#706b66;
            box-shadow:0 1px 4px rgba(0,0,0,0.15);
          ">${f.initials}</div>`,
          className: "",
          iconSize: [26, 26],
          iconAnchor: [13, 13],
        });
        return (
          <Marker key={`friend-${f.id}`} position={[f.location.lat, f.location.lng]} icon={icon}>
            <Tooltip direction="bottom" offset={[0, 14]}>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs }}>
                {f.name} · {f.location.name}
                {f.status === "free" && f.freeUntil ? ` · free til ${Math.floor(f.freeUntil / 60) > 12 ? Math.floor(f.freeUntil / 60) - 12 : Math.floor(f.freeUntil / 60)}:${String(f.freeUntil % 60).padStart(2, "0")}` : ""}
                {f.status === "in_class" ? " · in class" : ""}
              </span>
            </Tooltip>
          </Marker>
        );
      })}
    </>
  );
}

// ── Main Component ───────────────────────────────────────────────────────────

export default function CampusDay({ weeklyTerm, planTerms, isMobile }) {
  const [dayDate, setDayDate] = useState(getDefaultDate);
  const [dayData, setDayData] = useState(null);
  const [friends, setFriends] = useState([]);
  const [overlaps, setOverlaps] = useState([]);
  const [loading, setLoading] = useState(false);
  const [scrubMin, setScrubMin] = useState(null); // null = "now"
  const [sharing, setSharing] = useState(false);
  const campusDayRef = useRef(null);

  // Pick the current academic term, not just the first in the list
  const activeTerm = weeklyTerm || (() => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const current = month >= 8 ? `Fall ${year}` : month >= 5 ? `Summer ${year}` : `Spring ${year}`;
    return planTerms?.includes(current) ? current : planTerms?.[0];
  })();
  const weekDates = useMemo(() => getWeekDates(dayDate), [dayDate]);

  // Fetch day data + friends + overlaps
  useEffect(() => {
    if (!activeTerm) return;
    setLoading(true);
    const termEnc = encodeURIComponent(activeTerm);
    Promise.all([
      api.get(`/api/campus/my-day?date=${dayDate}&term=${termEnc}`),
      api.get(`/api/campus/friends-nearby?date=${dayDate}&term=${termEnc}`).catch(() => []),
      api.get(`/api/campus/overlaps?date=${dayDate}&term=${termEnc}`).catch(() => []),
    ]).then(([day, fr, ov]) => {
      setDayData(day);
      setFriends(fr || []);
      setOverlaps(ov || []);
      setLoading(false);
    }).catch(() => { setDayData(null); setFriends([]); setOverlaps([]); setLoading(false); });
  }, [dayDate, activeTerm]);

  const classes = dayData?.classes || [];
  const transitions = dayData?.transitions || [];
  const currentMin = scrubMin ?? getNowMinutes();

  // Find current/next class
  const { activeClass, nextClass } = useMemo(() => {
    let active = null, next = null;
    for (let i = 0; i < classes.length; i++) {
      if (currentMin >= classes[i].startMin && currentMin < classes[i].endMin) {
        active = classes[i];
        next = classes[i + 1] || null;
        break;
      }
      if (currentMin < classes[i].startMin) {
        next = classes[i];
        break;
      }
    }
    return { activeClass: active, nextClass: next };
  }, [classes, transitions, currentMin]);

  // Time range for scrubber
  const scrubStart = classes.length > 0 ? classes[0].startMin - 30 : 480;
  const scrubEnd = classes.length > 0 ? classes[classes.length - 1].endMin + 30 : 1020;

  // Map bounds
  const mapCenter = useMemo(() => {
    const withCoords = classes.filter(c => c.building);
    if (withCoords.length === 0) return [41.9998, -87.6576]; // Lake Shore default
    const lats = withCoords.map(c => c.building.lat);
    const lngs = withCoords.map(c => c.building.lng);
    return [(Math.min(...lats) + Math.max(...lats)) / 2, (Math.min(...lngs) + Math.max(...lngs)) / 2];
  }, [classes]);

  const mapZoom = useMemo(() => {
    const campuses = new Set(classes.filter(c => c.building).map(c => c.building.campus));
    if (campuses.size > 1) return 13;
    return 16;
  }, [classes]);

  // Status bar text
  const statusText = useMemo(() => {
    if (classes.length === 0) return null;
    if (activeClass) {
      const remaining = activeClass.endMin - currentMin;
      return { text: `In ${activeClass.courseCode} · ${activeClass.building?.name || "TBA"} · ends in ${remaining} min`, color: TEXT.secondary };
    }
    if (nextClass) {
      const until = nextClass.startMin - currentMin;
      const trans = transitions.find(t => t.to === nextClass.courseCode);
      const walk = trans?.walkMinutes;
      const urgency = trans?.urgency || "unknown";
      const label = urgency === "comfortable" ? "plenty of time" : urgency === "tight" ? "tight" : urgency === "critical" ? "leave now" : "";
      const walkStr = walk != null ? `${walk} min walk` : "";
      const fromTo = trans ? `${trans.fromBuilding || "?"} → ${trans.toBuilding || "?"}` : "";
      return {
        text: `${until} min until ${nextClass.courseCode} · ${fromTo} · ${walkStr}${label ? ` · ${label}` : ""}`,
        color: URGENCY_COLORS[urgency],
      };
    }
    return { text: "Done for today", color: "#22863a" };
  }, [activeClass, nextClass, transitions, currentMin, classes]);

  // ── Render ──────────────────────────────────────────────────────────────

  if (!activeTerm) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: FONT.mono, color: TEXT.muted }}>
      No term selected
    </div>
  );

  const dayPicker = (
    <div style={{ display: "flex", gap: "0.3rem", flexShrink: 0 }}>
      {weekDates.map((d, i) => {
        const isActive = d === dayDate;
        const dayNum = d.split("-")[2];
        const hasClasses = dayData?.dayOfWeek && d === dayDate ? classes.length > 0 : null;
        return (
          <button key={d} type="button" onClick={() => setDayDate(d)} style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.6rem",
            background: isActive ? BTN.primary : "transparent",
            color: isActive ? TEXT.inverse : TEXT.secondary,
            border: `1px solid ${isActive ? BTN.primary : BORDER}`, borderRadius: 4,
            cursor: "pointer", textAlign: "center", minWidth: 50,
          }}>
            <div style={{ fontFamily: FONT.serif, fontSize: TYPE.sm, fontWeight: 700 }}>{DAY_ABBR[i]}</div>
            <div style={{ fontSize: TYPE.xs }}>{dayNum}</div>
          </button>
        );
      })}
    </div>
  );

  const map = classes.some(c => c.building) ? (
    <div style={{ ...cardStyle, overflow: "hidden", flex: isMobile ? undefined : 1, height: isMobile ? 250 : undefined, minHeight: isMobile ? undefined : 300 }}>
      <MapContainer center={mapCenter} zoom={mapZoom} style={{ width: "100%", height: "100%", minHeight: 300 }}
        zoomControl={false} attributionControl={false} scrollWheelZoom={true}>
        <TileLayer
          url={`https://api.mapbox.com/styles/v1/mapbox/streets-v12/tiles/{z}/{x}/{y}?access_token=${import.meta.env.VITE_MAPBOX_TOKEN || ""}`}
          tileSize={512} zoomOffset={-1} maxZoom={18} minZoom={13}
          attribution='&copy; <a href="https://www.mapbox.com/">Mapbox</a>' />
        <BuildingMarkers classes={classes} transitions={transitions}
          activeClass={activeClass} nextClass={nextClass} currentMin={currentMin} friends={friends} />
      </MapContainer>
    </div>
  ) : (
    <div style={{ ...cardStyle, flex: isMobile ? undefined : 1, height: isMobile ? 200 : undefined, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>No building locations available</span>
    </div>
  );

  const timeScrubber = classes.length > 0 ? (
    <div style={{ ...cardStyle, padding: "0.4rem 0.6rem", marginTop: "0.5rem" }}
      onClick={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        setScrubMin(Math.round(scrubStart + pct * (scrubEnd - scrubStart)));
      }}>
      <div style={{ position: "relative", height: 28, background: "#f5f2ed", borderRadius: 4, overflow: "hidden", cursor: "pointer" }}>
        {/* Course blocks */}
        {classes.map((c, i) => {
          const left = (c.startMin - scrubStart) / (scrubEnd - scrubStart) * 100;
          const width = (c.endMin - c.startMin) / (scrubEnd - scrubStart) * 100;
          const dept = c.department || c.courseCode.split(" ")[0];
          const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";
          return (
            <div key={i} style={{
              position: "absolute", left: `${left}%`, width: `${width}%`, top: 2, bottom: 2,
              background: `${color}40`, borderLeft: `2px solid ${color}`, borderRadius: 2,
              display: "flex", alignItems: "center", paddingLeft: 4, overflow: "hidden",
            }}>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700, color, whiteSpace: "nowrap" }}>{c.courseCode}</span>
            </div>
          );
        })}
        {/* Now / scrub marker */}
        {(() => {
          const pos = (currentMin - scrubStart) / (scrubEnd - scrubStart) * 100;
          if (pos < 0 || pos > 100) return null;
          return <div style={{ position: "absolute", left: `${pos}%`, top: 0, bottom: 0, width: 2, background: "#c43b2d", zIndex: 2 }} />;
        })()}
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{formatMinutes(scrubStart)}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{formatMinutes(scrubEnd)}</span>
      </div>
    </div>
  ) : null;

  const statusBar = statusText ? (
    <div style={{ ...cardStyle, padding: "0.5rem 0.7rem", marginTop: "0.5rem" }}>
      <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: statusText.color }}>
        {"●"} {formatMinutes(currentMin)} · {statusText.text}
      </span>
    </div>
  ) : null;

  const sidebar = (
    <div style={{ width: isMobile ? "100%" : 260, minWidth: isMobile ? undefined : 220, flexShrink: 0, overflow: "auto" }}>
      <div style={{ ...cardStyle, padding: "0.6rem" }}>
        <div style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700, marginBottom: "0.4rem" }}>
          {dayData?.dayName || "Schedule"}
        </div>
        {loading ? (
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, padding: "1rem 0", textAlign: "center" }}>loading...</div>
        ) : classes.length === 0 ? (
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, padding: "1rem 0", textAlign: "center" }}>
            No classes on {dayData?.dayName || "this day"}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: "0.1rem" }}>
            {classes.map((c, i) => {
              const isPast = currentMin > c.endMin;
              const isActive = activeClass?.courseCode === c.courseCode;
              const isNext = nextClass?.courseCode === c.courseCode;
              const dept = c.department || c.courseCode.split(" ")[0];
              const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";

              return (
                <div key={c.courseCode}>
                  {/* Class entry */}
                  <div style={{
                    padding: "0.35rem 0.4rem", borderRadius: 4,
                    borderLeft: isActive || isNext ? `3px solid ${color}` : "3px solid transparent",
                    background: isActive ? `${color}10` : "transparent",
                    opacity: isPast ? 0.5 : 1,
                  }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                      <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
                        {formatTime12(c.startTime)} – {formatTime12(c.endTime)}
                      </span>
                      {isNext && <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color, fontWeight: 700 }}>{"←"} next</span>}
                    </div>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 700 }}>
                      {c.courseCode} <span style={{ fontWeight: 400, color: TEXT.muted }}>{"§"}{c.section}</span>
                    </div>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
                      {c.building?.name || "Location TBA"}{c.location && c.building ? ` · ${c.location.split(" - ")[1] || ""}` : ""}
                    </div>
                  </div>

                  {/* Transition to next class */}
                  {i < transitions.length && (
                    <div style={{
                      padding: "0.2rem 0.6rem", margin: "0.1rem 0",
                      fontFamily: FONT.mono, fontSize: TYPE.xs,
                      color: URGENCY_COLORS[transitions[i].urgency],
                      opacity: isPast ? 0.4 : 1,
                    }}>
                      {transitions[i].isSameBuilding ? (
                        <span>{transitions[i].gapMinutes} min gap · same building</span>
                      ) : transitions[i].isCrossCampus ? (
                        <span>
                          {transitions[i].fromBuilding} → {transitions[i].toBuilding} · ~25 min Red Line · {transitions[i].gapMinutes} min gap
                          <br />
                          <a href="https://www.luc.edu/campustransportation/intercampusshuttle/" target="_blank" rel="noopener noreferrer"
                            onClick={e => e.stopPropagation()} style={{ color: "#6f42c1", textDecoration: "underline" }}>
                            Shuttle runs ~every 30 min
                          </a>
                        </span>
                      ) : (
                        <span>
                          {transitions[i].fromBuilding} → {transitions[i].toBuilding} · {transitions[i].walkMinutes} min walk · {transitions[i].gapMinutes} min gap
                          {transitions[i].urgency === "tight" && " · tight"}
                          {transitions[i].urgency === "critical" && " · not enough time"}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Serendipity: overlap cards */}
      {overlaps.length > 0 && (
        <div style={{ ...cardStyle, padding: "0.6rem", marginTop: "0.5rem" }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.sm, fontWeight: 700, marginBottom: "0.3rem", color: "#6f42c1" }}>
            ☕ Free together
          </div>
          {overlaps.map((o, i) => (
            <div key={i} style={{
              padding: "0.3rem 0.4rem", borderRadius: 4,
              background: "#f5f0ff", border: "1px solid #e8e0f5", marginBottom: "0.2rem",
            }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700 }}>
                You and {o.friend.name}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
                {formatMinutes(o.startMin)}–{formatMinutes(o.endMin)} · {o.durationMin} min
                {o.walkMinutes != null && o.walkMinutes > 0 && ` · ${o.walkMinutes} min apart`}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Friends on campus */}
      {friends.length > 0 && (
        <div style={{ ...cardStyle, padding: "0.6rem", marginTop: "0.5rem" }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.sm, fontWeight: 700, marginBottom: "0.3rem" }}>
            {friends.length} friend{friends.length !== 1 ? "s" : ""} on campus
          </div>
          {friends.map(f => (
            <div key={f.id} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0" }}>
              <div style={{
                width: 28, height: 28, borderRadius: "50%", flexShrink: 0,
                background: f.avatarUrl ? "transparent" : "#e8e4df",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700, color: TEXT.secondary,
                overflow: "hidden",
              }}>
                {f.avatarUrl ? <img src={f.avatarUrl} style={{ width: "100%", height: "100%", objectFit: "cover" }} alt="" /> : f.initials}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700 }}>{f.name}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
                  {f.location?.name || "on campus"}
                  {f.status === "in_class" && f.inClassUntil && ` · in class til ${formatMinutes(f.inClassUntil)}`}
                  {f.status === "free" && f.freeUntil && ` · free til ${formatMinutes(f.freeUntil)}`}
                  {f.status === "done" && " · done for today"}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  // ── Layout ──────────────────────────────────────────────────────────────

  return (
    <div style={{ padding: "0.75rem", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Day picker + actions */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.75rem", flexShrink: 0, flexWrap: "wrap", gap: "0.4rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
          {dayPicker}
          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, background: SURFACE.card, border: `1px solid ${BORDER}`, padding: "0.2rem 0.5rem", borderRadius: 4 }}>
            {activeTerm}
          </span>
        </div>
        <div style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
          {scrubMin != null && (
            <button type="button" onClick={() => setScrubMin(null)} style={{
              fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#6f42c1", background: "none", border: "none", cursor: "pointer",
            }}>snap to now</button>
          )}
          {classes.length > 0 && (
            <button type="button" disabled={sharing} onClick={async () => {
              if (!campusDayRef.current) return;
              setSharing(true);
              try {
                const html2canvas = (await import("html2canvas")).default;
                const canvas = await html2canvas(campusDayRef.current, { backgroundColor: "#fffbf0", scale: 2, useCORS: true });
                const link = document.createElement("a");
                link.download = `campus-day-${dayDate}.png`;
                link.href = canvas.toDataURL("image/png");
                link.click();
              } catch { /* silently fail */ }
              setSharing(false);
            }} style={{
              fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.25rem 0.5rem",
              background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer",
              opacity: sharing ? 0.5 : 1,
            }}>
              {sharing ? "exporting..." : "share my day"}
            </button>
          )}
        </div>
      </div>

      {isMobile ? (
        <div ref={campusDayRef} style={{ flex: 1, overflow: "auto" }}>
          {map}
          {timeScrubber}
          {statusBar}
          <div style={{ marginTop: "0.5rem" }}>{sidebar}</div>
        </div>
      ) : (
        <div ref={campusDayRef} style={{ display: "flex", gap: "0.75rem", flex: 1, minHeight: 0, overflow: "hidden" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
            {map}
            {timeScrubber}
            {statusBar}
          </div>
          {sidebar}
        </div>
      )}
    </div>
  );
}
