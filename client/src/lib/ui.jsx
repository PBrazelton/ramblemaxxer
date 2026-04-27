/**
 * client/src/lib/ui.jsx
 * Shared UI primitives and constants.
 */
import { useEffect, useRef, useState } from "react";

// ── Design Tokens ───────────────────────────────────────────────────────────

// Program identity colors
export const COLORS = {
  "PLSC-BA": "#8b4a3a", "GLST-BA": "#1a7a5a", "CORE": "#7a4a1a",
  "CAS-GRAD": "#5a6a7a", "SPAN-LANG": "#6f42c1",
  // Modeled programs
  "PHIL-BA": "#7a4a8a", "HIST-BA": "#8a6a2a", "ENGL-BA": "#2a6a8a",
  "SPAN-BA": "#9a4a6a", "THEO-BA": "#5a4a7a", "ANTH-BA": "#4a7a6a",
  "FNAR-BA": "#c47a2a",
  // Minors
  "LATN-MIN": "#6a5a4a", "PHIL-MIN": "#7a5a9a",
};
// Deterministic color for unknown programs based on code hash
export const programColor = (code) => {
  if (COLORS[code]) return COLORS[code];
  // Generate a warm muted color from the code string
  let hash = 0;
  for (let i = 0; i < (code || "").length; i++) hash = ((hash << 5) - hash + code.charCodeAt(i)) | 0;
  const hue = ((hash & 0xFFFF) % 360);
  return `hsl(${hue}, 35%, 40%)`;
};

// Course/requirement status colors
export const STATUS_COLOR = {
  complete: "#22863a", enrolled: "#b08800",
  planned: "#6f42c1", transfer: "#5a6a7a", waived: "#bbb",
};

// Typography
export const FONT = { serif: "'Source Serif 4', Georgia, serif", mono: "'DM Mono', monospace" };
export const TYPE = {
  xs: "0.7rem",      // badges, tiny labels (was 0.55)
  sm: "0.8rem",      // secondary text, mono data (was 0.65)
  base: "0.9rem",    // body text, inputs (was 0.75)
  md: "1rem",        // section titles, card headers (was 0.85)
  lg: "1.15rem",     // page section titles (was 1)
  xl: "1.3rem",      // subsection headings (was 1.1)
  xxl: "1.5rem",     // page headings (was 1.3)
  display: "1.8rem", // logo (unchanged)
};

// Surfaces and backgrounds
export const BG = "#fffbf0";
export const BORDER = "#e8e4df";
export const SURFACE = {
  page: "#fffbf0",
  card: "#fff",
  input: "#fafaf8",
  hover: "#f5f0e8",
  overlay: "rgba(0,0,0,0.3)",
};

// Text colors (all meet WCAG AA 4.5:1 on page/card backgrounds)
export const TEXT = {
  primary: "#1a1a1a",
  secondary: "#5a5550",
  muted: "#706b66",    // was #888 (3.5:1) — now 4.5:1 on #fffbf0
  disabled: "#9a9590",
  inverse: "#fff",
  danger: "#c43b2d",
  success: "#22863a",
  warning: "#8a6d00",  // was #b08800 (3.9:1) — now 4.5:1 on #fff
  link: "#6f42c1",
  brand: "#800000",   // Loyola maroon — logo accent
};

// Button colors
export const BTN = {
  primary: "#1a1a1a",
  danger: "#c43b2d",
  disabled: "#ccc",
};

