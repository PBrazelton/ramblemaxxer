import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { COLORS, programColor, STATUS_COLOR, FONT, TYPE, BG, BORDER, SURFACE, TEXT, BTN, SHADOW, SPACING, api, ProgressRing, BottomSheet, StickyHeader, NavMenu, sharedStyles, Input, Btn, SectionTitle, ErrMsg, cardStyle, secondaryCardStyle, badgeStyle, sectionHeader, mutedText, EmptyState } from "./lib/ui.jsx";
import { getErrors } from "./lib/error-buffer.js";
import AdminPanel from "./pages/AdminPanel.jsx";
import Planner from "./pages/Planner.jsx";
import Grades from "./pages/Grades.jsx";

// ── Helper functions ────────────────────────────────────────────────────────
function getCurrentAcademicTerm() {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
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

// ── Router ──────────────────────────────────────────────────────────────────
function getPage() {
  const hash = window.location.hash.slice(1) || "/";
  if (hash.startsWith("/register")) return "register";
  if (hash.startsWith("/reset-password")) return "reset-password";
  if (hash.startsWith("/forgot-password")) return "forgot-password";
  if (hash.startsWith("/planner")) return "planner";
  if (hash.startsWith("/grades")) return "grades";
  return hash === "/login" ? "login" : "dashboard";
}

// ── App ─────────────────────────────────────────────────────────────────────
export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(getPage());
  const [devPersona, setDevPersona] = useState(null);
  const [onboardingActive, setOnboardingActive] = useState(false);

  useEffect(() => {
    window.addEventListener("hashchange", () => setPage(getPage()));
    api.get("/api/auth/me")
      .then(u => { setUser(u?.id ? u : false); setLoading(false); })
      .catch(() => { setUser(false); setLoading(false); });
  }, []);

  // Check for active dev persona
  useEffect(() => {
    if (import.meta.env.PROD || !user) { setDevPersona(null); return; }
    api.get("/api/dev/personas/current")
      .then(d => setDevPersona(d?.persona || null))
      .catch(() => {});
  }, [user]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: TEXT.muted }}>checking in...</span>
    </div>
  );
  const doLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(false);
    setDevPersona(null);
  };
  const switchPersona = () => { doLogout(); };
  const resetPersona = async () => {
    await api.post("/api/dev/personas/reset");
    window.location.reload();
  };

  if (page === "forgot-password") return <ForgotPasswordPage />;
  if (page === "reset-password") return <ResetPasswordPage />;
  if (!user && page !== "register") return <LoginPage onLogin={setUser} setDevPersona={setDevPersona} />;
  if (page === "register") return <RegisterPage onRegister={setUser} />;

  const banner = devPersona ? <DevBanner persona={devPersona} onSwitch={switchPersona} onReset={resetPersona} /> : null;
  // Hide feedback widget during onboarding (only relevant on dashboard page)
  const hideWidget = page === "dashboard" && onboardingActive;
  const widget = user ? <FeedbackWidget user={user} hidden={hideWidget} /> : null;

  if (user.role === "admin") return <>{banner}{widget}<AdminPanel user={user} onLogout={doLogout} /></>;
  if (page === "planner") return <>{banner}{widget}<Planner user={user} onLogout={doLogout} /></>;
  if (page === "grades") return <>{banner}{widget}<Grades user={user} onLogout={doLogout} /></>;
  return <>{banner}{widget}<Dashboard user={user} setUser={setUser} onLogout={doLogout} setOnboardingActive={setOnboardingActive} /></>;
}

// ── FeedbackWidget ──────────────────────────────────────────────────────────
const FEEDBACK_PULSE_KEYFRAMES = `@keyframes feedbackPulse {
  0% { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
  50% { box-shadow: 0 2px 16px rgba(26,26,26,0.35); }
  100% { box-shadow: 0 2px 8px rgba(0,0,0,0.15); }
}`;

function FeedbackWidget({ user, hidden }) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [category, setCategory] = useState(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [showCheck, setShowCheck] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [hasSubmitted, setHasSubmitted] = useState(false);
  const [lastSubmitTime, setLastSubmitTime] = useState(0);
  const [rateLimitMsg, setRateLimitMsg] = useState(false);
  const screenshotRef = useRef(null);
  const styleRef = useRef(null);

  // Inject pulse keyframes once
  useEffect(() => {
    if (styleRef.current) return;
    const style = document.createElement("style");
    style.textContent = FEEDBACK_PULSE_KEYFRAMES;
    document.head.appendChild(style);
    styleRef.current = style;
  }, []);

  // Pulse after 60s idle (only if never submitted)
  useEffect(() => {
    if (hasSubmitted || hidden) return;
    const timer = setTimeout(() => setShowPulse(true), 60000);
    return () => clearTimeout(timer);
  }, [hasSubmitted, hidden]);

  if (hidden || !user) return null;

  const handleOpen = async () => {
    if (open) { setOpen(false); return; }
    // Capture screenshot BEFORE opening sheet so it shows the actual page
    screenshotRef.current = null;
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(document.body, {
        scale: 1,
        logging: false,
        useCORS: true,
        ignoreElements: (el) => el.hasAttribute?.("data-feedback-widget"),
      });
      const blob = await new Promise(resolve => canvas.toBlob(resolve, "image/png", 0.8));
      screenshotRef.current = blob;
    } catch (err) {
      console.error("Screenshot capture failed:", err);
    }
    setOpen(true);
  };

  const handleSend = async () => {
    if (message.length < 5 || sending) return;
    if (Date.now() - lastSubmitTime < 60000) {
      setRateLimitMsg(true);
      setTimeout(() => setRateLimitMsg(false), 3000);
      return;
    }
    setSending(true);
    try {
      const context = {
        url: window.location.href,
        view: getPage(),
        userId: user.id,
        userName: user.name,
        screenWidth: window.innerWidth,
        screenHeight: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
        userAgent: navigator.userAgent,
        timestamp: new Date().toISOString(),
      };
      const fd = new FormData();
      fd.append("message", message);
      if (category) fd.append("category", category);
      fd.append("errors", JSON.stringify(getErrors()));
      fd.append("context", JSON.stringify(context));
      if (screenshotRef.current) fd.append("screenshot", screenshotRef.current, "screenshot.png");

      const res = await fetch("/api/feedback", {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
          setRateLimitMsg(true);
          setTimeout(() => setRateLimitMsg(false), 3000);
          setSending(false);
          return;
        }
        throw new Error(data.error || "Failed to submit");
      }
      setSent(true);
      setLastSubmitTime(Date.now());
      setHasSubmitted(true);
      setShowPulse(false);
      setTimeout(() => {
        setOpen(false);
        setSent(false);
        setMessage("");
        setCategory(null);
        setShowCheck(true);
        setTimeout(() => setShowCheck(false), 2000);
      }, 1500);
    } catch (err) {
      console.error("Feedback submit failed:", err);
    } finally {
      setSending(false);
    }
  };

  const categories = [
    { key: "bug", label: "Bug" },
    { key: "confusing", label: "Confusing" },
    { key: "idea", label: "Idea" },
    { key: "other", label: "Other" },
  ];

  const buttonIcon = showCheck
    ? <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M5 10l3.5 3.5L15 7" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
    : <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M3 10c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.3 0-2.52-.36-3.56-.98L3 17l.98-3.44A6.96 6.96 0 013 10z" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/></svg>;

  return (
    <>
      {/* Floating trigger */}
      <div data-feedback-widget style={{
        position: "fixed", bottom: 20, right: 20, zIndex: 90,
      }}>
        {rateLimitMsg && (
          <div style={{
            position: "absolute", bottom: 52, right: 0, whiteSpace: "nowrap",
            background: BTN.primary, color: TEXT.inverse, padding: "6px 12px", borderRadius: 6,
            fontFamily: FONT.mono, fontSize: TYPE.sm, boxShadow: "0 2px 8px rgba(0,0,0,0.2)",
          }}>Please wait before sending another</div>
        )}
        <button onClick={handleOpen} style={{
          width: 44, height: 44, borderRadius: "50%",
          background: showCheck ? "#22863a" : "#1a1a1a", border: "none",
          cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
          animation: showPulse && !open ? "feedbackPulse 2s ease-in-out 3" : "none",
          transition: "background 0.2s",
        }}>{buttonIcon}</button>
      </div>

      {/* Feedback sheet */}
      {open && (
        <BottomSheet onClose={() => { if (!sending) { setOpen(false); setSent(false); setMessage(""); setCategory(null); } }} maxWidth={440}>
          {sent ? (
            <div style={{ textAlign: "center", padding: "2rem 0" }}>
              <div style={{ fontSize: TYPE.display, marginBottom: "0.5rem" }}>
                <svg width="32" height="32" viewBox="0 0 32 32" fill="none"><circle cx="16" cy="16" r="14" stroke="#22863a" strokeWidth="2"/><path d="M10 16l4 4 8-8" stroke="#22863a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </div>
              <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, color: "#333" }}>Thanks! We got it.</div>
            </div>
          ) : (
            <>
              <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, color: "#1a1a1a", marginBottom: "1rem" }}>
                What's on your mind?
              </div>
              <textarea
                value={message}
                onChange={e => setMessage(e.target.value)}
                placeholder="Describe what happened or what you'd like to see..."
                aria-label="Feedback message"
                maxLength={2000}
                style={{
                  width: "100%", minHeight: 90, padding: "0.7rem", borderRadius: 8,
                  border: `1px solid ${BORDER}`, fontFamily: FONT.mono, fontSize: TYPE.md,
                  resize: "vertical", background: "#faf8f4", boxSizing: "border-box",
                }}
              />
              <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", margin: "0.8rem 0" }}>
                {categories.map(c => (
                  <button key={c.key} onClick={() => setCategory(category === c.key ? null : c.key)} style={{
                    padding: "0.35rem 0.75rem", borderRadius: 16, cursor: "pointer",
                    fontFamily: FONT.mono, fontSize: TYPE.base,
                    background: category === c.key ? "#1a1a1a" : "#f5f0e8",
                    color: category === c.key ? "#fff" : "#666",
                    border: "none", transition: "all 0.15s",
                  }}>{c.label}</button>
                ))}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, marginBottom: "1rem" }}>
                A screenshot of this page will be attached
              </div>
              <button onClick={handleSend} disabled={message.length < 5 || sending} style={{
                width: "100%", padding: "0.7rem", borderRadius: 8, border: "none",
                background: message.length < 5 ? "#ccc" : "#1a1a1a",
                color: TEXT.inverse, fontFamily: FONT.mono, fontSize: TYPE.md,
                cursor: message.length < 5 ? "default" : "pointer",
                transition: "background 0.15s",
              }}>{sending ? "Sending..." : "Send feedback"}</button>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: "#bbb", textAlign: "center", marginTop: "0.6rem" }}>
                Your feedback goes directly to the team. We read every message.
              </div>
            </>
          )}
        </BottomSheet>
      )}
    </>
  );
}

// ── DevBanner ───────────────────────────────────────────────────────────────
function DevBanner({ persona, onSwitch, onReset }) {
  if (!persona) return null;
  return (
    <>
      <div style={{
        position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
        background: BTN.danger, color: TEXT.inverse, padding: "6px 16px",
        fontFamily: FONT.mono, fontSize: TYPE.sm,
        display: "flex", alignItems: "center", justifyContent: "center", gap: 12,
      }}>
        <span>DEV MODE — Viewing as: {persona.name} ({persona.label})</span>
        <button onClick={onSwitch} style={{
          background: "rgba(255,255,255,0.2)", border: "none", color: TEXT.inverse,
          padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: FONT.mono, fontSize: TYPE.sm,
        }}>Switch</button>
        <button onClick={onReset} style={{
          background: "rgba(255,255,255,0.2)", border: "none", color: TEXT.inverse,
          padding: "2px 8px", borderRadius: 3, cursor: "pointer", fontFamily: FONT.mono, fontSize: TYPE.sm,
        }}>Reset</button>
      </div>
      <div style={{ height: 30 }} />
    </>
  );
}

// ── PersonaPicker ───────────────────────────────────────────────────────────
const PERSONA_COLORS = {
  green: "#22863a", blue: "#0366d6", yellow: "#b08800",
  red: "#c43b2d", purple: "#6f42c1", orange: "#e36209",
};

