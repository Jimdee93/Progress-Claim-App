# Advantage — Head Contract Progress Claims

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
cp .env.example .env   # if you don't already have one — set AUTH_SECRET, ADMIN_EMAIL, ADMIN_PASSWORD
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

## Scripts

- `npm run dev` — start the dev server (`--webpack`; Turbopack has been
  unreliable in this sandboxed environment — safe to try `next dev` without
  the flag elsewhere)
- `npm run db:seed` — (re)seed the single admin user from `.env`
- `npx tsx scripts/test-import.ts <path-to-xlsx>` — dry-run the workbook
  parser against a file and print the parsed totals, without touching the
  database
