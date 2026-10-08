# FOC Portal — tutorial video script

One continuous video, about 10–11 minutes. You see the sign-in once, on camera.
Every later change of branch happens behind a full-screen chapter card, so no
sign-in form and no code appears again.

The captions are the narration: they appear as a bar along the bottom of the
screen. A red ring marks every click, a cursor glides to each button before
it's pressed, and the important part of the screen is spotlit and zoomed in.

This script is the readable version of `js/tour.js`, which is what actually
plays. Change one, change the other.

---

## Intro: signing in (about 30 s)

| On screen | Caption |
|---|---|
| Title card: **FOC Portal**. "One place for every branch, fitting centre, clinic and the warehouse" | — |
| Sign-in page | Every location signs in from the same page |
| Zoom: the Warehouse panel | The warehouse sits on top… |
| Zoom: the three columns of locations | …with every branch, fitting centre and clinic below it. *Pick your own location to begin* |
| Cursor taps **Seeb City Centre** | — |
| Zoom: the code box. The code is typed, but shows only as dots | Then enter your location's six-digit code. *Each location has its own — the warehouse can change any of them* |
| Taps **Sign in** and the portal opens | — |

## Chapter 1: Seeb City Centre, a retail branch (about 3½ min)

Card: *"A retail branch sells the frame, sends it out for lenses, and hands it back to the customer."*

**Fitting Log**

| On screen | Caption |
|---|---|
| Zoom: the stat tiles | Fitting Log. *Every frame that leaves the branch to have its lenses fitted* · Active orders, urgent ones, and the ones waiting on you |
| Zoom: the filter chips | Filter by where each frame is on its journey |
| Taps **New fitting order**; types a bill number and **Ahmed Al Balushi** | A customer has bought glasses — log the frame · The bill number from the bill book, and the customer's name. *Both are required* |
| Taps **Log order**; spotlight on the new row | Logged — it reads "Waiting for Lenses" until it leaves the branch |
| Taps **Send to fitter**; zoom on the fitting-centre picker; taps **Muscat Grand Mall** | When the driver collects it: Send to fitter · Choose the fitting centre that will cut the lenses |
| Zoom: the status pill, then the journey diagram | Now it reads "Waiting to be Fitted". *Muscat Grand Mall sees it coming straight away* · Its journey: Seeb → Muscat Grand Mall → back to Seeb |
| Opens the order; zoom on the timeline | Open any order to see its whole history |

**Stock Requests**

| On screen | Caption |
|---|---|
| Taps **New stock request**; picks Sunglasses · Ray-Ban · Women · 6 | Stock Requests. *Order stock from the warehouse* · One line per item: category, then brand, who it's for and how many |
| Taps **Add line**; Cleaning kits · 4; note "Weekend promotion" | Add as many lines as you need |
| Taps **Place request**; spotlight on the new row | Placed — it lands in the warehouse's queue at once |

**Lens Stock**

| On screen | Caption |
|---|---|
| Zoom: the filters | Lens Stock. *The loose lenses on the shelf at Muscat Grand Mall* · Filter by type, index and coating — or search for a power |
| Zoom: one lens card (SPH −2.50) | Each card shows the power, and how many are on the shelf |
| Taps **Add**, then **+** | Two — one for each eye |
| Taps **Review & request**; types **Fatma Al Hinai** and a bill number | Who it's for: the customer and the bill number. *The fitting order opens from this by itself* |
| Taps **Send request** | Sent to Muscat Grand Mall. *A shop has no bench, so the frame goes over to be cut there* |
| Back to the Fitting Log; spotlight on the new order and its Stock Lens tag | …and that job is already in the fitting log. *Tagged Stock Lens — open it to see which lenses* |

**Insurance Claims**

| On screen | Caption |
|---|---|
| Taps **New claim receipt**; bill number, **Salim Al Rawahi** | Insurance Claims. *A printable receipt for the customer's insurer* |
| Two products with prices; zoom on the total | What they bought, and the price in rials · The total adds itself up |
| Zoom: the prescription grid; both eyes typed in, plus Add | The prescription — distance and near, for each eye |
| Payment: Card; taps **Create receipt**; the A4 receipt appears | Ready to print and sign. *Clinics raise their claims exactly the same way* |

## Chapter 2: Al Mouj, a fitting centre (about 1½ min)

Card: *"A fitting centre — it cuts lenses on its own bench."*

