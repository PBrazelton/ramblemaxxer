/**
 * client/src/pages/Planner.jsx
 * Interactive semester planner — three views: Semester Plan, Weekly Schedule, Campus Day.
 */

import { useState, useEffect, useCallback, useMemo, useRef, lazy, Suspense } from "react";
import { COLORS, STATUS_COLOR, programColor, FONT, TYPE, BG, BORDER, SURFACE, TEXT, BTN, SHADOW, api, ProgressRing, cardStyle, mutedText } from "../lib/ui.jsx";
const CampusDay = lazy(() => import("./CampusDay.jsx"));

// ── Helpers ──────────────────────────────────────────────────────────────────

function termOrder(semester) {
  if (!semester || semester === "Transfer") return 0;
  const m = String(semester).match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
  if (!m) return 1;
  const year = parseInt(m[2]);
  const season = m[1] === "Spring" ? 0 : m[1] === "Summer" ? 1 : 2;
  return year * 3 + season;
}

function getCurrentAcademicTerm() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) return `Fall ${year}`;
  if (month >= 5) return `Summer ${year}`;
  return `Spring ${year}`;
}

function termLabel(term) {
  const m = String(term).match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
  if (!m) return term;
  const short = { Fall: "FA", Spring: "SP", Summer: "SU" };
  return `${short[m[1]]} ${m[2].slice(2)}`;
}

function parseDays(days) {
  if (!days || days === "TBA") return [];
  const result = [];
  let i = 0;
  while (i < days.length) {
    if (days[i] === "T" && days[i + 1] === "h") { result.push("Th"); i += 2; }
    else { result.push(days[i]); i++; }
  }
  return result;
}

function parseTime(t) {
  if (!t) return 0;
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
}

function formatTime(minutes) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
  return `${h12}:${m.toString().padStart(2, "0")} ${ampm}`;
}

const DAY_COLS = ["M", "T", "W", "Th", "F"];
const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

// ── RMP Rating Badge ─────────────────────────────────────────────────────────

function RmpBadge({ rating, numRatings, difficulty, wouldTakeAgain, url, expanded }) {
  if (!rating || !numRatings || numRatings < 1) return null;
  const color = rating >= 4.0 ? "#22863a" : rating >= 3.0 ? "#8a6d00" : "#c43b2d";
  const bg = rating >= 4.0 ? "#e8f5e9" : rating >= 3.0 ? "#fff8e1" : "#fde8e8";

  const badge = (
    <span style={{ display: "inline-flex", alignItems: "center", gap: "0.15rem" }}>
      <span style={{
        fontFamily: FONT.mono, fontSize: "0.5rem", fontWeight: 700,
        color, background: bg, padding: "1px 4px", borderRadius: 3, whiteSpace: "nowrap",
      }}>
        {"\u2605"}{rating.toFixed(1)}
      </span>
      <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", color: TEXT.muted }}>({numRatings})</span>
    </span>
  );

  const expandedDetail = expanded && (difficulty != null || wouldTakeAgain != null) ? (
    <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", color: TEXT.muted, display: "block" }}>
      {difficulty != null && <span>Difficulty: {difficulty.toFixed(1)}</span>}
      {difficulty != null && wouldTakeAgain != null && " · "}
      {wouldTakeAgain != null && <span>{Math.round(wouldTakeAgain)}% would take again</span>}
    </span>
  ) : null;

  const handleClick = url ? (e) => { e.stopPropagation(); e.preventDefault(); window.open(url, "_blank", "noopener"); } : undefined;

  return (
    <span onClick={handleClick} style={{ cursor: url ? "pointer" : "default" }}>
      {badge}
      {expandedDetail}
    </span>
  );
}

// ── Main Planner Component ───────────────────────────────────────────────────

