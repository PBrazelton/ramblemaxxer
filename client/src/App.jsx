import { useState, useEffect, useCallback, useMemo } from "react";

// ── Constants ───────────────────────────────────────────────────────────────
const COLORS = {
  "PLSC-BA": "#c43b2d", "GLST-BA": "#1a7a5a", "CORE": "#7a4a1a",
  "CAS-GRAD": "#5a6a7a", "SPAN-LANG": "#6f42c1",
};
const STATUS_COLOR = {
  complete: "#22863a", enrolled: "#b08800",
  planned: "#6f42c1", transfer: "#5a6a7a", waived: "#bbb",
};
const FONT = { serif: "'Source Serif 4', Georgia, serif", mono: "'DM Mono', monospace" };
const BG = "#fffbf0";
const BORDER = "#e8e4df";

// ── API helpers ─────────────────────────────────────────────────────────────
const api = {
  get: (url) => fetch(url, { credentials: "include" }).then(r => r.json()),
  post: (url, body) => fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  put: (url, body) => fetch(url, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
};

// ── Router ──────────────────────────────────────────────────────────────────
function getPage() {
  const hash = window.location.hash.slice(1) || "/";
  if (hash.startsWith("/register")) return "register";
  return hash === "/login" ? "login" : "dashboard";
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(getPage());

  useEffect(() => {
    window.addEventListener("hashchange", () => setPage(getPage()));
    api.get("/api/auth/me")
      .then(u => { setUser(u?.id ? u : false); setLoading(false); })
      .catch(() => { setUser(false); setLoading(false); });
  }, []);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: "#888" }}>loading...</span>
    </div>
  );
  if (!user && page !== "register") return <LoginPage onLogin={setUser} />;
  if (page === "register") return <RegisterPage onRegister={setUser} />;
  return <Dashboard user={user} onLogout={() => setUser(false)} />;
}

// ── Login Page ──────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault(); setError("");
    const res = await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (res.ok) onLogin(data); else setError(data.error);
  };

  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}><span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span></h1>
        <p style={styles.tagline}>stop guessing, start maxxing</p>
        <form onSubmit={submit} style={styles.form}>
          <input style={styles.input} type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} required />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit">log in</button>
        </form>
      </div>
    </div>
  );
}

// ── Register Page ───────────────────────────────────────────────────────────
function RegisterPage({ onRegister }) {
  const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
  const [form, setForm] = useState({ email: "", name: "", password: "", grad_year: "", token });
  const [error, setError] = useState("");
  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault(); setError("");
    const res = await fetch("/api/auth/register", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...form, grad_year: parseInt(form.grad_year) || null }) });
    const data = await res.json();
    if (res.ok) { onRegister(data); window.location.hash = "/"; } else setError(data.error);
  };

  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}><span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span></h1>
        <p style={styles.tagline}>create your account</p>
        <form onSubmit={submit} style={styles.form}>
          <input style={styles.input} placeholder="name" value={form.name} onChange={set("name")} required />
          <input style={styles.input} type="email" placeholder="email" value={form.email} onChange={set("email")} required />
          <input style={styles.input} type="password" placeholder="password" value={form.password} onChange={set("password")} required />
          <input style={styles.input} placeholder="graduation year (e.g. 2027)" value={form.grad_year} onChange={set("grad_year")} />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit">create account</button>
        </form>
      </div>
    </div>
  );
}

// ── ProgressRing ────────────────────────────────────────────────────────────
function ProgressRing({ value, max, size = 80, stroke = 6, color = "#22863a" }) {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={BORDER} strokeWidth={stroke} />
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={circ} strokeDashoffset={circ * (1 - pct)} strokeLinecap="round" />
    </svg>
  );
}