// Shadows
export const SHADOW = {
  card: "0 2px 12px rgba(0,0,0,0.06)",
  sheet: "0 -8px 32px rgba(0,0,0,0.15)",
  button: "0 2px 8px rgba(0,0,0,0.2)",
};

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
  centered: { display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", padding: "1rem", background: SURFACE.page },
  card: { background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8, padding: "2.5rem", width: "100%", maxWidth: 360, boxShadow: SHADOW.card },
  logo: { fontFamily: FONT.serif, fontSize: TYPE.display, fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.25rem" },
  tagline: { fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: "1.5rem" },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  input: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.6rem 0.8rem", border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE.input, outline: "none" },
  button: { fontFamily: FONT.mono, fontSize: "0.9rem", padding: "0.65rem", background: BTN.primary, color: TEXT.inverse, border: "none", borderRadius: 4, cursor: "pointer" },
  error: { fontFamily: FONT.mono, fontSize: "0.8rem", color: TEXT.danger, padding: "0.5rem", background: "#fdf0ed", borderRadius: 4 },
};

// ── Reusable style objects (common patterns used 5+ times) ──────────────────

// Spacing rhythm — 3 tiers for zone-based layout
export const SPACING = {
  tight: "0.5rem",    // within a zone group
  normal: "0.75rem",  // between substantial cards (ProgramCards)
  zone: "1.75rem",    // between zone groups
};

// Card container — white card with border, used for dashboard cards, planner buckets, admin rows
export const cardStyle = { background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 8 };

// Secondary card — lighter weight for informational/reference sections (parchment shows through)
export const secondaryCardStyle = { ...cardStyle, background: "transparent" };

// Badge — small inline label with background
export const badgeStyle = (bg, color) => ({
  fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", borderRadius: 3,
  background: bg, color,
});

// Section header — serif bold title
export const sectionHeader = (size = TYPE.lg) => ({
  fontFamily: FONT.serif, fontSize: size, fontWeight: 700,
});

// Muted text — mono small gray
export const mutedText = (size = TYPE.sm) => ({
  fontFamily: FONT.mono, fontSize: size, color: TEXT.muted,
});

// Select input — for filter dropdowns
export const selectStyle = {
  fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.25rem 0.3rem",
  border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE.input,
};

// ── Grade color ─────────────────────────────────────────────────────────────
// Used for past-courses table and projected letter chips on syllabus cards.
export function gradeColor(letter) {
  if (!letter) return TEXT.muted;
  if (letter === "A" || letter === "A-") return "#22863a";
  if (letter === "B+" || letter === "B" || letter === "B-") return TEXT.secondary;
  if (letter === "C+" || letter === "C" || letter === "C-") return "#8a6d00";
  if (letter === "D+" || letter === "D" || letter === "D-" || letter === "F" || letter === "WF") return TEXT.danger;
  // Non-GPA grades (P, NP, W, I, AU, NR, IP) — neutral
  return TEXT.muted;
}

// ── NavMenu (kebab dropdown for header) ─────────────────────────────────────
// items: [{ label, href, color?, current? }]
export function NavMenu({ items }) {
  const [open, setOpen] = useState(false);

  // Close on outside click + Escape
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("click", close);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div style={{ position: "relative" }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        aria-label="Open navigation menu"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        style={{
          fontFamily: FONT.mono, fontSize: TYPE.lg, padding: "0.3rem 0.7rem",
          background: open ? SURFACE.hover : "transparent",
          border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer",
          color: TEXT.primary, minHeight: 44, minWidth: 44,
          display: "flex", alignItems: "center", justifyContent: "center",
          letterSpacing: "0.1em",
        }}
      >
        &#x22EF;
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: "absolute", right: 0, top: "calc(100% + 4px)",
            background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 6,
            boxShadow: SHADOW.card, padding: "0.3rem", minWidth: 160, zIndex: 60,
          }}
        >
          {items.map((item, i) => (
            <a
              key={i}
              href={item.href}
              role="menuitem"
              onClick={() => setOpen(false)}
              style={{
                display: "block", padding: "0.5rem 0.7rem",
                fontFamily: FONT.mono, fontSize: TYPE.sm, textDecoration: "none",
                color: item.current ? TEXT.muted : TEXT.primary,
                background: item.current ? SURFACE.hover : "transparent",
                borderRadius: 4, minHeight: 40, lineHeight: "1.6",
                cursor: item.current ? "default" : "pointer",
                pointerEvents: item.current ? "none" : "auto",
              }}
            >
              {item.color && (
                <span style={{
                  display: "inline-block", width: 8, height: 8, borderRadius: "50%",
                  background: item.color, marginRight: 8, verticalAlign: "middle",
                }} />
              )}
              {item.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Logo header ─────────────────────────────────────────────────────────────
export function StickyHeader({ user, badge, onLogout, onSettings, nav }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: BG, borderBottom: `1px solid ${BORDER}`, padding: "0.6rem 1rem", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <h1 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, margin: 0, letterSpacing: "-0.02em" }}>
        <span>ramble</span><span style={{ color: TEXT.brand }}>maxxer</span>
        {badge && <span style={{ marginLeft: 8, fontSize: "0.6rem", fontFamily: FONT.mono, background: "#1a1a1a", color: "#fff", padding: "2px 8px", borderRadius: 3, verticalAlign: "middle" }}>{badge}</span>}
      </h1>
      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
        {nav}
        {onSettings ? (
          <button onClick={onSettings} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.6rem", background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer", color: TEXT.secondary, minHeight: 44, display: "flex", alignItems: "center", gap: "0.3rem", maxWidth: 180, overflow: "hidden" }} title="Settings" aria-label="Open settings">
            <span style={{ fontSize: TYPE.base, flexShrink: 0 }}>&#9881;</span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{user.name}</span>
          </button>
        ) : (
          <>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.secondary }}>{user.name}</span>
            {onLogout && (
              <button onClick={onLogout} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", padding: "0.3rem 0.7rem", background: BTN.primary, color: TEXT.inverse, border: "none", borderRadius: 4, cursor: "pointer" }}>
                log out
              </button>
            )}
          </>
        )}
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
  const dialogRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    // Save previously focused element
    previousFocusRef.current = document.activeElement;

    // Focus first focusable element inside dialog, or the dialog itself
    const dialog = dialogRef.current;
    if (dialog) {
      const focusable = dialog.querySelector('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      if (focusable) focusable.focus();
      else dialog.focus();
    }

    // Escape key handler
    const handleKeyDown = (e) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      // Restore focus to previously focused element
      if (previousFocusRef.current && typeof previousFocusRef.current.focus === "function") {
        previousFocusRef.current.focus();
      }
    };
  }, [onClose]);

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: SURFACE.overlay, zIndex: 100, display: "flex", alignItems: "flex-end", justifyContent: "center", animation: "fadeIn 0.15s ease-out" }}>
      <div ref={dialogRef} role="dialog" aria-modal="true" tabIndex={-1} onClick={e => e.stopPropagation()} style={{ background: SURFACE.card, borderRadius: "16px 16px 0 0", padding: "1.5rem", width: "100%", maxWidth, maxHeight: "80vh", overflow: "auto", outline: "none", animation: "slideUp 0.25s ease-out" }}>
        <div style={{ width: 40, height: 4, borderRadius: 2, background: BORDER, margin: "0 auto 1rem" }} />
        {children}
      </div>
    </div>
  );
}

// ── Empty state ─────────────────────────────────────────────────────────────
export function EmptyState({ children }) {
  return (
    <div style={{ ...mutedText(TYPE.base), textAlign: "center", padding: "2rem" }} role="status">
      {children}
    </div>
  );
}