export default function Planner({ user, onLogout }) {
  const [plan, setPlan] = useState(null);
  const [view, setView] = useState("semester"); // "semester" | "weekly" | "campus"
  const [browseCourses, setBrowseCourses] = useState([]);
  const [solverData, setSolverData] = useState(null);
  const [programFilter, setProgramFilter] = useState("");
  const [termFilter, setTermFilter] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [catalogResults, setCatalogResults] = useState(null); // null = requirement-filtered mode
  const [selectedCourse, setSelectedCourse] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved"); // "saved" | "saving" | "dirty"
  const [futureTerms, setFutureTerms] = useState([]);
  const [scrapedTerms, setScrapedTerms] = useState([]);
  const [warnings, setWarnings] = useState([]);
  const [showBrowser, setShowBrowser] = useState(true);
  const [showTracker, setShowTracker] = useState(false);
  const [requirementFilter, setRequirementFilter] = useState(null); // { program, programName, category } or null
  const [wiFilter, setWiFilter] = useState(false);
  const [elFilter, setElFilter] = useState(false);
  const [weeklyTerm, setWeeklyTerm] = useState(null);
  const [sectionData, setSectionData] = useState({}); // { courseCode: [sections] }
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [error, setError] = useState(null);
  const saveTimerRef = useRef(null);
  const saveVersionRef = useRef(0);

  // Track mobile breakpoint
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);

  // Load or create plan on mount
  useEffect(() => {
    (async () => {
      try {
        const plans = await api.get("/api/students/me/plans");
        let activePlan;
        if (plans.length > 0) {
          activePlan = plans[0];
        } else {
          activePlan = await api.post("/api/students/me/plans", {});
        }
        const full = await api.get(`/api/students/me/plans/${activePlan.id}`);
        setPlan(full);
        loadPlannableCourses(full.id);
      } catch (e) {
        setError("Failed to load plan. Try refreshing.");
      }
    })();
  }, []);

  const loadPlannableCourses = useCallback(async (planId) => {
    try {
      const data = await api.get(`/api/students/me/plannable-courses?planId=${planId}`);
      setBrowseCourses(data.courses || []);
      setSolverData({ remaining: data.remaining, programs: data.programs, overlaps: data.overlaps, credits: data.credits });
      setFutureTerms(data.futureTerms || []);
      setScrapedTerms(data.scrapedTerms || []);
      if (!weeklyTerm && data.futureTerms?.length > 0) setWeeklyTerm(data.futureTerms[0]);
      // Seed allBrowseRef with placed course fills so requirement tracker works on refresh
      if (data.placedFills) {
        for (const [code, fills] of Object.entries(data.placedFills)) {
          allBrowseRef.current.set(code, { code, fills });
        }
      }
    } catch (e) {
      setError("Failed to load course suggestions.");
    }
  }, [weeklyTerm]);

  // Auto-save debounce with version guard to prevent race conditions
  useEffect(() => {
    if (!dirty || !plan) return;
    setSaveStatus("dirty");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    const version = ++saveVersionRef.current;
    const planId = plan.id;
    const snapshot = plan.courses.map(c => ({
      course_code: c.course_code,
      term: c.term,
      section: c.section || null,
      class_number: c.class_number || null,
    }));
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await api.put(`/api/students/me/plans/${planId}`, { courses: snapshot });
        // Only mark saved if no newer save was queued
        if (saveVersionRef.current === version) {
          setSaveStatus("saved");
          setDirty(false);
          loadPlannableCourses(planId);
        }
      } catch (e) {
        setSaveStatus("dirty");
        setError("Failed to save plan. Will retry on next change.");
      }
    }, 2000);
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current); };
  }, [dirty, plan]);

  // Update plan courses (local state + mark dirty)
  const updatePlanCourses = useCallback((newCourses) => {
    setPlan(prev => ({ ...prev, courses: newCourses }));
    setDirty(true);
  }, []);

  // Place a course in a term
  const placeCourse = useCallback((courseCode, term, courseData) => {
    if (!plan) return;
    // Check if already placed
    if (plan.courses.some(c => c.course_code === courseCode)) return;
    const newCourse = {
      course_code: courseCode,
      term,
      section: null,
      class_number: null,
      title: courseData?.title || courseCode,
      credits: courseData?.credits || 3,
      department: courseData?.department || courseCode.split(" ")[0],
    };
    updatePlanCourses([...plan.courses, newCourse]);
    setSelectedCourse(null);
  }, [plan, updatePlanCourses]);

  // Remove a course from the plan
  const removeCourse = useCallback((courseCode) => {
    if (!plan) return;
    updatePlanCourses(plan.courses.filter(c => c.course_code !== courseCode));
  }, [plan, updatePlanCourses]);

  // Assign section to a course
  const assignSection = useCallback((courseCode, section, classNumber) => {
    if (!plan) return;
    updatePlanCourses(plan.courses.map(c =>
      c.course_code === courseCode ? { ...c, section, class_number: classNumber } : c
    ));
  }, [plan, updatePlanCourses]);

  // Run validation
  const runValidation = useCallback(async () => {
    if (!plan) return;
    try {
      const result = await api.post(`/api/students/me/plans/${plan.id}/validate`, {});
      setWarnings(result.warnings || []);
    } catch (e) {
      setWarnings([{ type: "error", message: "Validation failed — try saving first." }]);
    }
  }, [plan]);

  // Load section data for a course+term (ref-based to avoid re-triggering effects)
  const sectionDataRef = useRef(sectionData);
  sectionDataRef.current = sectionData;
  const loadSections = useCallback(async (courseCode, term) => {
    const key = `${courseCode}|${term}`;
    if (sectionDataRef.current[key]) return sectionDataRef.current[key];
    try {
      const data = await api.get(`/api/offerings/${encodeURIComponent(courseCode)}/${encodeURIComponent(term)}`);
      const sections = Array.isArray(data) ? data : data.sections || [];
      setSectionData(prev => ({ ...prev, [key]: sections }));
      return sections;
    } catch {
      return [];
    }
  }, []);

  // Placed course codes
  const placedCodes = useMemo(() => new Set(plan?.courses?.map(c => c.course_code) || []), [plan]);

  // Full catalog search (debounced, with race-condition guard)
  useEffect(() => {
    if (searchQuery.length < 2) { setCatalogResults(null); return; }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const results = await api.get(`/api/courses/search?q=${encodeURIComponent(searchQuery)}`);
        if (!cancelled) setCatalogResults(Array.isArray(results) ? results : []);
      } catch { if (!cancelled) setCatalogResults([]); }
    }, 300);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [searchQuery]);

  // Courses grouped by term
  const coursesByTerm = useMemo(() => {
    if (!plan?.courses) return {};
    const grouped = {};
    for (const c of plan.courses) {
      if (!grouped[c.term]) grouped[c.term] = [];
      grouped[c.term].push(c);
    }
    return grouped;
  }, [plan]);

  // Actual student courses (enrolled/complete) grouped by term — read-only layer
  const actualByTerm = useMemo(() => {
    const grouped = {};
    for (const c of (plan?.studentCourses || [])) {
      if (!c.term || c.term === "Transfer") continue;
      if (!grouped[c.term]) grouped[c.term] = [];
      grouped[c.term].push(c);
    }
    return grouped;
  }, [plan?.studentCourses]);

  // Terms that have plan courses or actual courses (sorted)
  const planTerms = useMemo(() => {
    const terms = new Set(plan?.courses?.map(c => c.term) || []);
    for (const c of (plan?.studentCourses || [])) {
      if (c.term && c.term !== "Transfer") terms.add(c.term);
    }
    for (const t of futureTerms) terms.add(t);
    return [...terms].sort((a, b) => termOrder(a) - termOrder(b));
  }, [plan, futureTerms]);

  // Stable ref of all browse courses (survives re-fetches that exclude placed codes)
  const allBrowseRef = useRef(new Map());
  useEffect(() => {
    for (const c of browseCourses) allBrowseRef.current.set(c.code, c);
  }, [browseCourses]);

  // Requirement tracking: figure out how many plan courses fill remaining slots
  const requirementStatus = useMemo(() => {
    if (!solverData?.remaining) return { filled: 0, total: 0, items: [] };
    const remaining = solverData.remaining;
    const items = remaining.map(r => {
      // Build the expected fill prefix: "ProgramName: CategoryName"
      const fillPrefix = `${r.programName}: ${r.category}`;
      const filling = (plan?.courses || []).filter(c => {
        const bc = allBrowseRef.current.get(c.course_code);
        // Match on exact "ProgramName: CategoryName" to avoid cross-program false positives
        return bc?.fills?.some(f => f === fillPrefix);
      });
      return { ...r, fillingCount: filling.length };
    });
    const filled = items.filter(i => i.fillingCount >= i.needed).length;
    return { filled, total: items.length, items };
  }, [solverData, plan, browseCourses]);

  // Credit calculation
  const creditStats = useMemo(() => {
    const currentCredits = solverData?.credits?.total || 0;
    const plannedCredits = (plan?.courses || []).reduce((sum, c) => sum + (c.credits || 3), 0);
    return { current: currentCredits, planned: plannedCredits, total: currentCredits + plannedCredits, goal: 120 };
  }, [solverData, plan]);

  // Filtered browse courses (switches to full catalog when searching)
  const isSearchingCatalog = catalogResults !== null;
  const filteredCourses = useMemo(() => {
    if (isSearchingCatalog) {
      return catalogResults.map(c => ({
        ...c, fills: [], terms: [], boxCount: 0, isFullCatalog: true,
      })).filter(c => !placedCodes.has(c.code));
    }
    let list = browseCourses;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.code.toLowerCase().includes(q) || c.title?.toLowerCase().includes(q));
    }
    if (requirementFilter) {
      const fillKey = `${requirementFilter.programName}: ${requirementFilter.category}`;
      list = list.filter(c => c.fills?.some(f => f === fillKey));
    }
    if (programFilter) {
      list = list.filter(c => c.fills?.some(f => f.includes(programFilter)));
    }
    if (termFilter) {
      list = list.filter(c => c.terms?.includes(termFilter));
    }
    if (wiFilter) {
      list = list.filter(c => c.writing_intensive);
    }
    if (elFilter) {
      list = list.filter(c => c.engaged_learning);
    }
    return list;
  }, [browseCourses, catalogResults, isSearchingCatalog, searchQuery, programFilter, termFilter, requirementFilter, wiFilter, elFilter, placedCodes]);

  // Program names for filter
  const programNames = useMemo(() => {
    if (!solverData?.programs) return [];
    return Object.entries(solverData.programs).map(([code, p]) => ({ code, name: p.name }));
  }, [solverData]);

  if (!plan && error) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: BG, gap: "1rem" }}>
      <span style={{ fontFamily: FONT.mono, color: TEXT.danger, fontSize: TYPE.md }}>{error}</span>
      <a href="#/" style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.secondary }}>back to dashboard</a>
    </div>
  );

  if (!plan) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: TEXT.muted }}>loading planner...</span>
    </div>
  );

  return (
    <div style={{ background: BG, height: "100vh", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Error banner */}
      {error && (
        <div style={{ background: "#fde8e8", borderBottom: "1px solid #f5c6cb", padding: "0.5rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.danger }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.danger }}>{"\u00D7"}</button>
        </div>
      )}
      {/* Header */}
      <div style={{ flexShrink: 0, zIndex: 50, background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.6rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <h1 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              <a href="#/" style={{ textDecoration: "none", color: "inherit" }}>
                <span>ramble</span><span style={{ color: TEXT.danger }}>maxxer</span>
              </a>
            </h1>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#6f42c1", color: TEXT.inverse, padding: "2px 8px", borderRadius: 3 }}>planner</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: saveStatus === "saved" ? "#22863a" : saveStatus === "saving" ? "#b08800" : "#888" }}>
              {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving..." : "unsaved"}
            </span>
            <button onClick={() => window.location.hash = "/"} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.7rem", background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer" }}>
              dashboard
            </button>
            <button onClick={onLogout} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.7rem", background: BTN.primary, color: TEXT.inverse, border: "none", borderRadius: 4, cursor: "pointer" }}>
              log out
            </button>
          </div>
        </div>

        {/* View toggle + credit display */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem", gap: "0.75rem" }}>
          <div style={{ display: "flex", borderRadius: 6, overflow: "hidden", border: `1px solid ${BORDER}`, flex: 1, maxWidth: 420 }}>
            {[
              { key: "semester", title: "Semester Plan", subtitle: "choose courses per term" },
              { key: "weekly", title: "Weekly Schedule", subtitle: "pick sections & times" },
              { key: "campus", title: "Campus Day", subtitle: "map & transitions" },
            ].map(v => (
              <button key={v.key} type="button" onClick={() => setView(v.key)} style={{
                flex: 1, padding: "0.5rem 0.75rem", textAlign: "center",
                background: view === v.key ? BTN.primary : "transparent",
                color: view === v.key ? TEXT.inverse : TEXT.secondary,
                border: "none", cursor: "pointer",
              }}>
                <div style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700 }}>{v.title}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, opacity: 0.7 }}>{v.subtitle}</div>
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexShrink: 0 }}>
            <div style={{ position: "relative", width: 48, height: 48 }}>
              <ProgressRing value={creditStats.total} max={creditStats.goal} size={48} stroke={4} color={STATUS_COLOR.complete} />
              <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center",
                fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700 }}>
                {Math.round(creditStats.total / creditStats.goal * 100)}%
              </div>
            </div>
            <div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.md, fontWeight: 700 }}>{creditStats.total}cr</div>
              <div style={{ ...mutedText(TYPE.xs) }}>{creditStats.current} earned + {creditStats.planned} planned</div>
            </div>
          </div>
        </div>
      </div>

      {/* Content */}
      <div style={{ flex: 1, minHeight: 0, overflow: "hidden" }}>
      {view === "semester" ? (
        <SemesterPlanView
          plan={plan} courseCatalog={browseCourses} filteredCourses={filteredCourses}
          placedCodes={placedCodes} coursesByTerm={coursesByTerm} actualByTerm={actualByTerm} planTerms={planTerms}
          selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse}
          placeCourse={placeCourse} removeCourse={removeCourse}
          searchQuery={searchQuery} setSearchQuery={setSearchQuery}
          programFilter={programFilter} setProgramFilter={setProgramFilter}
          termFilter={termFilter} setTermFilter={setTermFilter}
          wiFilter={wiFilter} setWiFilter={setWiFilter} elFilter={elFilter} setElFilter={setElFilter}
          isSearchingCatalog={isSearchingCatalog}
          programNames={programNames} scrapedTerms={scrapedTerms}
          requirementStatus={requirementStatus} solverData={solverData}
          creditStats={creditStats} isMobile={isMobile}
          showBrowser={showBrowser} setShowBrowser={setShowBrowser}
          showTracker={showTracker} setShowTracker={setShowTracker}
          requirementFilter={requirementFilter} setRequirementFilter={setRequirementFilter}
          warnings={warnings} runValidation={runValidation}
          onSwitchToWeekly={(t) => { setView("weekly"); setWeeklyTerm(t); }}
          onConfirmTerm={async (t) => {
            if (!plan) return;
            try {
              const res = await api.post(`/api/students/me/plans/${plan.id}/confirm-term`, { term: t });
              if (res.plan) setPlan(res.plan);
              if (res.solver) setSolverData(res.solver);
              loadPlannableCourses(plan.id);
            } catch (e) {
              setError("Failed to confirm enrollment");
            }
          }}
        />
      ) : view === "weekly" ? (
        <WeeklyScheduleView
          plan={plan} coursesByTerm={coursesByTerm} actualByTerm={actualByTerm} planTerms={planTerms}
          weeklyTerm={weeklyTerm} setWeeklyTerm={setWeeklyTerm}
          sectionData={sectionData} loadSections={loadSections}
          assignSection={assignSection} isMobile={isMobile}
          onEnrolledSectionSelect={(courseCode, term, section, classNumber) => {
            api.put(`/api/students/me/courses/${encodeURIComponent(courseCode)}?semester=${encodeURIComponent(term)}`, { section, classNumber })
              .catch(() => setError("Failed to save section selection"));
            setPlan(prev => ({
              ...prev,
              studentCourses: (prev.studentCourses || []).map(c =>
                c.course_code === courseCode && c.term === term ? { ...c, section, class_number: classNumber } : c
              ),
            }));
          }}
        />
      ) : (
        <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", fontFamily: FONT.mono, color: TEXT.muted }}>loading campus day...</div>}>
          <CampusDay weeklyTerm={weeklyTerm} planTerms={planTerms} isMobile={isMobile} />
        </Suspense>
      )}
      </div>

      {/* Mobile: selected course sticky bar */}
      {isMobile && selectedCourse && (
        <div style={{
          position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 60,
          background: BTN.primary, color: TEXT.inverse, padding: "0.7rem 1rem",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <div>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 700 }}>{selectedCourse.code}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, marginLeft: "0.5rem", opacity: 0.7 }}>tap a semester to place</span>
          </div>
          <button onClick={() => setSelectedCourse(null)} style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.2rem 0.5rem",
            background: "rgba(255,255,255,0.2)", color: TEXT.inverse, border: "none", borderRadius: 3, cursor: "pointer",
          }}>cancel</button>
        </div>
      )}
    </div>
  );
}

