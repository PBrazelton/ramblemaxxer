import { useState, useEffect } from "react";

// Simple hash-based router until we add react-router
function getPage() {
  const hash = window.location.hash.slice(1) || "/";
  if (hash.startsWith("/register")) return "register";
  return hash === "/login" ? "login" : "dashboard";
}

export default function App() {
  const [user, setUser] = useState(null);       // null = unknown, false = not logged in
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(getPage());

  useEffect(() => {
    window.addEventListener("hashchange", () => setPage(getPage()));
    fetch("/api/auth/me", { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((u) => { setUser(u || false); setLoading(false); });
  }, []);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}>
        <span style={{ fontFamily: "'DM Mono', monospace", color: "#888" }}>loading...</span>
      </div>
    );
  }

  if (!user && page !== "register") {
    return <LoginPage onLogin={setUser} />;
  }

  if (page === "register") {
    return <RegisterPage onRegister={setUser} />;
  }

  return <Dashboard user={user} onLogout={() => { setUser(false); }} />;
}

// ── Login Page ─────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok) { onLogin(data); }
    else { setError(data.error); }
  };

  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}>ramblemaxxer</h1>
        <p style={styles.tagline}>stop guessing, start maxxing</p>
        <form onSubmit={submit} style={styles.form}>
          <input style={styles.input} type="email" placeholder="email" value={email}
            onChange={(e) => setEmail(e.target.value)} required />
          <input style={styles.input} type="password" placeholder="password" value={password}
            onChange={(e) => setPassword(e.target.value)} required />
          {error && <p style={styles.error}>{error}</p>}
          <button style={styles.button} type="submit">log in</button>
        </form>
      </div>
    </div>
  );
}

// ── Register Page ──────────────────────────────────────────────────────────
function RegisterPage({ onRegister }) {
  const token = new URLSearchParams(window.location.hash.split("?")[1] || "").get("token") || "";
  const [form, setForm] = useState({ email: "", name: "", password: "", grad_year: "", token });
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, grad_year: parseInt(form.grad_year) || null }),
    });
    const data = await res.json();
    if (res.ok) { onRegister(data); window.location.hash = "/"; }
    else { setError(data.error); }
  };

  return (
    <div style={styles.centered}>
      <div style={styles.card}>
        <h1 style={styles.logo}>ramblemaxxer</h1>
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

// ── Dashboard (placeholder — real component lives in ramblemaxxer.jsx) ─────
function Dashboard({ user, onLogout }) {
  const [solveResult, setSolveResult] = useState(null);

  useEffect(() => {
    fetch("/api/students/me/solve", { credentials: "include" })
      .then((r) => r.json())
      .then(setSolveResult);
  }, []);

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST", credentials: "include" });
    onLogout();
  };

  return (
    <div style={{ padding: "2rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "2rem" }}>
        <h1 style={styles.logo}>ramblemaxxer</h1>
        <div style={{ display: "flex", gap: "1rem", alignItems: "center" }}>
          <span style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.85rem", color: "#666" }}>
            {user.name}
          </span>
          <button onClick={logout} style={{ ...styles.button, padding: "0.4rem 0.9rem", fontSize: "0.8rem" }}>
            log out
          </button>
        </div>
      </div>

      {/* Solver output — temporary debug view until full UI is ported */}
      {solveResult ? (
        <div style={{ fontFamily: "'DM Mono', monospace", fontSize: "0.8rem", lineHeight: 1.6 }}>
          <h2 style={{ marginBottom: "1rem" }}>Credits: {solveResult.credits?.total ?? "—"} / 120</h2>
          <h3 style={{ marginBottom: "0.5rem" }}>Remaining requirements:</h3>
          {solveResult.remaining?.length === 0
            ? <p style={{ color: "#4a7" }}>✓ All requirements satisfied!</p>
            : <ul style={{ paddingLeft: "1.2rem" }}>
                {solveResult.remaining?.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
          }
          <p style={{ marginTop: "1rem", color: "#888", fontSize: "0.75rem" }}>
            (Full schedule UI coming next — this is the live solver output from the API)
          </p>
        </div>
      ) : (
        <p style={{ fontFamily: "'DM Mono', monospace", color: "#888" }}>computing...</p>
      )}
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const styles = {
  centered: {
    display: "flex", alignItems: "center", justifyContent: "center",
    minHeight: "100vh", padding: "1rem",
  },
  card: {
    background: "#fff", border: "1px solid #e8e0d0", borderRadius: "8px",
    padding: "2.5rem", width: "100%", maxWidth: "360px",
    boxShadow: "0 2px 12px rgba(0,0,0,0.06)",
  },
  logo: {
    fontFamily: "'Source Serif 4', serif", fontSize: "1.8rem",
    fontWeight: 700, letterSpacing: "-0.02em", marginBottom: "0.25rem",
  },
  tagline: {
    fontFamily: "'DM Mono', monospace", fontSize: "0.75rem",
    color: "#888", marginBottom: "1.5rem",
  },
  form: { display: "flex", flexDirection: "column", gap: "0.75rem" },
  input: {
    fontFamily: "'DM Mono', monospace", fontSize: "0.9rem",
    padding: "0.6rem 0.8rem", border: "1px solid #ddd", borderRadius: "4px",
    background: "#fafaf8", outline: "none",
  },
  button: {
    fontFamily: "'DM Mono', monospace", fontSize: "0.9rem",
    padding: "0.65rem", background: "#1a1a1a", color: "#fff",
    border: "none", borderRadius: "4px", cursor: "pointer",
  },
  error: {
    fontFamily: "'DM Mono', monospace", fontSize: "0.8rem",
    color: "#c0392b", padding: "0.5rem", background: "#fdf0ed",
    borderRadius: "4px",
  },
};