// ── CreditMeter ─────────────────────────────────────────────────────────────
function CreditMeter({ credits }) {
  const { total, complete, enrolled, planned } = credits;
  const max = 120;
  const pctC = (complete / max) * 100, pctE = (enrolled / max) * 100, pctP = (planned / max) * 100;

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1.2rem", marginBottom: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1.2rem" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <ProgressRing value={total} max={max} size={80} color={total >= max ? "#22863a" : "#b08800"} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: "1rem", fontWeight: 700 }}>{total}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888" }}>/ {max}</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Credit Hours</div>
          <div style={{ height: 12, borderRadius: 6, background: "#eee", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${pctC}%`, background: STATUS_COLOR.complete }} />
            <div style={{ width: `${pctE}%`, background: STATUS_COLOR.enrolled }} />
            <div style={{ width: `${pctP}%`, background: STATUS_COLOR.planned }} />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.4rem", fontFamily: FONT.mono, fontSize: "0.65rem", color: "#666" }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.complete, marginRight: 4 }} />{complete} earned</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.enrolled, marginRight: 4 }} />{enrolled} enrolled</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.planned, marginRight: 4 }} />{planned} planned</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", marginTop: "0.3rem" }}>
            {max - total > 0 ? `${max - total} credits remaining` : "Credit requirement met"}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ProgramCard ─────────────────────────────────────────────────────────────
function ProgramCard({ prog, conflicts, onPipClick, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const color = COLORS[prog.code] || "#444";
  const filledSlots = prog.categories.reduce((s, c) => s + (c.filledCount || 0), 0);
  const totalSlots = prog.categories.reduce((s, c) => s + c.slotsNeeded, 0);

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: "0.75rem", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.8rem 1rem", cursor: "pointer", borderLeft: `4px solid ${color}` }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <ProgressRing value={filledSlots} max={totalSlots} size={48} stroke={4} color={color} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700 }}>
            {filledSlots}/{totalSlots}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, color }}>{prog.name}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888" }}>
            {filledSlots}/{totalSlots} categories{prog.totalCredits ? ` · ${prog.creditsApplied || 0}/${prog.totalCredits} cr` : ""}
          </div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#aaa", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "0 1rem 0.8rem 1rem" }}>
          {prog.categories.map((cat, i) => (
            <CategoryRow key={i} cat={cat} color={color} conflicts={conflicts} onPipClick={onPipClick} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── CategoryRow ─────────────────────────────────────────────────────────────
function CategoryRow({ cat, color, conflicts, onPipClick }) {
  const hasConflict = cat.slots.some(s => conflicts[s.code]);

  // Build pip list — coversBothTiers slots expand to fill both positions
  const pips = [];
  let slotIdx = 0;
  for (let i = 0; i < cat.slotsNeeded; i++) {
    const slot = cat.slots[slotIdx];
    if (!slot) { pips.push(<EmptyPip key={i} />); continue; }
    if (slot.code === "WAIVED") { pips.push(<WaivedPip key={i} />); slotIdx++; continue; }
    if (slot.coversBothTiers) {
      // Render two pips from one slot entry
      const isConflict = conflicts[slot.code];
      const label = i === (pips.length) ? "T1" : "T2";
      pips.push(<FilledPip key={i} slot={slot} color={color} isConflict={!!isConflict} label={label}
        onClick={isConflict ? () => onPipClick(slot.code, slot.title, isConflict) : undefined} />);
      if (label === "T2") slotIdx++;
      continue;
    }
    const isConflict = conflicts[slot.code];
    pips.push(<FilledPip key={i} slot={slot} color={color} isConflict={!!isConflict}
      onClick={isConflict ? () => onPipClick(slot.code, slot.title, isConflict) : undefined} />);
    slotIdx++;
  }

  return (
    <div style={{ padding: "0.5rem 0", borderTop: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>
          {cat.name}
          {cat.isWaived && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#f0ede8", padding: "1px 6px", borderRadius: 3, color: "#888" }}>waived</span>}
          {hasConflict && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#fff3cd", padding: "1px 6px", borderRadius: 3, color: "#856404" }}>conflict</span>}
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: cat.isSatisfied ? "#22863a" : "#b08800", fontWeight: 600 }}>
          {cat.filledCount || 0}/{cat.slotsNeeded}
        </span>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>{pips}</div>
    </div>
  );
}

function FilledPip({ slot, color, isConflict, onClick, label }) {
  return (
    <div onClick={onClick} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "3px 8px", borderRadius: 4, fontSize: "0.65rem", fontFamily: FONT.mono,
      background: `${color}12`, border: `1px solid ${isConflict ? "#ffc107" : color + "40"}`,
      cursor: isConflict ? "pointer" : "default", boxShadow: isConflict ? "0 0 0 1px #ffc107" : "none",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[slot.status] || "#888", flexShrink: 0 }} />
      {slot.code}
      {label && <span style={{ fontSize: "0.5rem", opacity: 0.6 }}>{label}</span>}
      {isConflict && <span style={{ fontSize: "0.55rem" }}>&#x27F7;</span>}
    </div>
  );
}

function EmptyPip() {
  return <div style={{ width: 60, height: 24, borderRadius: 4, border: `1.5px dashed #ccc`, background: "transparent" }} />;
}

function WaivedPip() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 60, height: 24, borderRadius: 4, background: "#f5f0e8", border: `1px solid ${BORDER}`, fontSize: "0.6rem", color: "#888" }}>
      &#10003; waived
    </div>
  );
}

