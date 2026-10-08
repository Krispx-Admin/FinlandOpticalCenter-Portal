# FOC Portal — Optical Operations

An internal, real-time operations portal for a multi-branch optical retail
chain: retail branches, lens-fitting centres, eye clinics and one central
warehouse, all looking at the same live board, backed by Supabase.

**Zero build step.** Plain HTML + CSS + ES modules — serve the folder with any
static server:

```bash
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

## What's inside

| Module | What it does |
|---|---|
| **Fitting Log** | Tracks a frame's physical journey: branch → fitting centre → back to the branch. Log an order with just a bill number, then send it to a fitting centre. Pipeline: Waiting for Lenses → In transit to the fitter → Waiting to be Fitted → Ready → Returning to the branch → Delivered, with click-to-select + bulk advance, urgent flags, a per-order journey diagram (the fitter node turns green when ready) and a full audit timeline. |
| **Stock Requests** | Branches compose category-first requests; the admin controls, per category, which fields are needed, whether it's counted in pieces or boxes, and which brand group it offers (Settings). No review step — the warehouse prints the pick sheet, fulfils it, and marks it completed. |
| **Lens Stock** | One fitting centre (MGM) holds the loose-lens shelf and is the only location that can edit its counts. Every other branch browses that shelf by type / index / coating / SPH / CYL, builds a basket and requests it. The request takes the lenses off the shelf at once — MGM has nothing to confirm — and opens the fitting order, which carries a Stock Lens tag and lists the lenses. |
| **Insurance Claims** | Raises a printable A4 claim receipt: date, branch, bill number and customer, a priced product list that totals itself, a full SPH/CYL/AXIS/ADD/PD prescription grid, and the payment method. The on-screen preview and the printed sheet are built from the same markup, so what you see is what prints — brand logo on the header, logomark watermarked across the page. |
| **Settings** *(admin)* | Request categories: which fields each needs, pieces vs boxes, and its brand group. Brand groups: named lists of brands, drag-and-drop between them, so picking *Solutions & drops* never offers a sunglasses brand. |

## The model

- **Users are locations, not people.** Each location has a Supabase Auth
  account and a six-digit sign-in code. Codes are checked on Supabase's
  servers, never in the browser, and are stored only as bcrypt hashes.
- **Roles:** retail branch (sees only its own records), fitting centre (also
  sees jobs routed to it, and advances them), warehouse/admin (sees and
  oversees everything).
- **The data is shared, not local.** Every record lives in Postgres. A request
  placed at Seeb is visible at the warehouse immediately, on a different
  computer, and survives clearing the browser.
- **Enforced in the database.** Each login's JWT carries a `branch_code` in
  `app_metadata`, which is set server-side and cannot be rewritten by the
  browser. Row level security on every table keys off that claim, so a branch
  cannot read another branch's claims even by crafting its own requests. The
  permission checks in `js/data.js` are a second layer, not the only one.
- **Realtime.** The client subscribes to Postgres changes, so another branch's
  action lands on this board within a moment and raises a toast.
- **Atomic where it matters.** Confirming a lens request deducts the shelf and
  completing a stock request closes it inside a single database function —
  two people acting at once cannot both claim the last lens.
- Sign-in persists across refresh; signing out in one tab signs out the rest.

## Sign-in codes

Each location has its own six-digit code. The warehouse sets and changes them
all under **Settings → Branch access**; nobody, including the warehouse, can
read an existing code back. The codes are kept outside this repository.

## Layout

```
index.html
css/styles.css      design system, layout, micro-animations, A4 print rules
js/data.js          locations, catalogue, status machines, permissions
js/auth.js          Supabase sign-in, session, warehouse code control
js/supabase-config.js   project URL and anon key (public by design)
js/db.js            row <-> app mapping, collection loads, realtime
js/store.js         in-memory cache, mutations, change notification
js/ui.js            DOM helpers, icons, toasts, modal/drawer layers
js/app.js           login, boot, shell, navigation, live toasts
js/fitting.js       Module 1 — Fitting Log
js/stock.js         Module 2 — Stock Requests / Warehouse queue
js/settings.js      Module 3 — Settings: categories, brand groups, branch access
js/lens.js          Module 4 — Lens Stock
js/claims.js        Module 5 — Insurance Claim Receipts (A4 print)
img/                brand logos used on the printed receipt
supabase/*.sql      schema, row level security, functions, realtime
```

## Database

Applied in order:

| File | What it adds |
|---|---|
| `supabase/schema.sql` | branches, claims (+ items, prescriptions), orders (+ events), lens stock, lens requests (+ lines, events); RLS on all of them; the atomic `confirm_lens_request`; realtime publication |
| `supabase/branch-codes.sql` | `set_branch_code` and `branch_access` — warehouse-only, reject weak codes |
| `supabase/schema-02-shared.sql` | stock requests (+ lines, events), shared settings, reference numbers from database sequences, `complete_stock_request` |
| `supabase/schema-03-lens-topup.sql` | `add_lens_stock` — adding to a spec already on the shelf is one statement, so it cannot double-count |
| `supabase/schema-04-salalah-code.sql` | Salalah Shop's code SLS → SAL, in the table, the token claim and the sign-in address |
| `supabase/schema-05-lens-catalogue.sql` | `lens_catalogue` — the lens types, indices and coatings the holder edits |
| `supabase/schema-06-drop-frame-columns.sql` | drops the unused `orders.brand/model/lens` — **not applied** |
| `supabase/schema-07-lens-request-fulfilment.sql` | `create_lens_request` — a lens request opens its fitting order, frame over or lenses here |
| `supabase/schema-08-lens-auto-deduct.sql` | `create_lens_request` deducts the shelf as it is placed; no confirming step |

Reference numbers (`SR-…`, `LR-…`, `IC-…`) are allocated by Postgres sequences
as part of the insert, so two branches acting at the same instant cannot be
given the same one. A fitting order's reference is the branch's own bill
number and is unique per branch, not globally.