| On screen | Caption |
|---|---|
| Lens Stock: adds 2 × the SPH −4.00 lens, **Review & request** | Al Mouj needs a pair of lenses from Muscat Grand Mall's shelf |
| Zoom: the two choice cards | A fitting centre chooses how the job gets done · Send the frame over to be cut there… *…or have the lenses sent here and cut them yourself* |
| Taps **Receive the lenses**; types **Maryam Al Kindi** and a bill number; **Send request** | — |
| Zoom: the "Lenses come here" tag | Marked "Lenses come here" |
| Fitting Log: spotlight on the order that opened by itself | The job is already in Al Mouj's fitting log. *In-house — the frame never leaves the building* |
| Opens it: one-node journey, then the timeline | It reads "Waiting for Lenses" until they arrive |

## Chapter 3: Muscat Grand Mall, fitting centre and lens holder (about 3 min)

Card: *"Fits lenses for other branches and for itself — and keeps the lens shelf."*

**A frame from another branch**

| On screen | Caption |
|---|---|
| Spotlight: Seeb's order | Seeb's frame is on its way here |
| **Confirm arrival** → **Mark ready** → **Send to branch** | Confirm arrival when the driver drops it off · Mark ready once the lenses are fitted · Send it back with the driver |
| Zoom: the status pill | "Returning to SCC" — Seeb knows it's on its way back |

**A job it keeps**

| On screen | Caption |
|---|---|
| **New fitting order**: bill number and **Khalid Al Harthy** | A customer buys glasses here, at Muscat Grand Mall · It reads "Waiting for Lenses" until they come in from the supplier |
| **Send to fitter**: zoom on its own centre at the top of the picker | Lenses in? Send to fitter — and keep it here · Your own centre comes first: no transit, no driver |
| Taps it; then **Mark as done**; shown under Completed | Straight to "In fitting" · Done — it waits here for the customer to collect it. *No transit and no delivery step* |

**Lens requests**

| On screen | Caption |
|---|---|
| Lens Stock: the incoming requests | Lens Stock — every branch's lens requests arrive here |
| Opens Al Mouj's; zoom on its tag, then on its timeline | Al Mouj will cut these itself, so the lenses travel · Nothing to confirm. *The lenses came off the shelf the moment Al Mouj asked* |
| Opens Seeb's; zoom on its tag | Seeb's frame is coming here, so these stay on this bench |

**The shelf**

| On screen | Caption |
|---|---|
| **My shelf**: zoom on the table | The shelf — counts are edited right here |
| Toggles **Hide empty** off and on | Hide empty keeps sold-out lines out of the way |
| Zoom on the cog; opens it; adds index **1.80** and coating **Anti-fog**, then removes both | The cog decides what the shelf can hold · Add a new index… · …or a new coating. *Every branch's filters pick it up at once* · Anything not on the shelf can be taken off again |
| Opens **Add lens stock**, then closes it | Add lens stock tops up a line, or starts a new one |

## Chapter 4: back at Al Mouj (about 30 s)

Card: *"The lenses have arrived from Muscat Grand Mall."*

| On screen | Caption |
|---|---|
| **Start fitting** → **Mark as done**; shown under Completed | The lenses are in — start fitting · In fitting · Done — ready for Maryam to collect |

## Chapter 5: the Warehouse (about 1½ min)

Card: *"Sees every branch, fulfils stock requests and runs the settings."*

| On screen | Caption |
|---|---|
| Fitting Log for the whole network; zoom on the branch filter | The warehouse sees every frame across the network · Narrow it to one branch, or to one fitting centre |
| Queue: opens Seeb's request; **Mark completed** | The request queue — Seeb's request is waiting · Mark completed when it ships — Seeb sees it straight away |
| Insurance Claims list | Every branch's and clinic's claim receipts, in one list |
| Settings: categories, brand groups; adds then removes the brand "Demo Optics" | Settings — what branches can request · Brand groups — which brands each category offers · Every branch's request form offers it at once |
| Zoom: Branch access. Nothing is typed | Branch access — set or change any location's code. *Codes are never shown, only replaced* |

## Finale: back at Seeb (about 30 s)

| On screen | Caption |
|---|---|
| Spotlight: Seeb's original order, "Returning to SCC"; **Confirm delivery**; shown under Completed | "Returning to SCC" — and the driver is here · Delivered — the whole round trip, start to finish |
| End card: **That's FOC Portal**. "Every branch, every frame, every lens — in one place" | — |

---

### Who is covered

Retail branches (Seeb), fitting centres (Al Mouj, and Muscat Grand Mall as a fitter), the lens holder (Muscat Grand Mall), and the warehouse. Clinics aren't given their own chapter. Their working screen is Insurance Claims, which the Seeb chapter shows step by step and the captions point out.
