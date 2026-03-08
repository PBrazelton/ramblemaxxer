import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { COLORS, programColor, STATUS_COLOR, FONT, BG, BORDER, api, ProgressRing, BottomSheet, StickyHeader, sharedStyles, Input, Btn, SectionTitle, ErrMsg } from "./lib/ui.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";

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
  const doLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    setUser(false);
  };
  if (page === "forgot-password") return <ForgotPasswordPage />;
  if (page === "reset-password") return <ResetPasswordPage />;
  if (!user && page !== "register") return <LoginPage onLogin={setUser} />;
  if (page === "register") return <RegisterPage onRegister={setUser} />;
  if (user.role === "admin") return <AdminPanel user={user} onLogout={doLogout} />;
  return <Dashboard user={user} setUser={setUser} onLogout={doLogout} />;
}

// ── AuthShell ───────────────────────────────────────────────────────────────
function AuthShell({ title, sub, children }) {
  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}><span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span></h1>
        <p style={styles.tagline}>{sub || "stop guessing, start maxxing"}</p>
        {title && <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: 12 }}>{title}</div>}
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
function LoginPage({ onLogin }) {
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
        <Input type="email" placeholder="email" value={email} onChange={e => setEmail(e.target.value)} required />
        <Input type="password" placeholder="password" value={password} onChange={e => setPassword(e.target.value)} required />
        {error && <ErrMsg>{error}</ErrMsg>}
        <Btn type="submit" full>log in</Btn>
      </form>
      <div style={{ textAlign: "center", margin: "1rem 0 0.5rem" }}>
        <a href="/api/auth/google" style={{
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "100%", padding: "0.6rem", borderRadius: 4,
          border: `1px solid ${BORDER}`, background: "#fff", cursor: "pointer",
          fontFamily: FONT.mono, fontSize: "0.85rem", color: "#333",
          textDecoration: "none",
        }}>
          <GoogleIcon /> sign in with Google
        </a>
      </div>
      <div style={{ textAlign: "center", marginTop: "0.75rem" }}>
        <button onClick={() => { window.location.hash = "/forgot-password"; }}
          style={{ background: "none", border: "none", color: "#9a9590",
            fontSize: "0.75rem", fontFamily: FONT.mono, cursor: "pointer" }}>
          forgot password?
        </button>
      </div>
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
          background: "#fff", color: "#3a3530", textDecoration: "none",
          fontFamily: FONT.mono, fontSize: "0.9rem", marginBottom: 12,
        }}>
        <GoogleIcon /> continue with Google
      </a>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
        <span style={{ fontSize: 11, color: "#b0a090", fontFamily: FONT.mono }}>or</span>
        <div style={{ flex: 1, height: 1, background: BORDER }} />
      </div>
      <form onSubmit={submit} style={styles.form}>
        <Input placeholder="name" value={form.name} onChange={set("name")} required />
        <Input type="email" placeholder="email" value={form.email} onChange={set("email")} required />
        <Input type="password" placeholder="password" value={form.password} onChange={set("password")} required />
        <Input placeholder="graduation year (e.g. 2027)" value={form.grad_year} onChange={set("grad_year")} />
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
          <div style={{ fontSize: 14, color: "#5a5550", marginBottom: 16 }}>
            If that email is in our system, a reset link is on its way.
          </div>
          <Btn onClick={onBack} full>back to login</Btn>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input type="email" placeholder="your email" value={email}
            onChange={e => setEmail(e.target.value)} required />
          {err && <ErrMsg>{err}</ErrMsg>}
          <Btn type="submit" full>send reset link</Btn>
          <button type="button" onClick={onBack}
            style={{ background: "none", border: "none", color: "#9a9590",
              fontSize: 12, fontFamily: FONT.mono, cursor: "pointer" }}>
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
          <div style={{ fontSize: 14, color: "#22863a", marginBottom: 16 }}>
            Password updated! You can now log in.
          </div>
          <Btn onClick={() => { window.location.hash = "/login"; }} full>go to login</Btn>
        </div>
      ) : (
        <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <Input type="password" placeholder="new password (8+ chars)"
            value={password} onChange={e => setPassword(e.target.value)} required />
          <Input type="password" placeholder="confirm password"
            value={confirm} onChange={e => setConfirm(e.target.value)} required />
          {err && <ErrMsg>{err}</ErrMsg>}
          <Btn type="submit" full>set new password</Btn>
        </form>
      )}
    </AuthShell>
  );
}

