/**
 * client/src/pages/Planner.jsx
 * Interactive semester planner — two views: Semester Plan + Weekly Schedule.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { COLORS, STATUS_COLOR, programColor, FONT, TYPE, BG, BORDER, SURFACE, TEXT, BTN, SHADOW, api, ProgressRing, cardStyle, mutedText } from "../lib/ui.jsx";

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

// ── Main Planner Component ───────────────────────────────────────────────────

export default function Planner({ user, onLogout }) {
  const [plan, setPlan] = useState(null);
  const [view, setView] = useState("semester"); // "semester" | "weekly"
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
      // Full catalog mode — normalize shape, skip program/term filters
      return catalogResults.map(c => ({
        ...c, fills: [], terms: [], boxCount: 0, isFullCatalog: true,
      })).filter(c => !placedCodes.has(c.code));
    }
    let list = browseCourses;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      list = list.filter(c => c.code.toLowerCase().includes(q) || c.title?.toLowerCase().includes(q));
    }
    if (programFilter) {
      list = list.filter(c => c.fills?.some(f => f.includes(programFilter)));
    }
    if (termFilter) {
      list = list.filter(c => c.terms?.includes(termFilter));
    }
    return list;
  }, [browseCourses, catalogResults, isSearchingCatalog, searchQuery, programFilter, termFilter, placedCodes]);

  // Program names for filter
  const programNames = useMemo(() => {
    if (!solverData?.programs) return [];
    return Object.entries(solverData.programs).map(([code, p]) => ({ code, name: p.name }));
  }, [solverData]);

  if (!plan && error) return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: BG, gap: "1rem" }}>
      <span style={{ fontFamily: FONT.mono, color: TEXT.danger, fontSize: "0.85rem" }}>{error}</span>
      <a href="#/" style={{ fontFamily: FONT.mono, fontSize: "0.75rem", color: TEXT.secondary }}>back to dashboard</a>
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
          <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: TEXT.danger }}>{error}</span>
          <button onClick={() => setError(null)} style={{ background: "none", border: "none", cursor: "pointer", fontFamily: FONT.mono, fontSize: "0.8rem", color: TEXT.danger }}>{"\u00D7"}</button>
        </div>
      )}
      {/* Header */}
      <div style={{ flexShrink: 0, zIndex: 50, background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.6rem 1rem" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.8rem" }}>
            <h1 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
              <a href="#/" style={{ textDecoration: "none", color: "inherit" }}>
                <span>ramble</span><span style={{ color: TEXT.danger }}>maxxer</span>
              </a>
            </h1>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", background: "#6f42c1", color: TEXT.inverse, padding: "2px 8px", borderRadius: 3 }}>planner</span>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: saveStatus === "saved" ? "#22863a" : saveStatus === "saving" ? "#b08800" : "#888" }}>
              {saveStatus === "saved" ? "saved" : saveStatus === "saving" ? "saving..." : "unsaved"}
            </span>
            <button onClick={() => window.location.hash = "/"} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.7rem", background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer" }}>
              dashboard
            </button>
            <button onClick={onLogout} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.7rem", background: BTN.primary, color: TEXT.inverse, border: "none", borderRadius: 4, cursor: "pointer" }}>
              log out
            </button>
          </div>
        </div>

        {/* View toggle + credit bar */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "0.5rem" }}>
          <div style={{ display: "flex", gap: "0.3rem" }}>
            {["semester", "weekly"].map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.25rem 0.6rem",
                background: view === v ? "#1a1a1a" : "transparent", color: view === v ? "#fff" : "#666",
                border: `1px solid ${view === v ? "#1a1a1a" : BORDER}`, borderRadius: 4, cursor: "pointer",
              }}>
                {v === "semester" ? "Semester Plan" : "Weekly Schedule"}
              </button>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.secondary }}>
              {creditStats.current} + {creditStats.planned} = {creditStats.total} / {creditStats.goal} cr
            </div>
            <div style={{ position: "relative", width: 32, height: 32 }}>
              <ProgressRing value={creditStats.total} max={creditStats.goal} size={32} stroke={3} color="#22863a" />
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
          isSearchingCatalog={isSearchingCatalog}
          programNames={programNames} scrapedTerms={scrapedTerms}
          requirementStatus={requirementStatus} solverData={solverData}
          creditStats={creditStats} isMobile={isMobile}
          showBrowser={showBrowser} setShowBrowser={setShowBrowser}
          showTracker={showTracker} setShowTracker={setShowTracker}
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
      ) : (
        <WeeklyScheduleView
          plan={plan} coursesByTerm={coursesByTerm} actualByTerm={actualByTerm} planTerms={planTerms}
          weeklyTerm={weeklyTerm} setWeeklyTerm={setWeeklyTerm}
          sectionData={sectionData} loadSections={loadSections}
          assignSection={assignSection} isMobile={isMobile}
        />
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
            <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700 }}>{selectedCourse.code}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", marginLeft: "0.5rem", opacity: 0.7 }}>tap a semester to place</span>
          </div>
          <button onClick={() => setSelectedCourse(null)} style={{
            fontFamily: FONT.mono, fontSize: "0.65rem", padding: "0.2rem 0.5rem",
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
  termFilter, setTermFilter, isSearchingCatalog, programNames, scrapedTerms,
  requirementStatus, solverData, creditStats, isMobile,
  showBrowser, setShowBrowser, showTracker, setShowTracker,
  warnings, runValidation, onSwitchToWeekly, onConfirmTerm,
}) {
  if (isMobile) {
    return (
      <div style={{ padding: "0.5rem" }}>
        {/* Collapsible course browser */}
        <div style={{ marginBottom: "0.75rem" }}>
          <button onClick={() => setShowBrowser(!showBrowser)} style={{
            width: "100%", display: "flex", justifyContent: "space-between", alignItems: "center",
            fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700,
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
                programNames={programNames} scrapedTerms={scrapedTerms}
                isSearchingCatalog={isSearchingCatalog}
              />
              <CourseBrowserList
                courses={filteredCourses} placedCodes={placedCodes}
                selectedCourse={selectedCourse} setSelectedCourse={setSelectedCourse}
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
            fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700,
            padding: "0.5rem 0.7rem", background: SURFACE.card, border: `1px solid ${BORDER}`,
            borderRadius: 8, cursor: "pointer",
          }}>
            <span>Requirements ({requirementStatus.filled}/{requirementStatus.total} covered)</span>
            <span>{showTracker ? "\u25B2" : "\u25BC"}</span>
          </button>
          {showTracker && (
            <div style={{ background: SURFACE.card, border: `1px solid ${BORDER}`, borderTop: "none", borderRadius: "0 0 8px 8px", padding: "0.5rem" }}>
              <RequirementTracker status={requirementStatus} solverData={solverData} />
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
      <div style={{ width: 280, flexShrink: 0, display: "flex", flexDirection: "column" }}>
        <div style={{
          background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8,
          display: "flex", flexDirection: "column", overflow: "hidden", flex: 1,
        }}>
          <div style={{ padding: "0.6rem 0.7rem", borderBottom: `1px solid ${BORDER}` }}>
            <div style={{ fontFamily: FONT.serif, fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.4rem" }}>
              Course Browser
            </div>
            <CourseBrowserFilters
              searchQuery={searchQuery} setSearchQuery={setSearchQuery}
              programFilter={programFilter} setProgramFilter={setProgramFilter}
              termFilter={termFilter} setTermFilter={setTermFilter}
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
      <div style={{ width: 220, flexShrink: 0, overflow: "auto", minHeight: 0 }}>
        <div style={{
          background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8,
          padding: "0.6rem 0.7rem",
        }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.4rem" }}>
            Requirements
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: TEXT.secondary, marginBottom: "0.5rem" }}>
            {requirementStatus.filled}/{requirementStatus.total} covered by plan
          </div>
          <RequirementTracker status={requirementStatus} solverData={solverData} />
        </div>
      </div>
    </div>
  );
}

// ── Course Browser Filters ───────────────────────────────────────────────────

function CourseBrowserFilters({ searchQuery, setSearchQuery, programFilter, setProgramFilter, termFilter, setTermFilter, programNames, scrapedTerms, isSearchingCatalog }) {
  const selectStyle = {
    fontFamily: FONT.mono, fontSize: "0.65rem", padding: "0.25rem 0.3rem",
    border: `1px solid ${BORDER}`, borderRadius: 4, background: "#fafaf8",
    flex: 1, minWidth: 0,
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.3rem" }}>
      <input
        type="text" placeholder={isSearchingCatalog ? "Searching full catalog..." : "Search courses..."}
        aria-label="Search courses"
        value={searchQuery} onChange={e => setSearchQuery(e.target.value)}
        style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.5rem", border: `1px solid ${isSearchingCatalog ? "#6f42c1" : BORDER}`, borderRadius: 4, background: "#fafaf8", width: "100%", boxSizing: "border-box" }}
      />
      {!isSearchingCatalog && (
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
      )}
    </div>
  );
}

// ── Course Browser List ──────────────────────────────────────────────────────

function CourseBrowserList({ courses, placedCodes, selectedCourse, setSelectedCourse }) {
  if (courses.length === 0) {
    return <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: TEXT.muted, textAlign: "center", padding: "1rem" }}>No courses match filters</div>;
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
        <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.muted, textAlign: "center", padding: "0.5rem" }}>
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
            <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", fontWeight: 700 }}>{course.code}</span>
            {course.boxCount > 0 && (
              <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#f5e6d0", color: "#7a4a1a", padding: "1px 4px", borderRadius: 3 }}>
                {"\u26A1"}{course.boxCount}
              </span>
            )}
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#555", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {course.title}
          </div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: TEXT.muted, flexShrink: 0 }}>{course.credits || 3}cr</span>
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
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.muted }}>{collapsed ? "\u25B8" : "\u25BE"}</span>
            <span style={{ fontFamily: FONT.serif, fontSize: "0.85rem", fontWeight: 700 }}>{term}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.muted }}>
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
                <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: w.bg, color: w.color, padding: "1px 5px", borderRadius: 3 }}>
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
            <span style={{ fontFamily: FONT.serif, fontSize: "0.85rem", fontWeight: 700 }}>{term}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.muted }}>
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
                    <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700, color }}>{c.course_code}</div>
                    <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.secondary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.title || ""}
                    </div>
                  </div>
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: TEXT.muted }}>{c.credits || 3}cr</span>
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.45rem", background: `${statusColor}20`, color: statusColor, padding: "1px 4px", borderRadius: 3 }}>
                    {c.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {courses.length === 0 && actualCourses.length === 0 && !selectedCourse && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#bbb", textAlign: "center", padding: "0.5rem" }}>
            drag or tap courses here
          </div>
        )}
        {courses.length === 0 && actualCourses.length === 0 && selectedCourse && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#6f42c1", textAlign: "center", padding: "0.5rem" }}>
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
            fontFamily: FONT.mono, fontSize: "0.55rem", color: "#6f42c1",
            cursor: "pointer", marginTop: "0.3rem",
            background: "none", border: "none", padding: 0, textAlign: "left",
          }}>
            switch to weekly view to pick sections {"\u2192"}
          </button>
        )}

        {/* Confirm enrollment button — shown when this is the current term and has plan courses */}
        {onConfirmTerm && courses.length > 0 && termOrder(term) <= termOrder(getCurrentAcademicTerm()) && (
          <button onClick={(e) => { e.stopPropagation(); onConfirmTerm(term); }} style={{
            fontFamily: FONT.mono, fontSize: "0.6rem", padding: "0.4rem 0.8rem", marginTop: "0.4rem",
            background: "#6f42c1", color: TEXT.inverse, border: "none", borderRadius: 4,
            cursor: "pointer", width: "100%",
          }}>
            confirm enrollment for {term}
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
        <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700, color }}>{course.course_code}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.secondary, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {course.title || ""}
        </div>
      </div>
      <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: TEXT.muted }}>{course.credits || 3}cr</span>
      {course.section && (
        <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", background: "#eee", padding: "1px 3px", borderRadius: 2 }}>
          {"\u00A7"}{course.section}
        </span>
      )}
      <button onClick={e => { e.stopPropagation(); onRemove(); }} style={{
        background: "none", border: "none", cursor: "pointer", padding: "0 0 0 0.2rem",
        fontFamily: FONT.mono, fontSize: "0.7rem", color: TEXT.danger, lineHeight: 1,
      }}>{"\u00D7"}</button>
    </div>
  );
}

