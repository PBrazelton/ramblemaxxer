# Backlog

Current sprint: **Peeps Scenario** — get Ramblemaxxer working correctly for Penelope's actual use case.

## How this works

- **CC picks the top unchecked item** from the highest-priority section
- Each item links to a GitHub Issue with the full spec and acceptance criteria
- When a PR merges with `Fixes #N`, the issue auto-closes — check the box here too
- Paul reorders this list as priorities shift
- New issues filed by Penelope or from testing get triaged into this list

---

## P0 — Blocks Beta (all complete)

- [x] #18 — HIST 104 parsed as 15,003 credits
- [x] #19 — Stale planned courses survive transcript re-import
- [x] #16 — `[object Object]` rendering on onboarding summary
- [x] #17 — Credit count mismatch between views
- [x] #20 — Transfer credits displayed as duplicates
- [x] #23 — Course browser only shows GLST and PLSC courses
- [x] #24 — Empty slot "+" button returns "No eligible courses found"
- [x] #22 — Enrolled courses don't appear in Semester Planner
- [x] #21 — Transfer credits don't satisfy Core requirements

## P1 — Needed for Peeps Scenario (all complete)

- [x] #27 — Transfer credit entry UX is unusable
- [x] #26 — Section picker missing from production planner
- [x] #30 — Planner should show all semesters, collapsible
- [x] #25 — Onboarding wizard doesn't support minor selection
- [x] #28 — Credit cap blocks 21+ credits
- [x] #32 — Course search should show full catalog

## P2 — Polish Before Beta (all complete)

- [x] #29 — "Matched/Unmatched" language is confusing
- [x] #31 — Planner semester cards should fill the viewport
- [x] #33 — Core Curriculum label should be college-specific
- [x] #34 — Verify Ethical Knowledge slot count against LUC catalog (verified correct, no change needed)
- [x] #37 — Repeatable courses silently dropped by UNIQUE constraint
- [x] #6 — Admin program editor with minor support (already built)
- [x] #8 — Suggestions engine: filter to courses offered in upcoming terms (already built)
- [x] #9 — Dashboard plan preview card (already built)
- [x] #10 — Plan → enrollment flow
- [x] #15 — Catalog refresh admin button

## Remaining — Blocked or Deferred

- [ ] #7 — Model cohort programs (blocked — waiting on Penelope's 20 testers)
- [ ] #11 — RateMyProfessor integration in section picker (P3, blocked)
- [ ] #12 — Social layer: friend course history and shared enrollment (P3, blocked)
- [ ] #13 — Walking/transit directions between classes (P3, blocked)
- [ ] #14 — Prerequisite chain validation in planner (P3, blocked)
