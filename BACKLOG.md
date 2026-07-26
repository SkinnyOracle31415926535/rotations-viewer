# Gymnastics Vault Schedule Calendar Backlog

## Items

### BL-0004 — DONE
- Captured: 2026-07-22 13:46 America/Los_Angeles
- Request: i feel like i dont need the collisions section but i will keep it anyway. however when a ! is single pressed i want it hilighted on the calander schedule instead of forwrding me to the collisions page. also when i double click the ! i want the review collision window to open. also I want a way to pick from an opening and have is display as like a modified event card. Also for picking an opening i want it to send me to the openings page and when i double click on a event card that is the one that i want as the modified event card. make sure its clear that that event card is not whats in the schedule but save it for future. If the schedule is ever updated and that modification is no longer relevant it should throw a warming.
- Plan: 2026-07-25 — Keep single-click collision highlighting on the calendar and double-click audit review; let an opening create a clearly non-authoritative browser-local modified card with persistence and stale-schedule warnings.
- Notes: 2026-07-25 — Published and live-verified through Calendar PR #21. A single collision press now highlights the affected schedule cards without leaving the page, a double press opens Review Collision, and the opening picker saves exact-date or recurring personal cards with explicit not-published labels and stale-source warnings.

### BL-0005 — DONE
- Captured: 2026-07-22 14:51 America/Los_Angeles
- Request: for schedule can you make a note to like enhancve the colors it is good now but i want it even better
- Plan: 2026-07-25 — After the actual, modified, stale, selected, and collision states exist, strengthen their hierarchy with a brighter glossy 90s palette while preserving the existing collision color meanings.
- Notes: 2026-07-25 — Published and live-verified through Calendar PR #21. Published, selected-collision, personal-modification, stale-review, and collision states now have distinct glossy colors and a visible state key; phone, tablet, and desktop checks passed without page errors or document overflow.

### BL-0006 — PLAN READY
- Captured: 2026-07-22 15:09 America/Los_Angeles
- Request: for the schedule repo as well as the lesson p-lanner repo i want an option to like create an alternate schedule. for example maybe if ts is open even if there is no collision i want to save it for that day/week number that that station is open if that makes sense
- Plan: 2026-07-25 — Add one browser-local versioned alternate-schedule overlay shared by Calendar and Lesson Planner, with exact-date default scope, optional recurring weekday/parity scope, source fingerprints, and an immutable authoritative base schedule.

### BL-0020 — PLAN READY
- Captured: 2026-07-25 15:08 America/Los_Angeles
- Request: make a backlog item for the calander that i need to add the new schedule confirm it with the published schedule
- Plan: 2026-07-25 — Wait for Ryan's new Spring-2026-like PDF, treat it as the authoritative new-season source, reconcile every generated fact against it, and publish only after counts, labels, times, warnings, and source fingerprints match.
