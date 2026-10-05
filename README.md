# FOC Portal — Optical Operations

An internal, real-time operations portal for a multi-branch optical retail
chain: retail branches, lens-fitting centres, eye clinics and one central
warehouse, all looking at the same live board.

**Zero build step.** Plain HTML + CSS + ES modules — serve the folder with any
static server:

```bash
python3 -m http.server 8000     # or: npx serve
# open http://localhost:8000
```

## What's inside

| Module | What it does |
|---|---|
| **Fitting Log** | Tracks a frame's physical journey: branch → fitting centre → back to the branch. Log an order with just a bill number, then send it to a fitting centre. Pipeline: Pending → In transit to fitter → At fitter → Ready → Returning → Delivered, with click-to-select + bulk advance, urgent flags, a per-order journey diagram (the fitter node turns green when ready) and a full audit timeline. |
| **Stock Requests** | Branches compose category-first requests; the admin controls, per category, which fields are needed, whether it's counted in pieces or boxes, and which brand group it offers (Settings). No review step — the warehouse prints the pick sheet, fulfils it, and marks it completed. |
| **Lens Stock** | One fitting centre (MGM) holds the loose-lens shelf and is the only location that can edit its counts. Every other branch browses that shelf by type / index / coating / SPH / CYL, builds a basket and requests it; MGM confirms — which deducts the quantities — or declines with a reason. |
| **Insurance Claims** | Raises a printable A4 claim receipt: date, branch, bill number and customer, a priced product list that totals itself, a full SPH/CYL/AXIS/ADD/PD prescription grid, and the payment method. The on-screen preview and the printed sheet are built from the same markup, so what you see is what prints — brand logo on the header, logomark watermarked across the page. |
| **Settings** *(admin)* | Request categories: which fields each needs, pieces vs boxes, and its brand group. Brand groups: named lists of brands, drag-and-drop between them, so picking *Solutions & drops* never offers a sunglasses brand. |

## The model

- **Users are locations, not people.** Sign in as a location with a short PIN.
- **Roles:** retail branch (sees only its own records), fitting centre (also
  sees jobs routed to it, and advances them), warehouse/admin (sees and
  oversees everything).
- **Real-time:** state lives in `localStorage` and syncs instantly across tabs
  via `BroadcastChannel` — open two tabs, sign in as two locations, and watch
  actions land on both boards. A background simulator (one elected leader tab)
  keeps the rest of the network "working" so the board feels alive.
- Login persists across refresh; each tab can hold a different location.

## Demo credentials

| Locations | PIN |
|---|---|
| All branches & fitting centres | `1234` |
| Warehouse (admin) | `9999` |

“Reset demo” in the sidebar restores the seeded records (all tabs).

## Layout

```
index.html
css/styles.css      design system, layout, micro-animations
js/data.js          locations, catalogue, status machines, permissions, seed data
js/store.js         state, persistence, cross-tab sync, mutations, simulator
js/ui.js            DOM helpers, icons, toasts, modal/drawer layers
js/app.js           login, shell, navigation, live toasts
js/fitting.js       Module 1 — Fitting Log
js/stock.js         Module 2 — Stock Requests / Warehouse queue
js/settings.js      Module 3 — Settings: categories & brand groups (admin)
js/lens.js          Module 4 — Lens Stock
js/claims.js        Module 5 — Insurance Claim Receipts (A4 print)
img/                brand logos used on the printed receipt
```