function PersonaPicker({ onLogin, setDevPersona }) {
  const [personas, setPersonas] = useState([]);
  const [loading, setLoading] = useState(null); // id of persona being loaded

  useEffect(() => {
    fetch("/api/dev/personas").then(r => r.json()).then(setPersonas).catch(() => {});
  }, []);

  if (personas.length === 0) return null;

  const activate = async (id) => {
    setLoading(id);
    try {
      const res = await fetch(`/api/dev/personas/${id}/activate`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setDevPersona({ id: data.persona, name: data.user.name, label: personas.find(p => p.id === id)?.label });
        onLogin(data.user);
      }
    } catch (e) { /* ignore */ }
    setLoading(null);
  };

  return (
    <div style={{ marginTop: 24, borderTop: `1px solid ${BORDER}`, paddingTop: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
        <span style={{ fontSize: TYPE.xs, color: "#b0a090", fontFamily: FONT.mono, whiteSpace: "nowrap" }}>development mode</span>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
      </div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, marginBottom: 12, textAlign: "center" }}>
        Quick Login as Test Persona
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {personas.map(p => (
          <button key={p.id} onClick={() => activate(p.id)} disabled={!!loading}
            style={{
              display: "flex", alignItems: "center", gap: 10, padding: "10px 12px",
              borderRadius: 8, border: `1px solid ${BORDER}`, background: SURFACE.card,
              cursor: loading ? "wait" : "pointer", textAlign: "left",
              opacity: loading && loading !== p.id ? 0.5 : 1,
            }}>
            <span style={{
              width: 10, height: 10, borderRadius: "50%", flexShrink: 0,
              background: PERSONA_COLORS[p.color] || "#888",
            }} />
            <div style={{ flex: 1 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>
                {p.label}
              </div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>
                {p.name} · {p.description}
              </div>
            </div>
            {loading === p.id && (
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>loading...</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── AuthShell ───────────────────────────────────────────────────────────────
function AuthShell({ title, sub, children }) {
  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}><span>ramble</span><span style={{ color: TEXT.brand }}>maxxer</span></h1>
        <p style={styles.tagline}>{sub || "stop guessing, start maxxing"}</p>
        {title && <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: 12 }}>{title}</div>}
        {children}
      </div>
    </div>
  );
}

// ── GoogleIcon ──────────────────────────────────────────────────────────────
function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" style={{ verticalAlign: "middle", marginRight: 8 }}>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}

// ── Login Page ──────────────────────────────────────────────────────────────
function LoginPage({ onLogin, setDevPersona }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  // Check for OAuth error in URL
  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
    const oauthErr = params.get("error");
    if (oauthErr && oauthErr !== "oauth_error") setError(decodeURIComponent(oauthErr));
    else if (oauthErr === "oauth_error") setError("Google sign-in failed. Try again.");
  }, []);

  const submit = async (e) => {
    e.preventDefault(); setError("");
    const res = await fetch("/api/auth/login", { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (res.ok) onLogin(data); else setError(data.error);
  };

  return (
    <AuthShell>
      <form onSubmit={submit} style={styles.form}>
        <Input type="email" placeholder="email" aria-label="Email" value={email} onChange={e => setEmail(e.target.value)} required />
        <Input type="password" placeholder="password" aria-label="Password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <ErrMsg>{error}</ErrMsg>}
        <Btn type="submit" full>log in</Btn>
      </form>
      <div style={{ textAlign: "center", margin: "1rem 0 0.5rem" }}>
        <a href="/api/auth/google" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "100%", padding: "0.6rem", borderRadius: 4,
          border: `1px solid ${BORDER}`, background: SURFACE.card, cursor: "pointer",
          fontFamily: FONT.mono, fontSize: TYPE.md, color: "#333",
          textDecoration: "none",
        }}>
          <GoogleIcon /> sign in with Google
        </a>
      </div>
      <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
        <button onClick={() => { window.location.hash = "/forgot-password"; }}
          style={{ background: "none", border: "none", color: TEXT.disabled,
            fontSize: TYPE.base, fontFamily: FONT.mono, cursor: "pointer" }}>
          forgot password?
        </button>
      </div>
      {!import.meta.env.PROD && <PersonaPicker onLogin={onLogin} setDevPersona={setDevPersona} />}
    </AuthShell>
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
    <AuthShell sub="create your account">
      <a href={`/api/auth/google${token ? `?token=${token}` : ""}`}
        style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 10,
          padding: "0.65rem 1rem", borderRadius: 8, border: `1px solid ${BORDER}`,
          background: SURFACE.card, color: "#3a3530", textDecoration: "none",
          fontFamily: FONT.mono, fontSize: TYPE.md, marginBottom: 12,
        }}>
        <GoogleIcon /> continue with Google
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
        <span style={{ fontSize: TYPE.xs, color: "#b0a090", fontFamily: FONT.mono }}>or</span>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
      </div>
      <form onSubmit={submit} style={styles.form}>
        <Input placeholder="name" aria-label="Name" value={form.name} onChange={set("name")} required />
        <Input type="email" placeholder="email" aria-label="Email" value={form.email} onChange={set("email")} required />
        <Input type="password" placeholder="password" aria-label="Password" value={form.password} onChange={set("password")} required />
        <Input placeholder="graduation year (e.g. 2027)" aria-label="Graduation year" value={form.grad_year} onChange={set("grad_year")} />
        {error && <ErrMsg>{error}</ErrMsg>}
        <Btn type="submit" full>create account</Btn>
      </form>
    </AuthShell>
  );
}

// ── ForgotPasswordPage ──────────────────────────────────────────────────────
function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState("");

  const submit = async e => {
    e.preventDefault();
    const res = await api.post("/api/auth/forgot-password", { email });
    res.ok !== false ? setSent(true) : setErr(res.error);
  };

  const onBack = () => { window.location.hash = "/login"; };

  return (
    <AuthShell title="reset password" sub="we'll send you a link">
      {sent ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: TYPE.sm, color: TEXT.secondary, marginBottom: 16 }}>
            If that email is in our system, a reset link is on its way.
          </div>
          <Btn onClick={onBack} full>back to login</Btn>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input type="email" placeholder="your email" aria-label="Email" value={email}
            onChange={e => setEmail(e.target.value)} required />
          {err && <ErrMsg>{err}</ErrMsg>}
          <Btn type="submit" full>send reset link</Btn>
          <button type="button" onClick={onBack}
            style={{ background: "none", border: "none", color: TEXT.disabled,
              fontSize: TYPE.xs, fontFamily: FONT.mono, cursor: "pointer" }}>
            back to login
          </button>
        </form>
      )}
    </AuthShell>
  );
}

// ── ResetPasswordPage ───────────────────────────────────────────────────────
function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [done, setDone] = useState(false);
  const [err, setErr] = useState("");

  const submit = async e => {
    e.preventDefault();
    if (password !== confirm) return setErr("Passwords don't match");
    const res = await api.post("/api/auth/reset-password", { token, password });
    res.ok ? setDone(true) : setErr(res.error);
  };

  return (
    <AuthShell title="new password" sub="make it a good one">
      {done ? (
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: TYPE.sm, color: TEXT.success, marginBottom: 16 }}>
            Password updated! You can now log in.
          </div>
          <Btn onClick={() => { window.location.hash = "/login"; }} full>go to login</Btn>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input type="password" placeholder="new password (8+ chars)" aria-label="New password"
            value={password} onChange={e => setPassword(e.target.value)} required />
          <Input type="password" placeholder="confirm password" aria-label="Confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)} required />
          {err && <ErrMsg>{err}</ErrMsg>}
          <Btn type="submit" full>set new password</Btn>
        </form>
      )}
    </AuthShell>
  );
}

// ── SettingsResetSection ─────────────────────────────────────────────────────
function SettingsResetSection({ onClose, onReimport }) {
  const [resetConfirm, setResetConfirm] = useState("");
  const [resetting, setResetting] = useState(false);

  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginBottom: 16 }}>
      <SectionTitle>Reset</SectionTitle>
      <p style={{ fontSize: TYPE.xs, color: TEXT.danger, fontFamily: FONT.mono, marginBottom: 8 }}>
        Delete all course data and start over. Programs and account info are kept.
      </p>
      <Input placeholder='Type "RESET" to confirm' aria-label="Type RESET to confirm" value={resetConfirm}
        onChange={e => setResetConfirm(e.target.value)} />
      <Btn onClick={async () => {
        if (resetConfirm !== "RESET") return;
        setResetting(true);
        await api.post("/api/students/me/reset", { confirm: true });
        setResetting(false);
        onClose();
        onReimport();
      }} full disabled={resetConfirm !== "RESET" || resetting}
        style={{ marginTop: 8, background: BTN.danger }}>
        {resetting ? "resetting..." : "reset all course data"}
      </Btn>
    </div>
  );
}

// ── SettingsSheet ───────────────────────────────────────────────────────────
function SettingsSheet({ user, onClose, onUpdate, onReimport, onLogout }) {
  const [name, setName] = useState(user.name);
  const [gradYear, setGradYear] = useState(user.grad_year || "");
  const [privacy, setPrivacy] = useState(user.privacy || "private");
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const saveProfile = async () => {
    setMsg(""); setErr("");
    const res = await api.put("/api/students/me/settings", {
      name, grad_year: parseInt(gradYear) || null, privacy
    });
    res.ok ? (setMsg("Saved"), onUpdate({ ...user, name, grad_year: gradYear, privacy }))
           : setErr(res.error);
  };

  const changePassword = async () => {
    setMsg(""); setErr("");
    if (!currentPw || !newPw) return setErr("Both fields required");
    const res = await api.put("/api/students/me/password", {
      currentPassword: currentPw, newPassword: newPw
    });
    res.ok ? (setMsg("Password updated"), setCurrentPw(""), setNewPw(""))
           : setErr(res.error);
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
      zIndex: 1000, display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        style={{ background: BG, borderRadius: "16px 16px 0 0", padding: "24px 20px 48px",
          width: "100%", maxWidth: 560, boxShadow: "0 -8px 32px rgba(0,0,0,0.15)",
          maxHeight: "85vh", overflowY: "auto" }}>

        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#d0ccc6",
          margin: "0 auto 20px" }} />

        <SectionTitle>Profile</SectionTitle>

        {user.avatar_url && (
          <img src={user.avatar_url} alt={user.name}
            style={{ width: 48, height: 48, borderRadius: "50%", marginBottom: 12 }} />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 20 }}>
          <Input placeholder="display name" aria-label="Display name" value={name}
            onChange={e => setName(e.target.value)} />
          <Input placeholder="graduation year" aria-label="Graduation year" value={gradYear}
            onChange={e => setGradYear(e.target.value)} />
          <div>
            <div style={{ fontSize: TYPE.xs, color: "#8a8580", marginBottom: 6,
              fontFamily: FONT.mono }}>course visibility</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["private", "friends"].map(v => (
                <button key={v} onClick={() => setPrivacy(v)}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 8,
                    border: `2px solid ${privacy === v ? "#1a1a1a" : BORDER}`,
                    background: privacy === v ? "#1a1a1a" : "transparent",
                    cursor: "pointer", fontFamily: FONT.mono, fontSize: TYPE.sm,
                    color: privacy === v ? "#fff" : "#5a5550" }}>
                  {v === "private" ? "private" : "friends"}
                </button>
              ))}
            </div>
            <div style={{ fontSize: TYPE.xs, color: TEXT.disabled, marginTop: 6 }}>
              {privacy === "friends"
                ? "People in your invite network can see your course list"
                : "Only you can see your course list"}
            </div>
          </div>
          <Btn onClick={saveProfile} full>save profile</Btn>
        </div>

        {(user.provider === "local" || !user.provider) && (
          <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginBottom: 16 }}>
            <SectionTitle>Change Password</SectionTitle>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <Input type="password" placeholder="current password" aria-label="Current password"
                value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              <Input type="password" placeholder="new password (8+ chars)" aria-label="New password"
                value={newPw} onChange={e => setNewPw(e.target.value)} />
              <Btn onClick={changePassword} full>update password</Btn>
            </div>
          </div>
        )}

        {user.provider === "google" && (
          <div style={{ fontSize: TYPE.xs, color: TEXT.disabled, fontFamily: FONT.mono,
            padding: "12px 0", borderTop: `1px solid ${BORDER}` }}>
            Signed in with Google — password change not available
          </div>
        )}

        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginBottom: 16 }}>
          <SectionTitle>Transcript</SectionTitle>
          <Btn onClick={() => { onClose(); onReimport(); }} full
            style={{ background: "transparent", border: `2px solid ${BORDER}`, color: TEXT.secondary }}>
            re-import transcript
          </Btn>
          <div style={{ fontSize: TYPE.xs, color: TEXT.disabled, marginTop: 6, fontFamily: FONT.mono }}>
            Opens the transcript upload wizard — existing courses are kept
          </div>
        </div>

        <SettingsResetSection onClose={onClose} onReimport={onReimport} />

        {msg && <div style={{ color: TEXT.success, fontSize: TYPE.sm, fontFamily: FONT.mono,
          marginTop: 8 }}>{msg}</div>}
        {err && <ErrMsg>{err}</ErrMsg>}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={onClose}
            style={{ flex: 1, padding: 12, borderRadius: 10,
              border: "none", background: "#e8e4df", cursor: "pointer",
              fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary }}>
            close
          </button>
          {onLogout && (
            <button onClick={onLogout}
              style={{ padding: "12px 16px", borderRadius: 10,
                border: "none", background: "transparent", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>
              log out
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── CreditMeter ─────────────────────────────────────────────────────────────
function CreditMeter({ credits, hasUnmappedTransfer, onTransferWarningTap }) {
  const { total, complete, enrolled, planned } = credits;
  const max = 120;
  const pctC = (complete / max) * 100, pctE = (enrolled / max) * 100, pctP = (planned / max) * 100;

  return (
    <div style={{ padding: "0.8rem 0 1rem 0", borderBottom: `1px solid ${BORDER}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: "1.2rem", flexWrap: "wrap" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <ProgressRing value={total} max={max} size={80} color={total >= max ? "#22863a" : "#b08800"} />
          <div style={{ position: "absolute", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.lg, fontWeight: 700 }}>{total}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>/ {max}</span>
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 700, marginBottom: "0.5rem" }}>Credit Hours</div>
          <div style={{ height: 12, borderRadius: 6, background: "#eee", overflow: "hidden", display: "flex" }}>
            <div style={{ width: `${pctC}%`, background: STATUS_COLOR.complete }} />
            <div style={{ width: `${pctE}%`, background: STATUS_COLOR.enrolled }} />
            <div style={{ width: `${pctP}%`, background: STATUS_COLOR.planned }} />
          </div>
          <div style={{ display: "flex", gap: "0.8rem", marginTop: "0.4rem", fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary }}>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.complete, marginRight: 4 }} />{complete} earned</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.enrolled, marginRight: 4 }} />{enrolled} enrolled</span>
            <span><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLOR.planned, marginRight: 4 }} />{planned} planned</span>
          </div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: total >= max ? TEXT.success : TEXT.muted, marginTop: "0.3rem", animation: total >= max ? "celebratePulse 0.4s ease-out" : "none" }}>
            {max - total > 0 ? `${max - total} credits remaining` : "120 credits — you've hit the mark"}
          </div>
          {hasUnmappedTransfer && (
            <button type="button" onClick={onTransferWarningTap} style={{
              fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.warning, marginTop: "0.3rem",
              cursor: onTransferWarningTap ? "pointer" : "default",
              background: "none", border: "none", textAlign: "left", width: "100%", padding: 0,
            }}>
              Transfer credits not mapped to requirements
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NextStepsSection ────────────────────────────────────────────────────────
function NextStepsSection({ data, onAddCourses, onMapTransfer, onSuggestionTap, planSummary }) {
  const cards = [];

  // 1. Current enrollment check
  const currentTerm = getCurrentAcademicTerm();
  if (data.latestTerm && termOrderClient(data.latestTerm) < termOrderClient(currentTerm)) {
    cards.push({
      key: "enrollment",
      icon: "&#128218;",
      title: `Add your ${currentTerm} courses`,
      subtitle: `Last update: ${data.latestTerm}`,
      action: () => onAddCourses?.(currentTerm),
    });
  }

  // 2. Unmapped transfer credits
  const xferCount = Object.keys(data.slotAssignments || {}).filter(c => c.startsWith("XFER")).length;
  if (xferCount > 0) {
    cards.push({
      key: "transfer",
      icon: "&#8644;",
      title: `Map ${xferCount} transfer credit${xferCount !== 1 ? "s" : ""}`,
      subtitle: "Match to catalog courses for requirement tracking",
      action: () => onMapTransfer?.(),
    });
  }

  // 3. Top suggestion
  if (data.suggestions?.[0]?.boxCount >= 2) {
    const s = data.suggestions[0];
    cards.push({
      key: "suggestion",
      icon: "&#9733;",
      title: `Consider ${s.code}`,
      subtitle: `Fills ${s.boxCount} requirements — ${s.fills.slice(0, 2).join(", ")}`,
      action: () => onSuggestionTap?.(s),
    });
  }

  // 4. Plan your next semester (with plan summary if available)
  if (data.remaining?.length > 0) {
    const planInfo = planSummary
      ? `${planSummary.course_count} course${planSummary.course_count !== 1 ? "s" : ""} · ${planSummary.total_credits}cr planned`
      : `${data.remaining.length} requirements remaining`;
    cards.push({
      key: "planner",
      icon: "&#128197;",
      title: planSummary ? "Your plan" : "Plan your next semester",
      subtitle: planInfo,
      action: () => { window.location.hash = "/planner"; },
    });
  }

  // 5. Overlap warning (dynamic per pair)
  for (const [key, pair] of Object.entries(data.overlaps?.pairs || {})) {
    if (pair.max != null && pair.count >= pair.max) {
      const [a, b] = key.split("|");
      const nameA = data.programs[a]?.name || a;
      const nameB = data.programs[b]?.name || b;
      cards.push({
        key: `overlap-${key}`,
        icon: "&#9888;",
        title: "Overlap budget full",
        subtitle: `${pair.count}/${pair.max} ${nameA} / ${nameB} shared slots used`,
        action: null,
      });
    }
  }

  if (cards.length === 0) return null;

  const ctaCardStyle = {
    background: SURFACE.hover, border: `1px solid ${BORDER}`, borderRadius: 8,
    padding: "0.7rem 1rem", display: "flex", alignItems: "center", gap: "0.7rem",
    boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
  };

  return (
    <div>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600, marginBottom: "0.5rem" }}>Next Steps</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {cards.slice(0, 3).map((card, idx) => {
          const isTop = idx === 0;
          const cardPadding = isTop ? "0.9rem 1rem" : "0.7rem 1rem";
          const iconSize = isTop ? "1.5rem" : TYPE.xl;
          const titleSize = isTop ? TYPE.md : TYPE.base;

          return card.action ? (
            <button type="button" key={card.key} onClick={card.action} style={{
              ...ctaCardStyle, padding: cardPadding,
              cursor: "pointer", textAlign: "left", width: "100%",
            }}>
              <span style={{ fontSize: iconSize, flexShrink: 0, width: 28, textAlign: "center" }} dangerouslySetInnerHTML={{ __html: card.icon }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: titleSize, fontWeight: 700 }}>{card.title}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{card.subtitle}</div>
              </div>
              <span style={{ fontSize: TYPE.xl, color: TEXT.secondary, fontWeight: 300 }}>&rsaquo;</span>
            </button>
          ) : (
            <div key={card.key} style={{ ...ctaCardStyle, padding: cardPadding }}>
              <span style={{ fontSize: iconSize, flexShrink: 0, width: 28, textAlign: "center" }} dangerouslySetInnerHTML={{ __html: card.icon }} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: titleSize, fontWeight: 700 }}>{card.title}</div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{card.subtitle}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}


// ── ProgramCard ─────────────────────────────────────────────────────────────
function ProgramCard({ prog, conflicts, slotAssignments, onPipClick, onSlotTap, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const color = COLORS[prog.code] || "#444";
  const filledSlots = prog.categories.reduce((s, c) => s + (c.filledCount || 0), 0);
  const totalSlots = prog.categories.reduce((s, c) => s + c.slotsNeeded, 0);

  return (
    <div style={{ ...cardStyle, overflow: "hidden" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.8rem 1rem", cursor: "pointer", background: "none", border: "none", borderLeft: `4px solid ${color}`, textAlign: "left", width: "100%" }}>
        <div style={{ position: "relative", flexShrink: 0 }}>
          <ProgressRing value={filledSlots} max={totalSlots} size={48} stroke={4} color={color} />
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 700 }}>
            {filledSlots}/{totalSlots}
          </div>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600, color }}>{prog.name}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>
            {filledSlots}/{totalSlots} categories{prog.totalCredits ? ` · ${prog.creditsApplied || 0}/${prog.totalCredits} cr` : ""}
          </div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.disabled, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>
      {open && (() => {
        const incomplete = prog.categories.filter(cat => !cat.isSatisfied && !cat.isWaived);
        const completed = prog.categories.filter(cat => cat.isSatisfied || cat.isWaived);
        return (
          <div style={{ padding: "0 1rem 0.8rem 1rem", animation: "expandIn 0.2s ease-out" }}>
            {incomplete.map((cat, i) => (
              <CategoryRow key={`inc-${i}`} cat={cat} color={color} conflicts={conflicts} slotAssignments={slotAssignments} onPipClick={onPipClick}
                onSlotTap={onSlotTap ? () => onSlotTap(prog.code, cat.name) : null} />
            ))}
            {completed.length > 0 && (
              <CompletedCategoriesGroup categories={completed} color={color} conflicts={conflicts} slotAssignments={slotAssignments} onPipClick={onPipClick} />
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── CompletedCategoriesGroup ────────────────────────────────────────────────
function CompletedCategoriesGroup({ categories, color, conflicts, slotAssignments, onPipClick }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.5rem" }}>
      <button type="button" aria-expanded={expanded} onClick={() => setExpanded(!expanded)} style={{
        display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", padding: "0.3rem 0",
        background: "none", border: "none", textAlign: "left", width: "100%", minHeight: 44,
      }}>
        <span style={{ color: TEXT.success, fontSize: TYPE.sm }}>&#10003;</span>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, color: TEXT.success }}>
          {categories.length} done
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>&#9660;</span>
      </button>
      {expanded && categories.map((cat, i) => (
        <CategoryRow key={`comp-${i}`} cat={cat} color={color} conflicts={conflicts} slotAssignments={slotAssignments} onPipClick={onPipClick} />
      ))}
    </div>
  );
}

// ── CategoryRow ─────────────────────────────────────────────────────────────
function CategoryRow({ cat, color, conflicts, slotAssignments, onPipClick, onSlotTap }) {
  const hasConflict = cat.slots.some(s => conflicts[s.code]);

  // Build pip list — coversBothTiers slots expand to fill both positions
  const pips = [];
  let slotIdx = 0;
  for (let i = 0; i < cat.slotsNeeded; i++) {
    const slot = cat.slots[slotIdx];
    if (!slot) { pips.push(<EmptyPip key={i} onClick={onSlotTap || undefined} />); continue; }
    if (slot.code === "WAIVED") { pips.push(<WaivedPip key={i} />); slotIdx++; continue; }
    if (slot.coversBothTiers) {
      // Render two pips from one slot entry
      const isConflict = conflicts[slot.code];
      const label = i === (pips.length) ? "T1" : "T2";
      pips.push(<FilledPip key={i} slot={slot} color={color} isConflict={!!isConflict} label={label}
        slotAssignments={slotAssignments} onClick={() => onPipClick(slot.code, slot.title, isConflict || null)} />);
      if (label === "T2") slotIdx++;
      continue;
    }
    const isConflict = conflicts[slot.code];
    pips.push(<FilledPip key={i} slot={slot} color={color} isConflict={!!isConflict}
      slotAssignments={slotAssignments} onClick={() => onPipClick(slot.code, slot.title, isConflict || null)} />);
    slotIdx++;
  }

  return (
    <div style={{ padding: "0.5rem 0", borderTop: `1px solid ${BORDER}` }}>
      <div onClick={onSlotTap || undefined} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem",
        cursor: onSlotTap ? "pointer" : "default",
      }}>
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>
          {cat.name}
          {cat.isWaived && <span style={{ marginLeft: 6, fontSize: TYPE.xs, background: "#f0ede8", padding: "2px 6px", borderRadius: 3, color: TEXT.muted }}>waived</span>}
          {hasConflict && <span style={{ marginLeft: 6, fontSize: TYPE.xs, background: "#e8f0fe", padding: "2px 6px", borderRadius: 3, color: "#1a5276" }}>shared</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: cat.isSatisfied ? "#22863a" : "#b08800", fontWeight: 600 }}>
            {cat.filledCount || 0}/{cat.slotsNeeded}
          </span>
          {onSlotTap && <span style={{ color: "#c0b8b0", fontSize: TYPE.sm }}>&rsaquo;</span>}
        </div>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>{pips}</div>
    </div>
  );
}

function FilledPip({ slot, color, isConflict, onClick, label, slotAssignments }) {
  const asgns = slotAssignments?.[slot.code] || [];
  const uniqueProgs = [...new Set(asgns.map(a => a.programCode))];
  const isMultiProgram = uniqueProgs.length >= 2;
  const isShared = !isConflict && isMultiProgram;

  const titleText = isMultiProgram
    ? "Fills " + asgns.map(a => `${a.programCode} (${a.categoryName})`).join(" + ")
    : undefined;

  const btn = (
    <button type="button" onClick={onClick} title={titleText} style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      padding: "4px 8px", borderRadius: 4, fontSize: TYPE.sm, fontFamily: FONT.mono,
      background: `${color}12`, border: `1px solid ${isConflict ? "#ffc107" : color + "40"}`,
      cursor: "pointer", boxShadow: isConflict ? "0 0 0 1px #ffc107" : "none",
      textAlign: "left",
    }}>
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[slot.status] || "#888", flexShrink: 0 }} />
      {slot.code}
      {label && <span style={{ fontSize: TYPE.xs, opacity: 0.6 }}>{label}</span>}
      {isConflict && <span style={{ fontSize: TYPE.xs }}>&#x27F7;</span>}
    </button>
  );

  if (!isShared) return btn;

  const colors = uniqueProgs.map(p => programColor(p));
  const light = colors.map(c => c + "40").join(", ");
  const accent = colors.join(", ");
  return (
    <span className="pip-shared" style={{
      "--grad": `conic-gradient(${light}, ${accent}, ${light})`,
      display: "inline-flex",
    }}>
      {btn}
    </span>
  );
}

function EmptyPip({ onClick }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} style={{
        width: 70, height: 28, borderRadius: 4,
        border: `1.5px dashed #999`,
        background: "#fafaf8",
        cursor: "pointer",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled,
      }}>
        +
      </button>
    );
  }
  return (
    <div style={{
      width: 70, height: 28, borderRadius: 4,
      border: `1.5px dashed #ccc`,
      background: "transparent",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled,
    }} />
  );
}

function WaivedPip() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 70, height: 28, borderRadius: 4, background: SURFACE.hover, border: `1px solid ${BORDER}`, fontSize: TYPE.xs, color: TEXT.muted }}>
      &#10003; waived
    </div>
  );
}

