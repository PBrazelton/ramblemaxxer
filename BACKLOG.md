# Backlog

Current sprint: **Audit Fixes** — accessibility, theming, and responsive polish before beta.

## How this works

- **CC picks the top unchecked item** from the highest-priority section
- Each item links to a GitHub Issue with the full spec and acceptance criteria
- When a PR merges with `Fixes #N`, the issue auto-closes — check the box here too
- Paul reorders this list as priorities shift
- New issues filed by Penelope or from testing get triaged into this list

---

## Audit — Critical (A11y blockers)

- [ ] #41 — Replace ~30 clickable divs/spans with semantic buttons
- [ ] #42 — Add labels to all form inputs
- [ ] #43 — Add visible focus indicators for keyboard navigation

## Audit — High (A11y + theming + responsive)

- [ ] #44 — Extract 150+ hard-coded colors into design tokens
- [ ] #45 — Fix touch targets under 44px minimum
- [ ] #46 — Fix color contrast ratios below WCAG AA 4.5:1
- [ ] #47 — Fix Planner fixed-width panels for tablet viewports

## Audit — Medium (Polish)

- [ ] #48 — Add modal focus traps to BottomSheet and dialogs
- [ ] #49 — Add keyboard alternative for drag-and-drop course placement
- [ ] #50 — Extract font size scale to design tokens
- [ ] #51 — Add loading/disabled states to async action buttons

## Audit — Low (Nice-to-have)

- [ ] #52 — Remove gradient badge and tone down feedback pulse animation
- [ ] #53 — Add React.memo to frequently-rendered list components

---

## Remaining — Blocked or Deferred

- [ ] #7 — Model cohort programs (blocked — waiting on Penelope's 20 testers)
- [ ] #11 — RateMyProfessor integration in section picker (P3, blocked)
- [ ] #12 — Social layer: friend course history and shared enrollment (P3, blocked)
- [ ] #13 — Walking/transit directions between classes (P3, blocked)
- [ ] #14 — Prerequisite chain validation in planner (P3, blocked)

---

## Completed — Peeps Scenario (all done)

<details>
<summary>P0 + P1 + P2 — 25 issues closed</summary>

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