// ── Semester Plan View ───────────────────────────────────────────────────────

function SemesterPlanView({
  plan, filteredCourses, placedCodes, coursesByTerm, actualByTerm = {}, planTerms,
  selectedCourse, setSelectedCourse, placeCourse, removeCourse,
  searchQuery, setSearchQuery, programFilter, setProgramFilter,
  termFilter, setTermFilter, wiFilter, setWiFilter, elFilter, setElFilter,
  isSearchingCatalog, programNames, scrapedTerms,
  requirementStatus, solverData, creditStats, isMobile,
  showBrowser, setShowBrowser, showTracker, setShowTracker,
  requirementFilter, setRequirementFilter,
  warnings, runValidation, onSwitchToWeekly, onConfirmTerm,
}) {
  if (isMobile) {
    return (
      <div style={{ padding: "0.5rem" }}>
        {/* Collapsible course browser */}
        <div style={{ marginBottom: "0.75rem" }}>
          <button onClick={() => setShowBrowser(!showBrowser)} style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 700,
            padding: "0.5rem 0.7rem", background: SURFACE.card, border: `1px solid ${BORDER}`,
            borderRadius: 8, cursor: "pointer",
          }}>
            <span>Course Browser ({filteredCourses.length})</span>
            <span>{showBrowser ? "\u25B2" : "\u25BC"}</span>
          </button>
          {showBrowser && (
            <div style={{ background: SURFACE.card, border: `1px solid ${BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "0.5rem", maxHeight: 300, overflow: "auto" }}>
              <CourseBrowserFilters
                searchQuery={searchQuery} setSearchQuery={setSearchQuery}
                programFilter={programFilter} setProgramFilter={setProgramFilter}
                termFilter={termFilter} setTermFilter={setTermFilter}
          wiFilter={wiFilter} setWiFilter={setWiFilter} elFilter={elFilter} setElFilter={setElFilter}
                programNames={programNames} scrapedTerms={scrapedTerms}
                isSearchingCatalog={isSearchingCatalog}
                requirementFilter={requirementFilter} setRequirementFilter={setRequirementFilter}
              />
              <CourseBrowserList
                courses={filteredCourses} placedCodes={placedCodes}
                selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse}
                requirementFilter={requirementFilter} onClearRequirement={() => setRequirementFilter(null)}
                onSearchCatalog={() => { setRequirementFilter(null); setSearchQuery(requirementFilter?.category?.split(" ")[0] || ""); }}
              />
            </div>
          )}
        </div>

        {/* Semester buckets */}
        {planTerms.map(term => (
          <SemesterBucket key={term} term={term} courses={coursesByTerm[term] || []}
            actualCourses={actualByTerm[term] || []}
            selectedCourse={selectedCourse} placeCourse={placeCourse}
            removeCourse={removeCourse} scrapedTerms={scrapedTerms}
            onSwitchToWeekly={onSwitchToWeekly}
            onConfirmTerm={onConfirmTerm}
          />
        ))}

        {/* Validate + Warnings */}
        <ValidationSection warnings={warnings} onValidate={runValidation} />

        {/* Collapsible requirement tracker */}
        <div style={{ marginTop: "0.75rem" }}>
          <button onClick={() => setShowTracker(!showTracker)} style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 700,
            padding: "0.5rem 0.7rem", background: SURFACE.card, border: `1px solid ${BORDER}`,
            borderRadius: 8, cursor: "pointer",
          }}>
            <span>Requirements ({requirementStatus.filled}/{requirementStatus.total} covered)</span>
            <span>{showTracker ? "\u25B2" : "\u25BC"}</span>
          </button>
          {showTracker && (
            <div style={{ background: SURFACE.card, border: `1px solid ${BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "0.5rem" }}>
              <RequirementTracker status={requirementStatus} solverData={solverData} activeFilter={requirementFilter} onRequirementClick={setRequirementFilter} />
            </div>
          )}
        </div>
      </div>
    );
  }

  // Desktop: three-panel layout
  return (
    <div style={{ display: "flex", gap: "0.75rem", padding: "0.75rem", height: "100%", boxSizing: "border-box" }}>
      {/* Left: Course Browser */}
      <div style={{ width: 280, minWidth: 200, flexShrink: 1, display: "flex", flexDirection: "column" }}>
        <div style={{
          background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8,
          display: "flex", flexDirection: "column", overflow: "hidden", flex: 1,
        }}>
          <div style={{ padding: "0.6rem 0.7rem", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700, marginBottom: "0.4rem" }}>
              Course Browser
            </div>
            <CourseBrowserFilters
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              programFilter={programFilter} setProgramFilter={setProgramFilter}
              termFilter={termFilter} setTermFilter={setTermFilter}
          wiFilter={wiFilter} setWiFilter={setWiFilter} elFilter={elFilter} setElFilter={setElFilter}
              programNames={programNames} scrapedTerms={scrapedTerms}
              isSearchingCatalog={isSearchingCatalog}
            />
          </div>
          <div style={{ flex: 1, overflow: "auto", padding: "0.4rem" }}>
            <CourseBrowserList
              courses={filteredCourses} placedCodes={placedCodes}
              selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse}
            />
          </div>
        </div>
      </div>

      {/* Center: Semester Buckets */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "0.5rem", overflow: "auto", minHeight: 0 }}>
        {planTerms.map(term => (
          <SemesterBucket key={term} term={term} courses={coursesByTerm[term] || []}
            actualCourses={actualByTerm[term] || []}
            selectedCourse={selectedCourse} placeCourse={placeCourse}
            removeCourse={removeCourse} scrapedTerms={scrapedTerms}
            onSwitchToWeekly={onSwitchToWeekly}
            onConfirmTerm={onConfirmTerm}
          />
        ))}
        <ValidationSection warnings={warnings} onValidate={runValidation} />
      </div>

      {/* Right: Requirement Tracker */}
      <div style={{ width: 220, minWidth: 160, flexShrink: 1, overflow: "auto", minHeight: 0 }}>
        <div style={{
          background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: "0.6rem 0.7rem",
        }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700, marginBottom: "0.4rem" }}>
            Requirements
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary, marginBottom: "0.5rem" }}>
            {requirementStatus.filled}/{requirementStatus.total} covered by plan
          </div>
          <RequirementTracker status={requirementStatus} solverData={solverData} activeFilter={requirementFilter} onRequirementClick={setRequirementFilter} />
        </div>
      </div>
    </div>
  );
}