// ── OverlapBudget ───────────────────────────────────────────────────────────
function OverlapBudget({ overlaps, programs, conflicts, onPipClick, overlapSummary }) {
  const pairs = overlaps?.pairs || {};
  // Only show pairs that have an explicit max (i.e., a rule in overlap_rules)
  const ruledPairs = Object.entries(pairs).filter(([, p]) => p.max != null);
  // Show unique credit warnings for programs near/below their floor
  const uniqueCreditWarnings = Object.entries(overlapSummary || {})
    .filter(([, s]) => s.uniqueCreditsRequired != null && s.uniqueCredits <= s.uniqueCreditsRequired + 6);

  if (ruledPairs.length === 0 && uniqueCreditWarnings.length === 0) return null;

  // Build shared-course-code → pair-keys map for chip display
  const sharedCodes = Object.keys(conflicts);

  return (
    <div style={{ ...secondaryCardStyle, padding: "1rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600, marginBottom: "0.6rem" }}>Overlap Budget</div>

      {ruledPairs.map(([key, pair]) => {
        const [a, b] = key.split("|");
        const nameA = programs[a]?.name || a;
        const nameB = programs[b]?.name || b;
        const colorA = programColor(a);
        const colorB = programColor(b);
        const overBudget = pair.count > pair.max;

        const explain = pair.count === 0
          ? `No courses are currently shared. Up to ${pair.max} can count for both programs.`
          : overBudget
            ? `You have ${pair.count} shared courses but only ${pair.max} are allowed. Pin some courses to one program to get back under budget.`
            : pair.count === pair.max
              ? `All ${pair.max} shared slots are used. Any new course counting for both will put you over budget.`
              : `${pair.count} of ${pair.max} shared slots used. You can double-count ${pair.max - pair.count} more course${pair.max - pair.count !== 1 ? "s" : ""}.`;

        // Courses shared in this specific pair
        const pairCourses = pair.courses || [];

        return (
          <div key={key} style={{ marginBottom: "0.8rem" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.3rem" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>
                {nameA} &#x2194; {nameB}
              </span>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "2px 8px", borderRadius: 10, background: overBudget ? "#fde8e8" : "#e8f5e9", color: overBudget ? "#c43b2d" : "#22863a", fontWeight: 600 }}>
                {pair.count}/{pair.max}
              </span>
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary, lineHeight: 1.5, marginBottom: "0.4rem" }}>
              {explain}
            </div>
            <div style={{ display: "flex", gap: "0.3rem" }}>
              {Array.from({ length: pair.max }).map((_, i) => (
                <div key={i} style={{
                  width: 32, height: 20, borderRadius: 4,
                  background: i < pair.count ? `linear-gradient(135deg, ${colorA}, ${colorB})` : "#eee",
                  border: `1px solid ${i < pair.count ? colorA + "40" : "#ddd"}`,
                }} />
              ))}
              {overBudget && <div style={{ width: 32, height: 20, borderRadius: 4, background: BTN.danger, display: "flex", alignItems: "center", justifyContent: "center", fontSize: TYPE.xs, color: TEXT.inverse, fontFamily: FONT.mono }}>!</div>}
            </div>

            {pairCourses.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
                {pairCourses.map(code => (
                  <button type="button" key={code} onClick={() => onPipClick?.(code, "", conflicts[code] || [a, b])} style={{
                    fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 8px", borderRadius: 4,
                    background: "#e8f0fe", border: "1px solid #b8d0f0", color: "#1a5276",
                    cursor: "pointer",
                  }}>
                    {code}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* GLST dept spread — only show if GLST-BA is in a ruled pair */}
      {overlaps.glstElectiveDeptUsage && Object.keys(overlaps.glstElectiveDeptUsage).length > 0 && ruledPairs.some(([k]) => k.includes("GLST-BA")) && (
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.3rem" }}>
            GLST elective dept spread ({overlaps.glstElectiveDeptMax} max per dept)
          </div>
          {Object.entries(overlaps.glstElectiveDeptUsage).map(([dept, count]) => (
            <div key={dept} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, width: 40, textAlign: "right", color: TEXT.secondary }}>{dept}</span>
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: overlaps.glstElectiveDeptMax }).map((_, i) => (
                  <div key={i} style={{ width: 20, height: 10, borderRadius: 2, background: i < count ? (count >= overlaps.glstElectiveDeptMax ? "#c43b2d" : programColor("GLST-BA")) : "#eee" }} />
                ))}
              </div>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: count >= overlaps.glstElectiveDeptMax ? "#c43b2d" : "#888" }}>{count}</span>
            </div>
          ))}
        </div>
      )}

      {/* Per-program unique credit status */}
      {uniqueCreditWarnings.length > 0 && (
        <div style={{ marginTop: "0.6rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.3rem" }}>Unique Credits</div>
          {uniqueCreditWarnings.map(([code, s]) => {
            const color = s.meetsMinimum ? "#22863a" : "#c43b2d";
            const progName = programs[code]?.name || code;
            return (
              <div key={code} style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
                <span style={{ width: 8, height: 8, borderRadius: "50%", background: programColor(code), flexShrink: 0 }} />
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs }}>{progName}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color, fontWeight: 600 }}>
                  {s.uniqueCredits}/{s.uniqueCreditsRequired} unique cr
                </span>
                {!s.meetsMinimum && <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#fde8e8", color: "#c43b2d", padding: "1px 4px", borderRadius: 3 }}>below minimum</span>}
              </div>
            );
          })}
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
    <div style={{ ...secondaryCardStyle, overflow: "hidden" }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen(!open)} style={{ display: "flex", alignItems: "center", gap: "0.8rem", padding: "0.8rem 1rem", cursor: "pointer", background: "none", border: "none", borderLeft: `4px solid ${programColor("CAS-GRAD")}`, textAlign: "left", width: "100%" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600, color: programColor("CAS-GRAD") }}>{casGrad?.name || "Graduation Requirements"}</div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted }}>{filled}/{allCats.length} satisfied</div>
        </div>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.disabled, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>▼</span>
      </button>
      {open && (
        <div style={{ padding: "0 1rem 0.8rem" }}>
          {casGrad && casGrad.categories.map((cat, i) => (
            <div key={i} style={{ padding: "0.4rem 0", borderTop: `1px solid ${BORDER}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>{cat.name}</div>
                {cat.slots.length > 0 && (
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginTop: 2 }}>
                    {cat.slots.map(s => s.code).join(", ")}
                  </div>
                )}
              </div>
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: cat.isSatisfied ? "#22863a" : "#b08800", fontWeight: 600 }}>
                {cat.isSatisfied ? "done" : `${cat.filledCount || 0}/${cat.slotsNeeded}`}
              </span>
            </div>
          ))}
          {spanLang && spanLang.categories?.[0]?.slots && (
            <div style={{ padding: "0.5rem 0", borderTop: `1px solid ${BORDER}` }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, marginBottom: "0.3rem", color: programColor(spanLang.code) }}>{spanLang.name}</div>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {spanLang.categories[0].slots.map(slot => (
                  <div key={slot.label || slot.code || slot.id} style={{
                    padding: "4px 8px", borderRadius: 4, fontSize: TYPE.sm, fontFamily: FONT.mono,
                    background: slot.code ? `${programColor(spanLang.code)}15` : "#f5f0e8",
                    border: `1px solid ${slot.code ? programColor(spanLang.code) + "40" : "#ddd"}`,
                    color: slot.code ? "#333" : "#aaa",
                  }}>
                    {slot.code && <span style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: STATUS_COLOR[slot.status], marginRight: 4 }} />}
                    {slot.code || slot.label || "—"}
                  </div>
                ))}
              </div>
              {spanLang.notes && (
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginTop: "0.3rem" }}>
                  {Array.isArray(spanLang.notes) ? spanLang.notes.join(" · ") : spanLang.notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── RemainingCard ───────────────────────────────────────────────────────────
function RemainingCard({ remaining, onSlotTap }) {
  if (!remaining || remaining.length === 0) return null;
  return (
    <div style={{ ...secondaryCardStyle, padding: "1rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600, marginBottom: "0.5rem" }}>Remaining</div>
      {remaining.map((r, i) => (
        onSlotTap ? (
          <button type="button" key={i} onClick={() => onSlotTap(r.program, r.category)}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0", fontFamily: FONT.mono, fontSize: TYPE.sm, cursor: "pointer", background: "none", border: "none", textAlign: "left", width: "100%" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[r.program] || "#888", flexShrink: 0 }} />
            <span style={{ color: TEXT.primary }}>{r.category}</span>
            <span style={{ color: TEXT.muted, marginLeft: "auto", fontSize: TYPE.xs }}>{r.programName} · {r.needed} needed</span>
            <span style={{ color: "#c0b8b0", fontSize: TYPE.sm }}>&rsaquo;</span>
          </button>
        ) : (
          <div key={i}
            style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.35rem 0", fontFamily: FONT.mono, fontSize: TYPE.sm }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[r.program] || "#888", flexShrink: 0 }} />
            <span style={{ color: TEXT.primary }}>{r.category}</span>
            <span style={{ color: TEXT.muted, marginLeft: "auto", fontSize: TYPE.xs }}>{r.programName} · {r.needed} needed</span>
          </div>
        )
      ))}
    </div>
  );
}

// ── SuggestionsCard ─────────────────────────────────────────────────────────
function SuggestionsCard({ suggestions, remaining, scrapedTerms, programs }) {
  if (!suggestions || suggestions.length === 0) return null;

  const [termFilter, setTermFilter] = useState("");

  // Build lookup: fill string → needed count from remaining
  const neededLookup = {};
  if (remaining) {
    for (const r of remaining) {
      neededLookup[r.category] = r.needed;
    }
  }

  // Precompute program name → code map for fill chip colors
  const progNameToCode = useMemo(() => {
    const map = {};
    for (const [code, p] of Object.entries(programs || {})) map[p.name] = code;
    return map;
  }, [programs]);

  // Apply term filter
  const filtered = termFilter
    ? suggestions.filter(s => s.terms && s.terms.includes(termFilter))
    : suggestions;
  const top = filtered.slice(0, 8);

  return (
    <div style={{ ...secondaryCardStyle, padding: "1rem" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.5rem" }}>
        <div style={{ fontFamily: FONT.serif, fontSize: TYPE.lg, fontWeight: 600 }}>High-Efficiency Suggestions</div>
        {scrapedTerms && scrapedTerms.length > 0 && (
          <select
            value={termFilter}
            onChange={e => setTermFilter(e.target.value)}
            aria-label="Filter suggestions by term"
            style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", border: `1px solid ${BORDER}`, borderRadius: 4, background: SURFACE.card, color: TEXT.primary }}
          >
            <option value="">All terms</option>
            {scrapedTerms.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
      </div>
      {top.length === 0 && termFilter && (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, padding: "0.5rem 0" }}>
          Nothing jumping out for {termFilter} — try another semester?
        </div>
      )}
      {top.map((s, i) => {
        const isHighValue = s.boxCount >= 3;
        const badgeSize = isHighValue ? 28 : 22;
        return (
        <div key={i} style={{
          display: "flex", alignItems: "flex-start", gap: "0.5rem",
          padding: isHighValue && i === 0 ? "0.6rem 0.5rem" : "0.4rem 0",
          borderTop: i ? `1px solid ${BORDER}` : "none",
          background: isHighValue && i === 0 ? `${SURFACE.hover}` : "transparent",
          borderRadius: isHighValue && i === 0 ? 6 : 0,
          margin: isHighValue && i === 0 ? "0 -0.5rem" : 0,
        }}>
          <span style={{
            fontFamily: FONT.mono, fontSize: isHighValue ? TYPE.sm : TYPE.xs, fontWeight: 700,
            width: badgeSize, height: badgeSize, borderRadius: "50%",
            display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
            background: isHighValue ? TEXT.primary : "#e8e4df",
            color: isHighValue ? TEXT.inverse : "#444",
          }}>{s.boxCount}</span>
          <div style={{ flex: 1 }}>
            <div style={{ fontFamily: FONT.mono, fontSize: isHighValue && i === 0 ? TYPE.base : TYPE.sm, fontWeight: 600 }}>
              {s.code} <span style={{ fontWeight: 400, color: TEXT.secondary }}>{s.title}</span>
              {s.writing_intensive && <span style={{ marginLeft: 4, fontSize: TYPE.xs, background: "#e3f2fd", padding: "2px 5px", borderRadius: 2, color: "#1565c0" }}>WI</span>}
              {s.engaged_learning && <span style={{ marginLeft: 4, fontSize: TYPE.xs, background: "#f3e5f5", padding: "2px 5px", borderRadius: 2, color: "#7b1fa2" }}>EL</span>}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.25rem", marginTop: "0.2rem" }}>
              {s.fills.map((f, j) => {
                const needed = neededLookup[f];
                const progName = f.split(":")[0]?.trim();
                const progCode = progNameToCode[progName];
                const color = progCode ? programColor(progCode) : TEXT.secondary;
                // Use COLORS lookup for hex (supports alpha suffix); fallback for HSL colors
                const hasHex = COLORS[progCode];
                const bg = hasHex ? `${color}12` : "rgba(0,0,0,0.04)";
                const borderColor = hasHex ? `${color}25` : "rgba(0,0,0,0.08)";
                return (
                  <span key={j} style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: bg, padding: "2px 6px", borderRadius: 3, color, border: `1px solid ${borderColor}` }}>
                    {f}{needed ? ` (${needed} needed)` : ""}
                  </span>
                );
              })}
              {s.terms && s.terms.length > 0 && s.terms.map((t, j) => (
                <span key={`t${j}`} style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#e8f5e9", padding: "2px 6px", borderRadius: 3, color: "#2e7d32" }}>
                  {t.replace(/\d{4}/, "").trim()}
                </span>
              ))}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}

// ── RemainingPill ───────────────────────────────────────────────────────────
function RemainingPill({ count, remainingRef }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = remainingRef.current;
    if (!el || !count) return;
    const observer = new IntersectionObserver(
      ([entry]) => setVisible(!entry.isIntersecting),
      { threshold: 0 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [remainingRef, count]);

  if (!visible || !count) return null;

  return (
    <button type="button" onClick={() => remainingRef.current?.scrollIntoView({ behavior: "smooth" })}
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        background: "#3a3530", color: TEXT.inverse, padding: "10px 20px", borderRadius: 24,
        fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, cursor: "pointer",
        zIndex: 50, boxShadow: "0 4px 16px rgba(0,0,0,0.2)", border: "none",
      }}>
      {count} requirements remaining &#9650;
    </button>
  );
}

// ── PinModal ────────────────────────────────────────────────────────────────
function PinModal({ code, title, programs, onPin, onClose, slotAssignments, overlaps }) {
  const assignments = slotAssignments?.[code] || [];
  const pairs = overlaps?.pairs || {};

  // Find any overlap rules relevant to the programs this course is shared between
  const relevantRules = [];
  for (const [key, pair] of Object.entries(pairs)) {
    if (pair.max != null && pair.courses?.includes(code)) {
      const [a, b] = key.split("|");
      relevantRules.push({ a, b, ...pair });
    }
  }

  return (
    <BottomSheet onClose={onClose}>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "0.2rem" }}>Pin course to one program</div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.md, fontWeight: 700, marginBottom: "0.1rem" }}>{code}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, marginBottom: "0.8rem" }}>{title}</div>

      {/* Explanation block */}
      <div style={{ background: "#f8f6f2", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.6rem 0.8rem", marginBottom: "0.8rem" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: "#555", lineHeight: 1.5 }}>
          This course counts toward multiple programs.
          {relevantRules.map(r => ` ${r.a}/${r.b} allows up to ${r.max} shared (${r.count} used).`).join("")}
        </div>
      </div>

      {/* Slot assignments */}
      {assignments.length > 0 && (
        <div style={{ marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, fontWeight: 600, color: TEXT.muted, marginBottom: "0.3rem" }}>Currently fills:</div>
          {assignments.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[a.programCode] || "#888", flexShrink: 0 }} />
              <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary }}>
                {a.programCode}: {a.categoryName}
              </span>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {programs.map(p => (
          <button key={p} onClick={() => onPin(code, p)} style={{
            fontFamily: FONT.mono, fontSize: TYPE.md, padding: "0.7rem",
            background: COLORS[p] || "#444", color: TEXT.inverse, border: "none", borderRadius: 6, cursor: "pointer",
          }}>
            Pin to {p}
          </button>
        ))}
        <button onClick={() => onPin(code, null)} style={{
          fontFamily: FONT.mono, fontSize: TYPE.base, padding: "0.6rem",
          background: SURFACE.hover, color: TEXT.secondary, border: `1px solid ${BORDER}`, borderRadius: 6, cursor: "pointer",
        }}>
          Let solver decide automatically
        </button>
        <button onClick={onClose} style={{
          fontFamily: FONT.mono, fontSize: TYPE.base, padding: "0.5rem",
          background: "transparent", color: TEXT.disabled, border: "none", cursor: "pointer",
        }}>
          Cancel
        </button>
      </div>
    </BottomSheet>
  );
}

// ── SlotModal ──────────────────────────────────────────────────────────────
function SlotModal({ programCode, categoryName, onClose }) {
  const [courses, setCourses] = useState(null);
  const [detail, setDetail] = useState(null);

  useEffect(() => {
    const params = new URLSearchParams({ programId: programCode, categoryName });
    api.get(`/api/courses/for-slot?${params}`).then(setCourses);
  }, [programCode, categoryName]);

  if (detail) {
    return (
      <BottomSheet onClose={onClose} maxWidth={480}>
        <CourseDetailSheet course={detail} categoryName={categoryName} onBack={() => setDetail(null)} />
      </BottomSheet>
    );
  }

  return (
    <BottomSheet onClose={onClose} maxWidth={480}>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: COLORS[programCode] || "#666", marginBottom: "0.2rem" }}>{programCode}</div>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "0.8rem" }}>{categoryName}</div>

      {!courses && <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, textAlign: "center", padding: "2rem" }}>finding eligible courses...</div>}

      {courses && courses.length === 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, textAlign: "center", padding: "2rem" }}>
          No courses match this slot yet.
        </div>
      )}

      {courses && courses.map(c => (
        <button type="button" key={c.code} onClick={() => setDetail(c)} style={{
          padding: "0.6rem 0", cursor: "pointer",
          background: "none", border: "none", borderTop: `1px solid ${BORDER}`, textAlign: "left", width: "100%",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 700 }}>{c.code}</span>
                <span style={{ fontFamily: FONT.serif, fontSize: TYPE.base, color: TEXT.primary }}>{c.title}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{c.credits}cr</span>
              </div>
              {c.description && (
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: "0.3rem" }}>
                  {c.description.slice(0, 80)}{c.description.length > 80 ? "..." : ""}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {c.alreadyTaken && <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#e8f5e9", padding: "2px 6px", borderRadius: 3, color: TEXT.success }}>taking</span>}
                {c.writing_intensive && <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#e3f2fd", padding: "2px 5px", borderRadius: 2, color: "#1565c0" }}>WI</span>}
                {c.engaged_learning && <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: "#f3e5f5", padding: "2px 5px", borderRadius: 2, color: "#7b1fa2" }}>EL</span>}
              </div>
              {c.friends.length > 0 && (
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginTop: "0.2rem" }}>
                  {c.friends.map(f => f.name).join(", ")} {c.friends.length === 1 ? "is" : "are"} taking this
                </div>
              )}
            </div>
            <span style={{ color: "#c0b8b0", fontSize: TYPE.md, marginLeft: "0.5rem" }}>&rsaquo;</span>
          </div>
        </button>
      ))}
    </BottomSheet>
  );
}

// ── CourseDetailSheet ───────────────────────────────────────────────────────
function CourseDetailSheet({ course, categoryName, onBack }) {
  return (
    <div>
      <button type="button" onClick={onBack} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, cursor: "pointer", marginBottom: "0.8rem", background: "none", border: "none", padding: 0, textAlign: "left" }}>
        &larr; Back to {categoryName}
      </button>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.lg, fontWeight: 700 }}>{course.code}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted }}>{course.credits} credits</span>
      </div>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "1rem" }}>{course.title}</div>

      {course.description && (
        <div style={{ marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.2rem" }}>Description</div>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary, lineHeight: 1.5 }}>{course.description}</div>
        </div>
      )}

      {course.prerequisites && (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary, marginBottom: "0.5rem" }}>
          <strong>Prerequisites:</strong> {course.prerequisites}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.8rem" }}>
        <DetailItem label="Knowledge Area" value={course.knowledge_area || "--"} />
        <DetailItem label="Department" value={course.department || "--"} />
        <DetailItem label="Writing Intensive" value={course.writing_intensive ? "Yes" : "No"} />
        <DetailItem label="Engaged Learning" value={course.engaged_learning ? "Yes" : "No"} />
      </div>

      {course.interdisciplinary_options?.length > 0 && (
        <div style={{ marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.2rem" }}>Interdisciplinary</div>
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
            {course.interdisciplinary_options.map(opt => (
              <span key={opt} style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: SURFACE.hover, padding: "2px 6px", borderRadius: 3, color: TEXT.secondary }}>{opt}</span>
            ))}
          </div>
        </div>
      )}

      {course.friends?.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.2rem" }}>Friends taking this</div>
          {course.friends.map(f => (
            <div key={f.id} style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary }}>{f.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: 1 }}>{label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary }}>{value}</div>
    </div>
  );
}

// ── CourseDetailModal (standalone, for pip taps) ────────────────────────────
function CourseDetailModal({ code, onClose, onRefresh }) {
  const [course, setCourse] = useState(null);
  const [studentCourse, setStudentCourse] = useState(null);
  const [editing, setEditing] = useState(false);
  const [editTerm, setEditTerm] = useState("");
  const [editStatus, setEditStatus] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    api.get(`/api/courses/${encodeURIComponent(code)}`).then(setCourse).catch(() => {});
    api.get("/api/students/me/courses").then(courses => {
      const match = courses.find(c => c.code === code || c.course_code === code);
      setStudentCourse(match || null);
      if (match) { setEditTerm(match.semester || ""); setEditStatus(match.status || ""); }
    }).catch(() => {});
  }, [code]);

  const handleSave = async () => {
    setSaving(true);
    const safeCode = code.replace(" ", "-");
    const oldSemester = studentCourse?.semester;
    await api.put(`/api/students/me/courses/${safeCode}${oldSemester ? `?semester=${encodeURIComponent(oldSemester)}` : ""}`, {
      semester: editTerm || undefined,
      status: editStatus || undefined,
    });
    setSaving(false);
    setEditing(false);
    onRefresh?.();
    onClose();
  };

  const handleDelete = async () => {
    const safeCode = code.replace(" ", "-");
    const semester = studentCourse?.semester;
    await api.delete(`/api/students/me/courses/${safeCode}${semester ? `?semester=${encodeURIComponent(semester)}` : ""}`);
    onRefresh?.();
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} maxWidth={480}>
      {!course ? (
        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, padding: "2rem", textAlign: "center" }}>pulling course details...</div>
      ) : (
        <div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.lg, fontWeight: 700 }}>{course.code}</span>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted }}>{course.credits} credits</span>
          </div>
          <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "1rem" }}>{course.title}</div>

          {studentCourse && !editing && (
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.8rem" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary }}>
                <strong>Term:</strong> {studentCourse.semester}
                {studentCourse.status && <span style={{ marginLeft: "0.5rem", fontSize: TYPE.xs, background: `${STATUS_COLOR[studentCourse.status] || "#888"}18`, color: STATUS_COLOR[studentCourse.status] || "#888", padding: "2px 6px", borderRadius: 3 }}>{studentCourse.status}</span>}
              </div>
              <button type="button" onClick={() => setEditing(true)} style={{
                fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#6f42c1", background: "none", border: "none", cursor: "pointer",
              }}>edit</button>
            </div>
          )}

          {editing && (
            <div style={{ background: SURFACE.hover, border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.6rem", marginBottom: "0.8rem" }}>
              <div style={{ display: "flex", gap: "0.4rem", marginBottom: "0.4rem" }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: 2 }}>Term</div>
                  <input value={editTerm} onChange={e => setEditTerm(e.target.value)}
                    placeholder="e.g. Spring 2026"
                    style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.4rem", border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%", boxSizing: "border-box" }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: 2 }}>Status</div>
                  <select value={editStatus} onChange={e => setEditStatus(e.target.value)}
                    style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.3rem 0.4rem", border: `1px solid ${BORDER}`, borderRadius: 4, width: "100%", boxSizing: "border-box" }}>
                    <option value="complete">complete</option>
                    <option value="enrolled">enrolled</option>
                    <option value="planned">planned</option>
                    <option value="transfer">transfer</option>
                  </select>
                </div>
              </div>
              <div style={{ display: "flex", gap: "0.4rem" }}>
                <button type="button" disabled={saving} onClick={handleSave} style={{
                  flex: 1, fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.35rem",
                  background: BTN.primary, color: TEXT.inverse, border: "none", borderRadius: 4, cursor: "pointer",
                }}>{saving ? "saving..." : "save"}</button>
                <button type="button" onClick={() => setEditing(false)} style={{
                  fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.35rem 0.6rem",
                  background: "transparent", border: `1px solid ${BORDER}`, borderRadius: 4, cursor: "pointer",
                }}>cancel</button>
              </div>
              <div style={{ borderTop: `1px solid ${BORDER}`, marginTop: "0.5rem", paddingTop: "0.5rem" }}>
                {!confirmDelete ? (
                  <button type="button" onClick={() => setConfirmDelete(true)} style={{
                    fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.danger, background: "none", border: "none", cursor: "pointer",
                  }}>remove this course</button>
                ) : (
                  <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                    <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.danger }}>Are you sure?</span>
                    <button type="button" onClick={handleDelete} style={{
                      fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.5rem",
                      background: TEXT.danger, color: TEXT.inverse, border: "none", borderRadius: 3, cursor: "pointer",
                    }}>yes, remove</button>
                    <button type="button" onClick={() => setConfirmDelete(false)} style={{
                      fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, background: "none", border: "none", cursor: "pointer",
                    }}>cancel</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {course.description && (
            <div style={{ marginBottom: "0.8rem" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.2rem" }}>Description</div>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.primary, lineHeight: 1.5 }}>{course.description}</div>
            </div>
          )}

          {course.prerequisites && (
            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary, marginBottom: "0.5rem" }}>
              <strong>Prerequisites:</strong> {course.prerequisites}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.4rem", marginBottom: "0.8rem" }}>
            <DetailItem label="Knowledge Area" value={course.knowledge_area || "--"} />
            <DetailItem label="Department" value={course.department || "--"} />
            <DetailItem label="Writing Intensive" value={course.writing_intensive ? "Yes" : "No"} />
            <DetailItem label="Engaged Learning" value={course.engaged_learning ? "Yes" : "No"} />
          </div>

          {course.interdisciplinary_options?.length > 0 && (
            <div style={{ marginBottom: "0.8rem" }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, marginBottom: "0.2rem" }}>Interdisciplinary</div>
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {course.interdisciplinary_options.map(opt => (
                  <span key={opt} style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, background: SURFACE.hover, padding: "2px 6px", borderRadius: 3, color: TEXT.secondary }}>{opt}</span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </BottomSheet>
  );
}

// ── AddCoursesSheet ─────────────────────────────────────────────────────────
function AddCoursesSheet({ initialTerm, onClose, onSaved }) {
  const [term, setTerm] = useState(initialTerm || getCurrentAcademicTerm());
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [selected, setSelected] = useState([]); // array of { code, title, credits }
  const [saving, setSaving] = useState(false);
  const debounceRef = useRef(null);

  const termOptions = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const terms = [];
    // Current and next few terms
    if (month <= 5) terms.push(`Spring ${year}`);
    if (month <= 7) terms.push(`Summer ${year}`);
    terms.push(`Fall ${year}`);
    terms.push(`Spring ${year + 1}`);
    return [...new Set(terms)];
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      api.get(`/api/courses/search?q=${encodeURIComponent(query.trim())}`).then(r => {
        setResults(Array.isArray(r) ? r : r.results || []);
      });
    }, 250);
    return () => clearTimeout(debounceRef.current);
  }, [query]);

  const toggleCourse = (course) => {
    setSelected(prev => {
      const exists = prev.find(c => c.code === course.code);
      if (exists) return prev.filter(c => c.code !== course.code);
      return [...prev, { code: course.code, title: course.title, credits: course.credits || 3 }];
    });
  };

  const isSelected = (code) => selected.some(c => c.code === code);

  const totalCredits = selected.reduce((s, c) => s + (c.credits || 3), 0);

  const handleSave = async () => {
    if (selected.length === 0) return;
    setSaving(true);
    await api.post("/api/students/me/courses/bulk", {
      courses: selected.map(c => ({ code: c.code, semester: term, status: "enrolled" })),
    });
    setSaving(false);
    onSaved?.();
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} maxWidth={480}>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "0.5rem" }}>Add Courses</div>

      {/* Term selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: "0.8rem", flexWrap: "wrap" }}>
        {termOptions.map(t => (
          <button key={t} onClick={() => setTerm(t)} style={{
            fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "4px 10px", borderRadius: 12,
            border: `1px solid ${term === t ? "#1a1a1a" : BORDER}`,
            background: term === t ? "#1a1a1a" : "transparent",
            color: term === t ? "#fff" : "#666", cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>

      {/* Search */}
      <Input placeholder="Search courses..." aria-label="Search courses" value={query} onChange={e => setQuery(e.target.value)}
        style={{ marginBottom: "0.5rem" }} />

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: "0.5rem" }}>
          {selected.map(c => (
            <button type="button" key={c.code} onClick={() => toggleCourse(c)} style={{
              fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "3px 8px", borderRadius: 4,
              background: "#e8f5e9", color: TEXT.success, cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4, border: "none",
            }}>
              {c.code} <span style={{ color: TEXT.muted }}>&times;</span>
            </button>
          ))}
        </div>
      )}

      {/* Results */}
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        {results.slice(0, 20).map(c => (
          <button type="button" key={c.code} onClick={() => toggleCourse(c)} style={{
            display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0",
            cursor: "pointer",
            background: "none", border: "none", borderTop: `1px solid ${BORDER}`, textAlign: "left", width: "100%",
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${isSelected(c.code) ? "#22863a" : "#ccc"}`,
              background: isSelected(c.code) ? "#22863a" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: TEXT.inverse, fontSize: TYPE.xs,
            }}>
              {isSelected(c.code) && "\u2713"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600 }}>
                {c.code} <span style={{ fontWeight: 400, color: TEXT.secondary }}>{c.title}</span>
              </div>
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, flexShrink: 0 }}>{c.credits || 3}cr</span>
          </button>
        ))}
      </div>

      {/* Footer */}
      {selected.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.8rem", marginTop: "0.5rem",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary }}>
            {selected.length} course{selected.length !== 1 ? "s" : ""} · {totalCredits} credits
          </span>
          <Btn onClick={handleSave} style={{ padding: "0.5rem 1.5rem" }}>
            {saving ? "saving..." : "Save"}
          </Btn>
        </div>
      )}
    </BottomSheet>
  );
}

