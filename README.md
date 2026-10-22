# FOC Portal — Optical Operations

An internal, real-time operations portal for a multi-branch optical retail
chain: retail branches, lens-fitting centres, eye clinics and one central
office, all looking at the same live board, backed by Supabase.

**Zero build step.** Plain HTML + CSS + ES modules — serve the folder with any
static server:

```bash
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

## What's inside

| Module | What it does |
|---|---|
| **Fitting Log** | Tracks a frame's physical journey: branch → fitting centre → back to the branch. Log an order with just a bill number, press Lens received when they arrive, then send it to a fitting centre — or Outside, to a 3rd-party cutter — when the driver comes; each place presses Frame received when the frame reaches it. Pipeline: Waiting for Lenses → Lenses Delivered → In transit to the fitter → Waiting to be Fitted → Ready → Returning to the branch → Ready for collection → Collected, with click-to-select + bulk advance, a per-order journey diagram (the fitter node turns green when ready) and a full audit timeline. |
| **Stock Requests** | Branches compose category-first requests; the admin controls, per category, which fields are needed, whether it's counted in pieces or boxes, and which brand group it offers (Settings). No review step — the office prints the pick sheet, fulfils it, and marks it completed. |
| **Lens Stock** | Fitting centres the office marks as lens holders (Settings › Branches; MGM to start with) each keep a loose-lens shelf and are the only ones that can edit its counts. Every other branch picks a shelf, browses it by type / index / coating / SPH / CYL, builds a basket and requests it; the lenses come off that shelf straight away. Every branch chooses to send the frame there (the default) or to receive the lenses; for received lenses the holder presses Send lenses in its Fitting Log, or declines before sending. The request opens its fitting order, which tracks the lenses and the frame, carries a Stock Lens note and lists the lenses. |
| **Reimbursement Invoice** | Raises a printable A4 **invoice** — the company's CR and address in English and Arabic either side of the logo — with date, branch, bill number, the customer's full name and member ID exactly as on the insurance card, a priced product list that totals itself, a full SPH/CYL/AXIS/ADD/PD prescription grid, and the payment method. The on-screen preview and the printed sheet are built from the same markup, so what you see is what prints — brand logo on the header, logomark watermarked across the page. |
| **Direct Insurance** | Every insurance customer, recorded like a claim plus the insurer (OQIC, LIVA, Mednet — the list lives in Settings) and the salesperson, typed and picked from the schedule's roster. The list is a table; each line's arrow opens its details, where the invoice is printed. The office and Ghiath get a dashboard of what insurance paid — the total, by insurer, by branch and by employee — for today, the last 7 days or the last 30. Insurer and salesperson never appear on the printed invoice. |
| **Schedule** | The weekly staff scheduler, unchanged, running inside the portal (`scheduler.html`). Ghiath and the office build each week and press **Publish** to release it; the roster, branches, leave, special dates and presets live in Postgres, and every week is saved so it can be reopened. Every branch sees the published weeks that haven't finished — and so does anyone, without a code, on the sign-in page's **View schedule**. |
| **Settings** *(admin)* | Tabs: switch any sidebar tab off while it is worked on — branches see it greyed out, *under maintenance*, and cannot open it. Request categories: which fields each needs, pieces vs boxes, and its brand group. Brand groups: named lists of brands, drag-and-drop between them, so picking *Solutions & drops* never offers a sunglasses brand. |

## The model

- **Users are locations, not people.** Each location has a Supabase Auth
  account and a six-digit sign-in code. Codes are checked on Supabase's
  servers, never in the browser, and are stored only as bcrypt hashes.
- **Roles:** retail branch (sees only its own records), fitting centre (also
  sees jobs routed to it, and advances them), schedule editor (Ghiath: reads
  everything, changes only the schedule), office/admin (sees and
  oversees everything).
- **The data is shared, not local.** Every record lives in Postgres. A request
  placed at Seeb is visible at the office immediately, on a different
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

Each location has its own six-digit code. The office sets and changes them
all under **Settings → Branch access**; nobody, including the office, can
read an existing code back. The codes are kept outside this repository.

## Layout

```
index.html
css/styles.css      design system, layout, micro-animations, A4 print rules
js/data.js          locations, catalogue, status machines, permissions
js/auth.js          Supabase sign-in, session, office code control
js/supabase-config.js   project URL and anon key (public by design)
js/db.js            row <-> app mapping, collection loads, realtime
js/store.js         in-memory cache, mutations, change notification
js/ui.js            DOM helpers, icons, toasts, modal/drawer layers
js/app.js           login, boot, shell, navigation, live toasts
js/fitting.js       Module 1 — Fitting Log
js/stock.js         Module 2 — Stock Requests / Office queue
js/settings.js      Module 3 — Settings: categories, brand groups, branch access
js/lens.js          Module 4 — Lens Stock
js/claims.js        Insurance Claims and Direct Insurance (+ its dashboard), A4 invoice
js/schedule.js      Module 6 — Schedule: hosts scheduler.html, keeps its data in Postgres
scheduler.html      the staff scheduler, as built — only its storage now goes to the portal
img/                brand logos used on the printed receipt
supabase/*.sql      schema, row level security, functions, realtime
js/demo.js          Admin Demo (?AdminDemo=SCC): the database inside the browser
js/phone.js         phone number with a country picker; js/countries.js the codes
js/notify.js        the notification bell on each tab (All / My Action / Off) and what rings
js/insights.js      the Data tab: numbers, a chart, breakdowns and every record, per tab
js/sound.js         its two sounds — Web Audio, no file
demo/               practice copy's layout + starting data, and build.py that makes them
```

## Practice copy

`https://foc-portal.org/?AdminDemo` (or `?AdminDemo=SCC` for a branch) opens the portal on
a database of its own, running inside that browser (PGlite) and saved there
only — no code, nothing reaches the live data. `demo/schema.sql` is generated
from the live catalog, so it behaves exactly like the real portal. After any
migration: `python -I -X utf8 demo/build.py`, then bump `VERSION` in
`js/demo.js`.

## Database

Applied in order:

| File | What it adds |
|---|---|
| `supabase/schema.sql` | branches, claims (+ items, prescriptions), orders (+ events), lens stock, lens requests (+ lines, events); RLS on all of them; the atomic `confirm_lens_request`; realtime publication |
| `supabase/branch-codes.sql` | `set_branch_code` and `branch_access` — office-only, reject weak codes |
| `supabase/schema-02-shared.sql` | stock requests (+ lines, events), shared settings, reference numbers from database sequences, `complete_stock_request` |
| `supabase/schema-03-lens-topup.sql` | `add_lens_stock` — adding to a spec already on the shelf is one statement, so it cannot double-count |
| `supabase/schema-04-salalah-code.sql` | Salalah Shop's code SLS → SAL, in the table, the token claim and the sign-in address |
| `supabase/schema-05-lens-catalogue.sql` | `lens_catalogue` — the lens types, indices and coatings the holder edits |
| `supabase/schema-06-drop-frame-columns.sql` | drops the unused `orders.brand/model/lens` — **not applied** |
| `supabase/schema-07-lens-request-fulfilment.sql` | `create_lens_request` — a lens request opens its fitting order, frame over or lenses here |
| `supabase/schema-08-lens-auto-deduct.sql` | requests deducted the shelf as placed — applied, then undone by 09 |
| `supabase/schema-09-lens-confirm-again.sql` | puts back schema-07's `create_lens_request`: MGM confirms each request |
| `supabase/schema-10-office-ghiath-schedule.sql` | WH → OFC ("Office"); Ghiath, a read-only schedule editor; `schedule_state`, `schedule_weeks`, `schedule_view()` |
| `supabase/schema-11-schedule-publish.sql` | `publish_schedule_week()`; `schedule_view()` returns published, unfinished weeks; Al Mouj WAVE → MOUJ; saved days onto their real dates |
| `supabase/schema-12-schedule-roster-tables.sql` | the roster in `schedule_employees` / `schedule_branches`, its defaults in `schedule_defaults`, saved by `save_schedule_roster()` — none of it in the code |
| `supabase/schema-13-claim-invoice-fields.sql` | `claims.member_id`, `claims.insurer`, `app_settings.insurers` |
| `supabase/schema-14-direct-insurance.sql` | `claims.kind`, the salesperson columns, DI- numbering, the insurers seeded, `staff_list()` |
| `supabase/schema-16-lenses-delivered.sql` | the Fitting Log's `lenses_in` status |
| `supabase/schema-17-tab-maintenance.sql` | `app_settings.disabled_tabs` — the tabs switched off for maintenance |
| `supabase/schema-18-outside-cutters.sql` | `orders.outside_cutter`, `app_settings.outside_cutters` — frames sent to 3rd-party cutters |
| `supabase/schema-19-branches-editable.sql` | branches edited in Settings: `add_branch`, `save_branch`, open/closed, display order |
| `supabase/schema-20-delete-branch-lens-holders.sql` | `delete_branch`, several lens-stock holders (`holder_code`, `set_lens_holder`) |
| `supabase/schema-21-send-lenses.sql` | lens requests without confirming: reserve on order, `send_lens_request`, `decline_lens_request` |
| `supabase/schema-22-change-lens-fulfilment.sql` | switch a lens request between sending the frame and receiving the lenses |
| `supabase/schema-23-public-tab-maintenance.sql` | the sign-in page and public schedule respect a switched-off Schedule tab |
| `supabase/schema-24-outside-lens-orders.sql` | (trial) outside-lens orders that MGM copies to the supplier and marks ordered |
| `supabase/schema-25-outside-lens-flow.sql` | (trial) send the frame or receive the lenses; nothing cut or sent before ordered |
| `supabase/schema-26-outside-handler-sees-orders.sql` | (trial) MGM reads every order with outside lenses |
| `supabase/schema-27-outside-pick-fitter.sql` | (trial) send-the-frame outside orders: the branch picks the fitter |
| `supabase/schema-28-bench-lock-outside-flow.sql` | fitting centres close their bench while the fitter is on leave; outside lenses: frame to MGM, or lenses to the branch |
| `supabase/schema-29-stock-receive-pick-fitter.sql` | stock lenses received by a branch: cut here or send to a fitter |
| `supabase/schema-30-outside-two-legs.sql` | (trial) Avenues orders outside lenses; frame and lenses travel separately to the chosen fitter |
| `supabase/schema-31-collected.sql` | the last step: the customer collects the glasses |
| `supabase/schema-32-outside-arrived.sql` | outside lenses: Avenues marks them received before sending them on |
| `supabase/schema-33-lab-inhouse.sql` | the Lab: On / In-house only / Off |
| `supabase/schema-34-order-edit-delete.sql` | fix mistakes: edit an order, undo its last step, delete it before anything moved |
| `supabase/schema-35-claim-item-kind-qty.sql` | invoice products: frame or lenses, with a quantity |
| `supabase/schema-36-collect-at.sql` | collect at another branch, with transfers when the customer changes their mind |
| `supabase/schema-37-admins-damaged.sql` | view-only admins (Wijdan, Sarah), the insurance export switch, Damaged Stock reports |
| `supabase/schema-38-stock-partial.sql` | complete a stock request line by line |
| `supabase/schema-39-scale.sql` | ready for 50 people at once: permission checks once per query, missing indexes |
| `supabase/schema-40-people-not-branches.sql` | people (office, Ghiath, view-only admins) can't be chosen as a branch |
| `supabase/schema-41-accounts.sql` | Accounts: any account can be a branch or a person; one office admin always remains |
| `supabase/schema-42-own-lens-stock.sql` | a lens holder uses its own shelf for its own fitting orders |
| `supabase/schema-43-security.sql` | security: outsiders can only see the sign-in list; everything else closed |
| `supabase/schema-44-direct-line-total.sql` | Direct Insurance: a line's price is the whole line's; the Reimbursement Invoice stays price × qty |
| `supabase/schema-45-employees.sql` | `employees`: the staff by full name, the salesperson list — apart from the schedule's roster |
| `supabase/schema-46-payment-both.sql` | Reimbursement Invoice payment may be cash, card or both |
| `supabase/schema-47-direct-cancel.sql` | Direct Insurance is canceled (kept, marked, exported), never deleted |
| `supabase/schema-48-branch-hours.sql` | `branch_hours(code)`: a branch's opening hours from this week's schedule |
| `supabase/schema-49-branch-name-ar.sql` | `branches.name_ar`: each branch's name in Arabic, set by the office |
| `supabase/schema-50-permissions.sql` | access permissions per account (tick boxes + View only); people are one kind |
| `supabase/schema-51-outside-supplier.sql` | the outside-lens supplier's name and WhatsApp number (`set_outside_supplier`) |
| `supabase/schema-52-storage-usage.sql` | Settings → Data usage: `storage_usage()`, a daily reading (`storage_usage_log`, pg_cron) |
| `supabase/schema-53-tabs-per-account.sql` | `branches.tabs_hidden`: which sidebar tabs each account sees (`set_tabs_hidden`); Data hidden for branches |
| `supabase/schema-54-lens-stock-any-account.sql` | any open account may hold lens stock; frames go only to a fitting centre's shelf |
| `supabase/schema-55-mend-dashes.sql` | four functions' messages: garbled dashes put right |
| `supabase/schema-59-claims-ipd.sql` | `claims.ipd`: IPD on Direct Insurance (Admin Demo first) |
| `supabase/schema-58-open-as.sql` | `account_switches`: the record of every "Open as…" (edge function `supabase/functions/open-as`) |
| `supabase/schema-57-tabs-given.sql` | `branches.tabs_shown`: a tab given to an account on top of what it sees by itself (`set_tabs`) |
| `supabase/schema-56-step-log.sql` | `step_log`: when each order / stock request / lens request changed step (triggers), for the Data tab's journey times |
| `supabase/schema-15-invoice-numbers.sql` | claims are numbered `INV-…` (the three made before are renamed) |

Reference numbers (`SR-…`, `LR-…`, `INV-…`, `DI-…`) are allocated by Postgres sequences
as part of the insert, so two branches acting at the same instant cannot be
given the same one. A fitting order's reference is the branch's own bill
number and is unique per branch, not globally.