// ── Course Browser Filters ───────────────────────────────────────────────────

function CourseBrowserFilters({ searchQuery, setSearchQuery, programFilter, setProgramFilter, termFilter, setTermFilter, wiFilter, setWiFilter, elFilter, setElFilter, programNames, scrapedTerms, isSearchingCatalog, requirementFilter, setRequirementFilter }) {
  const selectStyle = {
    fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.25rem 0.3rem",
    border: `1px solid ${BORDER}`, borderRadius: 4, background: "#fafaf8",
    flex: 1, minWidth: 0,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {/* Requirement filter pill */}
      {requirementFilter && (
        <div style={{
          display: "flex", alignItems: "center", gap: "0.3rem",
          padding: "0.25rem 0.4rem", borderRadius: 4,
          background: `${programColor(requirementFilter.program)}15`,
          border: `1px solid ${programColor(requirementFilter.program)}40`,
        }}>
          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: programColor(requirementFilter.program), flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {requirementFilter.category}
          </span>
          <button type="button" onClick={() => setRequirementFilter(null)} style={{
            background: "none", border: "none", cursor: "pointer", padding: 0,
            fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, lineHeight: 1,
            minWidth: 20, minHeight: 20, display: "flex", alignItems: "center", justifyContent: "center",
          }}>{"\u00D7"}</button>
        </div>
      )}
      <input
        type="text" placeholder={isSearchingCatalog ? "Searching full catalog..." : "Search courses..."}
        aria-label="Search courses"
        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
        style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.5rem", border: `1px solid ${isSearchingCatalog ? "#6f42c1" : BORDER}`, borderRadius: 4, background: "#fafaf8", width: "100%", boxSizing: "border-box" }}
      />
      {!isSearchingCatalog && (<>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <select value={programFilter} onChange={e => setProgramFilter(e.target.value)} aria-label="Filter by program" style={selectStyle}>
            <option value="">All programs</option>
            {programNames.map(p => <option key={p.code} value={p.name}>{p.name}</option>)}
          </select>
          <select value={termFilter} onChange={e => setTermFilter(e.target.value)} aria-label="Filter by term" style={selectStyle}>
            <option value="">All terms</option>
            {scrapedTerms.map(t => <option key={t} value={t}>{termLabel(t)}</option>)}
          </select>
        </div>
        <div style={{ display: "flex", gap: "0.3rem" }}>
          <button type="button" onClick={() => setWiFilter(!wiFilter)} style={{
            flex: 1, fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.3rem",
            border: `1px solid ${wiFilter ? "#2a6a8a" : BORDER}`, borderRadius: 4,
            background: wiFilter ? "#2a6a8a15" : "transparent", color: wiFilter ? "#2a6a8a" : TEXT.muted,
            cursor: "pointer",
          }}>WI</button>
          <button type="button" onClick={() => setElFilter(!elFilter)} style={{
            flex: 1, fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.3rem",
            border: `1px solid ${elFilter ? "#8a6a2a" : BORDER}`, borderRadius: 4,
            background: elFilter ? "#8a6a2a15" : "transparent", color: elFilter ? "#8a6a2a" : TEXT.muted,
            cursor: "pointer",
          }}>EL</button>
        </div>
      </>)}
    </div>
  );
}

// ── Course Browser List ──────────────────────────────────────────────────────

function CourseBrowserList({ courses, placedCodes, selectedCourse, setSelectedCourse, requirementFilter, onClearRequirement, onSearchCatalog }) {
  if (courses.length === 0) {
    if (requirementFilter) {
      return (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, textAlign: "center", padding: "1rem" }}>
          <div>No courses found for <strong>{requirementFilter.category}</strong></div>
          <div style={{ fontSize: TYPE.xs, marginTop: "0.3rem" }}>in terms with section data</div>
          <button type="button" onClick={onSearchCatalog} style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#6f42c1", cursor: "pointer",
            background: "none", border: "none", padding: "0.3rem 0", textDecoration: "underline",
          }}>search full catalog</button>
        </div>
      );
    }
    return <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, textAlign: "center", padding: "1rem" }}>No courses match filters</div>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      {courses.slice(0, 100).map(course => (
        <CourseCard key={course.code} course={course}
          isPlaced={placedCodes.has(course.code)}
          isSelected={selectedCourse?.code === course.code}
          onSelect={() => setSelectedCourse(selectedCourse?.code === course.code ? null : course)}
        />
      ))}
      {courses.length > 100 && (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, textAlign: "center", padding: "0.5rem" }}>
          +{courses.length - 100} more — refine your search
        </div>
      )}
    </div>
  );
}

// ── Course Card ──────────────────────────────────────────────────────────────

function CourseCard({ course, isPlaced, isSelected, onSelect }) {
  const primaryFill = course.fills?.[0] || "";
  const programCode = primaryFill.split(":")[0]?.trim();
  const color = COLORS[Object.keys(COLORS).find(k => programCode.includes(k.replace("-BA", "").replace("-", " ")))] || "#5a6a7a";

  const Tag = isPlaced ? "div" : "button";
  const interactiveProps = isPlaced ? {} : { type: "button", onClick: onSelect };

  return (
    <Tag
      draggable={!isPlaced}
      onDragStart={e => {
        e.dataTransfer.setData("application/json", JSON.stringify(course));
        e.dataTransfer.effectAllowed = "move";
      }}
      {...interactiveProps}
      style={{
        padding: "0.4rem 0.5rem", borderRadius: 6,
        border: `1px solid ${isSelected ? "#1a1a1a" : BORDER}`,
        borderLeft: `3px solid ${color}`,
        background: isSelected ? "#f5f0e8" : "#fff",
        opacity: isPlaced ? 0.4 : 1,
        cursor: isPlaced ? "default" : "pointer",
        transition: "opacity 0.2s",
        textAlign: "left", width: "100%",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 700 }}>{course.code}</span>
            {course.boxCount > 1 && (
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#f5e6d0", color: "#7a4a1a", padding: "1px 4px", borderRadius: 3 }}>
                ⚡{course.boxCount}
              </span>
            )}
            {course.writing_intensive && (
              <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", background: "#2a6a8a15", color: "#2a6a8a", padding: "1px 3px", borderRadius: 2 }}>WI</span>
            )}
            {course.engaged_learning && (
              <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", background: "#8a6a2a15", color: "#8a6a2a", padding: "1px 3px", borderRadius: 2 }}>EL</span>
            )}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {course.title}
          </div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, flexShrink: 0 }}>{course.credits || 3}cr</span>
      </div>
      {/* Term badges */}
      {course.terms?.length > 0 && (
        <div style={{ display: "flex", gap: "0.2rem", marginTop: "0.2rem", flexWrap: "wrap" }}>
          {course.terms.slice(0, 4).map(t => (
            <span key={t} style={{ fontFamily: FONT.mono, fontSize: "0.45rem", background: "#eee", padding: "1px 3px", borderRadius: 2 }}>
              {termLabel(t)}
            </span>
          ))}
        </div>
      )}
      {/* Fills */}
      {course.fills?.length > 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.muted, marginTop: "0.15rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {course.fills.slice(0, 2).join(", ")}
        </div>
      )}
      {course.isFullCatalog && !course.fills?.length && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.45rem", color: "#bbb", marginTop: "0.15rem" }}>
          not in your requirements
        </div>
      )}
    </Tag>
  );
}

