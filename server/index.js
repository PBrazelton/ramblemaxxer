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

const authRoutes = require("./routes/auth");
const studentRoutes = require("./routes/students");
const coursesRoutes = require("./routes/courses");
const requirementsRoutes = require("./routes/requirements");

const app = express();
const PORT = process.env.PORT || 3001;
const IS_PROD = process.env.NODE_ENV === "production";

// ── Middleware ─────────────────────────────────────────────────────────────
app.use(express.json());
app.use(
  cors({
    origin: IS_PROD ? false : "http://localhost:5175",
    credentials: true,
  })
);
app.use(
  session({
    secret: process.env.SESSION_SECRET || "dev-secret-change-in-production",
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: IS_PROD,
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    },
  })
);

// ── API Routes ─────────────────────────────────────────────────────────────
app.use("/api/auth", authRoutes);
app.use("/api/students", studentRoutes);
app.use("/api/courses", coursesRoutes);
app.use("/api/requirements", requirementsRoutes);

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

app.listen(PORT, () => {
  console.log(`🦁 Ramblemaxxer server running on port ${PORT} (${IS_PROD ? "production" : "development"})`);
});
