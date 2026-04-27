import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  FONT, TYPE, BG, BORDER, SURFACE, TEXT, BTN, SPACING,
  api, StickyHeader, NavMenu, cardStyle, sectionHeader, mutedText,
  EmptyState, gradeColor, ErrMsg,
} from "../lib/ui.jsx";
import {
  ALL_GRADES, DEFAULT_SCALE,
  computeGPA, computeWeightedScore, finalScenarios, computeProjectedGPA,
} from "../../../shared/gpa.js";

// ── helpers ─────────────────────────────────────────────────────────────────
function getCurrentAcademicTerm() {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 8) return `Fall ${year}`;
  if (month >= 5) return `Summer ${year}`;
  return `Spring ${year}`;
}

function termOrderClient(semester) {
  if (!semester || semester === "Transfer") return 0;
  const m = String(semester).match(/^(Fall|Spring|Summer)\s+(\d{4})$/);
  if (!m) return 1;
  const year = parseInt(m[2]);
  const season = m[1] === "Spring" ? 0 : m[1] === "Summer" ? 1 : 2;
  return year * 3 + season;
}

function fmtGPA(g) {
  if (g == null) return "—";
  return g.toFixed(2);
}

function fmtPct(p) {
  if (p == null) return "—";
  return `${p.toFixed(1)}%`;
}

const GRADE_OPTIONS = ALL_GRADES;
const GPA_LETTERS = ["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F"];

function uid() { return Math.random().toString(36).slice(2, 9); }

