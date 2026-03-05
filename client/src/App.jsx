import { useState, useEffect, useCallback, useMemo } from "react";
import { COLORS, STATUS_COLOR, FONT, BG, BORDER, api, ProgressRing, BottomSheet, StickyHeader, sharedStyles, Input, Btn, SectionTitle, ErrMsg } from "./lib/ui.jsx";
import AdminPanel from "./pages/AdminPanel.jsx";

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
function SettingsSheet({ user, onClose, onUpdate }) {
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
      {open && (
        <div style={{ padding: "0 1rem 0.8rem 1rem" }}>
          {prog.categories.map((cat, i) => (
            <CategoryRow key={i} cat={cat} color={color} conflicts={conflicts} onPipClick={onPipClick}
              onSlotTap={!cat.isSatisfied && !cat.isWaived && onSlotTap ? () => onSlotTap(prog.code, cat.name) : null} />
          ))}
        </div>
      )}
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
      <div onClick={onSlotTap || undefined} style={{
        display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "0.3rem",
        cursor: onSlotTap ? "pointer" : "default",
      }}>
        <div style={{ fontFamily: FONT.mono, fontSize: "0.75rem", fontWeight: 600 }}>
          {cat.name}
          {cat.isWaived && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#f0ede8", padding: "1px 6px", borderRadius: 3, color: "#888" }}>waived</span>}
          {hasConflict && <span style={{ marginLeft: 6, fontSize: "0.6rem", background: "#fff3cd", padding: "1px 6px", borderRadius: 3, color: "#856404" }}>conflict</span>}
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
    <BottomSheet onClose={onClose}>
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

// ── Dashboard ───────────────────────────────────────────────────────────────
function Dashboard({ user, setUser, onLogout }) {
  const [data, setData] = useState(null);
  const [pinModal, setPinModal] = useState(null);
  const [slotModal, setSlotModal] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

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

  return (
    <div style={{ background: BG, minHeight: "100vh" }}>
      <StickyHeader user={user} onLogout={onLogout} onSettings={() => setShowSettings(true)} />

      {/* Content */}
      <div style={{ maxWidth: 680, margin: "0 auto", padding: "1rem" }}>
        <CreditMeter credits={data.credits} />

        {data.overlaps.glstMajorUsed > data.overlaps.glstMajorMax && (
          <div style={{ background: "#fde8e8", border: "1px solid #f5c6cb", borderRadius: 8, padding: "0.7rem 1rem", marginBottom: "0.75rem", fontFamily: FONT.mono, fontSize: "0.75rem", color: "#721c24" }}>
            Over budget: {data.overlaps.glstMajorUsed} PLSC/GLST overlaps (max {data.overlaps.glstMajorMax}). Pin courses to fix.
          </div>
        )}

        {majors.map(prog => (
          <ProgramCard key={prog.code} prog={prog} conflicts={conflicts} onPipClick={handlePipClick} onSlotTap={handleSlotTap}
            defaultOpen={prog.code === "PLSC-BA" || prog.code === "GLST-BA"} />
        ))}

        <OverlapBudget overlaps={data.overlaps} conflicts={conflicts} />

        <CASCard casGrad={data.programs["CAS-GRAD"]} spanLang={data.programs["SPAN-LANG"]} />

        <RemainingCard remaining={data.remaining} onSlotTap={handleSlotTap} />

        <SuggestionsCard suggestions={data.suggestions} />
      </div>

      {pinModal && (
        <PinModal code={pinModal.code} title={pinModal.title} programs={pinModal.programs}
          onPin={handlePin} onClose={() => setPinModal(null)} />
      )}

      {slotModal && (
        <SlotModal programCode={slotModal.programCode} categoryName={slotModal.categoryName}
          onClose={() => setSlotModal(null)} />
      )}

      {showSettings && (
        <SettingsSheet user={user} onClose={() => setShowSettings(false)}
          onUpdate={(updated) => setUser(updated)} />
      )}
    </div>
  );
}

// ── Shared styles (aliased from lib/ui.jsx) ─────────────────────────────────
const styles = sharedStyles;
