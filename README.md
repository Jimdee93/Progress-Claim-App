# Progress Claim App — Head Contract Progress Claims

A web app for tracking monthly head contract progress claims on a commercial
construction project. Import an existing progress claim workbook once, then
each month: edit % complete per line item, submit the claim, and certify the
superintendent's approved figures. The next claim automatically starts from
last month's certified amounts — no more retyping "previously claimed"
figures by hand.

## Stack

- Next.js 16 (App Router, TypeScript, Tailwind)
- Prisma ORM + SQLite for local development (swap the `DATABASE_URL` /
  datasource provider to Postgres for a hosted deployment — no schema
  changes needed)
- Auth.js (NextAuth) credentials login, single seeded user
- `xlsx` (SheetJS) for importing a workbook, `exceljs` for exporting one

## Setup

```bash
npm install
cp .env.example .env   # set DATABASE_URL (absolute path — see the note in the file), AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
npx prisma migrate dev
npm run db:seed        # creates the single login user from ADMIN_EMAIL/ADMIN_PASSWORD
npm run dev
```

Then sign in at `http://localhost:3000` and import a progress claim workbook
from `/import` to set up the project.

## Data model

- **Project** — one per deployment (single-project scope). Holds the pinned
  original contract value, retention rate/cap, and GST rate.
- **Trade** — a work element (matches the imported workbook's trade tabs,
  e.g. "Concrete Elements"). The "Variations & Provisional Sum Adjustments"
  trade is flagged `isVariations` and feeds "Plus Approved Variations" on
  the claim cover instead of being counted as original scope.
- **LineItem** — a billable line within a trade, with its contract sum.
- **Claim** — one progress claim (`DRAFT` → `SUBMITTED` → `APPROVED`).
- **ClaimLine** — one line item's figures for one claim: this claim's %
  complete, the prior claim's %/$ baseline, and (once certified) the
  superintendent's certified $ for this claim.

## The rollover automation

Creating a new claim (`POST /api/claims`) is blocked unless the latest claim
is `APPROVED`. When it's created, every line's "previous %" and "previous
claim $" are copied from the prior claim's **certified** cumulative figures
— not what was originally claimed, since a certificate can differ from the
claim. Previous % is re-derived as `certified $ / contract sum` (not copied
directly) so it never drifts out of sync with the contract sum, even for
negative-value variation credits — see `src/lib/claim-rollover.ts`.

## Desktop app (Windows)

The app wraps into a standalone Windows desktop app — the Electron shell
starts the Next.js server itself and points it at a SQLite database stored
locally on your machine, so there's nothing to run or configure separately.

**Build it yourself, on a machine with normal internet access** (this can't
be built inside the sandboxed session that generated this code — Windows
packaging needs to download tooling from GitHub releases, which that
environment's network policy blocks):

```bash
npm install
npm run dist:win
```

The installer lands in `dist-electron/` (e.g. `Progress Claim App Setup 0.1.0.exe`).
Run it to install; a Start Menu / desktop shortcut is created using the
icon in `build/icon.ico`.

**First launch**: the app generates a random local login (no credentials are
baked into the installer) and shows it once in a dialog:

```
Email: admin@local
Password: <randomly generated>
```

This is saved to `%APPDATA%\Progress Claim App\desktop-config.json` on your
machine only — write the password down when you see it, since there's no
"forgot password" flow yet. Delete that file and relaunch the app to
regenerate a fresh login (this does **not** touch your claims data).

**Data location**: `%APPDATA%\Progress Claim App\progress-claims.db` — a
normal SQLite file. Back it up like any other file; there's no server
involved.

**How it works** (`electron/main.cjs`, `electron/server.cjs`): on launch,
the app runs `prisma migrate deploy` and seeds the admin user against that
local database (both steps are safe to repeat on every launch), starts
`next start` bound to `127.0.0.1` only on a free port from 3100 up, waits
for it to respond, then opens a window pointed at it. Closing the window
stops the embedded server.

## Scripts

- `npm run dev` — start the dev server (`--webpack`; Turbopack has been
  unreliable in this sandboxed environment — safe to try `next dev` without
  the flag elsewhere)
- `npm run db:seed` — (re)seed the single admin user from `.env`
- `npx tsx scripts/test-import.ts <path-to-xlsx>` — dry-run the workbook
  parser against a file and print the parsed totals, without touching the
  database
- `npm run build` — production build (`next build`)
- `npm run dist:win` — build the Windows desktop installer (see
  [Desktop app](#desktop-app-windows) above)
