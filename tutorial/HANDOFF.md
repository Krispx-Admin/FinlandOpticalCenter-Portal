# Handoff: record the FOC Portal tutorial video

You are driving Chrome so the user can record one continuous tutorial video of
**FOC Portal** (https://foc-portal.org), the internal operations app for
Finland Optical Center's branches in Oman. The user records the screen; you
drive the page.

**You do not click through the tutorial yourself.** The portal has a built-in
presenter mode that plays the whole tour as scripted takes. It draws a
gliding cursor, red click ripples, spotlight zoom-ins, bottom captions and
full-screen chapter cards. Your job is to set it up, start it, watch it, and
recover it if a step fails. Improvised clicking would leave long pauses in the
video. The scripted takes don't.

## What the tour shows

About 10–11 minutes in seven chapters, played in this order:

| Chapter | Signed in as | Shows |
|---|---|---|
| `intro` | signs in on camera as **SCC** | the sign-in page, code entry (masked) |
| `seeb` | SCC: Seeb City Centre, retail | fitting order → send to fitter; stock request; lens request; insurance claim |
| `mouj` | MOUJ: Al Mouj, fitting centre | lens request choosing "Receive the lenses"; the fitting order that opens by itself |
| `mgm` | MGM: Muscat Grand Mall, fitting centre and lens holder | receiving Seeb's frame; an in-house job; answering both lens requests; the shelf and its cog |
| `moujDone` | MOUJ | start fitting → done |
| `warehouse` | WH: Warehouse | network-wide view; completing Seeb's stock request; claims; settings |
| `finale` | SCC | confirming delivery of the frame from chapter 1 |

The sign-in appears once. Every later switch happens behind a chapter card,
so no sign-in form or code appears on camera again.

## Before you start: get these from the user

1. **The six-digit sign-in codes for SCC, MOUJ, MGM and WH.** Never repeat them
   in chat, never put them in a caption, and never type them into a visible
   field. They only go into `present.pins()` or the panel's password fields.
2. **Who is recording.** Normally the user records with Windows Snipping Tool
   (**Win + Shift + R**), dragging the box over the web page area only, so your
   side panel stays out of the video. Agree that they start recording when you
   say "ready", and stop when you say "done".

## Setup

1. Work in **one tab**. The page area should be at least **1440 × 860**: below
   1180px wide the journey column on the Fitting Log hides, and the script
   zooms into it. If you can resize the window, go for 1600 × 1000.
2. Go to **https://foc-portal.org/?present**
3. If the portal opens signed in, press **Sign out** at the bottom of the left
   sidebar, so the sign-in page with the location buttons is showing.
4. Run in the page:
   ```js
   present.pins({ SCC: '······', MOUJ: '······', MGM: '······', WH: '······' })
   ```
   It returns `['SCC','MOUJ','MGM','WH']`, which lists the codes it holds, never
   their values. Codes live in memory only, so **after any page reload, set them
   again.**
5. Check `present.chapters()` returns the seven chapters above.
6. Tell the user "Ready — start recording", and wait for them to confirm.

If you **can't run JavaScript** in the page: press **Alt+P** to open the
presenter panel, type the four codes into its password fields, and use its
buttons. **▶ Play all** and **Resume** do the same as the calls below. The
panel hides itself when a take starts.

## Recording

Start the whole video in one go, **without awaiting it**:

```js
present.playAll(); 'started'
```

Then watch it with `present.status()` every 15–20 seconds. It returns
`{ running, chapter, step, total, error, done, playingAll, ctx }`. **Don't
click, scroll or type in the page while it's running.** That moves the cursor
on camera and can make a step miss. Screenshots are fine.

It's finished when `running` is false, `error` is null and `chapter` is
`'finale'`. The end card stays on screen. Tell the user "done — stop
recording".

`ctx` holds this take's bill numbers (`DEMO-xxx1` … `DEMO-xxx5`). Mention them
to the user at the end.

## When a step fails

`present.status()` shows `running: false` and an `error` like
`step 41 ["tap","{seebOrder} >> Send to fitter"]: nothing on screen matches …`.

1. Take a screenshot to see what's actually on screen.
2. Common causes: a toast covering the target, a drawer or dialog still open,
   data still loading, a row that isn't where the script expected.
3. Put the page right **using presenter calls**, so it still looks deliberate
   on video. For example `present.tap('.drawer [data-close]')`,
   `present.tap('a.nav-item[href="#/lens"]')`, `present.wait(1000)`.
   Targets are CSS selectors or visible text, and `A >> B` means B inside
   whatever holds A.
4. Carry on with `present.resume()`. It restarts the failed step and continues
   through the remaining chapters. If the failed step **did** happen (the click
   went through and something after it gave up), use
   `present.resume({ skip: true })` to start from the next step.
5. If something can't be fixed cleanly, stop and tell the user which chapter
   and step. They can cut that part, or do a full retake: stop recording,
   sign out, and run `present.playAll()` again. A fresh take mints new bill
   numbers, so it never collides with the old one.

To play a single chapter on its own: `present.play('mgm')`. To start partway:
`present.playAll('mgm')`.

## Rules

- **Create nothing the script doesn't create.** Everything it makes carries a
  `DEMO-` bill number so it can be removed afterwards.
- Don't set or change codes in **Settings → Branch access**. The tour only
  shows that screen.
- Don't press **Print**. It opens a system print dialog that blocks the page.
- Don't delete or edit anything that isn't from this recording.
- If something comes up that this document doesn't cover, stop and ask the user.

## Afterwards, tell the user

- the take finished (or where it stopped), and the bill numbers in `ctx`
- to ask their Claude Code session to **clean up the demo data**
  (`tutorial/demo-cleanup.sql` in the project removes everything the tour made)
- to **change any sign-in code they shared with you**, in Settings → Branch access

## Presenter calls, for fixing things by hand

| Call | Does |
|---|---|
| `present.tap(t)` | glides the cursor to `t`, shows a ripple, clicks it |
| `present.type(t, text)` | types into a field at reading pace |
| `present.choose(t, option)` | picks an option in a dropdown |
| `present.point(t)` | glides the cursor there without clicking |
| `present.focus(t, { zoom })` | spotlights and zooms towards `t` |
| `present.reset()` | zooms back out |
| `present.caption(title, sub)` | bottom caption; `present.caption()` clears it |
| `present.card(title, sub, kicker)` | full-screen title card; `present.card()` hides it |
| `present.wait(ms)` | pause |
| `present.find(t)` | returns the element `t` resolves to, without touching it |
| `present.status()` | where things stand |
