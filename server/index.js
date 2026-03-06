require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

/**
 * server/index.js
 * Express API server for Ramblemaxxer.
 *
 * In development: Vite dev server handles the frontend (port 5173).
 *                 This runs on port 3001, proxied by Vite.
 * In production:  This serves the built client from ./public and
 *                 handles all API routes.
 */

const express = require("express");
const path = require("path");
const cors = require("cors");
const session = require("express-session");
const SqliteStore = require("better-sqlite3-session-store")(session);
const sessionDb = require("better-sqlite3")(path.join(__dirname, "db", "ramblemaxxer.db"));

const passport = require("./lib/passport");
const authRoutes = require("./routes/auth");
const studentRoutes = require("./routes/students");
const coursesRoutes = require("./routes/courses");
const requirementsRoutes = require("./routes/requirements");
const adminRoutes = require("./routes/admin");
const transcriptRoutes = require("./routes/transcripts");
const programRoutes = require("./routes/programs");

const app = express();
const PORT = process.env.PORT || 3006;
const IS_PROD = process.env.NODE_ENV === "production";

// ── Middleware ─────────────────────────────────────────────────────────────
if (IS_PROD) app.set("trust proxy", 1);
app.use(express.json());
app.use(
  cors({
    origin: IS_PROD ? false : ["http://localhost:5175", "http://localhost:5176"],
    credentials: true,
  })
);
app.use(
  session({
    store: new SqliteStore({ client: sessionDb, expired: { clear: true, intervalMs: 900000 } }),
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IS_PROD,
      httpOnly: true,
      sameSite: IS_PROD ? "none" : "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ── Passport (initialize only, no passport sessions) ──────────────────────
app.use(passport.initialize());

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/requirements", requirementsRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/transcript", transcriptRoutes);
app.use("/api/programs", programRoutes);

// Health check
app.get("/api/health", (req, res) => {
  res.json({ ok: true, env: IS_PROD ? "production" : "development" });
});

// ── Static frontend (production only) ─────────────────────────────────────
if (IS_PROD) {
  const clientBuild = path.join(__dirname, "public");
  app.use(express.static(clientBuild));
  // SPA fallback — all non-API routes serve index.html
  app.get("*", (req, res) => {
    res.sendFile(path.join(clientBuild, "index.html"));
  });
}

const server = app.listen(PORT, () => {
  console.log(`🦁 Ramblemaxxer server running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
});
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`Port ${PORT} in use — killing stale process and retrying...`);
    require("child_process").execSync(`lsof -ti:${PORT} | xargs kill -9 2>/dev/null || true`);
    setTimeout(() => server.listen(PORT), 1000);
  } else {
    throw err;
  }
});
