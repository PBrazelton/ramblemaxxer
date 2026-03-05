# Ramblemaxxer

> Schedule optimizer for Loyola University Chicago students.
> Built by Paul and Penelope. Penelope owns it now.

## What this is

Ramblemaxxer helps LUC students figure out the most efficient path to
graduation given complex overlapping degree requirements. The core problem
is constraint satisfaction: maximize requirement slots filled per course
while respecting overlap caps between programs.

Penelope is double-majoring in Political Science (BA) and Global Studies (BA).
The constraint logic is non-trivial — read `luc-handoff.md` for the full
picture before touching the solver.

## Stack

- **Frontend:** Vite + React, single App.jsx, all inline styles, no Tailwind
- **Backend:** Node.js + Express, port 3001 in dev
- **Database:** SQLite via better-sqlite3 (`server/db/ramblemaxxer.db`)
- **Fonts:** Source Serif 4 (serif), DM Mono (mono) via Google Fonts

## Running locally

```bash
npm run dev          # starts both servers (Express :3001, Vite :5175)
npm run db:init      # create/migrate the database
npm run db:seed      # seed Penelope + Paul's accounts
```

Penelope's test login: `penelope@ramblemaxxer.local` / `changeme`
Paul's admin login: `paul@ramblemaxxer.com` / `changeme-admin`

## Project structure

```
client/src/App.jsx          # entire frontend (single file)
client/src/lib/ui.jsx       # shared UI primitives and constants
client/src/pages/AdminPanel.jsx  # admin view (Paul only)
shared/solver.js            # constraint solver — the brain
server/routes/              # Express API routes
server/lib/catalog.js       # shared course/program maps
server/db/                  # SQLite schema, init, seed
data/                       # course catalog + degree requirements JSON
luc-handoff.md              # full constraint model documentation — READ THIS
```

## The solver

`shared/solver.js` is the most important file. It takes a student's course
list and returns which requirement slots are filled, what's remaining, and
high-efficiency course suggestions. It runs on the server at
`GET /api/students/me/solve`.

Key constraint: GLST-BA allows max 4 courses overlapping with other declared
majors, and max 3 courses from any single department in GLST elective slots.
Details in `luc-handoff.md` under "Overlap / Double-Dipping Rules".

If the solver output looks wrong, check:
1. Is the course in `data/courses.json` or `data/courses-supplemental.json`?
2. Does `data/degree_requirements.json` list it in the right category's `eligible_courses`?
3. Is there a `pinnedProgram` on the course in the DB that's routing it away?

## UI conventions

- Colors: PLSC=#c43b2d, GLST=#1a7a5a, CORE=#7a4a1a, CAS=#5a6a7a
- Status: complete=#22863a, enrolled=#b08800, planned=#6f42c1
- All styling is inline — no CSS files, no Tailwind
- Mobile-first, max-width 680px centered
- Bottom sheets for modals (not centered overlays)
- Shared primitives live in `client/src/lib/ui.jsx`

## Data files (read-only at runtime, updated manually)

- `data/courses.json` — 224 courses from catalog.luc.edu (run parse-catalog.js to refresh)
- `data/courses-supplemental.json` — ~18 courses the parser missed (manually maintained)
- `data/degree_requirements.json` — 5 programs with slot definitions and constraints
- `data/course_program_tags.json` — interdisciplinary program memberships

## Common tasks

**Add a new course to the catalog:**
Edit `data/courses-supplemental.json`. Match the shape of existing entries.

**Fix a requirement mapping:**
Edit `data/degree_requirements.json`. Find the program + category, add the
course code to `eligible_courses`.

**Add a new feature:**
1. Add the API route in `server/routes/`
2. Register it in `server/index.js`
3. Add the UI in `client/src/App.jsx` (or a new file in `client/src/pages/`)
4. Test with `npm run dev`
5. Deploy: `git push`, then SSH and `git pull` + rebuild + restart

## What's not built yet (Phase 2)

- Course schedule data (fall/spring offering — behind Loyola login, not scraped yet)
- Interactive semester planning (drag courses into future semesters)
- GLST portfolio tracking
- Richer social features (course reviews, friend recommendations)
