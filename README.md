# Hour-tracker

**Hours** is a personal clock-in/clock-out app for iPhone. It's a web app you add to your Home Screen, so it needs no App Store, no Mac and no Apple developer account.

## What it does

- **One-tap Clock In / Clock Out.** It records the exact time and today's date. Undo is available for a few seconds in case you tap by mistake.
- **Clock In At… / Clock Out At…** for when you forgot. A scroll wheel opens on the current time, so you only scroll back to when you actually started or left. It works out the day (11 PM picked just after midnight means last night) and won't accept a time that hasn't happened yet, a clock-out before the clock-in, or a clock-in that overlaps your last shift.
- **Optional breaks.** Tap **Add break** while on the clock, or right after clocking out, and pick the length on a wheel (5-minute steps, starts at 1 hour). You can also set or change a break when editing a shift. Breaks come off the shift's hours everywhere, and exports show them in a Break column (rounding applies after the break).
- **A live timer and totals** for today and this week while you're on the clock. A warning appears if you've been clocked in for more than 12 hours.
- **Pay periods run Monday to Sunday.** Each week lists every shift (start – end), a total for each day and the week total. A shift that runs past midnight counts toward the day you clocked in.
- **Up to a few jobs** (for example Church and a second job), each with its own color and clock. Pay Periods can show all jobs or one at a time.
- **Fix mistakes.** Change the clock-in or clock-out time, add a shift you forgot, add a note, or delete a shift.
- **Export a week** as text (for Messages or email), as a CSV spreadsheet, or as a printable page or PDF. **Export everything** as CSV.
- **Clean timesheets.** Exports round each shift to the nearest 15 minutes (8h 56m → 9h, 8h 48m → 8h 45m), and the day and week totals add up those rounded shifts. Clock-in/out times stay exact, the app itself shows exact hours, and rounding can be turned off in Settings.
- **Back up and restore** all your data as a file (keep a copy in iCloud Drive).
- **Optional app-icon badge** while you're clocked in, so you notice if you forgot to clock out.
- **Works offline** and supports dark mode. Your data stays on your phone.

Hours are counted in whole minutes, from the minute you clock in to the minute you clock out, so the totals always match the times shown.

## Put it on your iPhone

The app is the `docs/` folder: plain HTML, CSS and JavaScript with no build step. It needs to be served from an `https://` address. This repository is private, and GitHub Pages only serves private repositories on paid plans, so pick one of these:

**Option 1: GitHub Pages (make the repo public)**
1. On GitHub, go to the repo's **Settings → General → Danger Zone → Change visibility → Public**. The code holds no personal data; your hours live only on your phone.
2. Go to **Settings → Pages**. Under *Build and deployment*, choose **Deploy from a branch**, pick the branch with the app (`main` once merged) and the **/docs** folder, then **Save**.
3. After a minute, the page shows your address, such as `https://dycksamuel.github.io/Hour-tracker/`.

**Option 2: Cloudflare Pages or Netlify (keeps the repo private, free)**
Sign in with GitHub, import this repo, leave the build command empty, and set the output/publish directory to `docs`.

**Then on the iPhone:**
1. Open the address in **Safari**.
2. Tap **Share → Add to Home Screen → Add**.
3. Always open **Hours** from the Home Screen icon. Data saved there stays even if Safari's history is cleared.

> Your hours are tied to that web address. If you ever move the app to a different address, use **Settings → Back up everything** first, then **Restore from a backup** in the new one.

## Updating

When the files in `docs/` change, bump `VERSION` in `docs/sw.js` (and `APP_VERSION` in `docs/js/app.js`). The phone picks up the new version the next time the app opens with a connection.

## Development

```sh
npm run serve       # serves docs/ at http://localhost:8080
npm test            # unit tests for week/day math, totals and exports
npm run test:e2e    # drives the app in a phone-sized browser (needs Playwright + Chromium)
npm run icons       # re-renders docs/icons/*.png from the SVGs
```
