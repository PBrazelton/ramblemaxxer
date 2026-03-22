# Backlog

Current sprint: **Campus Day + RMP** — all three phases shipped. Next up: program modeling or polish.

## How this works

- **CC picks the top unchecked item** from the highest-priority section
- Each item links to a GitHub Issue with the full spec and acceptance criteria
- When a PR merges with `Fixes #N`, the issue auto-closes — check the box here too
- Paul reorders this list as priorities shift
- New issues filed by Penelope or from testing get triaged into this list

---

## P1 — High Priority

- [ ] #7 — Model cohort programs (blocked — waiting on Penelope's 20 testers)
- [ ] #58 — Model CAS Humanities BAs (Batch 1 of 7)
- [ ] #59 — Model CAS Social Sciences (Batch 2 of 7)
- [ ] #60 — Model Music & Fine Arts concentrations (Batch 3 of 7)
- [ ] #61 — Model Environmental Studies cluster (Batch 4 of 7)
- [ ] #62 — Model Life Sciences programs (Batch 5 of 7)
- [ ] #63 — Model Math, CS & Engineering programs (Batch 6 of 7)
- [ ] #64 — Model Physical Sciences programs (Batch 7 of 7)

## P2 — Should Do

- [ ] #66 — RMP name matching false positives need admin correction UI
- [ ] #67 — Create custom Mapbox Studio style for Campus Day map
- [ ] #65 — Upgrade to React 19

## P3 — Nice-to-have

- [ ] #52 — Remove gradient badge and tone down feedback pulse animation
- [ ] #53 — Add React.memo to frequently-rendered list components
- [ ] #14 — Prerequisite chain validation in planner

## Future — Campus Day Ideas

- [ ] Push notifications ("class in 10 minutes") — needs mobile app infrastructure
- [ ] Indoor routing (room within building) — building is routing granularity for now
- [ ] Shuttle schedule API — hardcode "~30 min" for now, link to schedule page
- [ ] Weather integration (rain adds walk time)
- [ ] Real-time location tracking (GPS/geofencing) — schedule-inferred only for now

---

## Completed — Campus Day + RMP Sprint

<details>
<summary>10 items shipped</summary>

- [x] Weekly schedule: section pickers for enrolled courses + schema migration
- [x] Weekly schedule: two-zone sidebar layout (compressed grid + accordion picker)
- [x] View toggle redesign (segmented control) + credit display uplift
- [x] Clickable requirements → course browser filter
- [x] Fix CORE knowledge area mappings (Scientific, Artistic, Ethical were incomplete)
- [x] #11 — RateMyProfessor integration (scraper, API, rating badges, multi-instructor fix)
- [x] #13 — Campus Day Phase 1: map, buildings, walking transitions, time scrubber
- [x] #12 — Campus Day Phase 2: social layer, friend graph, serendipity engine
- [x] Campus Day Phase 3: Red Line, pulse animation, shuttle link, share-as-image
- [x] Requirement tracker refresh fix (placedFills from plannable-courses endpoint)

</details>

## Completed — Audit Sprint (all done)

<details>
<summary>11 issues closed</summary>

- [x] #41 — Replace ~30 clickable divs/spans with semantic buttons
- [x] #42 — Add labels to all form inputs
- [x] #43 — Add visible focus indicators for keyboard navigation
- [x] #44 — Extract 150+ hard-coded colors into design tokens
- [x] #45 — Fix touch targets under 44px minimum
- [x] #46 — Fix color contrast ratios below WCAG AA 4.5:1
- [x] #47 — Fix Planner fixed-width panels for tablet viewports
- [x] #48 — Add modal focus traps to BottomSheet and dialogs
- [x] #49 — Add keyboard alternative for drag-and-drop course placement
- [x] #50 — Extract font size scale to design tokens
- [x] #51 — Add loading/disabled states to async action buttons

</details>

## Completed — Peeps Scenario (all done)

<details>
<summary>25 issues closed</summary>

- [x] #18 — HIST 104 parsed as 15,003 credits
- [x] #19 — Stale planned courses survive transcript re-import
- [x] #16 — `[object Object]` rendering on onboarding summary
- [x] #17 — Credit count mismatch between views
- [x] #20 — Transfer credits displayed as duplicates
- [x] #23 — Course browser only shows GLST and PLSC courses
- [x] #24 — Empty slot "+" button returns "No eligible courses found"
- [x] #22 — Enrolled courses don't appear in Semester Planner
- [x] #21 — Transfer credits don't satisfy Core requirements
- [x] #27 — Transfer credit entry UX is unusable
- [x] #26 — Section picker missing from production planner
- [x] #30 — Planner should show all semesters, collapsible
- [x] #25 — Onboarding wizard doesn't support minor selection
- [x] #28 — Credit cap blocks 21+ credits
- [x] #32 — Course search should show full catalog
- [x] #29 — "Matched/Unmatched" language is confusing
- [x] #31 — Planner semester cards should fill the viewport
- [x] #33 — Core Curriculum label should be college-specific
- [x] #34 — Verify Ethical Knowledge slot count (verified correct)
- [x] #37 — Repeatable courses silently dropped by UNIQUE constraint
- [x] #6 — Admin program editor with minor support
- [x] #8 — Suggestions engine: filter to offered terms
- [x] #9 — Dashboard plan preview card
- [x] #10 — Plan → enrollment flow
- [x] #15 — Catalog refresh admin button

</details>
