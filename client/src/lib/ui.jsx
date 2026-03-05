/**
 * client/src/lib/ui.jsx
 * Shared UI primitives and constants.
 */

// ── Constants ───────────────────────────────────────────────────────────────
export const COLORS = {
  "PLSC-BA": "#c43b2d", "GLST-BA": "#1a7a5a", "CORE": "#7a4a1a",
  "CAS-GRAD": "#5a6a7a", "SPAN-LANG": "#6f42c1",
};
export const STATUS_COLOR = {
  complete: "#22863a", enrolled: "#b08800",
  planned: "#6f42c1", transfer: "#5a6a7a", waived: "#bbb",
};
export const FONT = { serif: "'Source Serif 4', Georgia, serif", mono: "'DM Mono', monospace" };
export const BG = "#fffbf0";
export const BORDER = "#e8e4df";

// ── API helpers ─────────────────────────────────────────────────────────────
export const api = {
  get: (url) => fetch(url, { credentials: "include" }).then(r => r.json()),
  post: (url, body) => fetch(url, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  put: (url, body) => fetch(url, { method: "PUT", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(r => r.json()),
  del: (url) => fetch(url, { method: "DELETE", credentials: "include" }).then(r => r.json()),
};

// ── ProgressRing ────────────────────────────────────────────────────────────
export function ProgressRing({ value, max, size = 80, stroke = 6, color = "#22863a" }) {
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

// ── Shared styles ───────────────────────────────────────────────────────────
export const sharedStyles = {
  centered: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1rem", background: BG },
  card: { background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "2.5rem", width: "100%", maxWidth: 360, boxShadow: "0 2px 12px rgba(0,0,0,0.06)" },
  logo: { fontFamily: FONT.serif, fontSize: "1.8rem", fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.25rem" },
  tagline: { fontFamily: FONT.mono, fontSize: "0.75rem", color: "#888", marginBottom: "1.5rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  input: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.6rem 0.8rem", border: "1px solid #ddd", borderRadius: 4, background: "#fafaf8", outline: "none" },
  button: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.65rem", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" },
  error: { fontFamily: FONT.mono, fontSize: "0.8rem", color: "#c0392b", padding: "0.5rem", background: "#fdf0ed", borderRadius: 4 },
};

// ── Logo header ─────────────────────────────────────────────────────────────
export function StickyHeader({ user, badge, onLogout, onSettings }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.6rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h1 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
        <span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span>
        {badge && <span style={{ marginLeft: 8, fontSize: "0.6rem", fontFamily: FONT.mono, background: "#1a1a1a", color: "#fff", padding: "2px 8px", borderRadius: 3, verticalAlign: "middle" }}>{badge}</span>}
      </h1>
      <div style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", color: "#666" }}>{user.name}</span>
        {onSettings && (
          <button onClick={onSettings} style={{ fontFamily: FONT.mono, fontSize: "1rem", padding: "0.2rem 0.4rem", background: "transparent", border: "none", cursor: "pointer", color: "#666" }} title="Settings">
            &#9881;
          </button>
        )}
        <button onClick={onLogout} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.7rem", background: "#1a1a1a", color: "#fff", border: "none", borderRadius: 4, cursor: "pointer" }}>
          log out
        </button>
      </div>
    </div>
  );
}

// ── Input ──────────────────────────────────────────────────────────────────
export function Input(props) {
  return <input {...props} style={{ ...sharedStyles.input, width: "100%", boxSizing: "border-box", ...props.style }} />;
}

// ── Btn ────────────────────────────────────────────────────────────────────
export function Btn({ full, children, ...props }) {
  return (
    <button {...props} style={{ ...sharedStyles.button, width: full ? "100%" : "auto", ...props.style }}>
      {children}
    </button>
  );
}

// ── SectionTitle ───────────────────────────────────────────────────────────
export function SectionTitle({ children }) {
  return (
    <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 700, marginBottom: 12 }}>
      {children}
    </div>
  );
}

// ── ErrMsg ─────────────────────────────────────────────────────────────────
export function ErrMsg({ children }) {
  return <p style={sharedStyles.error}>{children}</p>;
}

// ── Bottom sheet wrapper ────────────────────────────────────────────────────
export function BottomSheet({ onClose, children, maxWidth = 400 }) {
  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.3)", zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: "16px 16px 0 0", padding: "1.5rem", width: "100%", maxWidth, maxHeight: "80vh", overflow: "auto" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: "#ddd", margin: "0 auto 1rem" }} />
        {children}
      </div>
    </div>
  );
}