// ── Semester Bucket ──────────────────────────────────────────────────────────

function SemesterBucket({ term, courses, actualCourses: rawActual = [], selectedCourse, placeCourse, removeCourse, scrapedTerms, onSwitchToWeekly, onConfirmTerm }) {
  const [dragOver, setDragOver] = useState(false);
  const [confirming, setConfirming] = useState(false);
  // Filter out actual courses that also exist in plan (avoid duplicate keys)
  const actualCourses = rawActual.filter(a => !courses.some(p => p.course_code === a.course_code));
  const actualCredits = actualCourses.reduce((sum, c) => sum + (c.credits || 3), 0);
  const plannedCredits = courses.reduce((sum, c) => sum + (c.credits || 3), 0);
  const termCredits = actualCredits + plannedCredits;
  const totalCourseCount = courses.length + actualCourses.length;
  const hasData = scrapedTerms.includes(term);
  const isPast = termOrder(term) < termOrder(getCurrentAcademicTerm());
  const [collapsed, setCollapsed] = useState(isPast && totalCourseCount > 0);

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    try {
      const course = JSON.parse(e.dataTransfer.getData("application/json"));
      placeCourse(course.code, term, course);
    } catch {}
  };

  const handleTapPlace = () => {
    if (selectedCourse) {
      placeCourse(selectedCourse.code, term, selectedCourse);
    }
  };

  return (
    <div
      onDragOver={e => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={selectedCourse ? handleTapPlace : undefined}
      tabIndex={selectedCourse ? 0 : undefined}
      aria-label={selectedCourse ? `Place ${selectedCourse.code} in ${term}` : undefined}
      onKeyDown={selectedCourse ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleTapPlace(); } } : undefined}
      style={{
        background: dragOver ? "#e8f5e9" : "#fff",
        border: `1px ${totalCourseCount === 0 ? "dashed" : "solid"} ${dragOver ? "#22863a" : selectedCourse ? "#6f42c1" : BORDER}`,
        borderRadius: 8, padding: "0.6rem 0.7rem", marginBottom: "0.5rem",
        flex: "1 0 auto", minHeight: totalCourseCount === 0 ? 80 : undefined,
        cursor: selectedCourse ? "pointer" : "default",
        transition: "background 0.15s, border-color 0.15s",
      }}
    >
      {totalCourseCount > 0 ? (
        <button type="button" aria-expanded={!collapsed} onClick={(e) => { e.stopPropagation(); setCollapsed(c => !c); }}
          style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
            marginBottom: (!collapsed && totalCourseCount > 0) ? "0.4rem" : 0,
            cursor: "pointer", userSelect: "none",
            background: "none", border: "none", textAlign: "left", width: "100%", padding: 0,
          }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{collapsed ? "\u25B8" : "\u25BE"}</span>
            <span style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700 }}>{term}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
              {totalCourseCount} course{totalCourseCount !== 1 ? "s" : ""} {"\u00B7"} {termCredits}cr
              {isPast && actualCourses.length > 0 && " \u00B7 completed"}
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
            {(() => {
              const allCompleted = actualCourses.length > 0 && courses.length === 0 && actualCourses.every(c => c.status === "complete");
              if (allCompleted || termCredits <= 18) return null;
              const w = termCredits <= 21 ? { label: "heavy load — advisor approval may be required", bg: "#fff8e1", color: "#b08800" }
                : termCredits <= 24 ? { label: "overload — requires approval + extra fees", bg: "#fff3cd", color: "#856404" }
                : { label: "exceeds LUC max overload", bg: "#fde8e8", color: TEXT.danger };
              return (
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: w.bg, color: w.color, padding: "1px 5px", borderRadius: 3 }}>
                  {w.label}
                </span>
              );
            })()}
            {!hasData && (
              <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: "#b08800" }}>no schedule data</span>
            )}
          </div>
        </button>
      ) : (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center",
          marginBottom: 0, userSelect: "none",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700 }}>{term}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
              {totalCourseCount} course{totalCourseCount !== 1 ? "s" : ""} {"\u00B7"} {termCredits}cr
            </span>
          </div>
          <div style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
            {!hasData && (
              <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: "#b08800" }}>no schedule data</span>
            )}
          </div>
        </div>
      )}

      {!collapsed && <>
        {/* Actual enrolled/complete courses (read-only) */}
        {actualCourses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginBottom: courses.length > 0 ? "0.3rem" : 0 }}>
            {actualCourses.map(c => {
              const dept = c.department || c.course_code.split(" ")[0];
              const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";
              const statusColor = c.status === "complete" ? STATUS_COLOR.complete : STATUS_COLOR.enrolled;
              return (
                <div key={c.course_code} style={{
                  display: "inline-flex", alignItems: "center", gap: "0.3rem",
                  background: `${color}18`, border: `1.5px solid ${color}40`,
                  borderRadius: 6, padding: "0.3rem 0.5rem",
                }}>
                  <div>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700, color }}>{c.course_code}</div>
                    <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.secondary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title || ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{c.credits || 3}cr</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", background: `${statusColor}20`, color: statusColor, padding: "1px 4px", borderRadius: 3 }}>
                    {c.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {courses.length === 0 && actualCourses.length === 0 && !selectedCourse && (
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: "#bbb", textAlign: "center", padding: "0.5rem" }}>
            drag or tap courses here
          </div>
        )}
        {courses.length === 0 && actualCourses.length === 0 && selectedCourse && (
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: "#6f42c1", textAlign: "center", padding: "0.5rem" }}>
            tap to place {selectedCourse.code}
          </div>
        )}

        {courses.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem" }}>
            {courses.map(c => (
              <PlacedCourseChip key={c.course_code} course={c} onRemove={() => removeCourse(c.course_code)} />
            ))}
          </div>
        )}
        {/* Section picker nudge */}
        {hasData && onSwitchToWeekly && courses.some(c => !c.section) && (
          <button type="button" onClick={(e) => { e.stopPropagation(); onSwitchToWeekly(term); }} style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#6f42c1",
            cursor: "pointer", marginTop: "0.3rem",
            background: "none", border: "none", padding: 0, textAlign: "left",
          }}>
            switch to weekly view to pick sections {"\u2192"}
          </button>
        )}

        {/* Confirm enrollment button — shown when this is the current term and has plan courses */}
        {onConfirmTerm && courses.length > 0 && termOrder(term) <= termOrder(getCurrentAcademicTerm()) && (
          <button disabled={confirming} onClick={async (e) => { e.stopPropagation(); setConfirming(true); try { await onConfirmTerm(term); } finally { setConfirming(false); } }} style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.4rem 0.8rem", marginTop: "0.4rem",
            background: "#6f42c1", color: TEXT.inverse, border: "none", borderRadius: 4,
            cursor: confirming ? "not-allowed" : "pointer", width: "100%",
            opacity: confirming ? 0.6 : 1,
          }}>
            {confirming ? "confirming..." : `confirm enrollment for ${term}`}
          </button>
        )}
      </>}
    </div>
  );
}

// ── Placed Course Chip ───────────────────────────────────────────────────────