// ── OverlapBudget ───────────────────────────────────────────────────────────
function OverlapBudget({ overlaps, conflicts }) {
  const { glstMajorUsed, glstMajorMax, glstElectiveDeptUsage, glstElectiveDeptMax } = overlaps;
  const overBudget = glstMajorUsed > glstMajorMax;
  const depts = Object.entries(glstElectiveDeptUsage);

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.6rem" }}>Overlap Budget</div>

      <div style={{ marginBottom: "0.8rem" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>PLSC &#x2194; GLST double-counts</span>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", padding: "1px 8px", borderRadius: 10, background: overBudget ? "#fde8e8" : "#e8f5e9", color: overBudget ? "#c43b2d" : "#22863a", fontWeight: 600 }}>
            {glstMajorUsed}/{glstMajorMax}
          </span>
        </div>
        {Object.keys(conflicts).length > 0 && (
          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginBottom: "0.4rem" }}>
            Tap a conflicted course to pin it to one program
          </div>
        )}
        <div style={{ display: "flex", gap: "0.3rem" }}>
          {Array.from({ length: glstMajorMax }).map((_, i) => (
            <div key={i} style={{
              width: 32, height: 20, borderRadius: 4,
              background: i < glstMajorUsed ? "linear-gradient(135deg, #c43b2d, #1a7a5a)" : "#eee",
              border: `1px solid ${i < glstMajorUsed ? "#c43b2d40" : "#ddd"}`,
            }} />
          ))}
          {overBudget && <div style={{ width: 32, height: 20, borderRadius: 4, background: "#c43b2d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "#fff", fontFamily: FONT.mono }}>!</div>}
        </div>
      </div>

      {depts.length > 0 && (
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.3rem" }}>
            Dept spread ({depts.length} dept{depts.length !== 1 ? "s" : ""} · {glstElectiveDeptMax} max per dept)
          </div>
          {depts.map(([dept, count]) => (
            <div key={dept} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", width: 40, textAlign: "right", color: "#666" }}>{dept}</span>
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: glstElectiveDeptMax }).map((_, i) => (
                  <div key={i} style={{ width: 20, height: 10, borderRadius: 2, background: i < count ? (count >= glstElectiveDeptMax ? "#c43b2d" : COLORS["GLST-BA"]) : "#eee" }} />
                ))}
              </div>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: count >= glstElectiveDeptMax ? "#c43b2d" : "#888" }}>{count}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── CASCard ─────────────────────────────────────────────────────────────────
function CASCard({ casGrad, spanLang }) {
  const [open, setOpen] = useState(false);
  if (!casGrad && !spanLang) return null;

  const allCats = [...(casGrad?.categories || []), ...(spanLang?.categories || [])];
  const filled = allCats.reduce((s, c) => s + (c.isSatisfied ? 1 : 0), 0);

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, marginBottom: "0.75rem", overflow: "hidden" }}>
      <div onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.8rem 1rem", cursor: "pointer", borderLeft: `4px solid ${COLORS["CAS-GRAD"]}` }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, color: COLORS["CAS-GRAD"] }}>Graduation Requirements</div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888" }}>{filled}/{allCats.length} satisfied</div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#aaa", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </div>
      {open && (
        <div style={{ padding: "0 1rem 0.8rem" }}>
          {casGrad && casGrad.categories.map((cat, i) => (
            <div key={i} style={{ padding: "0.4rem 0", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>{cat.name}</div>
                {cat.slots.length > 0 && (
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginTop: 2 }}>
                    {cat.slots.map(s => s.code).join(", ")}
                  </div>
                )}
              </div>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: cat.isSatisfied ? "#22863a" : "#b08800", fontWeight: 600 }}>
                {cat.isSatisfied ? "done" : `${cat.filledCount || 0}/${cat.slotsNeeded}`}
              </span>
            </div>
          ))}
          {spanLang && (
            <div style={{ padding: "0.5rem 0", borderTop: `1px solid ${BORDER}` }}>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, marginBottom: "0.3rem", color: COLORS["SPAN-LANG"] }}>Spanish Sequence</div>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {["SPAN 102", "SPAN 103", "SPAN 104"].map(code => {
                  const slot = spanLang.categories[0]?.slots.find(s => s.code === code);
                  return (
                    <div key={code} style={{
                      padding: "3px 8px", borderRadius: 4, fontSize: "0.65rem", fontFamily: FONT.mono,
                      background: slot ? `${COLORS["SPAN-LANG"]}15` : "#f5f0e8",
                      border: `1px solid ${slot ? COLORS["SPAN-LANG"] + "40" : "#ddd"}`,
                      color: slot ? "#333" : "#aaa",
                    }}>
                      {slot && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[slot.status], marginRight: 4 }} />}
                      {code}
                    </div>
                  );
                })}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#888", marginTop: "0.3rem" }}>
                SPAN 102 satisfies CAS · SPAN 104 satisfies GLST · does not count toward 33 major credits
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RemainingCard ───────────────────────────────────────────────────────────
function RemainingCard({ remaining }) {
  if (!remaining || remaining.length === 0) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Remaining</div>
      {remaining.map((r, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0", fontFamily: FONT.mono, fontSize: "0.7rem" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[r.program] || "#888", flexShrink: 0 }} />
          <span style={{ color: "#444" }}>{r.category}</span>
          <span style={{ color: "#888", marginLeft: "auto", fontSize: "0.6rem" }}>{r.programName} · {r.needed} needed</span>
        </div>
      ))}
    </div>
  );
}