// ── Requirement Tracker ──────────────────────────────────────────────────────

function RequirementTracker({ status, solverData }) {
  if (!status?.items?.length) return (
    <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#22863a", textAlign: "center", padding: "0.5rem" }}>
      All requirements satisfied!
    </div>
  );

  // Group by program
  const grouped = {};
  for (const item of status.items) {
    if (!grouped[item.program]) grouped[item.program] = { name: item.programName, items: [] };
    grouped[item.program].items.push(item);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
      {Object.entries(grouped).map(([code, group]) => (
        <div key={code}>
          <div style={{
            fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700,
            color: programColor(code), marginBottom: "0.2rem",
          }}>
            {group.name}
          </div>
          {group.items.map((item, i) => {
            const covered = item.fillingCount >= item.needed;
            return (
              <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.3rem", marginBottom: "0.15rem" }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: covered ? "#22863a" : "#ddd", flexShrink: 0 }} />
                <span style={{
                  fontFamily: FONT.mono, fontSize: "0.55rem", color: covered ? "#22863a" : "#888",
                  textDecoration: covered ? "line-through" : "none",
                  flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                }}>
                  {item.category}
                </span>
                <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.disabled }}>
                  {Math.min(item.fillingCount, item.needed)}/{item.needed}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Validation Section ───────────────────────────────────────────────────────

function ValidationSection({ warnings, onValidate }) {
  return (
    <div style={{ marginTop: "0.5rem" }}>
      <button onClick={onValidate} style={{
        fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.4rem 0.8rem",
        background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer",
        width: "100%",
      }}>
        Validate Plan
      </button>
      {warnings.length > 0 && (
        <div style={{ marginTop: "0.4rem", display: "flex", flexDirection: "column", gap: "0.3rem" }}>
          {warnings.map((w, i) => (
            <div key={i} style={{
              fontFamily: FONT.mono, fontSize: "0.65rem", padding: "0.4rem 0.6rem",
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

function WeeklyScheduleView({ plan, coursesByTerm, actualByTerm = {}, planTerms, weeklyTerm, setWeeklyTerm, sectionData, loadSections, assignSection, isMobile }) {
  // Terms that have courses (plan or actual)
  const termsWithCourses = planTerms.filter(t => (coursesByTerm[t]?.length > 0) || (actualByTerm[t]?.length > 0));
  const activeTerm = weeklyTerm || termsWithCourses[0] || planTerms[0];
  // Plan courses for this term (editable, get section pickers)
  const planCourses = coursesByTerm[activeTerm] || [];
  // Actual enrolled/complete courses (read-only, shown on grid but no section pickers)
  const actualCourses = (actualByTerm[activeTerm] || [])
    .filter(c => !planCourses.some(p => p.course_code === c.course_code))
    .map(c => ({ ...c, course_code: c.course_code, isActual: true }));
  const termCourses = [...planCourses, ...actualCourses];

  // Load sections only for planned courses (actual courses don't need section pickers)
  useEffect(() => {
    for (const c of planCourses) {
      loadSections(c.course_code, activeTerm);
    }
  }, [planCourses, activeTerm, loadSections]);

  // Gather scheduled blocks for the grid
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
        for (const day of days) {
          result.push({
            courseCode: c.course_code,
            title: c.title,
            section: chosen.section,
            instructor: chosen.instructor,
            day,
            startMin,
            endMin,
            color: COLORS[Object.keys(COLORS).find(k => k.startsWith(c.department || c.course_code.split(" ")[0]))] || "#5a6a7a",
          });
        }
      } else if (chosen && (!chosen.days || chosen.days === "TBA")) {
        tba.push(c);
      } else {
        tba.push(c);
      }
    }
    return { scheduled: result, tba };
  }, [termCourses, sectionData, activeTerm]);

  // Detect conflicts
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

  // Conflicting course codes
  const conflictCodes = useMemo(() => {
    const codes = new Set();
    for (const c of conflicts) { codes.add(`${c.a.courseCode}|${c.a.day}|${c.a.startMin}`); codes.add(`${c.b.courseCode}|${c.b.day}|${c.b.startMin}`); }
    return codes;
  }, [conflicts]);

  // Time range
  const minTime = blocks.scheduled.length > 0 ? Math.min(...blocks.scheduled.map(b => b.startMin)) : 480;
  const maxTime = blocks.scheduled.length > 0 ? Math.max(...blocks.scheduled.map(b => b.endMin)) : 1080;
  const gridStart = Math.floor(Math.max(minTime - 30, 420) / 30) * 30; // round down to 30min, min 7am
  const gridEnd = Math.ceil(Math.min(maxTime + 30, 1260) / 30) * 30; // round up, max 9pm

  return (
    <div style={{ padding: "0.75rem" }}>
      {/* Term selector */}
      <div style={{ display: "flex", gap: "0.3rem", marginBottom: "0.75rem", flexWrap: "wrap" }}>
        {planTerms.map(t => {
          const count = (coursesByTerm[t]?.length || 0) + (actualByTerm[t]?.length || 0);
          return (
            <button key={t} onClick={() => setWeeklyTerm(t)} style={{
              fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.6rem",
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

      {termCourses.length === 0 ? (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: TEXT.muted, textAlign: "center", padding: "3rem" }}>
          No courses placed in {activeTerm}. Switch to Semester Plan to add courses.
        </div>
      ) : (
        <>
          {/* Time grid */}
          <div style={{ overflowX: isMobile ? "auto" : "visible", marginBottom: "1rem" }}>
            <TimeGrid blocks={blocks.scheduled} conflictCodes={conflictCodes} gridStart={gridStart} gridEnd={gridEnd} />
          </div>

          {/* Conflict warnings */}
          {conflicts.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              {conflicts.map((c, i) => (
                <div key={i} style={{
                  fontFamily: FONT.mono, fontSize: "0.65rem", color: TEXT.danger,
                  background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 6,
                  padding: "0.4rem 0.6rem", marginBottom: "0.3rem",
                }}>
                  {"\u26A0"} {c.a.courseCode} {"\u00A7"}{c.a.section} and {c.b.courseCode} {"\u00A7"}{c.b.section} overlap on {c.a.day === "Th" ? "Thursday" : DAY_LABELS[DAY_COLS.indexOf(c.a.day)]} {formatTime(Math.max(c.a.startMin, c.b.startMin))}-{formatTime(Math.min(c.a.endMin, c.b.endMin))}
                </div>
              ))}
            </div>
          )}

          {/* TBA courses */}
          {blocks.tba.length > 0 && (
            <div style={{ marginBottom: "1rem" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 700, marginBottom: "0.3rem", color: TEXT.muted }}>Off-grid (TBA / no section selected)</div>
              {blocks.tba.map(c => (
                <div key={c.course_code} style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: TEXT.secondary, padding: "0.2rem 0" }}>
                  {c.course_code} {c.title} {c.section ? `(${"\u00A7"}${c.section} — TBA)` : "(pick section below)"}
                </div>
              ))}
            </div>
          )}

          {/* Section pickers (only for planned courses, not actual enrolled/complete) */}
          <div style={{ fontFamily: FONT.serif, fontSize: "0.9rem", fontWeight: 700, marginBottom: "0.5rem" }}>Pick Sections</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "1fr 1fr", gap: "0.5rem" }}>
            {planCourses.map(c => (
              <SectionPicker key={c.course_code} course={c} term={activeTerm}
                sections={sectionData[`${c.course_code}|${activeTerm}`] || []}
                onSelect={(section, classNumber) => assignSection(c.course_code, section, classNumber)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Time Grid ────────────────────────────────────────────────────────────────

function TimeGrid({ blocks, conflictCodes, gridStart, gridEnd }) {
  const ROW_HEIGHT = 2; // px per minute
  const COL_WIDTH = 120;
  const LABEL_WIDTH = 50;
  const totalHeight = (gridEnd - gridStart) * ROW_HEIGHT;
  const rows = [];
  for (let t = gridStart; t < gridEnd; t += 60) rows.push(t);

  return (
    <div style={{ position: "relative", display: "flex", minWidth: LABEL_WIDTH + COL_WIDTH * 5 }}>
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
        <div key={day} style={{ width: COL_WIDTH, flexShrink: 0, position: "relative", height: totalHeight, borderLeft: `1px solid ${BORDER}` }}>
          {/* Day header */}
          <div style={{
            position: "sticky", top: 0, zIndex: 2,
            fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700, textAlign: "center",
            background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.2rem 0",
          }}>
            {DAY_LABELS[dayIdx]}
          </div>

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
                position: "absolute", top, height: Math.max(height, 20),
                left: 2, right: 2, borderRadius: 4,
                background: isConflict ? `repeating-linear-gradient(45deg, ${b.color}20, ${b.color}20 4px, #fde8e820 4px, #fde8e820 8px)` : `${b.color}20`,
                border: `1px solid ${isConflict ? "#c43b2d" : b.color}40`,
                padding: "2px 4px", overflow: "hidden", zIndex: 1,
              }}>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", fontWeight: 700, color: b.color, lineHeight: 1.2 }}>
                  {b.courseCode}
                </div>
                {height > 30 && (
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.4rem", color: TEXT.secondary, lineHeight: 1.2 }}>
                    {b.instructor?.split(",")[0] || ""}
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

// ── Section Picker ───────────────────────────────────────────────────────────

function SectionPicker({ course, term, sections, onSelect }) {
  // Auto-select if only 1 section
  useEffect(() => {
    if (sections.length === 1 && !course.section) {
      onSelect(sections[0].section, sections[0].class_number);
    }
  }, [sections]);

  if (sections.length === 0) {
    return (
      <div style={{
        background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.5rem",
      }}>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 700 }}>{course.course_code}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: TEXT.muted }}>No section data available</div>
      </div>
    );
  }

  return (
    <div style={{ background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.5rem" }}>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 700, marginBottom: "0.3rem" }}>
        {course.course_code}
        <span style={{ fontWeight: 400, color: TEXT.muted, marginLeft: "0.3rem" }}>{course.title}</span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.2rem" }}>
        {sections.map(s => {
          const isSelected = course.section === s.section;
          return (
            <button type="button" key={s.section || s.class_number} onClick={() => onSelect(s.section, s.class_number)} style={{
              display: "flex", alignItems: "center", gap: "0.4rem",
              padding: "0.3rem 0.4rem", borderRadius: 4, cursor: "pointer",
              background: isSelected ? "#e8f5e9" : "transparent",
              border: `1px solid ${isSelected ? "#22863a" : "transparent"}`,
              textAlign: "left", width: "100%",
            }}>
              <span style={{ width: 14, height: 14, borderRadius: "50%", border: `2px solid ${isSelected ? "#22863a" : "#ddd"}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {isSelected && <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#22863a" }} />}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem" }}>
                  <span style={{ fontWeight: 700 }}>{"\u00A7"}{s.section}</span>
                  <span style={{ color: TEXT.muted, marginLeft: "0.3rem" }}>{s.days || "TBA"} {s.start_time && s.end_time ? `${s.start_time}-${s.end_time}` : ""}</span>
                </div>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.5rem", color: TEXT.muted }}>
                  {s.instructor || "TBA"}{s.location ? ` | ${s.location}` : ""}{s.instruction_mode ? ` | ${s.instruction_mode}` : ""}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
