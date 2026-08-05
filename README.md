# Tanawin Concierge

Guest-facing services hub for **Tanawin Bed & Breakfast** (Sinagtala, Brgy Tala,
Orani, Bataan). Reached by a QR code in each room; the front door for guests —
information first, requests second, with food ordering handed off to the Menu app.

Part of the Tanawin family: **Finance**, **Kitchen**, **Hub**, **Menu**,
**Payroll**, **Concierge** (this app).

## Phase 1 — Tanawin Info (this build)

| Surface | File | Who | Auth |
|---|---|---|---|
| Guest info | `index.html` | Guests | 6-digit room access code (same codes as Menu) |
| Content editor | `staff.html` | Admins (Lexi) | Menu's staff login (name + PIN) |

Guest content: wifi (with tap-to-copy + scan-to-join QR), Sinagtala pool hours,
getting-around directions + swappable map, key facts (staff hours, last call,
breakfast, checkout), front-desk contact buttons, house rules, and a hand-off
link to the Menu app that carries the room code so guests never retype it.

**Admin preview:** the editor's "👁 Guest view" button opens `/?preview=1` in a
new tab — it reuses the editor's login session to render the guest view exactly
as guests see it (plus a bottom banner with a back link), no room code needed.
Without a staff session the flag is inert and falls through to the normal code
gate, so guests can never reach or even detect it.

Phases 2 (requests + combined staff queue in Menu's dashboard) and 3 (Tala
Massage, adventure tickets) come later — see the build handoff.

## Stack

- Vanilla HTML/CSS/JS multi-page site — **no build step**. Supabase JS via CDN.
- **Shares the Menu Supabase project** (`lkeuiquqogtevsgvaddf`) so room codes
  validate against the same `rooms` table and staff use the same logins.
  Discipline: every Concierge table is prefixed `concierge_`; Concierge never
  writes to Menu's tables (it only reads `rooms`, inside a security-definer RPC).
- Deploys as a Cloudflare Worker with static assets from `main`
  (`tanawin-concierge.tanawinbnb.workers.dev`). Multi-page: `wrangler.jsonc`
  deliberately does NOT set SPA fallback.

## Database

Migrations in `db/`, applied via the Supabase management API:

- `001_concierge_content.sql` — `concierge_content` (one row per content block,
  jsonb value + `last_reviewed`), admin-only RLS writes, the
  `concierge_bootstrap(access_code)` RPC (validates the room code AND returns
  all content — guests have no table access), the public `concierge-assets`
  bucket (map image, admin-only writes), and seed content from the 2026-08-05
  handoff.

Wifi credentials and front-desk numbers are **never committed** — they're
entered in the staff editor (or SQL editor) and live only in the database.

## Content staleness — the standing rule

Most of what Concierge displays belongs to other people (Sinagtala's pool hours
and prices, Tampay's list) — a wrong price on a screen is worse than a wrong
price on paper. Therefore:

- Nothing third-party is hardcoded; it all lives in `concierge_content`.
- Every block carries a `last_reviewed` date; third-party blocks show guests a
  quiet "as of [date] — confirm at the front desk" note.
- **Lexi owns content reviews (admin-only), on a quarterly cadence.** The
  editor's "Mark reviewed today" button exists for exactly this.

## Local dev

Serve the folder statically on port 3600, e.g. `npx http-server -p 3600 -c-1 .`
— nothing to build. Testing against the live DB: use **Glamping Tent 1** (the
designated test room) and clean up anything you create.