// ── SuggestionsCard ─────────────────────────────────────────────────────────
function SuggestionsCard({ suggestions }) {
  if (!suggestions || suggestions.length === 0) return null;
  const top = suggestions.slice(0, 8);
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>High-Efficiency Suggestions</div>
      {top.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "flex-start", gap: "0.5rem", padding: "0.4rem 0", borderTop: i ? `1px solid ${BORDER}` : "none" }}>
          <span style={{
            fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 700, width: 22, height: 22, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: s.boxCount >= 3 ? "linear-gradient(135deg, #c43b2d, #1a7a5a)" : "#e8e4df",
            color: s.boxCount >= 3 ? "#fff" : "#444",
          }}>{s.boxCount}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600 }}>
              {s.code} <span style={{ fontWeight: 400, color: "#666" }}>{s.title}</span>
              {s.writing_intensive && <span style={{ marginLeft: 4, fontSize: "0.55rem", background: "#e3f2fd", padding: "1px 4px", borderRadius: 2, color: "#1565c0" }}>WI</span>}
              {s.engaged_learning && <span style={{ marginLeft: 4, fontSize: "0.55rem", background: "#f3e5f5", padding: "1px 4px", borderRadius: 2, color: "#7b1fa2" }}>EL</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.2rem" }}>
              {s.fills.map((f, j) => (
                <span key={j} style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#f5f0e8", padding: "1px 5px", borderRadius: 3, color: "#666" }}>{f}</span>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── PinModal ────────────────────────────────────────────────────────────────
function PinModal({ code, title, programs, onPin, onClose }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px 16px 0 0", padding: "1.5rem", width: "100%", maxWidth: 400, maxHeight: "60vh", overflow: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "0 auto 1rem" }} />
        <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.2rem" }}>Pin course to one program</div>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.1rem" }}>{code}</div>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", marginBottom: "1rem" }}>{title}</div>

        <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          {programs.map(p => (
            <button key={p} onClick={() => onPin(code, p)} style={{
              fontFamily: FONT.mono, fontSize: "0.85rem", padding: "0.7rem",
              background: COLORS[p] || "#444", color: "#fff", border: "none", borderRadius: 6, cursor: "pointer",
            }}>
              Pin to {p}
            </button>
          ))}
          <button onClick={() => onPin(code, null)} style={{
            fontFamily: FONT.mono, fontSize: "0.8rem", padding: "0.6rem",
            background: "#f5f0e8", color: "#666", border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer",
          }}>
            Let solver decide automatically
          </button>
          <button onClick={onClose} style={{
            fontFamily: FONT.mono, fontSize: "0.75rem", padding: "0.5rem",
            background: "transparent", color: "#aaa", border: "none", cursor: "pointer",
          }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ user, onLogout }) {
  const [data, setData] = useState(null);
  const [pinModal, setPinModal] = useState(null);

  const refresh = useCallback(() => {
    api.get("/api/students/me/solve").then(setData);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  const conflicts = useMemo(() => {
    if (!data) return {};
    return Object.entries(data.slotAssignments || {}).reduce((acc, [code, asgns]) => {
      const progs = new Set(asgns.map(a => a.programCode));
      // Only flag as conflict if course fills slots in BOTH major programs
      if (progs.has("PLSC-BA") && progs.has("GLST-BA")) {
        acc[code] = [...progs].filter(p => p === "PLSC-BA" || p === "GLST-BA");
      }
      return acc;
    }, {});
  }, [data]);

  const handlePin = async (code, pinnedProgram) => {
    const safeCode = code.replace(" ", "-");
    await api.put(`/api/students/me/courses/${safeCode}`, { pinnedProgram });
    setPinModal(null);
    refresh();
  };

  const handlePipClick = (code, title, programs) => {
    setPinModal({ code, title, programs });
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    onLogout();
  };

  if (!data) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: "#888" }}>computing...</span>
    </div>
  );

  const majorOrder = ["PLSC-BA", "GLST-BA", "CORE"];
  const majors = majorOrder.map(code => data.programs[code]).filter(Boolean);

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      {/* Sticky header */}
      <div style={{ position: "sticky", top: 0, zIndex: 50, background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.6rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h1 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
          <span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span>
        </h1>
        <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", color: "#666" }}>{user.name}</span>
          <button onClick={logout} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.7rem", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
            log out
          </button>
        </div>
      </div>

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem" }}>
        <CreditMeter credits={data.credits} />

        {data.overlaps.glstMajorUsed > data.overlaps.glstMajorMax && (
          <div style={{ background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 8, padding: "0.7rem 1rem", marginBottom: "0.75rem", fontFamily: FONT.mono, fontSize: "0.75rem", color: "#721c24" }}>
            Over budget: {data.overlaps.glstMajorUsed} PLSC/GLST overlaps (max {data.overlaps.glstMajorMax}). Pin courses to fix.
          </div>
        )}

        {majors.map(prog => (
          <ProgramCard key={prog.code} prog={prog} conflicts={conflicts} onPipClick={handlePipClick}
            defaultOpen={prog.code === "PLSC-BA" || prog.code === "GLST-BA"} />
        ))}

        <OverlapBudget overlaps={data.overlaps} conflicts={conflicts} />

        <CASCard casGrad={data.programs["CAS-GRAD"]} spanLang={data.programs["SPAN-LANG"]} />

        <RemainingCard remaining={data.remaining} />

        <SuggestionsCard suggestions={data.suggestions} />
      </div>

      {pinModal && (
        <PinModal code={pinModal.code} title={pinModal.title} programs={pinModal.programs}
          onPin={handlePin} onClose={() => setPinModal(null)} />
      )}
    </div>
  );
}

// ── Shared styles ───────────────────────────────────────────────────────────
const styles = {
  centered: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1rem", background: BG },
  card: { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "2.5rem", width: "100%", maxWidth: 360, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
  logo: { fontFamily: FONT.serif, fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.25rem" },
  tagline: { fontFamily: FONT.mono, fontSize: "0.75rem", color: "#888", marginBottom: "1.5rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  input: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.6rem 0.8rem", border: `1px solid #ddd`, borderRadius: 4, background: "#fafaf8", outline: "none" },
  button: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.65rem", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" },
  error: { fontFamily: FONT.mono, fontSize: "0.8rem", color: "#c0392b", padding: "0.5rem", background: "#fdf0ed", borderRadius: 4 },
};