// ── TransferMappingSheet ────────────────────────────────────────────────────
function TransferMappingSheet({ onClose, onSaved }) {
  const [rows, setRows] = useState([{ label: "", creditHours: 3, satisfiesCode: "" }]);
  const [saving, setSaving] = useState(false);

  const addRow = () => setRows(prev => [...prev, { label: "", creditHours: 3, satisfiesCode: "" }]);

  const updateRow = (idx, field, value) => {
    setRows(prev => prev.map((r, i) => i === idx ? { ...r, [field]: value } : r));
  };

  const removeRow = (idx) => {
    if (rows.length <= 1) return;
    setRows(prev => prev.filter((_, i) => i !== idx));
  };

  const totalCredits = rows.reduce((s, r) => s + (parseFloat(r.creditHours) || 0), 0);

  const handleSave = async () => {
    const valid = rows.filter(r => r.label.trim() || r.satisfiesCode.trim());
    if (valid.length === 0) return;
    setSaving(true);
    await api.post("/api/students/me/transfer-credits", {
      credits: valid.map(r => ({
        label: r.label.trim(),
        creditHours: parseFloat(r.creditHours) || 3,
        satisfiesCode: r.satisfiesCode.trim() || undefined,
      })),
    });
    setSaving(false);
    onSaved?.();
    onClose();
  };

  return (
    <BottomSheet onClose={onClose} maxWidth={480}>
      <div style={{ fontFamily: FONT.serif, fontSize: TYPE.xl, fontWeight: 600, marginBottom: "0.2rem" }}>Transfer Credits</div>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, marginBottom: "1rem" }}>
        Add credits from other institutions
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{
          display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 8,
          padding: "0.5rem 0", borderTop: i ? `1px solid ${BORDER}` : "none",
        }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Input placeholder="Description (e.g. Intro to Psych)" aria-label="Transfer credit description"
              value={row.label} onChange={e => updateRow(i, "label", e.target.value)}
              style={{ fontSize: TYPE.base }} />
            <div style={{ display: "flex", gap: 6 }}>
              <Input type="number" placeholder="Cr" aria-label="Credit hours"
                value={row.creditHours}
                onChange={e => updateRow(i, "creditHours", e.target.value)}
                style={{ width: 50, fontSize: TYPE.base, textAlign: "center" }} />
              <Input placeholder="Catalog code (optional, e.g. PSYC 101)" aria-label="Catalog course code"
                value={row.satisfiesCode} onChange={e => updateRow(i, "satisfiesCode", e.target.value)}
                style={{ flex: 1, fontSize: TYPE.base }} />
            </div>
          </div>
          {rows.length > 1 && (
            <button onClick={() => removeRow(i)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: FONT.mono, fontSize: TYPE.lg, color: "#ccc", padding: "0.3rem",
            }}>&times;</button>
          )}
        </div>
      ))}

      <button onClick={addRow} style={{
        fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, background: "transparent",
        border: `1px dashed ${BORDER}`, borderRadius: 6, padding: "0.5rem", width: "100%",
        cursor: "pointer", marginBottom: "0.8rem",
      }}>
        + Add another
      </button>

      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.8rem",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary }}>
          {rows.length} credit{rows.length !== 1 ? "s" : ""} · {totalCredits} hours
        </span>
        <Btn onClick={handleSave} style={{ padding: "0.5rem 1.5rem" }}>
          {saving ? "saving..." : "Save"}
        </Btn>
      </div>
    </BottomSheet>
  );
}