function PlacedCourseChip({ course, onRemove }) {
  const dept = course.department || course.course_code.split(" ")[0];
  const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: "0.3rem",
      background: `${color}10`, border: `1px solid ${color}30`,
      borderRadius: 6, padding: "0.3rem 0.5rem",
    }}>
      <div>
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700, color }}>{course.course_code}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.secondary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {course.title || ""}
        </div>
      </div>
      <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{course.credits || 3}cr</span>
      {course.section && (
        <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", background: "#eee", padding: "1px 3px", borderRadius: 2 }}>
          {"\u00A7"}{course.section}
        </span>
      )}
      <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{
        background: "none", border: "none", cursor: "pointer", padding: "0 0 0 0.2rem",
        fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.danger, lineHeight: 1,
        minWidth: 44, minHeight: 44, display: "flex", alignItems: "center", justifyContent: "center",
      }}>{"\u00D7"}</button>
    </div>
  );
}

// ── Requirement Tracker ──────────────────────────────────────────────────────

function RequirementTracker({ status, solverData, activeFilter, onRequirementClick }) {
  const [hovered, setHovered] = useState(null);

  if (!status?.items?.length) return (
    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: "#22863a", textAlign: "center", padding: "0.5rem" }}>
      All requirements satisfied!
    </div>
  );

  // Group by program
  const grouped = {};
  for (const item of status.items) {
    if (!grouped[item.program]) grouped[item.program] = { name: item.programName, items: [] };
    grouped[item.program].items.push(item);
  }

  const handleClick = (item) => {
    if (!onRequirementClick) return;
    const isActive = activeFilter?.program === item.program && activeFilter?.category === item.category;
    onRequirementClick(isActive ? null : { program: item.program, programName: item.programName, category: item.category });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {Object.entries(grouped).map(([code, group]) => (
        <div key={code}>
          <div style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700,
            color: programColor(code), marginBottom: "0.2rem",
          }}>
            {group.name}
          </div>
          {group.items.map((item, i) => {
            const covered = item.fillingCount >= item.needed;
            const itemKey = `${item.program}|${item.category}`;
            const isActive = activeFilter?.program === item.program && activeFilter?.category === item.category;
            const isHovered = hovered === itemKey;
            const pColor = programColor(item.program);
            return (
              <button type="button" key={i}
                onClick={() => handleClick(item)}
                onMouseEnter={() => setHovered(itemKey)}
                onMouseLeave={() => setHovered(null)}
                style={{
                  display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.15rem",
                  width: "100%", padding: "0.15rem 0.25rem", borderRadius: 4, cursor: "pointer",
                  background: isActive ? `${pColor}15` : isHovered ? `${pColor}08` : "transparent",
                  border: "none", textAlign: "left",
                  borderLeft: isActive ? `3px solid ${pColor}` : "3px solid transparent",
                  transition: "background 0.1s",
                }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: covered ? "#22863a" : "#ddd", flexShrink: 0 }} />
                <span style={{
                  fontFamily: FONT.mono, fontSize: TYPE.xs, color: covered ? "#22863a" : "#888",
                  textDecoration: covered ? "line-through" : "none",
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {item.category}
                </span>
                {isActive ? (
                  <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, flexShrink: 0 }}>{"\u00D7"}</span>
                ) : (
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.disabled, flexShrink: 0 }}>
                    {Math.min(item.fillingCount, item.needed)}/{item.needed}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Validation Section ───────────────────────────────────────────────────────

function ValidationSection({ warnings, onValidate }) {
  const [validating, setValidating] = useState(false);
  const [validated, setValidated] = useState(false);

  const handleValidate = async () => {
    setValidating(true);
    setValidated(false);
    await onValidate();
    setValidating(false);
    setValidated(true);
  };

  return (
    <div style={{ marginTop: "0.5rem" }}>
      <button onClick={handleValidate} disabled={validating} style={{
        fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.4rem 0.8rem",
        background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: validating ? "wait" : "pointer",
        width: "100%", opacity: validating ? 0.6 : 1,
      }}>
        {validating ? "Validating..." : "Validate Plan"}
      </button>
      {validated && warnings.length === 0 && (
        <div style={{ marginTop: "0.4rem", fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.4rem 0.6rem",
          borderRadius: 6, background: "#e8f5e9", color: "#22863a", border: "1px solid #c8e6c9" }}>
          ✓ Plan looks good — no conflicts or warnings
        </div>
      )}
      {warnings.length > 0 && (
        <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {warnings.map((w, i) => (
            <div key={i} style={{
              fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.4rem 0.6rem",
              borderRadius: 6,
              background: w.type === "time_conflict" ? "#fde8e8" : w.type === "overlap" ? "#fff3cd" : "#fff3cd",
              color: w.type === "time_conflict" ? "#c43b2d" : "#856404",
              border: `1px solid ${w.type === "time_conflict" ? "#f5c6cb" : "#ffc107"}`,
            }}>
              {w.type === "time_conflict" ? "\u26A0 " : w.type === "overlap" ? "\u26A0 " : "\u26A0 "}
              {w.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Weekly Schedule View ─────────────────────────────────────────────────────

function WeeklyScheduleView({ plan, coursesByTerm, actualByTerm = {}, planTerms, weeklyTerm, setWeeklyTerm, sectionData, loadSections, assignSection, isMobile, onEnrolledSectionSelect }) {
  const [expandedCourse, setExpandedCourse] = useState(null);

  const termsWithCourses = planTerms.filter(t => (coursesByTerm[t]?.length > 0) || (actualByTerm[t]?.length > 0));
  const activeTerm = weeklyTerm || termsWithCourses[0] || planTerms[0];
  const isPastTerm = termOrder(activeTerm) < termOrder(getCurrentAcademicTerm());

  const planCourses = coursesByTerm[activeTerm] || [];
  const actualCourses = (actualByTerm[activeTerm] || [])
    .filter(c => !planCourses.some(p => p.course_code === c.course_code))
    .map(c => ({ ...c, course_code: c.course_code, isActual: true }));
  const termCourses = [...planCourses, ...actualCourses];

  // Load sections for all term courses in current/future terms
  useEffect(() => {
    if (isPastTerm) return;
    for (const c of termCourses) {
      loadSections(c.course_code, activeTerm);
    }
  }, [termCourses.map(c => c.course_code).join(","), activeTerm, isPastTerm, loadSections]);

  // Auto-select single-section courses (planned only, not enrolled)
  useEffect(() => {
    for (const c of planCourses) {
      if (c.section) continue;
      const sections = sectionData[`${c.course_code}|${activeTerm}`] || [];
      if (sections.length === 1) {
        assignSection(c.course_code, sections[0].section, sections[0].class_number);
      }
    }
  }, [sectionData, activeTerm, planCourses, assignSection]);

  // Section save handler
  const onSectionSelect = useCallback((courseCode, section, classNumber) => {
    const isPlanCourse = planCourses.some(c => c.course_code === courseCode);
    if (isPlanCourse) {
      assignSection(courseCode, section, classNumber);
    } else {
      onEnrolledSectionSelect(courseCode, activeTerm, section, classNumber);
    }
  }, [planCourses, assignSection, activeTerm, onEnrolledSectionSelect]);

  // Build grid blocks
  const blocks = useMemo(() => {
    const result = [];
    const tba = [];
    for (const c of termCourses) {
      const key = `${c.course_code}|${activeTerm}`;
      const sections = sectionData[key] || [];
      const chosen = c.section ? sections.find(s => s.section === c.section) : null;
      if (chosen && chosen.days && chosen.days !== "TBA" && chosen.start_time && chosen.end_time) {
        const days = parseDays(chosen.days);
        const startMin = parseTime(chosen.start_time);
        const endMin = parseTime(chosen.end_time);
        const color = COLORS[Object.keys(COLORS).find(k => k.startsWith(c.department || c.course_code.split(" ")[0]))] || "#5a6a7a";
        for (const day of days) {
          result.push({ courseCode: c.course_code, title: c.title, section: chosen.section, instructor: chosen.instructor, day, startMin, endMin, color });
        }
      } else if (chosen && (!chosen.days || chosen.days === "TBA")) {
        tba.push(c);
      }
      // Courses without a section are handled by the picker — not in tba
    }
    return { scheduled: result, tba };
  }, [termCourses, sectionData, activeTerm]);

  // Conflicts
  const conflicts = useMemo(() => {
    const result = [];
    const { scheduled } = blocks;
    for (let i = 0; i < scheduled.length; i++) {
      for (let j = i + 1; j < scheduled.length; j++) {
        const a = scheduled[i], b = scheduled[j];
        if (a.day === b.day && a.startMin < b.endMin && b.startMin < a.endMin && a.courseCode !== b.courseCode) {
          result.push({ a, b });
        }
      }
    }
    return result;
  }, [blocks]);

  const conflictCodes = useMemo(() => {
    const codes = new Set();
    for (const c of conflicts) { codes.add(`${c.a.courseCode}|${c.a.day}|${c.a.startMin}`); codes.add(`${c.b.courseCode}|${c.b.day}|${c.b.startMin}`); }
    return codes;
  }, [conflicts]);

  // Tight time bounds: 30min breathing room around content
  const minTime = blocks.scheduled.length > 0 ? Math.min(...blocks.scheduled.map(b => b.startMin)) : 540;
  const maxTime = blocks.scheduled.length > 0 ? Math.max(...blocks.scheduled.map(b => b.endMin)) : 1020;
  const gridStart = Math.floor(Math.max(minTime - 30, 420) / 60) * 60;
  const gridEnd = Math.ceil(Math.min(maxTime + 30, 1320) / 60) * 60;

  const termCredits = termCourses.reduce((sum, c) => sum + (c.credits || 3), 0);
  const needsSections = termCourses.filter(c => !c.section).length;

  const termContext = isPastTerm
    ? `${termCredits}cr \u00B7 completed`
    : conflicts.length > 0
      ? `${termCredits}cr \u00B7 \u26A0 ${conflicts.length} time conflict${conflicts.length !== 1 ? "s" : ""}`
      : needsSections > 0
        ? `${termCredits}cr \u00B7 ${needsSections} course${needsSections !== 1 ? "s" : ""} need sections`
        : `${termCredits}cr \u00B7 no conflicts \u2713`;

  // Color map for picker dots (matches grid block colors)
  const courseColor = useCallback((c) => {
    const dept = c.department || c.course_code.split(" ")[0];
    return COLORS[Object.keys(COLORS).find(k => k.startsWith(dept))] || "#5a6a7a";
  }, []);

  // Picker row data: enrich each course with its section state
  const pickerRows = useMemo(() => termCourses.map(c => {
    const key = `${c.course_code}|${activeTerm}`;
    const sections = sectionData[key] || [];
    const chosen = c.section ? sections.find(s => s.section === c.section) : null;
    const isTBA = chosen && (!chosen.days || chosen.days === "TBA");
    const noData = sections.length === 0;
    return { ...c, sections, chosen, isTBA, noData, color: courseColor(c) };
  }), [termCourses, sectionData, activeTerm, courseColor]);

  // Section picker sidebar
  const sectionSidebar = (
    <div style={{
      width: isMobile ? "100%" : 260, minWidth: isMobile ? undefined : 220, flexShrink: 0,
      background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8,
      overflow: "auto", display: "flex", flexDirection: "column",
    }}>
      <div style={{ padding: "0.5rem 0.6rem", borderBottom: `1px solid ${BORDER}` }}>
        <div style={{ fontFamily: FONT.serif, fontSize: TYPE.md, fontWeight: 700 }}>Sections</div>
      </div>
      <div style={{ flex: 1, overflow: "auto" }}>
        {pickerRows.map(c => {
          const isExpanded = expandedCourse === c.course_code;
          const isExpandable = c.sections.length > 0; // any sections = can open

          // Summary line for right side
          let rightContent;
          if (c.noData) {
            rightContent = <span style={{ color: TEXT.muted, fontSize: TYPE.xs }}>no section data</span>;
          } else if (c.isTBA) {
            rightContent = <span style={{ color: TEXT.muted, fontSize: TYPE.xs }}>{"\u00A7"}{c.section} {"\u00B7"} TBA</span>;
          } else if (c.chosen) {
            rightContent = (
              <span style={{ fontSize: TYPE.xs, display: "inline-flex", alignItems: "center", gap: "0.2rem" }}>
                {"\u00A7"}{c.section} {"\u00B7"} {c.chosen.days || ""} {c.chosen.start_time || ""}
                <RmpBadge rating={c.chosen.rmp_rating} numRatings={c.chosen.rmp_num_ratings} url={c.chosen.rmp_url} />
              </span>
            );
          } else {
            rightContent = <span style={{ color: "#b08800", fontSize: TYPE.xs }}>pick section {"\u25B8"}</span>;
          }

          const RowTag = isExpandable ? "button" : "div";
          const rowProps = isExpandable ? {
            type: "button",
            onClick: () => setExpandedCourse(isExpanded ? null : c.course_code),
          } : {};

          return (
            <div key={c.course_code} style={{ borderBottom: `1px solid ${BORDER}` }}>
              {/* Collapsed row */}
              <RowTag {...rowProps} style={{
                display: "flex", alignItems: "center", gap: "0.4rem", width: "100%",
                padding: "0.45rem 0.6rem", minHeight: 44, cursor: isExpandable ? "pointer" : "default",
                background: !c.section && !c.noData ? `${c.color}08` : "transparent",
                border: "none", textAlign: "left",
              }}>
                {/* Colored dot */}
                {c.noData ? (
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", color: TEXT.muted, width: 10, textAlign: "center", flexShrink: 0 }}>{"\u2013"}</span>
                ) : (
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
                    background: c.section ? c.color : "transparent",
                    border: `2px solid ${c.section ? c.color : "#ccc"}`,
                  }} />
                )}
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 700, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {c.course_code}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, flexShrink: 0 }}>{rightContent}</span>
              </RowTag>

              {/* Expanded: section alternatives with professor filter */}
              {isExpanded && (
                <SectionList sections={c.sections} selectedSection={c.section}
                  courseCode={c.course_code} onSectionSelect={onSectionSelect} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div style={{ padding: "0.75rem", height: "100%", boxSizing: "border-box", display: "flex", flexDirection: "column", overflow: "hidden" }}>
      {/* Term selector */}
      <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.75rem", flexWrap: "wrap", flexShrink: 0 }}>
        {planTerms.map(t => {
          const count = (coursesByTerm[t]?.length || 0) + (actualByTerm[t]?.length || 0);
          return (
            <button key={t} type="button" onClick={() => setWeeklyTerm(t)} style={{
              fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.6rem",
              background: activeTerm === t ? "#1a1a1a" : "#fff",
              color: activeTerm === t ? "#fff" : "#666",
              border: `1px solid ${activeTerm === t ? "#1a1a1a" : BORDER}`,
              borderRadius: 4, cursor: "pointer",
            }}>
              {termLabel(t)} ({count})
            </button>
          );
        })}
      </div>

      {isPastTerm ? (
        /* Past semester: read-only course list */
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 700 }}>{activeTerm}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>{termContext}</span>
          </div>
          <div style={{ ...cardStyle, padding: "1rem" }}>
            {termCourses.map(c => (
              <div key={c.course_code} style={{ display: "flex", justifyContent: "space-between", padding: "0.25rem 0", borderTop: `1px solid ${BORDER}` }}>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm }}>
                  <strong>{c.course_code}</strong> {c.title}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{c.credits || 3}cr</span>
              </div>
            ))}
            {termCourses.length === 0 && (
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, textAlign: "center" }}>No courses in this term</div>
            )}
          </div>
        </div>
      ) : termCourses.length === 0 ? (
        <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, textAlign: "center" }}>
            No courses in {activeTerm}. Switch to Semester Plan to add courses.
          </div>
        </div>
      ) : isMobile ? (
        /* Mobile: grid stacked above picker list */
        <div style={{ flex: 1, overflow: "auto" }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem" }}>
            <span style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 700 }}>{activeTerm}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>{termContext}</span>
          </div>
          {blocks.scheduled.length > 0 ? (
            <div style={{ ...cardStyle, padding: "0.5rem", overflow: "hidden", marginBottom: "0.5rem" }}>
              <div style={{ overflowX: "auto" }}>
                <TimeGrid blocks={blocks.scheduled} conflictCodes={conflictCodes} gridStart={gridStart} gridEnd={gridEnd} />
              </div>
            </div>
          ) : (
            <div style={{ ...cardStyle, padding: "0.75rem", marginBottom: "0.5rem", textAlign: "center" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>Pick sections below to build your schedule</div>
            </div>
          )}
          {/* Conflict warnings */}
          {conflicts.length > 0 && conflicts.map((c, i) => (
            <div key={i} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.danger, background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 6, padding: "0.4rem 0.6rem", marginBottom: "0.3rem" }}>
              {"\u26A0"} {c.a.courseCode} and {c.b.courseCode} overlap
            </div>
          ))}
          {/* Off-grid TBA */}
          {blocks.tba.length > 0 && (
            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: "0.5rem" }}>
              {blocks.tba.map(c => <div key={c.course_code}>Off-grid: {c.course_code} ({"\u00A7"}{c.section} — TBA)</div>)}
            </div>
          )}
          {sectionSidebar}
        </div>
      ) : (
        /* Desktop: two-zone — grid (main) + section picker (right sidebar) */
        <div style={{ flex: 1, display: "flex", gap: "0.75rem", minHeight: 0, overflow: "hidden" }}>
          {/* Main: grid zone */}
          <div style={{ flex: 1, minWidth: 0, overflow: "auto", display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: "0.5rem", marginBottom: "0.5rem", flexShrink: 0 }}>
              <span style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 700 }}>{activeTerm}</span>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>{termContext}</span>
            </div>
            {blocks.scheduled.length > 0 ? (
              <div style={{ ...cardStyle, padding: "0.75rem", overflow: "hidden", flexShrink: 0 }}>
                <div style={{ overflowX: "auto" }}>
                  <TimeGrid blocks={blocks.scheduled} conflictCodes={conflictCodes} gridStart={gridStart} gridEnd={gridEnd} />
                </div>
              </div>
            ) : (
              <div style={{ ...cardStyle, padding: "1.5rem", textAlign: "center", flexShrink: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>
                  Pick sections on the right to build your schedule
                </div>
              </div>
            )}
            {/* Conflict warnings */}
            {conflicts.length > 0 && (
              <div style={{ marginTop: "0.5rem", flexShrink: 0 }}>
                {conflicts.map((c, i) => (
                  <div key={i} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.danger, background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 6, padding: "0.4rem 0.6rem", marginBottom: "0.3rem" }}>
                    {"\u26A0"} {c.a.courseCode} {"\u00A7"}{c.a.section} and {c.b.courseCode} {"\u00A7"}{c.b.section} overlap on {c.a.day === "Th" ? "Thursday" : DAY_LABELS[DAY_COLS.indexOf(c.a.day)]} {formatTime(Math.max(c.a.startMin, c.b.startMin))}{"\u2013"}{formatTime(Math.min(c.a.endMin, c.b.endMin))}
                  </div>
                ))}
              </div>
            )}
            {/* Off-grid TBA items */}
            {blocks.tba.length > 0 && (
              <div style={{ marginTop: "0.5rem", fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, flexShrink: 0 }}>
                {blocks.tba.map(c => <div key={c.course_code}>Off-grid: {c.course_code} {c.title} ({"\u00A7"}{c.section} — TBA)</div>)}
              </div>
            )}
          </div>

          {/* Right sidebar: section picker */}
          {sectionSidebar}
        </div>
      )}
    </div>
  );
}

// ── Section List with professor filter ────────────────────────────────────────

function SectionList({ sections, selectedSection, courseCode, onSectionSelect }) {
  const [filter, setFilter] = useState("");
  const filtered = filter
    ? sections.filter(s => (s.instructor || "").toLowerCase().includes(filter.toLowerCase()))
    : sections;

  return (
    <div style={{ padding: "0 0.6rem 0.4rem 0.6rem" }}>
      {sections.length >= 3 && (
        <input type="text" placeholder="filter by professor..." aria-label="Filter by professor"
          value={filter} onChange={e => setFilter(e.target.value)}
          style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.25rem 0.4rem", marginBottom: "0.3rem",
            border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%", boxSizing: "border-box",
          }} />
      )}
      {filtered.length === 0 && filter && (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, padding: "0.3rem 0" }}>No sections match "{filter}"</div>
      )}
      {filtered.map(s => {
        const isSelected = selectedSection === s.section;
        return (
          <button type="button" key={s.section || s.class_number}
            onClick={() => onSectionSelect(courseCode, s.section, s.class_number)}
            style={{
              display: "flex", alignItems: "flex-start", gap: "0.4rem", width: "100%",
              padding: "0.4rem 0.3rem", cursor: "pointer", borderRadius: 4,
              background: isSelected ? "#e8f5e9" : "transparent",
              border: "none", textAlign: "left", minHeight: 44,
            }}>
            <span style={{
              width: 14, height: 14, borderRadius: "50%", flexShrink: 0, marginTop: 1,
              border: `2px solid ${isSelected ? "#22863a" : "#ddd"}`,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}>
              {isSelected && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22863a" }} />}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm }}>
                <span style={{ fontWeight: 700 }}>§{s.section}</span>
                <span style={{ color: TEXT.muted, marginLeft: "0.3rem" }}>{s.days || "TBA"} {s.start_time && s.end_time ? `${s.start_time}–${s.end_time}` : ""}</span>
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, display: "flex", alignItems: "center", gap: "0.25rem", flexWrap: "wrap" }}>
                <span>{s.instructor || "TBA"}</span>
                <RmpBadge rating={s.rmp_rating} numRatings={s.rmp_num_ratings}
                  difficulty={s.rmp_difficulty} wouldTakeAgain={s.rmp_would_take_again}
                  url={s.rmp_url} expanded={true} />
                {s.location ? <span>· {s.location}</span> : null}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── Time Grid ────────────────────────────────────────────────────────────────

function TimeGrid({ blocks, conflictCodes, gridStart, gridEnd }) {
  const PX_PER_HOUR = 50;
  const ROW_HEIGHT = PX_PER_HOUR / 60; // ~0.833 px per minute
  const LABEL_WIDTH = 50;
  const totalHeight = (gridEnd - gridStart) * ROW_HEIGHT;
  const rows = [];
  for (let t = gridStart; t < gridEnd; t += 60) rows.push(t);

  return (
    <div style={{ position: "relative", display: "flex", width: "100%", minWidth: LABEL_WIDTH + 80 * 5 }}>
      {/* Time labels */}
      <div style={{ width: LABEL_WIDTH, flexShrink: 0, position: "relative", height: totalHeight }}>
        {rows.map(t => (
          <div key={t} style={{
            position: "absolute", top: (t - gridStart) * ROW_HEIGHT,
            fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.disabled, width: LABEL_WIDTH, textAlign: "right", paddingRight: 4,
          }}>
            {formatTime(t)}
          </div>
        ))}
      </div>

      {/* Day columns */}
      {DAY_COLS.map((day, dayIdx) => (
        <div key={day} style={{ flex: 1, minWidth: 80, position: "relative", height: totalHeight, borderLeft: `1px solid ${BORDER}` }}>
          {/* Day header */}
          <div style={{
            position: "sticky", top: 0, zIndex: 2,
            fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700, textAlign: "center",
            background: "#f5f0eb", borderBottom: `1px solid ${BORDER}`, padding: "0.3rem 0",
          }}>
            {DAY_LABELS[dayIdx]}
          </div>

          {/* Alternating hour bands */}
          {rows.map((t, i) => (
            <div key={`bg-${t}`} style={{
              position: "absolute", top: (t - gridStart) * ROW_HEIGHT,
              width: "100%", height: PX_PER_HOUR,
              background: i % 2 === 0 ? "transparent" : "#f8f5f0",
            }} />
          ))}

          {/* Hour lines */}
          {rows.map(t => (
            <div key={t} style={{ position: "absolute", top: (t - gridStart) * ROW_HEIGHT, width: "100%", borderTop: `1px solid #f0ece8` }} />
          ))}

          {/* Course blocks */}
          {blocks.filter(b => b.day === day).map((b, i) => {
            const top = (b.startMin - gridStart) * ROW_HEIGHT;
            const height = (b.endMin - b.startMin) * ROW_HEIGHT;
            const isConflict = conflictCodes.has(`${b.courseCode}|${b.day}|${b.startMin}`);
            return (
              <div key={i} style={{
                position: "absolute", top, height: Math.max(height, 16),
                left: 2, right: 2, borderRadius: 3,
                background: isConflict ? `repeating-linear-gradient(45deg, ${b.color}30, ${b.color}30 4px, #fde8e820 4px, #fde8e820 8px)` : `${b.color}18`,
                borderLeft: `3px solid ${b.color}`,
                border: isConflict ? `1.5px solid #c43b2d60` : undefined,
                borderLeftWidth: 3, borderLeftStyle: "solid", borderLeftColor: b.color,
                boxShadow: "0 1px 2px rgba(0,0,0,0.06)",
                padding: "1px 4px", overflow: "hidden", zIndex: 1,
              }}>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700, color: b.color, lineHeight: 1.2 }}>
                  {b.courseCode}
                </div>
                {height > 25 && (
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.secondary, lineHeight: 1.1 }}>
                    {b.instructor?.split(",")[0]?.split(" ").pop() || ""}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