// ── SettingsSheet ───────────────────────────────────────────────────────────
function SettingsSheet({ user, onClose, onUpdate, onReimport }) {
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
          <Input placeholder="display name" value={name}
            onChange={e => setName(e.target.value)} />
          <Input placeholder="graduation year" value={gradYear}
            onChange={e => setGradYear(e.target.value)} />
          <div>
            <div style={{ fontSize: 12, color: "#8a8580", marginBottom: 6,
              fontFamily: FONT.mono }}>course visibility</div>
            <div style={{ display: "flex", gap: 8 }}>
              {["private", "friends"].map(v => (
                <button key={v} onClick={() => setPrivacy(v)}
                  style={{ flex: 1, padding: "10px 0", borderRadius: 8,
                    border: `2px solid ${privacy === v ? COLORS["PLSC-BA"] : BORDER}`,
                    background: privacy === v ? COLORS["PLSC-BA"] + "11" : "transparent",
                    cursor: "pointer", fontFamily: FONT.mono, fontSize: 13,
                    color: privacy === v ? COLORS["PLSC-BA"] : "#5a5550" }}>
                  {v === "private" ? "private" : "friends"}
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "#9a9590", marginTop: 6 }}>
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
              <Input type="password" placeholder="current password"
                value={currentPw} onChange={e => setCurrentPw(e.target.value)} />
              <Input type="password" placeholder="new password (8+ chars)"
                value={newPw} onChange={e => setNewPw(e.target.value)} />
              <Btn onClick={changePassword} full>update password</Btn>
            </div>
          </div>
        )}

        {user.provider === "google" && (
          <div style={{ fontSize: 12, color: "#9a9590", fontFamily: FONT.mono,
            padding: "12px 0", borderTop: `1px solid ${BORDER}` }}>
            Signed in with Google — password change not available
          </div>
        )}

        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: 16, marginBottom: 16 }}>
          <SectionTitle>Transcript</SectionTitle>
          <Btn onClick={() => { onClose(); onReimport(); }} full
            style={{ background: "transparent", border: `2px solid ${BORDER}`, color: "#5a5550" }}>
            re-import transcript
          </Btn>
          <div style={{ fontSize: 11, color: "#9a9590", marginTop: 6, fontFamily: FONT.mono }}>
            Opens the transcript upload wizard — existing courses are kept
          </div>
        </div>

        {msg && <div style={{ color: "#22863a", fontSize: 13, fontFamily: FONT.mono,
          marginTop: 8 }}>{msg}</div>}
        {err && <ErrMsg>{err}</ErrMsg>}

        <button onClick={onClose}
          style={{ marginTop: 16, width: "100%", padding: 12, borderRadius: 10,
            border: "none", background: "#e8e4df", cursor: "pointer",
            fontFamily: FONT.mono, fontSize: 13, color: "#5a5550" }}>
          close
        </button>
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
          {hasUnmappedTransfer && (
            <div onClick={onTransferWarningTap} style={{
              fontFamily: FONT.mono, fontSize: "0.65rem", color: "#b08800", marginTop: "0.3rem",
              cursor: onTransferWarningTap ? "pointer" : "default",
            }}>
              Transfer credits not mapped to requirements
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── NextStepsSection ────────────────────────────────────────────────────────
function NextStepsSection({ data, onAddCourses, onMapTransfer, onSuggestionTap }) {
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

  // 4. Overlap warning (dynamic per pair)
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

  return (
    <div style={{ marginBottom: "1rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Next Steps</div>
      <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
        {cards.slice(0, 3).map(card => (
          <div key={card.key} onClick={card.action || undefined} style={{
            background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "0.7rem 1rem",
            display: "flex", alignItems: "center", gap: "0.7rem",
            cursor: card.action ? "pointer" : "default",
          }}>
            <span style={{ fontSize: "1.1rem", flexShrink: 0 }} dangerouslySetInnerHTML={{ __html: card.icon }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700 }}>{card.title}</div>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888" }}>{card.subtitle}</div>
            </div>
            {card.action && <span style={{ fontFamily: FONT.mono, fontSize: "1rem", color: "#c0b8b0" }}>&rsaquo;</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── ProgramCard ─────────────────────────────────────────────────────────────
function ProgramCard({ prog, conflicts, onPipClick, onSlotTap, defaultOpen = false }) {
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
      {open && (() => {
        const incomplete = prog.categories.filter(cat => !cat.isSatisfied && !cat.isWaived);
        const completed = prog.categories.filter(cat => cat.isSatisfied || cat.isWaived);
        return (
          <div style={{ padding: "0 1rem 0.8rem 1rem" }}>
            {incomplete.map((cat, i) => (
              <CategoryRow key={`inc-${i}`} cat={cat} color={color} conflicts={conflicts} onPipClick={onPipClick}
                onSlotTap={onSlotTap ? () => onSlotTap(prog.code, cat.name) : null} />
            ))}
            {completed.length > 0 && (
              <CompletedCategoriesGroup categories={completed} color={color} conflicts={conflicts} onPipClick={onPipClick} />
            )}
          </div>
        );
      })()}
    </div>
  );
}

// ── CompletedCategoriesGroup ────────────────────────────────────────────────
function CompletedCategoriesGroup({ categories, color, conflicts, onPipClick }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.5rem" }}>
      <div onClick={() => setExpanded(!expanded)} style={{
        display: "flex", alignItems: "center", gap: "0.4rem", cursor: "pointer", padding: "0.3rem 0",
      }}>
        <span style={{ color: "#22863a", fontSize: "0.7rem" }}>&#10003;</span>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600, color: "#22863a" }}>
          {categories.length} completed
        </span>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#aaa", transform: expanded ? "rotate(180deg)" : "none", transition: "transform 0.2s" }}>&#9660;</span>
      </div>
      {expanded && categories.map((cat, i) => (
        <div key={i} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "0.3rem 0", borderTop: `1px solid ${BORDER}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
            <span style={{ color: "#22863a", fontSize: "0.6rem" }}>&#10003;</span>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#444" }}>{cat.name}</span>
          </div>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#22863a" }}>
            {cat.filledCount || 0}/{cat.slotsNeeded}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── CategoryRow ─────────────────────────────────────────────────────────────
function CategoryRow({ cat, color, conflicts, onPipClick, onSlotTap }) {
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
      <div onClick={onSlotTap || undefined} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem",
        cursor: onSlotTap ? "pointer" : "default",
      }}>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>
          {cat.name}
          {cat.isWaived && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#f0ede8", padding: "1px 6px", borderRadius: 3, color: "#888" }}>waived</span>}
          {hasConflict && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#e8f0fe", padding: "1px 6px", borderRadius: 3, color: "#1a5276" }}>shared</span>}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "0.3rem" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: cat.isSatisfied ? "#22863a" : "#b08800", fontWeight: 600 }}>
            {cat.filledCount || 0}/{cat.slotsNeeded}
          </span>
          {onSlotTap && <span style={{ color: "#c0b8b0", fontSize: 14 }}>&rsaquo;</span>}
        </div>
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

function EmptyPip({ onClick }) {
  return (
    <div onClick={onClick} style={{
      width: 60, height: 24, borderRadius: 4,
      border: `1.5px dashed ${onClick ? "#999" : "#ccc"}`,
      background: onClick ? "#fafaf8" : "transparent",
      cursor: onClick ? "pointer" : "default",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: FONT.mono, fontSize: "0.65rem", color: "#999",
    }}>
      {onClick && "+"}
    </div>
  );
}

function WaivedPip() {
  return (
    <div style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 60, height: 24, borderRadius: 4, background: "#f5f0e8", border: `1px solid ${BORDER}`, fontSize: "0.6rem", color: "#888" }}>
      &#10003; waived
    </div>
  );
}

// ── OverlapBudget ───────────────────────────────────────────────────────────
function OverlapBudget({ overlaps, programs, conflicts, onPipClick }) {
  const pairs = overlaps?.pairs || {};
  // Only show pairs that have an explicit max (i.e., a rule in overlap_rules)
  const ruledPairs = Object.entries(pairs).filter(([, p]) => p.max != null);

  if (ruledPairs.length === 0) return null;

  // Build shared-course-code → pair-keys map for chip display
  const sharedCodes = Object.keys(conflicts);

  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.6rem" }}>Overlap Budget</div>

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
              <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>
                {nameA} &#x2194; {nameB}
              </span>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", padding: "1px 8px", borderRadius: 10, background: overBudget ? "#fde8e8" : "#e8f5e9", color: overBudget ? "#c43b2d" : "#22863a", fontWeight: 600 }}>
                {pair.count}/{pair.max}
              </span>
            </div>
            <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#666", lineHeight: 1.5, marginBottom: "0.4rem" }}>
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
              {overBudget && <div style={{ width: 32, height: 20, borderRadius: 4, background: "#c43b2d", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "0.55rem", color: "#fff", fontFamily: FONT.mono }}>!</div>}
            </div>

            {pairCourses.length > 0 && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: "0.3rem", marginTop: "0.5rem" }}>
                {pairCourses.map(code => (
                  <span key={code} onClick={() => onPipClick?.(code, "", conflicts[code] || [a, b])} style={{
                    fontFamily: FONT.mono, fontSize: "0.6rem", padding: "2px 8px", borderRadius: 4,
                    background: "#e8f0fe", border: "1px solid #b8d0f0", color: "#1a5276",
                    cursor: "pointer",
                  }}>
                    {code}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* GLST dept spread — only show if GLST-BA is in a ruled pair */}
      {overlaps.glstElectiveDeptUsage && Object.keys(overlaps.glstElectiveDeptUsage).length > 0 && ruledPairs.some(([k]) => k.includes("GLST-BA")) && (
        <div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.3rem" }}>
            GLST elective dept spread ({overlaps.glstElectiveDeptMax} max per dept)
          </div>
          {Object.entries(overlaps.glstElectiveDeptUsage).map(([dept, count]) => (
            <div key={dept} style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginBottom: "0.25rem" }}>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", width: 40, textAlign: "right", color: "#666" }}>{dept}</span>
              <div style={{ display: "flex", gap: 2 }}>
                {Array.from({ length: overlaps.glstElectiveDeptMax }).map((_, i) => (
                  <div key={i} style={{ width: 20, height: 10, borderRadius: 2, background: i < count ? (count >= overlaps.glstElectiveDeptMax ? "#c43b2d" : programColor("GLST-BA")) : "#eee" }} />
                ))}
              </div>
              <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: count >= overlaps.glstElectiveDeptMax ? "#c43b2d" : "#888" }}>{count}</span>
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
function RemainingCard({ remaining, onSlotTap }) {
  if (!remaining || remaining.length === 0) return null;
  return (
    <div style={{ background: "#fff", border: `1px solid ${BORDER}`, borderRadius: 8, padding: "1rem", marginBottom: "0.75rem" }}>
      <div style={{ fontFamily: FONT.serif, fontSize: "1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Remaining</div>
      {remaining.map((r, i) => (
        <div key={i} onClick={() => onSlotTap?.(r.program, r.category)}
          style={{ display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.25rem 0", fontFamily: FONT.mono, fontSize: "0.7rem", cursor: onSlotTap ? "pointer" : "default" }}>
          <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[r.program] || "#888", flexShrink: 0 }} />
          <span style={{ color: "#444" }}>{r.category}</span>
          <span style={{ color: "#888", marginLeft: "auto", fontSize: "0.6rem" }}>{r.programName} · {r.needed} needed</span>
          {onSlotTap && <span style={{ color: "#c0b8b0", fontSize: 14 }}>&rsaquo;</span>}
        </div>
      ))}
    </div>
  );
}

// ── SuggestionsCard ─────────────────────────────────────────────────────────
function SuggestionsCard({ suggestions, remaining }) {
  if (!suggestions || suggestions.length === 0) return null;
  const top = suggestions.slice(0, 8);

  // Build lookup: fill string → needed count from remaining
  const neededLookup = {};
  if (remaining) {
    for (const r of remaining) {
      neededLookup[r.category] = r.needed;
    }
  }

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
              {s.fills.map((f, j) => {
                const needed = neededLookup[f];
                return (
                  <span key={j} style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#f5f0e8", padding: "1px 5px", borderRadius: 3, color: "#666" }}>
                    {f}{needed ? ` (${needed} needed)` : ""}
                  </span>
                );
              })}
            </div>
          </div>
        </div>
      ))}
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
    <div onClick={() => remainingRef.current?.scrollIntoView({ behavior: "smooth" })}
      style={{
        position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
        background: "#1a1a1a", color: "#fff", padding: "10px 20px", borderRadius: 24,
        fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, cursor: "pointer",
        zIndex: 50, boxShadow: "0 4px 16px rgba(0,0,0,0.2)",
      }}>
      {count} requirements remaining &#9650;
    </div>
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
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.2rem" }}>Pin course to one program</div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.85rem", fontWeight: 700, marginBottom: "0.1rem" }}>{code}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", marginBottom: "0.8rem" }}>{title}</div>

      {/* Explanation block */}
      <div style={{ background: "#f8f6f2", border: `1px solid ${BORDER}`, borderRadius: 6, padding: "0.6rem 0.8rem", marginBottom: "0.8rem" }}>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#555", lineHeight: 1.5 }}>
          This course counts toward multiple programs.
          {relevantRules.map(r => ` ${r.a}/${r.b} allows up to ${r.max} shared (${r.count} used).`).join("")}
        </div>
      </div>

      {/* Slot assignments */}
      {assignments.length > 0 && (
        <div style={{ marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", fontWeight: 600, color: "#888", marginBottom: "0.3rem" }}>Currently fills:</div>
          {assignments.map((a, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: "0.4rem", padding: "0.2rem 0" }}>
              <span style={{ width: 8, height: 8, borderRadius: "50%", background: COLORS[a.programCode] || "#888", flexShrink: 0 }} />
              <span style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#444" }}>
                {a.programCode}: {a.categoryName}
              </span>
            </div>
          ))}
        </div>
      )}

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
      <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: COLORS[programCode] || "#666", marginBottom: "0.2rem" }}>{programCode}</div>
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.8rem" }}>{categoryName}</div>

      {!courses && <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>loading...</div>}

      {courses && courses.length === 0 && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", textAlign: "center", padding: "2rem" }}>
          No eligible courses found in catalog.
        </div>
      )}

      {courses && courses.map(c => (
        <div key={c.code} onClick={() => setDetail(c)} style={{
          padding: "0.6rem 0", borderTop: `1px solid ${BORDER}`, cursor: "pointer",
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div style={{ flex: 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: "0.4rem", marginBottom: "0.2rem" }}>
                <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 700 }}>{c.code}</span>
                <span style={{ fontFamily: FONT.serif, fontSize: "0.8rem", color: "#444" }}>{c.title}</span>
                <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888" }}>{c.credits}cr</span>
              </div>
              {c.description && (
                <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", marginBottom: "0.3rem" }}>
                  {c.description.slice(0, 80)}{c.description.length > 80 ? "..." : ""}
                </div>
              )}
              <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
                {c.alreadyTaken && <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#e8f5e9", padding: "1px 5px", borderRadius: 3, color: "#22863a" }}>taking</span>}
                {c.writing_intensive && <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#e3f2fd", padding: "1px 4px", borderRadius: 2, color: "#1565c0" }}>WI</span>}
                {c.engaged_learning && <span style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#f3e5f5", padding: "1px 4px", borderRadius: 2, color: "#7b1fa2" }}>EL</span>}
              </div>
              {c.friends.length > 0 && (
                <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#888", marginTop: "0.2rem" }}>
                  {c.friends.map(f => f.name).join(", ")} {c.friends.length === 1 ? "is" : "are"} taking this
                </div>
              )}
            </div>
            <span style={{ color: "#c0b8b0", fontSize: 16, marginLeft: "0.5rem" }}>&rsaquo;</span>
          </div>
        </div>
      ))}
    </BottomSheet>
  );
}

// ── CourseDetailSheet ───────────────────────────────────────────────────────
function CourseDetailSheet({ course, categoryName, onBack }) {
  return (
    <div>
      <div onClick={onBack} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", cursor: "pointer", marginBottom: "0.8rem" }}>
        &larr; Back to {categoryName}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "0.3rem" }}>
        <span style={{ fontFamily: FONT.mono, fontSize: "1rem", fontWeight: 700 }}>{course.code}</span>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888" }}>{course.credits} credits</span>
      </div>
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "1rem" }}>{course.title}</div>

      {course.description && (
        <div style={{ marginBottom: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600, marginBottom: "0.2rem" }}>Description</div>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#444", lineHeight: 1.5 }}>{course.description}</div>
        </div>
      )}

      {course.prerequisites && (
        <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#666", marginBottom: "0.5rem" }}>
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
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", fontWeight: 600, marginBottom: "0.2rem" }}>Interdisciplinary</div>
          <div style={{ display: "flex", gap: "0.3rem", flexWrap: "wrap" }}>
            {course.interdisciplinary_options.map(opt => (
              <span key={opt} style={{ fontFamily: FONT.mono, fontSize: "0.55rem", background: "#f5f0e8", padding: "1px 5px", borderRadius: 3, color: "#666" }}>{opt}</span>
            ))}
          </div>
        </div>
      )}

      {course.friends?.length > 0 && (
        <div style={{ marginTop: "0.8rem" }}>
          <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", fontWeight: 600, marginBottom: "0.2rem" }}>Friends taking this</div>
          {course.friends.map(f => (
            <div key={f.id} style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#444" }}>{f.name}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function DetailItem({ label, value }) {
  return (
    <div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#888", marginBottom: 1 }}>{label}</div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#444" }}>{value}</div>
    </div>
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
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.5rem" }}>Add Courses</div>

      {/* Term selector */}
      <div style={{ display: "flex", gap: 6, marginBottom: "0.8rem", flexWrap: "wrap" }}>
        {termOptions.map(t => (
          <button key={t} onClick={() => setTerm(t)} style={{
            fontFamily: FONT.mono, fontSize: "0.65rem", padding: "4px 10px", borderRadius: 12,
            border: `1px solid ${term === t ? "#1a1a1a" : BORDER}`,
            background: term === t ? "#1a1a1a" : "transparent",
            color: term === t ? "#fff" : "#666", cursor: "pointer",
          }}>{t}</button>
        ))}
      </div>

      {/* Search */}
      <Input placeholder="Search courses..." value={query} onChange={e => setQuery(e.target.value)}
        style={{ marginBottom: "0.5rem" }} />

      {/* Selected chips */}
      {selected.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: "0.5rem" }}>
          {selected.map(c => (
            <span key={c.code} onClick={() => toggleCourse(c)} style={{
              fontFamily: FONT.mono, fontSize: "0.6rem", padding: "3px 8px", borderRadius: 4,
              background: "#e8f5e9", color: "#22863a", cursor: "pointer",
              display: "inline-flex", alignItems: "center", gap: 4,
            }}>
              {c.code} <span style={{ color: "#888" }}>&times;</span>
            </span>
          ))}
        </div>
      )}

      {/* Results */}
      <div style={{ maxHeight: 280, overflow: "auto" }}>
        {results.slice(0, 20).map(c => (
          <div key={c.code} onClick={() => toggleCourse(c)} style={{
            display: "flex", alignItems: "center", gap: "0.5rem", padding: "0.5rem 0",
            borderTop: `1px solid ${BORDER}`, cursor: "pointer",
          }}>
            <span style={{
              width: 20, height: 20, borderRadius: 4, flexShrink: 0,
              border: `1.5px solid ${isSelected(c.code) ? "#22863a" : "#ccc"}`,
              background: isSelected(c.code) ? "#22863a" : "transparent",
              display: "flex", alignItems: "center", justifyContent: "center",
              color: "#fff", fontSize: 11,
            }}>
              {isSelected(c.code) && "\u2713"}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600 }}>
                {c.code} <span style={{ fontWeight: 400, color: "#666" }}>{c.title}</span>
              </div>
            </div>
            <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", flexShrink: 0 }}>{c.credits || 3}cr</span>
          </div>
        ))}
      </div>

      {/* Footer */}
      {selected.length > 0 && (
        <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.8rem", marginTop: "0.5rem",
          display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#666" }}>
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
      <div style={{ fontFamily: FONT.serif, fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.2rem" }}>Transfer Credits</div>
      <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#888", marginBottom: "1rem" }}>
        Add credits from other institutions
      </div>

      {rows.map((row, i) => (
        <div key={i} style={{
          display: "flex", gap: 6, alignItems: "flex-start", marginBottom: 8,
          padding: "0.5rem 0", borderTop: i ? `1px solid ${BORDER}` : "none",
        }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
            <Input placeholder="Description (e.g. Intro to Psych)"
              value={row.label} onChange={e => updateRow(i, "label", e.target.value)}
              style={{ fontSize: "0.75rem" }} />
            <div style={{ display: "flex", gap: 6 }}>
              <Input type="number" placeholder="Cr" value={row.creditHours}
                onChange={e => updateRow(i, "creditHours", e.target.value)}
                style={{ width: 50, fontSize: "0.75rem", textAlign: "center" }} />
              <Input placeholder="Catalog code (optional, e.g. PSYC 101)"
                value={row.satisfiesCode} onChange={e => updateRow(i, "satisfiesCode", e.target.value)}
                style={{ flex: 1, fontSize: "0.75rem" }} />
            </div>
          </div>
          {rows.length > 1 && (
            <button onClick={() => removeRow(i)} style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: FONT.mono, fontSize: "1rem", color: "#ccc", padding: "0.3rem",
            }}>&times;</button>
          )}
        </div>
      ))}

      <button onClick={addRow} style={{
        fontFamily: FONT.mono, fontSize: "0.7rem", color: "#888", background: "transparent",
        border: `1px dashed ${BORDER}`, borderRadius: 6, padding: "0.5rem", width: "100%",
        cursor: "pointer", marginBottom: "0.8rem",
      }}>
        + Add another
      </button>

      <div style={{ borderTop: `1px solid ${BORDER}`, paddingTop: "0.8rem",
        display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontFamily: FONT.mono, fontSize: "0.7rem", color: "#666" }}>
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
      <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, marginBottom: 8 }}>
        {label}
      </div>
      <input
        type="text"
        placeholder="search programs..."
        value={search}
        onChange={e => onSearch(e.target.value)}
        style={{
          ...sharedStyles.input, width: "100%", boxSizing: "border-box",
          marginBottom: 10, fontSize: "0.8rem",
        }}
      />
      <div style={{ maxHeight, overflowY: "auto", border: `1px solid ${BORDER}`, borderRadius: 8, background: "#fff" }}>
        {items.length === 0 && (
          <div style={{ padding: 16, textAlign: "center", fontFamily: FONT.mono, fontSize: "0.75rem", color: "#aaa" }}>
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
                color: "#fff", fontSize: 11,
              }}>
                {isSelected && "\u2713"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, color: isSelected ? color : "#333" }}>{p.name}</span>
                  {p.degree && <span style={{
                    fontFamily: FONT.mono, fontSize: "0.55rem", padding: "1px 5px", borderRadius: 3,
                    background: "#eee", color: "#666", flexShrink: 0,
                  }}>{p.degree}</span>}
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
                  <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#aaa" }}>{p.code}</span>
                  {p.modeled ? (
                    <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", padding: "1px 5px", borderRadius: 3, background: "#e8f5e9", color: "#22863a" }}>full tracking</span>
                  ) : (
                    <span style={{ fontFamily: FONT.mono, fontSize: "0.5rem", padding: "1px 5px", borderRadius: 3, background: "#f0f0f0", color: "#999" }}>credit tracking only</span>
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
function OnboardingWizard({ user, onComplete }) {
  const [step, setStep] = useState(1);
  const [gradYear, setGradYear] = useState(user.grad_year || "");
  const [programs, setPrograms] = useState([]);
  const [minors, setMinors] = useState([]);
  const [programCatalog, setProgramCatalog] = useState([]);
  const [programSearch, setProgramSearch] = useState("");
  const [minorSearch, setMinorSearch] = useState("");
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState(null);
  const [reviewCourses, setReviewCourses] = useState([]);
  const [reviewTransfer, setReviewTransfer] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  const toggleProgram = (pid) => {
    setPrograms(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]);
  };

  const toggleMinor = (pid) => {
    setMinors(prev => prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]);
  };

  useEffect(() => {
    fetch("/api/programs/catalog").then(r => r.json()).then(setProgramCatalog).catch(() => {});
  }, []);

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
      onComplete();
    } catch (e) {
      setError("Failed to save courses");
      setConfirming(false);
    }
  };

  const matchIcon = (type) => {
    if (type === "exact") return { symbol: "\u2713", color: "#22863a", bg: "#e8f5e9" };
    if (type === "unmatched") return { symbol: "\u2717", color: "#c43b2d", bg: "#fde8e8" };
    return { symbol: "~", color: "#b08800", bg: "#fff8e1" };
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
          {[1, 2, 3].map(s => (
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
            <h2 style={{ fontFamily: FONT.serif, fontSize: "1.5rem", fontWeight: 700, marginBottom: 4 }}>
              welcome to <span>ramble</span><span style={{ color: "#c43b2d" }}>maxxer</span>
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: "0.8rem", color: "#888", marginBottom: 24 }}>
              let's set up your degree tracking
            </p>

            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, marginBottom: 8 }}>
                expected graduation
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {[2026, 2027, 2028, 2029].map(y => (
                  <button key={y} onClick={() => setGradYear(y)}
                    style={{
                      flex: 1, padding: "10px 0", borderRadius: 8, cursor: "pointer",
                      fontFamily: FONT.mono, fontSize: "0.85rem",
                      border: `2px solid ${gradYear == y ? "#1a1a1a" : BORDER}`,
                      background: gradYear == y ? "#1a1a1a" : "transparent",
                      color: gradYear == y ? "#fff" : "#5a5550",
                    }}>
                    {y}
                  </button>
                ))}
              </div>
            </div>

            <ProgramPickerList
              label="your major(s)"
              items={sortedPrograms}
              selected={programs}
              onToggle={toggleProgram}
              search={programSearch}
              onSearch={setProgramSearch}
              loading={programCatalog.length === 0}
            />

            {minorCatalog.length > 0 && (
              <ProgramPickerList
                label="your minor(s) (optional)"
                items={sortedMinors}
                selected={minors}
                onToggle={toggleMinor}
                search={minorSearch}
                onSearch={setMinorSearch}
                loading={false}
                maxHeight={180}
              />
            )}

            <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#aaa", marginBottom: 24 }}>
              Core + CAS graduation requirements are tracked automatically
            </div>

            {error && <ErrMsg>{error}</ErrMsg>}
            <Btn onClick={saveStep1} full disabled={programs.length === 0}>continue</Btn>
          </div>
        )}

        {/* ── Step 2: Transcript Upload ─────────────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, marginBottom: 4 }}>
              import your transcript
            </h2>
            <p style={{ fontFamily: FONT.mono, fontSize: "0.75rem", color: "#888", marginBottom: 24 }}>
              upload your unofficial transcript PDF to auto-populate your courses
            </p>

            <label style={{
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              padding: "40px 20px", borderRadius: 12, cursor: "pointer",
              border: `2px dashed ${BORDER}`, background: "#fff",
              transition: "border-color 0.2s",
            }}>
              <input type="file" accept=".pdf" onChange={handleFileUpload}
                style={{ display: "none" }} disabled={uploading} />
              {uploading ? (
                <span style={{ fontFamily: FONT.mono, fontSize: "0.85rem", color: "#888" }}>
                  parsing transcript...
                </span>
              ) : (
                <>
                  <div style={{ fontSize: 32, marginBottom: 8, opacity: 0.4 }}>&#128196;</div>
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.85rem", color: "#444", marginBottom: 4 }}>
                    tap to upload PDF
                  </div>
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.65rem", color: "#aaa" }}>
                    official or unofficial transcript from LOCUS (max 2MB)
                  </div>
                </>
              )}
            </label>

            {error && <div style={{ marginTop: 12 }}><ErrMsg>{error}</ErrMsg></div>}

            <button onClick={onComplete}
              style={{
                display: "block", width: "100%", marginTop: 20, padding: 12,
                background: "transparent", border: "none", cursor: "pointer",
                fontFamily: FONT.mono, fontSize: "0.75rem", color: "#9a9590",
                textAlign: "center",
              }}>
              I'll add courses manually &rarr;
            </button>
          </div>
        )}

        {/* ── Step 3: Review ────────────────────────────────────────────── */}
        {step === 3 && parseResult && (
          <div>
            <h2 style={{ fontFamily: FONT.serif, fontSize: "1.3rem", fontWeight: 700, marginBottom: 4 }}>
              review your courses
            </h2>

            {/* Summary bar */}
            <div style={{
              display: "flex", gap: 12, padding: "10px 14px", borderRadius: 8,
              background: "#fff", border: `1px solid ${BORDER}`, marginBottom: 16,
              fontFamily: FONT.mono, fontSize: "0.7rem",
            }}>
              <span style={{ color: "#22863a" }}>{parseResult.summary.exact} matched</span>
              <span style={{ color: "#b08800" }}>{parseResult.summary.fuzzy} fuzzy</span>
              <span style={{ color: "#c43b2d" }}>{parseResult.summary.unmatched} unmatched</span>
              {parseResult.summary.inferred > 0 && (
                <span style={{ color: "#b08800" }}>{parseResult.summary.inferred} inferred</span>
              )}
            </div>

            {/* Transfer credits */}
            {reviewTransfer.length > 0 && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, marginBottom: 8, color: COLORS["CAS-GRAD"] }}>
                  Transfer Credits
                </div>
                {parseResult.transferCredits?.sources?.length > 0 && (
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 10 }}>
                    {parseResult.transferCredits.sources.map((src, i) => (
                      <span key={i} style={{
                        fontFamily: FONT.mono, fontSize: "0.6rem", padding: "3px 8px",
                        borderRadius: 4, background: "#f5f0eb", color: "#5a5550",
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
                        background: c.included ? "#1a1a1a" : "transparent", color: "#fff",
                        cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                      }}>
                        {c.included && "\u2713"}
                      </button>
                      <span style={{
                        width: 18, height: 18, borderRadius: "50%", fontSize: "0.6rem",
                        display: "flex", alignItems: "center", justifyContent: "center",
                        background: icon.bg, color: icon.color, flexShrink: 0,
                      }}>{icon.symbol}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600 }}>{c.code}</div>
                        <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {c.title}
                        </div>
                      </div>
                      <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", flexShrink: 0 }}>
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
                  <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600, marginBottom: 8 }}>
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
                          background: c.included ? "#1a1a1a" : "transparent", color: "#fff",
                          cursor: "pointer", fontSize: 11, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0,
                        }}>
                          {c.included && "\u2713"}
                        </button>
                        <span style={{
                          width: 18, height: 18, borderRadius: "50%", fontSize: "0.6rem",
                          display: "flex", alignItems: "center", justifyContent: "center",
                          background: icon.bg, color: icon.color, flexShrink: 0,
                        }}>{icon.symbol}</span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: FONT.mono, fontSize: "0.7rem", fontWeight: 600 }}>
                            {c.matchedCode || c.code}
                            {c.grade && <span style={{ fontWeight: 400, color: "#888", marginLeft: 6 }}>{c.grade}</span>}
                          </div>
                          <div style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {c.matchedTitle || c.title}
                          </div>
                          {c.matchType !== "exact" && c.matchedCode && c.matchedCode !== c.code && (
                            <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#b08800" }}>
                              transcript: {c.code} &rarr; matched: {c.matchedCode}
                            </div>
                          )}
                          {c.inferred && (
                            <div style={{ fontFamily: FONT.mono, fontSize: "0.55rem", color: "#b08800" }}>
                              please verify — credits not in PDF
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", flexShrink: 0 }}>
                          <span style={{ fontFamily: FONT.mono, fontSize: "0.6rem", color: "#888" }}>{c.credits != null ? `${c.credits}cr` : "—"}</span>
                          <div style={{
                            fontFamily: FONT.mono, fontSize: "0.55rem",
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
                fontFamily: FONT.mono, fontSize: "0.7rem", color: "#9a9590", textAlign: "center",
              }}>
              &larr; upload a different file
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ user, setUser, onLogout }) {
  const [data, setData] = useState(null);
  const [pinModal, setPinModal] = useState(null);
  const [slotModal, setSlotModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [addCoursesSheet, setAddCoursesSheet] = useState(null); // null or { term }
  const [transferSheet, setTransferSheet] = useState(false);
  const remainingRef = useRef(null);
  const nextStepsRef = useRef(null);

  const refresh = useCallback(() => {
    api.get("/api/students/me/solve").then(setData);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  // Show onboarding for new users with zero courses
  useEffect(() => {
    if (data && data.credits.total === 0 && !showOnboarding) {
      setShowOnboarding(true);
    }
  }, [data]);

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
    setPinModal({ code, title, programs });
  };

  const handleSlotTap = (programCode, categoryName) => {
    setSlotModal({ programCode, categoryName });
  };

  if (!data) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: BG }}>
      <span style={{ fontFamily: FONT.mono, color: "#888" }}>computing...</span>
    </div>
  );

  const majorOrder = ["PLSC-BA", "GLST-BA", "CORE"];
  const majors = majorOrder.map(code => data.programs[code]).filter(Boolean);
  const remainingCount = data.remaining?.length || 0;

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <StickyHeader user={user} onLogout={onLogout} onSettings={() => setShowSettings(true)} />

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem" }}>
        <CreditMeter credits={data.credits} hasUnmappedTransfer={hasUnmappedTransfer}
          onTransferWarningTap={() => nextStepsRef.current?.scrollIntoView({ behavior: "smooth" })} />

        <div ref={nextStepsRef}>
          <NextStepsSection data={data}
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
            <div key={key} style={{ background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 8, padding: "0.7rem 1rem", marginBottom: "0.75rem", fontFamily: FONT.mono, fontSize: "0.75rem", color: "#721c24" }}>
              Over budget: {pair.count} {nameA}/{nameB} overlaps (max {pair.max}). Pin courses to fix.
            </div>
          );
        })}

        {majors.map(prog => (
          <ProgramCard key={prog.code} prog={prog} conflicts={conflicts} onPipClick={handlePipClick} onSlotTap={handleSlotTap}
            defaultOpen={prog.code === "PLSC-BA" || prog.code === "GLST-BA"} />
        ))}

        <OverlapBudget overlaps={data.overlaps} programs={data.programs} conflicts={conflicts} onPipClick={handlePipClick} />

        <CASCard casGrad={data.programs["CAS-GRAD"]} spanLang={data.programs["SPAN-LANG"]} />

        <div ref={remainingRef}>
          <RemainingCard remaining={data.remaining} onSlotTap={handleSlotTap} />
        </div>

        <SuggestionsCard suggestions={data.suggestions} remaining={data.remaining} />
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
          onReimport={() => setShowOnboarding(true)} />
      )}

      {showOnboarding && (
        <OnboardingWizard user={user} onComplete={() => { setShowOnboarding(false); refresh(); }} />
      )}

      <RemainingPill count={remainingCount} remainingRef={remainingRef} />
    </div>
  );
}

// ── Shared styles (aliased from lib/ui.jsx) ─────────────────────────────────
const styles = sharedStyles;