// ── main page ───────────────────────────────────────────────────────────────
export default function Grades({ user, onLogout }) {
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState("");
  const [projectionMode, setProjectionMode] = useState("quick"); // "quick" | "detailed"
  // quickGrades keyed by `${code}|${semester}` to avoid collisions across repeats
  const [quickGrades, setQuickGrades] = useState({});
  // Hydrate quickGrades from gradePlanJson once on initial load. Subsequent
  // user edits flow through setQuickGradeFor, which updates state + persists.
  const hydrated = useRef(false);

  const currentTerm = getCurrentAcademicTerm();
  const currentTermRank = termOrderClient(currentTerm);

  const load = useCallback(async () => {
    try {
      const data = await api.get("/api/students/me/courses");
      setCourses(Array.isArray(data) ? data : []);
    } catch (e) {
      setError("Couldn't load your courses.");
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // One-time hydration of quickGrades from saved plan blobs
  useEffect(() => {
    if (!courses || hydrated.current) return;
    const next = {};
    for (const c of courses) {
      if (!c.gradePlanJson) continue;
      try {
        const plan = JSON.parse(c.gradePlanJson);
        if (plan.quickGrade) next[`${c.code}|${c.semester}`] = plan.quickGrade;
      } catch (e) { /* skip malformed */ }
    }
    if (Object.keys(next).length > 0) setQuickGrades(next);
    hydrated.current = true;
  }, [courses]);

  // Build courseMap-like for computeGPA (it expects .get(code) → {credits})
  const courseMap = useMemo(() => {
    const m = new Map();
    if (courses) for (const c of courses) m.set(c.code, { credits: c.credits ?? 3 });
    return m;
  }, [courses]);

  // Partition: current-term enrolled vs past (planned courses for current term shown
  // in current-term section; future-planned courses excluded from past)
  const currentTermCourses = useMemo(() => {
    if (!courses) return [];
    return courses.filter(c => c.semester === currentTerm && c.status !== "complete" && c.status !== "transfer");
  }, [courses, currentTerm]);

  const pastCourses = useMemo(() => {
    if (!courses) return [];
    return courses.filter(c => {
      // Always include explicit transfers and rows already marked complete
      if (c.status === "transfer") return true;
      if (c.status === "complete") return true;
      // For non-complete rows, only include if semester is strictly past current term
      const rank = termOrderClient(c.semester);
      return rank > 0 && rank < currentTermRank;
    });
  }, [courses, currentTermRank]);

  // Cumulative GPA: from past courses only (those with grades)
  const cumulative = useMemo(() => computeGPA(pastCourses, courseMap), [pastCourses, courseMap]);

  // Projection helper: applies detailed (syllabus) or quick (dropdown) per current-term course
  const applyProjections = useCallback((rows) => rows.map(c => {
    if (c.grade) return c;
    const key = `${c.code}|${c.semester}`;
    if (projectionMode === "detailed" && c.gradePlanJson) {
      try {
        const plan = JSON.parse(c.gradePlanJson);
        const result = computeWeightedScore(plan);
        // Only honor projected letter when the syllabus is meaningfully filled in
        if (result.projectedLetter && result.isComplete) return { ...c, grade: result.projectedLetter };
      } catch (e) { /* fall through to quick */ }
    }
    if (quickGrades[key]) return { ...c, grade: quickGrades[key] };
    return c;
  }), [projectionMode, quickGrades]);

  // Projected GPA: cumulative + current-term projections
  const projected = useMemo(() => {
    return computeGPA(applyProjections(courses || []), courseMap);
  }, [courses, courseMap, applyProjections]);

  // Current-term-only GPA (projected)
  const currentTermGPA = useMemo(() => {
    return computeGPA(applyProjections(currentTermCourses), courseMap);
  }, [currentTermCourses, courseMap, applyProjections]);

  // ── persistence helpers ───────────────────────────────────────────────────
  const updateGrade = async (code, semester, grade) => {
    // Optimistic update
    setCourses(prev => prev.map(c =>
      c.code === code && c.semester === semester ? { ...c, grade: grade || null } : c
    ));
    try {
      const url = `/api/students/me/courses/${encodeURIComponent(code)}?semester=${encodeURIComponent(semester)}`;
      const res = await fetch(url, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grade: grade || null }),
      });
      if (!res.ok) throw new Error("save failed");
    } catch (e) {
      setError("Couldn't save grade.");
      load(); // resync
    }
  };

  // Debounced syllabus saves — keyed by (code, semester). Each card has a 600ms debounce.
  const saveTimers = useRef({});
  const updateGradePlan = useCallback((code, semester, plan) => {
    const json = plan ? JSON.stringify(plan) : null;
    // Optimistic UI immediately
    setCourses(prev => prev.map(c =>
      c.code === code && c.semester === semester ? { ...c, gradePlanJson: json } : c
    ));
    const key = `${code}|${semester}`;
    if (saveTimers.current[key]) clearTimeout(saveTimers.current[key]);
    saveTimers.current[key] = setTimeout(async () => {
      try {
        const url = `/api/students/me/courses/${encodeURIComponent(code)}?semester=${encodeURIComponent(semester)}`;
        const res = await fetch(url, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ gradePlanJson: json }),
        });
        if (!res.ok) throw new Error("save failed");
      } catch (e) {
        setError("Couldn't save syllabus.");
        load();
      }
    }, 600);
  }, [load]);

  // Flush pending saves on unmount
  useEffect(() => () => {
    Object.values(saveTimers.current).forEach(t => clearTimeout(t));
  }, []);

  // Set + persist a quick-mode projection for a current-term course. Stored
  // inside gradePlanJson so it coexists with any syllabus categories the
  // student has set up. Kept in local state too for instant UI response.
  const setQuickGradeFor = useCallback((code, semester, grade) => {
    const key = `${code}|${semester}`;
    setQuickGrades(qg => ({ ...qg, [key]: grade }));
    const course = (courses || []).find(c => c.code === code && c.semester === semester);
    let plan = { categories: [] };
    if (course?.gradePlanJson) {
      try { plan = JSON.parse(course.gradePlanJson); } catch (e) { /* fall back to empty */ }
    }
    const next = { ...plan };
    if (grade) next.quickGrade = grade;
    else delete next.quickGrade;
    // If plan is now empty (no categories, no quickGrade, no scaleOverride), clear it
    const isEmpty = (!next.categories || next.categories.length === 0)
      && !next.quickGrade
      && !next.scaleOverride;
    updateGradePlan(code, semester, isEmpty ? null : next);
  }, [courses, updateGradePlan]);

  // ── render ────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <StickyHeader
        user={user}
        onLogout={onLogout}
        nav={<NavMenu items={[
          { label: "dashboard", href: "#/", color: TEXT.brand },
          { label: "planner", href: "#/planner", color: "#6f42c1" },
          { label: "grades", href: "#/grades", current: true, color: "#22863a" },
        ]} />}
      />

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem", paddingBottom: "4rem" }}>
        <h2 style={{ ...sectionHeader(TYPE.xxl), margin: "1rem 0 0.5rem" }}>Grades</h2>
        <p style={{ ...mutedText(TYPE.sm), margin: "0 0 1.5rem" }}>
          Track past grades, project current-term GPA, and run scenarios.
        </p>

        {error && <ErrMsg>{error}</ErrMsg>}
        {courses == null && <EmptyState>Loading...</EmptyState>}
        {courses && (
          <>
            <GPAOverview
              cumulative={cumulative}
              currentTermGPA={currentTermGPA}
              projected={projected}
              projectionMode={projectionMode}
              setProjectionMode={setProjectionMode}
              currentTerm={currentTerm}
            />

            <div style={{ marginTop: SPACING.zone }}>
              <h3 style={{ ...sectionHeader(TYPE.lg), marginBottom: "0.5rem" }}>{currentTerm}</h3>
              {currentTermCourses.length === 0 ? (
                <EmptyState>No courses for the current term.</EmptyState>
              ) : (
                currentTermCourses.map(c => {
                  const key = `${c.code}|${c.semester}`;
                  return (
                    <CurrentTermCard
                      key={key}
                      course={c}
                      quickGrade={quickGrades[key] || ""}
                      setQuickGrade={(g) => setQuickGradeFor(c.code, c.semester, g)}
                      onSavePlan={(plan) => updateGradePlan(c.code, c.semester, plan)}
                      projectionMode={projectionMode}
                    />
                  );
                })
              )}
            </div>

            <div style={{ marginTop: SPACING.zone }}>
              <h3 style={{ ...sectionHeader(TYPE.lg), marginBottom: "0.5rem" }}>Past courses</h3>
              <PastCoursesList courses={pastCourses} onUpdateGrade={updateGrade} />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── GPA Overview ────────────────────────────────────────────────────────────
function GPAOverview({ cumulative, currentTermGPA, projected, projectionMode, setProjectionMode, currentTerm }) {
  return (
    <div style={{ ...cardStyle, padding: "1.25rem" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "1rem", marginBottom: "1rem" }}>
        <div>
          <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase", letterSpacing: "0.05em" }}>Cumulative</div>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700 }}>{fmtGPA(cumulative.gpa)}</div>
          <div style={{ ...mutedText(TYPE.xs) }}>{cumulative.totalCredits} cr graded</div>
        </div>
        <div>
          <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase", letterSpacing: "0.05em" }}>{currentTerm} (proj.)</div>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, color: TEXT.link }}>{fmtGPA(currentTermGPA.gpa)}</div>
          <div style={{ ...mutedText(TYPE.xs) }}>{currentTermGPA.totalCredits} cr</div>
        </div>
      </div>

      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.75rem" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "0.5rem", flexWrap: "wrap" }}>
          <div>
            <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase", letterSpacing: "0.05em" }}>Projected overall</div>
            <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 700 }}>
              {fmtGPA(projected.gpa)}
              <span style={{ ...mutedText(TYPE.xs), marginLeft: 8, fontFamily: FONT.mono, fontWeight: 400 }}>
                {projected.totalCredits} cr
              </span>
            </div>
          </div>
          <ProjectionToggle mode={projectionMode} setMode={setProjectionMode} />
        </div>
      </div>
    </div>
  );
}