// ── ProgramPickerList ─────────────────────────────────────────────────────────
function ProgramPickerList({ label, items, selected, onToggle, search, onSearch, loading, maxHeight = 300 }) {
  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, marginBottom: 8 }}>
        {label}
      </div>
      <input
        type="text"
        placeholder="search programs..."
        aria-label="Search programs"
        value={search}
        onChange={e => onSearch(e.target.value)}
        style={{
          ...sharedStyles.input, width: "100%", boxSizing: "border-box",
          marginBottom: 10, fontSize: TYPE.base,
        }}
      />
      <div style={{ maxHeight, overflowY: "auto", border: `1px solid ${BORDER}`, borderRadius: 8, background: SURFACE.card }}>
        {items.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.disabled }}>
            {loading ? "loading programs..." : "no programs match your search"}
          </div>
        )}
        {items.map(p => {
          const isSelected = selected.includes(p.code);
          const color = programColor(p.code);
          return (
            <button key={p.code} onClick={() => onToggle(p.code)}
              style={{
                display: "flex", alignItems: "center", gap: 10, width: "100%",
                padding: "10px 12px", cursor: "pointer",
                borderBottom: `1px solid ${BORDER}`, borderTop: "none", borderLeft: "none", borderRight: "none",
                background: isSelected ? color + "0a" : "transparent",
                textAlign: "left",
              }}>
              <div style={{
                width: 18, height: 18, borderRadius: 4, flexShrink: 0,
                border: `2px solid ${isSelected ? color : "#ccc"}`,
                background: isSelected ? color : "transparent",
                display: "flex", alignItems: "center", justifyContent: "center",
                color: TEXT.inverse, fontSize: TYPE.xs,
              }}>
                {isSelected && "\u2713"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, color: isSelected ? color : "#333" }}>{p.name}</span>
                  {p.degree && <span style={{
                    fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", borderRadius: 3,
                    background: "#eee", color: TEXT.secondary, flexShrink: 0,
                  }}>{p.degree}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.disabled }}>{p.code}</span>
                  {p.modeled ? (
                    <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", borderRadius: 3, background: "#e8f5e9", color: TEXT.success }}>full tracking</span>
                  ) : (
                    <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 6px", borderRadius: 3, background: "#f0f0f0", color: TEXT.disabled }}>credit tracking only</span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── OnboardingWizard ─────────────────────────────────────────────────────────
// ── Transfer Credit Course Search ──────────────────────────────────────────
function TransferCourseSearch({ value, onSelect, onChange }) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState([]);
  const [focused, setFocused] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => { setQuery(value || ""); }, [value]);

  useEffect(() => {
    if (query.length < 2) { setResults([]); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const data = await api.get(`/api/courses/search?q=${encodeURIComponent(query)}`);
        setResults((Array.isArray(data) ? data : []).slice(0, 6));
      } catch { setResults([]); }
    }, 250);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [query]);

  return (
    <div style={{ position: "relative", marginTop: 6 }}>
      <Input placeholder="Search LUC course (e.g. BIOL 101)" aria-label="Map to LUC course"
        value={query}
        onChange={e => { setQuery(e.target.value); onChange?.(e.target.value); }}
        onFocus={() => setFocused(true)}
        onBlur={() => setTimeout(() => setFocused(false), 200)}
        style={{ fontSize: TYPE.xs, color: TEXT.muted }} />
      {focused && results.length > 0 && (
        <div style={{
          position: "absolute", top: "100%", left: 0, right: 0, zIndex: 10,
          background: SURFACE.card, border: `1px solid ${BORDER}`, borderRadius: 4,
          boxShadow: SHADOW.card, maxHeight: 180, overflow: "auto",
        }}>
          {results.map(c => (
            <button key={c.code} type="button" onClick={() => {
              onSelect(c.code, c.knowledge_area);
              setQuery(c.code);
              setResults([]);
            }} style={{
              display: "block", width: "100%", padding: "0.3rem 0.5rem", textAlign: "left",
              fontFamily: FONT.mono, fontSize: TYPE.xs, border: "none", cursor: "pointer",
              background: "transparent", borderBottom: `1px solid ${BORDER}`,
            }}>
              <strong>{c.code}</strong> {c.title}
              {c.knowledge_area && <span style={{ color: TEXT.muted, marginLeft: "0.3rem" }}>· {c.knowledge_area}</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function OnboardingWizard({ user, onComplete, initialStep }) {
  const [step, setStep] = useState(initialStep || 1);
  const [gradYear, setGradYear] = useState(user.grad_year || "");
  const [programs, setPrograms] = useState([]);
  const [minors, setMinors] = useState([]);
  const [programCatalog, setProgramCatalog] = useState([]);
  const [programSearch, setProgramSearch] = useState("");
  const [minorSearch, setMinorSearch] = useState("");
  const [programSubStep, setProgramSubStep] = useState(0); // 0=majors, 1=minors
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [reviewCourses, setReviewCourses] = useState([]);
  const [reviewTransfer, setReviewTransfer] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");
  // Steps 4-7 state
  const [solveResult, setSolveResult] = useState(null);
  const [pastEnrolled, setPastEnrolled] = useState([]);
  const [courseUpdates, setCourseUpdates] = useState({});
  const [adjustMode, setAdjustMode] = useState(false);
  const [currentTermSearch, setCurrentTermSearch] = useState("");
  const [currentTermResults, setCurrentTermResults] = useState([]);
  const [currentTermSelected, setCurrentTermSelected] = useState([]);
  const [transferRows, setTransferRows] = useState([]);
  const [transferTotal, setTransferTotal] = useState(0);
  const [coreCategories, setCoreCategories] = useState([]);
  const searchTimer = useRef(null);

  const toggleProgram = (pid) => {
    setPrograms(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]);
  };

  const toggleMinor = (pid) => {
    setMinors(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]);
  };

  useEffect(() => {
    fetch("/api/programs/catalog").then(r => r.json()).then(setProgramCatalog).catch(() => {});
    fetch("/api/programs/CORE").then(r => r.json()).then(p => {
      if (p?.categories) setCoreCategories(p.categories.map(c => c.name));
    }).catch(() => {});
  }, []);

  // Skip logic — accepts overrides for state that may not be committed yet
  const shouldSkip = (s, overrides = {}) => {
    if (s === 4) return (overrides.pastEnrolled ?? pastEnrolled).length === 0;
    if (s === 5) {
      const currentTerm = getCurrentAcademicTerm();
      return (overrides.solveResult ?? solveResult)?.semesters?.includes(currentTerm);
    }
    if (s === 6) return (overrides.reviewTransfer ?? reviewTransfer).length === 0 && (overrides.transferTotal ?? transferTotal) === 0;
    return false; // step 7 never skipped
  };

  const advanceFrom = (current, overrides = {}) => {
    let next = current + 1;
    while (next < 7 && shouldSkip(next, overrides)) next++;
    setStep(next);
    api.put("/api/students/me/onboarding", { step: next });
  };

  // Auto-populate transfer rows when step 6 is entered
  useEffect(() => {
    if (step === 6 && transferRows.length === 0 && reviewTransfer.filter(t => t.included).length > 0) {
      setTransferRows(reviewTransfer.filter(t => t.included).map(t => ({
        code: t.code, label: t.title || "", credits: t.credits || 3, satisfiesCode: "", satisfies: [],
      })));
    }
  }, [step, reviewTransfer]);

  // Fetch fresh solve data when reaching step 7 (or any step needing it)
  useEffect(() => {
    if (step === 7) {
      api.get("/api/students/me/solve").then(setSolveResult);
    }
  }, [step]);

  // Resume logic: when initialStep >= 4, fetch data from server
  useEffect(() => {
    if (!initialStep || initialStep < 4) return;
    api.get("/api/students/me/courses").then(courses => {
      const currentTerm = getCurrentAcademicTerm();
      const past = courses.filter(c => c.status === "enrolled"
        && termOrderClient(c.semester) < termOrderClient(currentTerm))
        .map(c => ({ ...c, dbCode: c.code }));
      setPastEnrolled(past);
      const xfer = courses.filter(c => c.semester === "Transfer");
      setReviewTransfer(xfer.map(c => ({ code: c.code, included: true, credits: c.credits_override || 3, title: c.note || "" })));
      setTransferTotal(xfer.reduce((s, c) => s + (c.credits_override || 3), 0));
    });
    api.get("/api/students/me/solve").then(setSolveResult);
  }, [initialStep]);

  const majorCatalog = programCatalog.filter(p => p.type !== "minor");
  const minorCatalog = programCatalog.filter(p => p.type === "minor");

  const filterAndSort = (catalog, searchStr, selectedList) => {
    let filtered = catalog;
    if (searchStr) {
      const q = searchStr.toLowerCase();
      filtered = catalog.filter(p => p.name.toLowerCase().includes(q) || p.code.toLowerCase().includes(q) || (p.department || "").toLowerCase().includes(q) || (p.college || "").toLowerCase().includes(q));
    }
    return [...filtered].sort((a, b) => {
      const aSelected = selectedList.includes(a.code) ? 0 : 1;
      const bSelected = selectedList.includes(b.code) ? 0 : 1;
      if (aSelected !== bSelected) return aSelected - bSelected;
      return a.name.localeCompare(b.name);
    });
  };

  const sortedPrograms = filterAndSort(majorCatalog, programSearch, programs);
  const sortedMinors = filterAndSort(minorCatalog, minorSearch, minors);

  // Step 1: Save programs + grad year
  const saveStep1 = async () => {
    setError("");
    const allProgs = [...new Set([...programs, ...minors, "CORE", "CAS-GRAD"])];
    try {
      await api.put("/api/students/me/programs", { programs: allProgs });
      if (gradYear) {
        await api.put("/api/students/me/settings", { grad_year: parseInt(gradYear) || null });
      }
      setStep(2);
    } catch (e) {
      setError("Failed to save programs");
    }
  };

  // Step 2: Upload transcript
  const handleFileUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/transcript/parse", {
        method: "POST",
        credentials: "include",
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to parse transcript");
        setUploading(false);
        return;
      }
      setParseResult(data);

      // Flatten courses for review
      const courses = [];
      for (const term of data.terms) {
        for (const c of term.courses) {
          courses.push({ ...c, semester: term.name, included: true });
        }
      }
      setReviewCourses(courses);

      // Transfer items
      const transfer = (data.transferCredits?.items || []).map(t => ({
        ...t, semester: "Transfer", included: true,
      }));
      setReviewTransfer(transfer);

      setStep(3);
    } catch (e) {
      setError("Failed to upload transcript");
    }
    setUploading(false);
  };

  // Step 3: Confirm
  const handleConfirm = async () => {
    setError("");
    setConfirming(true);

    const allProgs = [...new Set([...programs, ...minors, "CORE", "CAS-GRAD"])];
    const coursesToSend = reviewCourses
      .filter(c => c.included)
      .map(c => ({
        code: c.code,
        matchedCode: c.matchedCode,
        semester: c.semester,
        status: c.status,
        grade: c.grade || null,
      }));

    const transferToSend = reviewTransfer
      .filter(t => t.included)
      .map(t => ({
        code: t.code,
        matchedCode: t.matchedCode,
      }));

    try {
      const res = await fetch("/api/transcript/confirm", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          courses: coursesToSend,
          transferCredits: { items: transferToSend },
          programs: allProgs,
          gradYear: parseInt(gradYear) || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Failed to save courses");
        setConfirming(false);
        return;
      }
      setSolveResult(data);
      // Compute past enrolled courses
      const currentTerm = getCurrentAcademicTerm();
      const past = reviewCourses.filter(c => c.included && c.status === "enrolled"
        && termOrderClient(c.semester) < termOrderClient(currentTerm))
        .map(c => ({ ...c, dbCode: c.matchedCode || c.code }));
      setPastEnrolled(past);
      const xferTotal = parseResult?.transferCredits?.total || 0;
      setTransferTotal(xferTotal);
      const xfer = reviewTransfer.filter(t => t.included);
      advanceFrom(3, { solveResult: data, pastEnrolled: past, reviewTransfer: xfer, transferTotal: xferTotal });
    } catch (e) {
      setError("Failed to save courses");
      setConfirming(false);
    }
  };

  const matchIcon = (type) => {
    if (type === "exact") return { symbol: "\u2713", color: TEXT.success, bg: "#e8f5e9" };
    if (type === "unmatched") return { symbol: "\u2717", color: TEXT.danger, bg: "#fde8e8" };
    return { symbol: "~", color: TEXT.warning, bg: "#fff8e1" };
  };

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 1000,
      display: "flex", alignItems: "flex-end", justifyContent: "center" }}
      onClick={(e) => { if (e.target === e.currentTarget) onComplete(); }}>
      <div onClick={e => e.stopPropagation()}
        style={{
          background: BG, borderRadius: "16px 16px 0 0", padding: "24px 20px 48px",
          width: "100%", maxWidth: 600, boxShadow: "0 -8px 32px rgba(0,0,0,0.15)",
          maxHeight: "90vh", overflowY: "auto",
        }}>

        {/* Drag handle */}
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "#d0ccc6", margin: "0 auto 20px" }} />

        {/* Step indicator */}
        <div style={{ display: "flex", gap: 6, justifyContent: "center", marginBottom: 24 }}>
          {[1, 2, 3, 4, 5, 6, 7].filter(s => s <= 3 || !shouldSkip(s)).map(s => (
            <div key={s} style={{
              width: s === step ? 24 : 8, height: 8, borderRadius: 4,
              background: s === step ? "#1a1a1a" : s < step ? "#22863a" : "#d0ccc6",
              transition: "all 0.3s",
            }} />
          ))}
        </div>

        {/* ── Step 1: Welcome + Programs ────────────────────────────────── */}
        {step === 1 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              welcome to <span>ramble</span><span style={{ color: TEXT.brand }}>maxxer</span>
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 24 }}>
              let's set up your degree tracking
            </p>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, marginBottom: 8 }}>
                expected graduation
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() + i).map(y => (
                  <button key={y} onClick={() => setGradYear(y)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
                      fontFamily: FONT.mono, fontSize: TYPE.md,
                      border: `2px solid ${gradYear == y ? "#1a1a1a" : BORDER}`,
                      background: gradYear == y ? "#1a1a1a" : "transparent",
                      color: gradYear == y ? "#fff" : "#5a5550",
                    }}>
                    {y}
                  </button>
                ))}
              </div>
            </div>

            {programSubStep === 0 ? (<>
              <ProgramPickerList
                label="your major(s)"
                items={sortedPrograms}
                selected={programs}
                onToggle={toggleProgram}
                search={programSearch}
                onSearch={setProgramSearch}
                loading={programCatalog.length === 0}
              />

              <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.disabled, marginBottom: 24 }}>
                Core + CAS graduation requirements are tracked automatically
              </div>

              {error && <ErrMsg>{error}</ErrMsg>}
              <Btn onClick={() => { if (programs.length > 0 && minorCatalog.length > 0) { setProgramSubStep(1); } else { saveStep1(); } }} full disabled={programs.length === 0}>continue</Btn>
            </>) : (<>
              <ProgramPickerList
                label="any minors?"
                items={sortedMinors}
                selected={minors}
                onToggle={toggleMinor}
                search={minorSearch}
                onSearch={setMinorSearch}
                loading={false}
                maxHeight={240}
              />

              {minors.length > 0 && (
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: 8 }}>
                  (not yet tracked — minors are saved as declarations)
                </div>
              )}

              {error && <ErrMsg>{error}</ErrMsg>}
              <div style={{ display: "flex", gap: "0.5rem" }}>
                <Btn onClick={saveStep1} full style={{ background: "transparent", color: TEXT.muted, border: `1px solid ${BORDER}` }}>skip</Btn>
                <Btn onClick={saveStep1} full>continue</Btn>
              </div>
            </>)}
          </div>
        )}

        {/* ── Step 2: Transcript Upload ─────────────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              import your transcript
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 24 }}>
              upload your unofficial transcript PDF to auto-populate your courses
            </p>

            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "40px 20px", borderRadius: 12, cursor: "pointer",
              border: `2px dashed ${BORDER}`, background: SURFACE.card,
              transition: "border-color 0.2s",
            }}>
              <input type="file" accept=".pdf" onChange={handleFileUpload}
                aria-label="Upload transcript PDF"
                style={{ display: "none" }} disabled={uploading} />
              {uploading ? (
                <span style={{ fontFamily: FONT.mono, fontSize: TYPE.md, color: TEXT.muted }}>
                  parsing transcript...
                </span>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>&#128196;</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.md, color: TEXT.primary, marginBottom: 4 }}>
                    tap to upload PDF
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled }}>
                    official or unofficial transcript from LOCUS (max 2MB)
                  </div>
                </>
              )}
            </label>

            {error && <div style={{ marginTop: 12 }}><ErrMsg>{error}</ErrMsg></div>}

            <button onClick={async () => {
              await api.put("/api/students/me/onboarding", { step: 0 });
              onComplete();
            }}
              style={{
                display: "block", width: "100%", marginTop: 20, padding: 12,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.disabled,
                textAlign: "center",
              }}>
              I'll add courses manually &rarr;
            </button>
          </div>
        )}

        {/* ── Step 3: Review ────────────────────────────────────────────── */}
        {step === 3 && parseResult && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              review your courses
            </h2>

            {/* Summary bar */}
            <div style={{
              display: "flex", gap: 12, padding: "10px 14px", borderRadius: 8,
              background: SURFACE.card, border: `1px solid ${BORDER}`, marginBottom: 16,
              fontFamily: FONT.mono, fontSize: TYPE.sm,
            }}>
              <span style={{ color: TEXT.success }}>
                found {parseResult.summary.exact + (parseResult.summary.fuzzy || 0)} of {parseResult.summary.exact + (parseResult.summary.fuzzy || 0) + parseResult.summary.unmatched} in catalog
              </span>
              {parseResult.summary.fuzzy > 0 && (
                <span style={{ color: TEXT.warning }}>{parseResult.summary.fuzzy} close match{parseResult.summary.fuzzy !== 1 ? "es" : ""}</span>
              )}
              {parseResult.summary.unmatched > 0 && (
                <span style={{ color: TEXT.danger }}>{parseResult.summary.unmatched} not found</span>
              )}
            </div>

            {/* Transfer credits */}
            {(reviewTransfer.length > 0 || parseResult.transferCredits?.total > 0) && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, marginBottom: 4, color: COLORS["CAS-GRAD"] }}>
                  Transfer Credits
                </div>
                {parseResult.transferCredits?.total > 0 && (
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, marginBottom: 8 }}>
                    Your transcript shows {parseResult.transferCredits.total} transfer credits
                  </div>
                )}
                {parseResult.transferCredits?.sources?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {parseResult.transferCredits.sources.map((src, i) => (
                      <span key={i} style={{
                        fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "3px 8px",
                        borderRadius: 4, background: "#f5f0eb", color: TEXT.secondary,
                      }}>
                        {src.type === "test" ? "Test/AP Credits" : src.name || "Transfer"} — {src.credits}cr
                      </span>
                    ))}
                  </div>
                )}
                {reviewTransfer.map((c, i) => {
                  const icon = matchIcon(c.matchType);
                  return (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                      borderTop: i ? `1px solid ${BORDER}` : "none",
                      opacity: c.included ? 1 : 0.4,
                    }}>
                      <button onClick={() => {
                        const next = [...reviewTransfer];
                        next[i] = { ...next[i], included: !next[i].included };
                        setReviewTransfer(next);
                      }} style={{
                        width: 22, height: 22, borderRadius: 4, border: `1px solid ${BORDER}`,
                        background: c.included ? "#1a1a1a" : "transparent", color: TEXT.inverse,
                        cursor: "pointer", fontSize: TYPE.xs, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, minWidth: 44, minHeight: 44, padding: 0,
                      }}>
                        {c.included && "\u2713"}
                      </button>
                      <span style={{
                        width: 18, height: 18, borderRadius: "50%", fontSize: TYPE.xs,
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: icon.bg, color: icon.color, flexShrink: 0,
                      }}>{icon.symbol}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600 }}>{c.code}</div>
                        <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title}
                        </div>
                      </div>
                      <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, flexShrink: 0 }}>
                        {c.credits}cr
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Term groups */}
            {parseResult.terms.map(term => {
              const termCourses = reviewCourses.filter(c => c.semester === term.name);
              if (termCourses.length === 0) return null;
              return (
                <div key={term.name} style={{ marginBottom: 16 }}>
                  <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600, marginBottom: 8 }}>
                    {term.name}
                  </div>
                  {termCourses.map((c, i) => {
                    const globalIdx = reviewCourses.indexOf(c);
                    const icon = matchIcon(c.matchType);
                    return (
                      <div key={i} style={{
                        display: "flex", alignItems: "center", gap: 8, padding: "8px 0",
                        borderTop: i ? `1px solid ${BORDER}` : "none",
                        opacity: c.included ? 1 : 0.4,
                      }}>
                        <button onClick={() => {
                          const next = [...reviewCourses];
                          next[globalIdx] = { ...next[globalIdx], included: !next[globalIdx].included };
                          setReviewCourses(next);
                        }} style={{
                          width: 22, height: 22, borderRadius: 4, border: `1px solid ${BORDER}`,
                          background: c.included ? "#1a1a1a" : "transparent", color: TEXT.inverse,
                          cursor: "pointer", fontSize: TYPE.xs, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, minWidth: 44, minHeight: 44, padding: 0,
                        }}>
                          {c.included && "\u2713"}
                        </button>
                        <span style={{
                          width: 18, height: 18, borderRadius: "50%", fontSize: TYPE.xs,
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: icon.bg, color: icon.color, flexShrink: 0,
                        }}>{icon.symbol}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, fontWeight: 600, display: "flex", alignItems: "center", gap: 6 }}>
                            <span>{c.matchedCode || c.code}</span>
                            {c.status === "complete" && (
                              <select
                                aria-label={`grade for ${c.matchedCode || c.code}`}
                                value={c.grade || ""}
                                onChange={(e) => {
                                  const next = [...reviewCourses];
                                  next[globalIdx] = { ...next[globalIdx], grade: e.target.value || null };
                                  setReviewCourses(next);
                                }}
                                style={{
                                  fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 4px",
                                  border: `1px solid ${BORDER}`, borderRadius: 3,
                                  background: "transparent", color: TEXT.muted, fontWeight: 400,
                                }}>
                                <option value="">—</option>
                                {["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "D-", "F", "P", "NP", "W", "WF", "I", "AU", "NR"].map(g => (
                                  <option key={g} value={g}>{g}</option>
                                ))}
                              </select>
                            )}
                          </div>
                          <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.matchedTitle || c.title}
                          </div>
                          {c.matchType !== "exact" && c.matchedCode && c.matchedCode !== c.code && (
                            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.warning }}>
                              transcript: {c.code} &rarr; matched: {c.matchedCode}
                            </div>
                          )}
                          {c.inferred && (
                            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.warning }}>
                              please verify — credits not in PDF
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted }}>{c.credits != null ? `${c.credits}cr` : "—"}</span>
                          <div style={{
                            fontFamily: FONT.mono, fontSize: TYPE.xs,
                            color: STATUS_COLOR[c.status] || "#888",
                          }}>{c.status}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            {error && <ErrMsg>{error}</ErrMsg>}

            <Btn onClick={handleConfirm} full style={{ marginTop: 8 }}>
              {confirming ? "saving..." : "looks good"}
            </Btn>
            <button onClick={() => setStep(2)}
              style={{
                display: "block", width: "100%", marginTop: 12, padding: 8,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, textAlign: "center",
              }}>
              &larr; upload a different file
            </button>
          </div>
        )}

        {/* ── Step 4: Are these done? ─────────────────────────────────── */}
        {step === 4 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              quick check on past courses
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 20 }}>
              these courses are from past terms but still marked "enrolled" — did you complete them?
            </p>

            {pastEnrolled.map((c, i) => {
              const chosen = courseUpdates[c.dbCode] || "complete";
              return (
                <div key={i} style={{
                  display: "flex", alignItems: "center", gap: 8, padding: "10px 0",
                  borderTop: i ? `1px solid ${BORDER}` : "none",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, fontWeight: 600 }}>
                      {c.matchedCode || c.code}
                    </div>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {c.matchedTitle || c.title} · {c.semester}
                    </div>
                  </div>
                  {adjustMode && (
                    <div style={{ display: "flex", gap: 4 }}>
                      {[["complete", "#22863a"], ["enrolled", "#b08800"], ["remove", "#c43b2d"]].map(([st, col]) => (
                        <button key={st} onClick={() => setCourseUpdates(prev => ({ ...prev, [c.dbCode]: st }))}
                          style={{
                            padding: "4px 8px", borderRadius: 4, cursor: "pointer",
                            fontFamily: FONT.mono, fontSize: TYPE.xs,
                            border: `1px solid ${chosen === st ? col : BORDER}`,
                            background: chosen === st ? col + "18" : "transparent",
                            color: chosen === st ? col : "#888",
                          }}>
                          {st === "remove" ? "withdrew" : st}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {error && <ErrMsg>{error}</ErrMsg>}

            {!adjustMode ? (
              <>
                <Btn onClick={async () => {
                  const updates = pastEnrolled.map(c => ({ code: c.dbCode, status: "complete" }));
                  await api.post("/api/students/me/courses/bulk-update", { updates });
                  advanceFrom(4);
                }} full style={{ marginTop: 12 }}>yes, all complete</Btn>
                <button onClick={() => setAdjustMode(true)}
                  style={{
                    display: "block", width: "100%", marginTop: 12, padding: 8,
                    background: "transparent", border: "none", cursor: "pointer",
                    fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, textAlign: "center",
                  }}>
                  let me adjust
                </button>
              </>
            ) : (
              <Btn onClick={async () => {
                const updates = pastEnrolled.map(c => ({
                  code: c.dbCode,
                  status: courseUpdates[c.dbCode] || "complete",
                }));
                await api.post("/api/students/me/courses/bulk-update", { updates });
                advanceFrom(4);
              }} full style={{ marginTop: 12 }}>continue</Btn>
            )}
          </div>
        )}

        {/* ── Step 5: What are you taking now? ────────────────────────── */}
        {step === 5 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              what are you taking this semester?
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 20 }}>
              it's {getCurrentAcademicTerm()} — add your current courses
            </p>

            <Input placeholder="search courses..." aria-label="Search courses"
              value={currentTermSearch}
              onChange={e => {
                const q = e.target.value;
                setCurrentTermSearch(q);
                clearTimeout(searchTimer.current);
                if (q.length >= 2) {
                  searchTimer.current = setTimeout(() => {
                    api.get(`/api/courses/search?q=${encodeURIComponent(q)}`).then(setCurrentTermResults);
                  }, 250);
                } else {
                  setCurrentTermResults([]);
                }
              }}
              style={{ marginBottom: 12 }}
            />

            {currentTermResults.length > 0 && (
              <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 12,
                border: `1px solid ${BORDER}`, borderRadius: 8, background: SURFACE.card }}>
                {currentTermResults.filter(c => !currentTermSelected.find(s => s.code === c.code)).map(c => (
                  <button key={c.code} onClick={() => {
                    setCurrentTermSelected(prev => [...prev, c]);
                    setCurrentTermSearch("");
                    setCurrentTermResults([]);
                  }} style={{
                    display: "block", width: "100%", textAlign: "left", padding: "10px 12px",
                    border: "none", borderBottom: `1px solid ${BORDER}`, background: "transparent",
                    cursor: "pointer", fontFamily: FONT.mono, fontSize: TYPE.base,
                  }}>
                    <strong>{c.code}</strong> — {c.title}
                    <span style={{ color: TEXT.muted, marginLeft: 8 }}>{c.credits || 3}cr</span>
                  </button>
                ))}
              </div>
            )}

            {currentTermSelected.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 16 }}>
                {currentTermSelected.map(c => (
                  <button type="button" key={c.code} onClick={() => setCurrentTermSelected(prev => prev.filter(s => s.code !== c.code))}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 4,
                      padding: "6px 10px", borderRadius: 6, cursor: "pointer",
                      fontFamily: FONT.mono, fontSize: TYPE.sm,
                      background: BTN.primary, color: TEXT.inverse, border: "none",
                    }}>
                    {c.code} · {c.credits || 3}cr ×
                  </button>
                ))}
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, width: "100%", marginTop: 4 }}>
                  {currentTermSelected.reduce((s, c) => s + (c.credits || 3), 0)} credits selected
                </div>
              </div>
            )}

            {error && <ErrMsg>{error}</ErrMsg>}

            <Btn onClick={async () => {
              if (currentTermSelected.length > 0) {
                const courses = currentTermSelected.map(c => ({
                  code: c.code,
                  semester: getCurrentAcademicTerm(),
                  status: "enrolled",
                }));
                await api.post("/api/students/me/courses/bulk", { courses });
              }
              advanceFrom(5);
            }} full disabled={currentTermSelected.length === 0}>save and continue</Btn>

            <button onClick={() => advanceFrom(5)}
              style={{
                display: "block", width: "100%", marginTop: 12, padding: 8,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, textAlign: "center",
              }}>
              skip for now
            </button>
          </div>
        )}

        {/* ── Step 6: Transfer Credits ────────────────────────────────── */}
        {step === 6 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4 }}>
              let's map your transfer credits
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 20 }}>
              your transcript shows {transferTotal} transfer credits
            </p>

            {transferRows.map((row, i) => (
              <div key={i} style={{
                padding: "10px 0",
                borderTop: i ? `1px solid ${BORDER}` : "none",
              }}>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                  <Input placeholder="What was it? (e.g. AP Biology)" aria-label="Transfer credit description" value={row.label}
                    onChange={e => {
                      const next = [...transferRows];
                      next[i] = { ...next[i], label: e.target.value };
                      setTransferRows(next);
                    }}
                    style={{ flex: 1, fontSize: TYPE.sm }} />
                  <Input placeholder="cr" aria-label="Credit hours" value={row.credits} type="number"
                    onChange={e => {
                      const next = [...transferRows];
                      next[i] = { ...next[i], credits: parseInt(e.target.value) || 0 };
                      setTransferRows(next);
                    }}
                    style={{ width: 50, fontSize: TYPE.sm }} />
                </div>
                {/* Core category checkboxes */}
                {coreCategories.length > 0 && (
                  <div style={{ marginLeft: 2 }}>
                    <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: TEXT.muted, marginBottom: 4 }}>
                      satisfies which Core requirement?
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 8px" }}>
                      {coreCategories.map(cat => {
                        const shortName = cat.replace(" and Inquiry", "").replace("Knowledge", "").replace("Seminar", "").trim();
                        const checked = (row.satisfies || []).includes(cat);
                        return (
                          <label key={cat} style={{
                            display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
                            fontFamily: FONT.mono, fontSize: TYPE.xs, color: checked ? "#1a1a1a" : "#888",
                            padding: "2px 0",
                          }}>
                            <input type="checkbox" checked={checked} onChange={() => {
                              const next = [...transferRows];
                              const sats = [...(next[i].satisfies || [])];
                              if (checked) sats.splice(sats.indexOf(cat), 1); else sats.push(cat);
                              next[i] = { ...next[i], satisfies: sats };
                              setTransferRows(next);
                            }} style={{ margin: 0 }} />
                            {shortName}
                          </label>
                        );
                      })}
                    </div>
                    {(row.satisfies || []).length === 0 && (
                      <div style={{ fontFamily: FONT.mono, fontSize: TYPE.xs, color: "#22863a", marginTop: 4, display: "flex", alignItems: "center", gap: 4 }}>
                        <span style={{ fontSize: TYPE.sm }}>ℹ</span> General credit — counts toward your 120 total
                      </div>
                    )}
                  </div>
                )}
                {/* Map to specific LUC course with search */}
                <TransferCourseSearch value={row.satisfiesCode} onSelect={(courseCode, knowledgeArea) => {
                  const next = [...transferRows];
                  next[i] = { ...next[i], satisfiesCode: courseCode };
                  // Auto-populate Core area from knowledge_area if not already set
                  if (knowledgeArea && (next[i].satisfies || []).length === 0) {
                    const matchingCat = coreCategories.find(cat =>
                      knowledgeArea.toLowerCase().includes(cat.replace(" and Inquiry", "").replace("Knowledge", "").trim().toLowerCase())
                    );
                    if (matchingCat) next[i] = { ...next[i], satisfies: [matchingCat] };
                  }
                  setTransferRows(next);
                }} onChange={(val) => {
                  const next = [...transferRows];
                  next[i] = { ...next[i], satisfiesCode: val };
                  setTransferRows(next);
                }} />
              </div>
            ))}

            <button onClick={() => setTransferRows(prev => [...prev, { code: "", label: "", credits: 3, satisfiesCode: "", satisfies: [] }])}
              style={{
                fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.secondary,
                padding: "8px 0", background: "transparent", border: "none", cursor: "pointer",
              }}>
              + add another
            </button>

            <div style={{ fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.muted, marginBottom: 12 }}>
              accounted for: {transferRows.reduce((s, r) => s + (r.credits || 0), 0)} / {transferTotal} credits
            </div>

            {error && <ErrMsg>{error}</ErrMsg>}

            <Btn onClick={async () => {
              for (const row of transferRows) {
                // Create new XFER entries for manually added rows
                if (!row.code && row.label) {
                  const res = await api.post("/api/students/me/transfer-credits", [{
                    label: row.label, credits: row.credits,
                  }]);
                  if (res?.created?.[0]) row.code = res.created[0].code;
                }
                if (!row.code) continue;
                const safeCode = row.code.replace(" ", "-");
                if (row.satisfiesCode) {
                  // Delete old XFER entry and insert real code
                  await fetch(`/api/students/me/courses/${safeCode}`, {
                    method: "DELETE", credentials: "include",
                  });
                  await api.post("/api/students/me/courses", {
                    code: row.satisfiesCode.toUpperCase(),
                    semester: "Transfer",
                    status: "transfer",
                    creditsOverride: row.credits,
                    note: row.label,
                  });
                } else {
                  const satisfiesJson = (row.satisfies || []).length > 0
                    ? JSON.stringify(row.satisfies.map(cat => ({ program: "CORE", category: cat })))
                    : null;
                  await api.put(`/api/students/me/courses/${safeCode}`, {
                    note: row.label,
                    creditsOverride: row.credits,
                    satisfiesJson,
                  });
                }
              }
              advanceFrom(6);
            }} full>save and continue</Btn>

            <button onClick={() => advanceFrom(6)}
              style={{
                display: "block", width: "100%", marginTop: 12, padding: 8,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: TYPE.sm, color: TEXT.disabled, textAlign: "center",
              }}>
              skip for now
            </button>
          </div>
        )}

        {/* ── Step 7: You're all set ──────────────────────────────────── */}
        {step === 7 && (() => {
          if (!solveResult) {
            return (
              <div style={{ textAlign: "center", padding: "2rem", fontFamily: FONT.mono, color: TEXT.muted }}>
                computing your progress...
              </div>
            );
          }

          const totalCredits = solveResult.credits?.total || 0;
          const creditPct = Math.min((totalCredits / 120) * 100, 100);
          const remainingCount = solveResult.remaining?.length || 0;

          return (
            <div>
              <h2 style={{ fontFamily: FONT.serif, fontSize: TYPE.xxl, fontWeight: 700, marginBottom: 4, textAlign: "center", animation: "expandIn 0.3s ease-out" }}>
                you're all set
              </h2>
              <p style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, marginBottom: 24, textAlign: "center", animation: "fadeIn 0.4s ease-out 0.15s both" }}>
                here's where you stand
              </p>

              {/* Credit progress bar */}
              <div style={{ marginBottom: 20 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT.mono, fontSize: TYPE.sm, marginBottom: 6 }}>
                  <span>credits</span>
                  <span>{totalCredits} / 120</span>
                </div>
                <div style={{ height: 10, borderRadius: 5, background: "#e8e4df", overflow: "hidden" }}>
                  <div style={{ height: "100%", width: `${creditPct}%`, borderRadius: 5, background: "#22863a", transition: "width 0.5s" }} />
                </div>
              </div>

              {/* Per-program progress */}
              {Object.entries(solveResult.programs || {}).map(([code, prog]) => {
                const filled = prog.categories?.reduce((s, c) => s + (c.filledCount || 0), 0) || 0;
                const total = prog.categories?.reduce((s, c) => s + (c.slotsNeeded || 0), 0) || 0;
                const pct = total > 0 ? Math.min((filled / total) * 100, 100) : 0;
                return (
                  <div key={code} style={{ marginBottom: 12 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", fontFamily: FONT.mono, fontSize: TYPE.sm, marginBottom: 4 }}>
                      <span style={{ color: programColor(code) }}>{prog.name || code}</span>
                      <span>{filled}/{total} slots</span>
                    </div>
                    <div style={{ height: 6, borderRadius: 3, background: "#e8e4df", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${pct}%`, borderRadius: 3, background: programColor(code), transition: "width 0.5s" }} />
                    </div>
                  </div>
                );
              })}

              {remainingCount > 0 && (
                <div style={{ fontFamily: FONT.mono, fontSize: TYPE.base, color: TEXT.muted, textAlign: "center", margin: "16px 0" }}>
                  {remainingCount} requirement{remainingCount !== 1 ? "s" : ""} remaining
                </div>
              )}

              <Btn onClick={() => {
                api.put("/api/students/me/onboarding", { step: 0 });
                onComplete();
              }} full style={{ marginTop: 16 }}>go to dashboard</Btn>
            </div>
          );
        })()}
      </div>
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ user, setUser, onLogout, setOnboardingActive }) {
  const [data, setData] = useState(null);
  const [pinModal, setPinModal] = useState(null);
  const [slotModal, setSlotModal] = useState(null);
  const [courseDetailModal, setCourseDetailModal] = useState(null); // { code }
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [addCoursesSheet, setAddCoursesSheet] = useState(null); // null or { term }
  const [transferSheet, setTransferSheet] = useState(false);
  const [planSummary, setPlanSummary] = useState(null);
  const remainingRef = useRef(null);
  const nextStepsRef = useRef(null);

  const refresh = useCallback(() => {
    api.get("/api/students/me/solve").then(setData);
    api.get("/api/students/me/plans").then(plans => {
      if (plans.length > 0 && plans[0].course_count > 0) setPlanSummary(plans[0]);
      else setPlanSummary(null);
    }).catch(() => {});
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Show onboarding for new users or resume interrupted onboarding
  useEffect(() => {
    if (showOnboarding) return;
    if (user.onboarding_step === null && data && data.credits.total === 0) {
      setShowOnboarding(true);
    } else if (user.onboarding_step > 0) {
      setShowOnboarding(true);
    }
  }, [data, user.onboarding_step]);

  // Notify parent when onboarding is active (hides feedback widget)
  useEffect(() => {
    setOnboardingActive?.(showOnboarding);
  }, [showOnboarding]);

  // Build conflicts: courses shared between any two programs that have an overlap rule
  const conflicts = useMemo(() => {
    if (!data) return {};
    const pairs = data.overlaps?.pairs || {};
    const ruledKeys = new Set(Object.keys(pairs).filter(k => pairs[k].max != null));
    return Object.entries(data.slotAssignments || {}).reduce((acc, [code, asgns]) => {
      const progCodes = [...new Set(asgns.map(a => a.programCode))];
      for (let i = 0; i < progCodes.length; i++) {
        for (let j = i + 1; j < progCodes.length; j++) {
          const key = [progCodes[i], progCodes[j]].sort().join("|");
          if (ruledKeys.has(key)) {
            if (!acc[code]) acc[code] = [];
            if (!acc[code].includes(progCodes[i])) acc[code].push(progCodes[i]);
            if (!acc[code].includes(progCodes[j])) acc[code].push(progCodes[j]);
          }
        }
      }
      return acc;
    }, {});
  }, [data]);

  const hasUnmappedTransfer = useMemo(() => {
    if (!data?.slotAssignments) return false;
    return Object.keys(data.slotAssignments).some(c => c.startsWith("XFER"));
  }, [data]);

  const handlePin = async (code, pinnedProgram) => {
    const safeCode = code.replace(" ", "-");
    await api.put(`/api/students/me/courses/${safeCode}`, { pinnedProgram });
    setPinModal(null);
    refresh();
  };

  const handlePipClick = (code, title, programs) => {
    if (programs) {
      setPinModal({ code, title, programs });
    } else {
      setCourseDetailModal({ code });
    }
  };

  const handleSlotTap = (programCode, categoryName) => {
    setSlotModal({ programCode, categoryName });
  };

  if (!data) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: TEXT.muted }}>crunching your requirements...</span>
    </div>
  );

  // Build program list dynamically from solver data
  const allPrograms = Object.values(data.programs || {});
  const declaredMajors = allPrograms.filter(p => p.type === "major");
  const declaredMinors = allPrograms.filter(p => p.type === "minor" || p.type === "requirement");
  const corePrograms = allPrograms.filter(p => p.type === "core");
  // CAS-GRAD and SPAN-LANG rendered separately by CASCard — exclude from majors list
  const majors = [...declaredMajors, ...corePrograms];
  const remainingCount = data.remaining?.length || 0;

  const stopImpersonating = async () => {
    await api.post("/api/admin/stop-impersonating");
    window.location.hash = "/admin";
    window.location.reload();
  };

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      {user.impersonating && (
        <div style={{
          background: "#6f42c1", color: "#fff", textAlign: "center",
          fontFamily: FONT.mono, fontSize: TYPE.sm, padding: "0.4rem",
          display: "flex", justifyContent: "center", alignItems: "center", gap: "0.5rem",
        }}>
          Viewing as {user.name}
          <button type="button" onClick={stopImpersonating} style={{
            background: "#fff", color: "#6f42c1", border: "none", borderRadius: 4,
            fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "2px 8px", cursor: "pointer",
          }}>Stop</button>
        </div>
      )}
      <StickyHeader user={user} onLogout={onLogout} onSettings={() => setShowSettings(true)}
        nav={<NavMenu items={[
          { label: "dashboard", href: "#/", current: true, color: TEXT.brand },
          { label: "planner", href: "#/planner", color: "#6f42c1" },
          { label: "grades", href: "#/grades", color: "#22863a" },
        ]} />}
      />

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem" }}>

        {/* Zone 1: Status overview */}
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.tight, marginBottom: SPACING.zone }}>
          <CreditMeter credits={data.credits} hasUnmappedTransfer={hasUnmappedTransfer}
            onTransferWarningTap={() => nextStepsRef.current?.scrollIntoView({ behavior: "smooth" })} />
          {allPrograms.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}>
              {declaredMajors.map(p => (
                <span key={p.code} style={{
                  fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.5rem", borderRadius: 4,
                  background: `${programColor(p.code)}15`, color: programColor(p.code),
                  border: `1px solid ${programColor(p.code)}30`,
                }}>
                  {p.name}
                </span>
              ))}
              {declaredMinors.map(p => (
                <span key={p.code} style={{
                  fontFamily: FONT.mono, fontSize: TYPE.xs, padding: "0.2rem 0.5rem", borderRadius: 4,
                  background: `${programColor(p.code)}10`, color: programColor(p.code),
                  border: `1px solid ${programColor(p.code)}20`,
                }}>
                  {p.name} <span style={{ opacity: 0.6 }}>minor</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Zone 2: Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.tight, marginBottom: SPACING.zone }}>
          <div ref={nextStepsRef}>
            <NextStepsSection data={data}
              planSummary={planSummary}
              onAddCourses={(term) => setAddCoursesSheet({ term })}
              onMapTransfer={() => setTransferSheet(true)}
              onSuggestionTap={() => remainingRef.current?.scrollIntoView({ behavior: "smooth" })}
            />
          </div>
          {Object.entries(data.overlaps?.pairs || {}).filter(([, p]) => p.max != null && p.count > p.max).map(([key, pair]) => {
            const [a, b] = key.split("|");
            const nameA = data.programs[a]?.name || a;
            const nameB = data.programs[b]?.name || b;
            return (
              <div key={key} style={{ background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 8, padding: "0.7rem 1rem", fontFamily: FONT.mono, fontSize: TYPE.base, color: "#721c24" }}>
                Over budget: {pair.count} {nameA}/{nameB} overlaps (max {pair.max}). Pin courses to fix.
              </div>
            );
          })}
        </div>

        {/* Zone 3: Program detail */}
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.normal, marginBottom: SPACING.zone }}>
          {majors.map(prog => (
            <ProgramCard key={prog.code} prog={prog} conflicts={conflicts} slotAssignments={data.slotAssignments} onPipClick={handlePipClick} onSlotTap={handleSlotTap}
              defaultOpen={prog.type === "major"} />
          ))}
          {declaredMinors.filter(p => p.type === "minor").map(prog => (
            <ProgramCard key={prog.code} prog={prog} conflicts={conflicts} slotAssignments={data.slotAssignments} onPipClick={handlePipClick} onSlotTap={handleSlotTap}
              defaultOpen={false} />
          ))}
          <OverlapBudget overlaps={data.overlaps} programs={data.programs} conflicts={conflicts} onPipClick={handlePipClick} overlapSummary={data.overlap_summary} />
          <CASCard casGrad={data.programs["CAS-GRAD"]} spanLang={data.programs["SPAN-LANG"]} />
        </div>

        {/* Zone 4: What's left */}
        <div style={{ display: "flex", flexDirection: "column", gap: SPACING.tight }}>
          <div ref={remainingRef}>
            <RemainingCard remaining={data.remaining} onSlotTap={handleSlotTap} />
          </div>
          <SuggestionsCard suggestions={data.suggestions} remaining={data.remaining} scrapedTerms={data.scrapedTerms} programs={data.programs} />
        </div>

      </div>

      {pinModal && (
        <PinModal code={pinModal.code} title={pinModal.title} programs={pinModal.programs}
          onPin={handlePin} onClose={() => setPinModal(null)}
          slotAssignments={data.slotAssignments} overlaps={data.overlaps} />
      )}

      {slotModal && (
        <SlotModal programCode={slotModal.programCode} categoryName={slotModal.categoryName}
          onClose={() => setSlotModal(null)} />
      )}

      {courseDetailModal && (
        <CourseDetailModal code={courseDetailModal.code} onClose={() => setCourseDetailModal(null)} onRefresh={refresh} />
      )}

      {addCoursesSheet && (
        <AddCoursesSheet initialTerm={addCoursesSheet.term}
          onClose={() => setAddCoursesSheet(null)} onSaved={refresh} />
      )}

      {transferSheet && (
        <TransferMappingSheet onClose={() => setTransferSheet(false)} onSaved={refresh} />
      )}

      {showSettings && (
        <SettingsSheet user={user} onClose={() => setShowSettings(false)}
          onUpdate={(updated) => setUser(updated)}
          onReimport={() => setShowOnboarding(true)}
          onLogout={onLogout} />
      )}

      {showOnboarding && (
        <OnboardingWizard user={user} initialStep={user.onboarding_step || 1}
          onComplete={() => {
            setShowOnboarding(false);
            refresh();
            // Refresh user to update onboarding_step
            api.get("/api/auth/me").then(u => { if (u?.id) setUser(u); });
          }} />
      )}

      <RemainingPill count={remainingCount} remainingRef={remainingRef} />
    </div>
  );
}

// ── Shared styles (aliased from lib/ui.jsx) ─────────────────────────────────
const styles = sharedStyles;
