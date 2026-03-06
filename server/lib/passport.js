/**
 * server/lib/passport.js
 * Google OAuth strategy. Invite-gated: only users who already have an account
 * (created via invite link) or who have a pending invite for their email can sign in.
 */

const passport = require("passport");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const db = require("../db/connection");

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const APP_URL = process.env.APP_URL || "http://localhost:5175";

if (GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: `${APP_URL.replace(/\/$/, "")}/api/auth/google/callback`,
      },
      (accessToken, refreshToken, profile, done) => {
        const email = profile.emails?.[0]?.value?.toLowerCase();
        if (!email) return done(null, false, { message: "No email from Google" });

        // Check if user already exists with this Google ID
        let user = db.prepare(
          "SELECT * FROM users WHERE provider = 'google' AND provider_id = ?"
        ).get(profile.id);

        if (user) {
          // Update avatar on each login
          db.prepare("UPDATE users SET avatar_url = ? WHERE id = ?")
            .run(profile.photos?.[0]?.value || null, user.id);
          return done(null, user);
        }

        // Check if a local user with same email exists — link accounts
        user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
        if (user) {
          db.prepare(
            "UPDATE users SET provider = 'google', provider_id = ?, avatar_url = ? WHERE id = ?"
          ).run(profile.id, profile.photos?.[0]?.value || null, user.id);
          return done(null, { ...user, provider: "google", provider_id: profile.id });
        }

        // New user — check for pending invite with matching email
        const invite = db.prepare(`
          SELECT * FROM invites
          WHERE email = ? AND used_at IS NULL AND expires_at > datetime('now')
        `).get(email);

        if (!invite) {
          return done(null, false, { message: "No invite found for this email. Ask a friend for an invite link." });
        }

        // Create new user from invite
        // password_hash is NOT NULL in older DBs — use empty string for OAuth users
        const { lastInsertRowid: userId } = db.prepare(`
          INSERT INTO users (email, name, password_hash, role, grad_year, invited_by, provider, provider_id, avatar_url)
          VALUES (?, ?, '', 'student', NULL, ?, 'google', ?, ?)
        `).run(
          email,
          profile.displayName || email.split("@")[0],
          invite.invited_by,
          profile.id,
          profile.photos?.[0]?.value || null
        );

        db.prepare("UPDATE invites SET used_at = datetime('now') WHERE id = ?").run(invite.id);
        db.prepare("INSERT INTO student_programs (user_id, program_id) VALUES (?, ?)").run(userId, "CORE");

        const newUser = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
        done(null, newUser);
      }
    )
  );
} else {
  console.log("[passport] Google OAuth not configured (missing GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET)");
}

module.exports = passport;