function ProjectionToggle({ mode, setMode }) {
  return (
    <div style={{ display: "flex", border: `1px solid ${BORDER}`, borderRadius: 6, overflow: "hidden" }} role="radiogroup" aria-label="Projection mode">
      {[
        { key: "quick", label: "Quick" },
        { key: "detailed", label: "Detailed" },
      ].map(opt => (
        <button
          key={opt.key}
          type="button"
          role="radio"
          aria-checked={mode === opt.key}
          onClick={() => setMode(opt.key)}
          style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.4rem 0.75rem",
            background: mode === opt.key ? BTN.primary : "transparent",
            color: mode === opt.key ? TEXT.inverse : TEXT.secondary,
            border: "none", cursor: "pointer", minHeight: 36,
          }}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

// ── Current term card (per course) ──────────────────────────────────────────
function CurrentTermCard({ course, quickGrade, setQuickGrade, onSavePlan, projectionMode }) {
  const [expanded, setExpanded] = useState(false);
  const [plan, setPlan] = useState(() => {
    if (!course.gradePlanJson) return { categories: [], scaleOverride: null };
    try { return JSON.parse(course.gradePlanJson); } catch (e) { return { categories: [], scaleOverride: null }; }
  });

  // Saved plan summary (for collapsed view)
  const summary = useMemo(() => computeWeightedScore(plan), [plan]);
  // Only treat as a real projection when the syllabus is complete (no open weight).
  // Otherwise show the running weighted average as a "so-far" indicator.
  const projectedLetter = summary.isComplete ? summary.projectedLetter : null;
  const runningPct = !summary.isComplete && summary.currentPct != null ? summary.currentPct : null;
  const hasSyllabus = plan.categories && plan.categories.length > 0;
  const showQuick = projectionMode === "quick" || !hasSyllabus || !summary.isComplete;

  // When persisting from inside this card, merge in the latest quickGrade
  // from props so a separately-updated quick projection isn't clobbered.
  const persistPlan = useCallback((next) => {
    setPlan(next);
    let externalQuick = null;
    if (course.gradePlanJson) {
      try {
        const ext = JSON.parse(course.gradePlanJson);
        if (ext.quickGrade) externalQuick = ext.quickGrade;
      } catch (e) { /* ignore */ }
    }
    const toSave = externalQuick ? { ...next, quickGrade: externalQuick } : next;
    onSavePlan(toSave);
  }, [onSavePlan, course.gradePlanJson]);

  const updateCategory = (id, patch) => {
    persistPlan({ ...plan, categories: plan.categories.map(c => c.id === id ? { ...c, ...patch } : c) });
  };

  const addCategory = () => {
    persistPlan({
      ...plan,
      categories: [...(plan.categories || []), { id: uid(), name: "", weight: "", scoreEarned: "", scoreOut: "", scenario: "" }],
    });
  };

  const removeCategory = (id) => {
    persistPlan({ ...plan, categories: plan.categories.filter(c => c.id !== id) });
  };

  return (
    <div style={{ ...cardStyle, padding: "0.9rem 1rem", marginBottom: SPACING.tight }}>
      {/* Header row: code + projected letter + quick grade or expand button */}
      <div style={{ display: "flex", alignItems: "center", gap: "0.6rem", flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>{course.code}</div>
          {course.title && (
            <div style={{ ...mutedText(TYPE.xs), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {course.title}
            </div>
          )}
        </div>

        {/* Projected letter (only when syllabus is fully filled in) */}
        {projectedLetter && (
          <span style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "2px 8px", borderRadius: 4,
            background: SURFACE.input, border: `1px solid ${BORDER}`,
            color: gradeColor(projectedLetter), fontWeight: 600,
          }}>
            {projectedLetter} · {summary.projectedPct.toFixed(0)}%
          </span>
        )}
        {/* Running weighted avg (partial syllabus, not yet a final projection) */}
        {!projectedLetter && runningPct != null && (
          <span title="Running weighted average so far" style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", borderRadius: 3,
            background: SURFACE.input, color: TEXT.muted,
          }}>
            so far: {runningPct.toFixed(0)}%
          </span>
        )}

        {/* Quick-mode dropdown */}
        {showQuick && !course.grade && (
          <select
            aria-label={`projected grade for ${course.code}`}
            value={quickGrade}
            onChange={(e) => setQuickGrade(e.target.value)}
            style={{
              fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.4rem",
              border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE.input,
              minHeight: 36,
            }}>
            <option value="">project...</option>
            {GPA_LETTERS.map(g => <option key={g} value={g}>{g}</option>)}
          </select>
        )}

        <button
          type="button"
          onClick={() => setExpanded(e => !e)}
          aria-expanded={expanded}
          style={{
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.3rem 0.6rem",
            background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4,
            cursor: "pointer", color: TEXT.secondary, minHeight: 36,
          }}>
          {expanded ? "collapse" : (plan.categories?.length ? "edit syllabus" : "+ syllabus")}
        </button>
      </div>

      {/* Expanded: syllabus calculator */}
      {expanded && (
        <div style={{ marginTop: "0.8rem", paddingTop: "0.8rem", borderTop: `1px solid ${BORDER}` }}>
          <SyllabusEditor
            plan={plan}
            updateCategory={updateCategory}
            addCategory={addCategory}
            removeCategory={removeCategory}
            persistPlan={persistPlan}
            summary={summary}
          />
        </div>
      )}
    </div>
  );
}

// ── Syllabus editor ─────────────────────────────────────────────────────────
function SyllabusEditor({ plan, updateCategory, addCategory, removeCategory, persistPlan, summary }) {
  const cats = plan.categories || [];
  const weightSumPct = cats.reduce((s, c) => s + (Number(c.weight) || 0), 0);
  const useHundred = cats.some(c => Number(c.weight) > 1);
  const displaySum = useHundred ? weightSumPct : weightSumPct * 100;
  const weightOK = Math.abs(displaySum - 100) < 0.01;

  const scenarios = useMemo(() => finalScenarios(plan), [plan]);

  return (
    <div>
      {/* Category rows */}
      {cats.length === 0 && (
        <div style={{ ...mutedText(TYPE.sm), textAlign: "center", padding: "1rem 0" }}>
          Add the categories from your syllabus (Exam 1, Final, Homework...)
        </div>
      )}
      {cats.map(c => (
        <CategoryRow
          key={c.id}
          cat={c}
          onChange={(patch) => updateCategory(c.id, patch)}
          onRemove={() => removeCategory(c.id)}
        />
      ))}

      <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={addCategory}
          style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.4rem 0.7rem",
            background: "transparent", border: `1px dashed ${BORDER}`, borderRadius: 4,
            cursor: "pointer", color: TEXT.secondary,
          }}>
          + add category
        </button>
        <div style={{ ...mutedText(TYPE.xs) }}>
          weights: <span style={{ color: weightOK ? TEXT.success : TEXT.danger, fontWeight: 600 }}>
            {displaySum.toFixed(0)}%
          </span>
          {!weightOK && cats.length > 0 && <span> (must total 100)</span>}
        </div>
      </div>

      {/* Summary */}
      {cats.length > 0 && weightOK && (
        <div style={{ marginTop: "0.8rem", padding: "0.6rem", background: SURFACE.input, borderRadius: 4 }}>
          <div style={{ display: "flex", justifyContent: "space-between", flexWrap: "wrap", gap: "0.5rem", alignItems: "center" }}>
            <div>
              <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase" }}>So far</div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>
                {fmtPct(summary.currentPct)}
              </div>
            </div>
            {summary.isComplete && (
              <div>
                <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase" }}>Final projected</div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, color: gradeColor(summary.projectedLetter) }}>
                  {summary.projectedLetter || "—"} ({fmtPct(summary.projectedPct)})
                </div>
              </div>
            )}
          </div>
          {!summary.isComplete && (
            <div style={{ ...mutedText(TYPE.xs), marginTop: "0.4rem" }}>
              {(summary.openWeight * 100).toFixed(0)}% of grade remaining — see scenarios below.
            </div>
          )}
        </div>
      )}

      {/* Final scenarios */}
      {scenarios.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ ...mutedText(TYPE.xs), textTransform: "uppercase", marginBottom: "0.4rem" }}>
            Scenarios on remaining work
          </div>
          <div style={{ display: "flex", gap: "0.4rem", flexWrap: "wrap" }}>
            {scenarios.map(s => (
              <div key={s.scenarioPct} style={{
                fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.3rem 0.5rem",
                border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE.card,
                display: "flex", alignItems: "center", gap: "0.4rem",
              }}>
                <span style={{ color: TEXT.muted }}>{s.scenarioPct}%</span>
                <span style={{ color: gradeColor(s.letter), fontWeight: 600 }}>{s.letter}</span>
                <span style={{ color: TEXT.muted, fontSize: "0.65rem" }}>({s.finalPct.toFixed(0)})</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Grade scale picker */}
      <ScalePicker plan={plan} persistPlan={persistPlan} />
    </div>
  );
}

function CategoryRow({ cat, onChange, onRemove }) {
  const inputStyle = {
    fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.3rem 0.4rem",
    border: `1px solid ${BORDER}`, borderRadius: 3, background: SURFACE.input,
    width: "100%", boxSizing: "border-box", minHeight: 36,
  };
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "1.6fr 0.6fr 0.7fr 0.5fr 0.7fr 36px",
      gap: "0.3rem", alignItems: "center", marginBottom: "0.3rem",
    }}>
      <input
        aria-label="category name"
        value={cat.name || ""}
        onChange={(e) => onChange({ name: e.target.value })}
        placeholder="Exam 1, HW..."
        style={inputStyle}
      />
      <input
        aria-label="weight percent"
        type="number" inputMode="decimal" min="0" max="100"
        value={cat.weight ?? ""}
        onChange={(e) => onChange({ weight: e.target.value })}
        placeholder="%"
        style={{ ...inputStyle, textAlign: "right" }}
      />
      <input
        aria-label="score earned"
        type="number" inputMode="decimal" min="0"
        value={cat.scoreEarned ?? ""}
        onChange={(e) => onChange({ scoreEarned: e.target.value, scenario: "" })}
        placeholder="got"
        style={{ ...inputStyle, textAlign: "right" }}
      />
      <span style={{ ...mutedText(TYPE.xs), textAlign: "center" }}>/</span>
      <input
        aria-label="score out of"
        type="number" inputMode="decimal" min="0"
        value={cat.scoreOut ?? ""}
        onChange={(e) => onChange({ scoreOut: e.target.value })}
        placeholder="of"
        style={{ ...inputStyle, textAlign: "right" }}
      />
      <button
        type="button"
        onClick={onRemove}
        aria-label="remove category"
        style={{
          background: "transparent", border: "none", cursor: "pointer", color: TEXT.muted,
          fontSize: TYPE.lg, minHeight: 36, minWidth: 36,
        }}>
        ×
      </button>
      {/* Scenario row when no earned score */}
      {(!cat.scoreEarned || !cat.scoreOut) && (
        <div style={{ gridColumn: "3 / 6", display: "flex", alignItems: "center", gap: "0.3rem", marginTop: "0.15rem" }}>
          <span style={{ ...mutedText(TYPE.xs), whiteSpace: "nowrap" }}>or scenario %:</span>
          <input
            aria-label="scenario percent"
            type="number" inputMode="decimal" min="0" max="100"
            value={cat.scenario ?? ""}
            onChange={(e) => onChange({ scenario: e.target.value })}
            placeholder="e.g. 85"
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}

// ── Custom grade scale picker ───────────────────────────────────────────────
function ScalePicker({ plan, persistPlan }) {
  const usingCustom = Array.isArray(plan.scaleOverride) && plan.scaleOverride.length > 0;
  const [open, setOpen] = useState(false);
  const scale = usingCustom ? plan.scaleOverride : DEFAULT_SCALE;

  const updateMin = (idx, val) => {
    const next = scale.map((tier, i) => i === idx ? { ...tier, min: Number(val) || 0 } : tier);
    persistPlan({ ...plan, scaleOverride: next });
  };

  const reset = () => persistPlan({ ...plan, scaleOverride: null });

  return (
    <div style={{ marginTop: "0.8rem" }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
        style={{
          fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.3rem 0.5rem",
          background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4,
          cursor: "pointer", color: TEXT.secondary,
        }}>
        scale: {usingCustom ? "custom" : "LUC default"} {open ? "▴" : "▾"}
      </button>
      {open && (
        <div style={{ marginTop: "0.5rem", padding: "0.6rem", background: SURFACE.input, borderRadius: 4 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "0.3rem" }}>
            {scale.map((tier, i) => (
              <div key={tier.letter} style={{ display: "flex", alignItems: "center", gap: "0.2rem" }}>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 600, width: 24 }}>{tier.letter}</span>
                <input
                  aria-label={`min for ${tier.letter}`}
                  type="number" inputMode="decimal" min="0" max="100"
                  value={tier.min}
                  onChange={(e) => updateMin(i, e.target.value)}
                  style={{
                    fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.3rem",
                    border: `1px solid ${BORDER}`, borderRadius: 3, background: SURFACE.card,
                    width: "100%", minWidth: 0, boxSizing: "border-box",
                  }}
                />
              </div>
            ))}
          </div>
          {usingCustom && (
            <button
              type="button"
              onClick={reset}
              style={{
                marginTop: "0.5rem",
                fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.3rem 0.5rem",
                background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4,
                cursor: "pointer", color: TEXT.muted,
              }}>
              reset to LUC default
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Past courses list ───────────────────────────────────────────────────────
function PastCoursesList({ courses, onUpdateGrade }) {
  // Group by semester (descending), Transfer last
  const groups = useMemo(() => {
    const m = {};
    for (const c of courses) {
      const key = c.semester || "Unknown";
      if (!m[key]) m[key] = [];
      m[key].push(c);
    }
    const keys = Object.keys(m).sort((a, b) => termOrderClient(b) - termOrderClient(a));
    return keys.map(k => ({ name: k, courses: m[k] }));
  }, [courses]);

  if (groups.length === 0) return <EmptyState>No past courses yet.</EmptyState>;

  const missingCount = courses.filter(c => c.status !== "transfer" && c.status !== "planned" && !c.grade).length;

  return (
    <div>
      {missingCount > 0 && (
        <div style={{ ...mutedText(TYPE.xs), marginBottom: "0.5rem" }}>
          {missingCount} {missingCount === 1 ? "course" : "courses"} missing a grade.
        </div>
      )}
      {groups.map(g => (
        <div key={g.name} style={{ marginBottom: "1rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.3rem", color: TEXT.secondary }}>
            {g.name}
          </div>
          <div style={{ ...cardStyle }}>
            {g.courses.map((c, i) => (
              <PastCourseRow
                key={`${c.code}__${c.semester}`}
                course={c}
                isFirst={i === 0}
                onUpdateGrade={onUpdateGrade}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function PastCourseRow({ course, isFirst, onUpdateGrade }) {
  const isTransfer = course.status === "transfer";
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "0.6rem",
      padding: "0.6rem 0.9rem",
      borderTop: isFirst ? "none" : `1px solid ${BORDER}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600 }}>
          {course.code}
          {isTransfer && (
            <span style={{ ...mutedText(TYPE.xs), marginLeft: 6, padding: "1px 5px", background: SURFACE.hover, borderRadius: 3 }}>TR</span>
          )}
        </div>
        {course.title && (
          <div style={{ ...mutedText(TYPE.xs), overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {course.title}
          </div>
        )}
      </div>
      <span style={{ ...mutedText(TYPE.xs), flexShrink: 0 }}>
        {course.credits != null ? `${course.credits}cr` : "—"}
      </span>
      {isTransfer ? (
        <span style={{ ...mutedText(TYPE.xs), width: 64, textAlign: "center" }}>—</span>
      ) : (
        <select
          aria-label={`grade for ${course.code}`}
          value={course.grade || ""}
          onChange={(e) => onUpdateGrade(course.code, course.semester, e.target.value || null)}
          style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.35rem",
            border: `1px solid ${BORDER}`, borderRadius: 3, background: SURFACE.input,
            width: 64, color: gradeColor(course.grade), fontWeight: course.grade ? 600 : 400,
            minHeight: 36,
          }}>
          <option value="">—</option>
          {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
        </select>
      )}
    </div>
  );
}
