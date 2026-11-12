// End-to-end check of the app in an iPhone-sized browser, with a fake clock.
// Run: npm run test:e2e        (screenshots go to $SHOTS_DIR, default tests/screenshots)
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const PORT = 8765;
const ROOT = path.join(__dirname, '..', 'docs');
const SHOTS = process.env.SHOTS_DIR || path.join(__dirname, 'screenshots');
const TZ = 'America/Toronto';
process.env.TZ = TZ;

const phone = {
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: Number(process.env.DPR || 2),
  isMobile: true,
  hasTouch: true,
  timezoneId: TZ,
  locale: 'en-US',
  userAgent:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
};

const at = (y, m, d, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi).getTime();
const url = `http://127.0.0.1:${PORT}/`;

async function waitForServer() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}

function watchErrors(page, errors) {
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`console: ${m.text()}`);
  });
}

async function shot(page, name) {
  await page.waitForTimeout(350); // let sheet/toast transitions settle
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function freshFlow(browser) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  // Thursday Nov 5 2026, 9:07 AM
  await page.clock.install({ time: at(2026, 11, 5, 9, 7) });
  await page.goto(url);

  // Welcome -> add first job
  await page.getByPlaceholder('Job name, e.g. Church').fill('Church');
  await shot(page, '01-welcome');
  await page.getByRole('button', { name: 'Add job' }).click();
  await page.getByRole('button', { name: 'Clock In Now', exact: true }).waitFor();
  assert.equal(await page.locator('.pill').textContent(), 'Off the clock');

  // Clock in: uses the current time automatically
  await page.getByRole('button', { name: 'Clock In Now', exact: true }).click();
  await page.locator('#toast.show').waitFor();
  assert.match(await page.locator('#toast').textContent(), /Clocked in at 9:07 AM/);
  assert.equal(await page.locator('.pill').textContent(), 'On the clock');
  assert.match(await page.locator('.since').textContent(), /since 9:07 AM/);

  // An hour and a quarter later the timer and totals have moved on their own
  await page.clock.runFor(75 * 60 * 1000 + 1000);
  assert.match(await page.locator('.timer').textContent(), /^1:15:0[01]$/);
  const stats = page.locator('.stats b');
  assert.equal(await stats.nth(0).textContent(), '1.25h');
  assert.equal(await stats.nth(1).textContent(), '1.25h');
  await shot(page, '02-clocked-in');

  // Persisted: reload and it's still running
  await page.reload();
  assert.equal(await page.locator('.pill').textContent(), 'On the clock');

  // Clock out at 4:21 PM
  await page.clock.setSystemTime(at(2026, 11, 5, 16, 21));
  await page.getByRole('button', { name: 'Clock Out Now', exact: true }).click();
  assert.match(await page.locator('#toast').textContent(), /Clocked out at 4:21 PM · 7.23h/);
  assert.equal(await page.locator('.pill').textContent(), 'Off the clock');
  assert.match(await page.locator('.card.list').textContent(), /9:07 AM – 4:21 PM/);

  // Undo the clock-out, then clock out again
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.locator('.pill').textContent(), 'On the clock');
  await page.getByRole('button', { name: 'Clock Out Now', exact: true }).click();
  await shot(page, '03-clocked-out');

  // Edit the shift: change clock-in to 9:06
  await page.locator('.card.list .row').first().click();
  await page.locator('input[name="start"]').fill('2026-11-05T09:06');
  await shot(page, '04-edit-shift');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await page.locator('.card.list').textContent(), /9:06 AM – 4:21 PM\s*7.25h/);

  // Validation: clock-out before clock-in
  await page.locator('.card.list .row').first().click();
  await page.locator('input[name="end"]').fill('2026-11-05T08:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.equal(await page.locator('.form-error').textContent(), 'Clock-out has to be after clock-in.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Add a second job in Settings
  await page.locator('.tabbar [data-tab="settings"]').click();
  await page.getByRole('button', { name: '+ Add job' }).click();
  await page.locator('input[name="name"]').fill('Cafe');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.locator('.tabbar [data-tab="clock"]').click();
  assert.equal(await page.locator('.job').count(), 2);

  // Both jobs can be clocked separately
  await page.locator('[data-action="clock-in"]').nth(1).click();
  assert.equal(await page.locator('.job.is-on').count(), 1);
  assert.match(await page.locator('.job.is-on .job-name').textContent(), /Cafe/);
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.locator('.job.is-on').count(), 0);

  // Offline: the app still opens with no connection
  await page.waitForFunction(() => navigator.serviceWorker?.controller);
  await context.setOffline(true);
  await page.reload();
  await page.getByRole('button', { name: 'Clock In Now', exact: true }).first().waitFor();
  await context.setOffline(false);

  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ fresh flow: clock in/out, live timer, undo, edit, validation, second job, offline');
}

function seedState() {
  const jobs = [
    { id: 'church', name: 'Church', color: '#2f7cf6', createdAt: 1 },
    { id: 'cafe', name: 'Cafe', color: '#30a46c', createdAt: 2 },
  ];
  const e = (id, jobId, start, end, note = '') => ({ id, jobId, start, end, note });
  const entries = [
    e('1', 'church', at(2026, 11, 2, 9, 6), at(2026, 11, 2, 16, 21)),
    e('2', 'church', at(2026, 11, 3, 9, 6), at(2026, 11, 3, 16, 21)),
    e('3', 'church', at(2026, 11, 3, 18, 1), at(2026, 11, 3, 20, 35), 'Youth night'),
    e('4', 'church', at(2026, 11, 4, 9, 33), at(2026, 11, 4, 10, 29)),
    e('5', 'cafe', at(2026, 11, 4, 12, 0), at(2026, 11, 4, 15, 30)),
    e('6', 'church', at(2026, 11, 5, 9, 7), null),
  ];
  // Four earlier weeks of Church shifts, Mon–Fri
  let n = 100;
  for (let w = 1; w <= 4; w++) {
    for (let d = 0; d < 5; d++) {
      const day = new Date(2026, 10, 2 - 7 * w + d);
      const y = day.getFullYear();
      const m = day.getMonth() + 1;
      const dd = day.getDate();
      if ((w + d) % 4 === 0) continue;
      entries.push(e(String(n++), 'church', at(y, m, dd, 9, 0), at(y, m, dd, 13 + ((w + d) % 3), 15 * ((w * d) % 4))));
    }
  }
  return { version: 1, jobs, entries, settings: { hoursFormat: 'decimal', badge: false } };
}

async function seededFlow(browser, colorScheme) {
  const context = await browser.newContext({ ...phone, colorScheme, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.clock.install({ time: at(2026, 11, 5, 10, 19) });
  const seed = JSON.stringify(seedState());
  await page.addInitScript((s) => {
    if (!localStorage.getItem('hourtracker.v1')) localStorage.setItem('hourtracker.v1', s);
  }, seed);
  await page.goto(url);
  const suffix = colorScheme === 'dark' ? '-dark' : '';

  await shot(page, `05-clock-two-jobs${suffix}`);
  assert.equal(await page.locator('.job.is-on .timer').textContent(), '1:12:00');

  await page.locator('.tabbar [data-tab="weeks"]').click();
  await shot(page, `06-pay-periods${suffix}`);
  const firstWeek = page.locator('[data-action="open-week"]').first();
  assert.match(await firstWeek.textContent(), /Nov 2 – Nov 8, 2026/);
  assert.match(await firstWeek.textContent(), /This week/);
  // 7.25 + 7.25 + 2.5667 + 0.9333 + 3.5 + 1.2 (running since 9:07) = 22.7h
  assert.equal((await firstWeek.locator('.row-value').textContent()).trim(), '22.7h');

  await firstWeek.click();
  await shot(page, `07-week-detail${suffix}`);
  const dayHeads = await page.locator('.day-head h3').allTextContents();
  assert.deepEqual(dayHeads, ['Mon Nov 2', 'Tue Nov 3', 'Wed Nov 4', 'Thu Nov 5']);
  assert.equal(await page.locator('.day').nth(1).locator('.day-head b').textContent(), '9.82h');

  if (!colorScheme || colorScheme === 'light') {
    await page.locator('.export').scrollIntoViewIfNeeded();
    await shot(page, '08-week-detail-export');

    // Filter to one job
    await page.getByRole('tab', { name: 'Cafe' }).click();
    assert.equal((await page.locator('.summary-main b').textContent()).trim(), '3.5h');
    await page.getByRole('tab', { name: 'All jobs' }).click();

    // CSV export (no share sheet in desktop Chromium, so it falls back to a download)
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Spreadsheet (CSV)' }).click()]);
    assert.equal(download.suggestedFilename(), 'hours-week-of-2026-11-02.csv');
    const csv = fs.readFileSync(await download.path(), 'utf8');
    fs.writeFileSync(path.join(SHOTS, 'sample-week.csv'), csv);
    // Exports round each shift to the nearest 15 minutes (on by default)
    assert.match(csv, /2026-11-03,Tue,Church,6:01 PM,8:35 PM,,2.5,Youth night/);
    assert.match(csv, /2026-11-04,Wed,Church,9:33 AM,10:29 AM,,1,/);
    assert.match(csv, /,,,,,Day total \(Tue Nov 3\),9.75,/);
    assert.match(csv, /Week total \(Nov 2 – Nov 8, 2026\)",22.75,/);
    assert.doesNotMatch(csv, /rounded/); // no rounding note in the spreadsheet
    assert.equal(await page.locator('.export-note .rounded-total').textContent(), '22.75h');

    // Print view renders the report
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.getByRole('button', { name: 'Print / PDF' }).click();
    assert.match(await page.locator('#print-root').textContent(), /Week total: 22.75h/);
    assert.doesNotMatch(await page.locator('#print-root').textContent(), /rounded/);
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: path.join(SHOTS, 'sample-week.pdf'), format: 'Letter', margin: { top: '0.6in', bottom: '0.6in', left: '0.6in', right: '0.6in' } }).catch(() => {});
    await page.emulateMedia({ media: 'screen' });

    // Previous week
    await page.getByRole('button', { name: 'Previous week' }).click();
    assert.match(await page.locator('.page-head h1').textContent(), /Oct 26 – Nov 1, 2026/);
    assert.equal(await page.getByRole('button', { name: 'Next week' }).isDisabled(), false);
    await page.getByRole('button', { name: 'Next week' }).click();
    assert.equal(await page.getByRole('button', { name: 'Next week' }).isDisabled(), true);

    // Hours & minutes display
    await page.locator('.tabbar [data-tab="settings"]').click();
    await shot(page, '09-settings');
    await page.getByRole('button', { name: /Hours & min/ }).click();
    await page.locator('.tabbar [data-tab="clock"]').click();
    assert.match(await page.locator('.job.is-on .stats b').first().textContent(), /^1h 12m$/);

    // Rounding can be turned off for exact exports
    await page.locator('.tabbar [data-tab="settings"]').click();
    await page.locator('input[data-action="round-toggle"]').click();
    const [exact] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Export all shifts/ }).click()]);
    const exactCsv = fs.readFileSync(await exact.path(), 'utf8');
    assert.match(exactCsv, /6:01 PM,8:35 PM,,2.57,Youth night/);
    assert.doesNotMatch(exactCsv, /rounded/);
    await page.locator('input[data-action="round-toggle"]').click();

    // Backup downloads valid JSON
    await page.locator('.tabbar [data-tab="settings"]').click();
    const [backup] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: /Back up everything/ }).click()]);
    const data = JSON.parse(fs.readFileSync(await backup.path(), 'utf8'));
    assert.equal(data.entries.length, seedState().entries.length);
  }

  assert.deepEqual(errors, []);
  await context.close();
  console.log(`✓ seeded flow (${colorScheme || 'light'}): pay periods, week detail, totals, filter, CSV, print, backup`);
}

async function setWheel(page, col, index) {
  await page.$eval(
    `#sheet-root .wheel-col[data-col="${col}"]`,
    (el, i) => {
      el.scrollTop = i * 44;
      el.dispatchEvent(new Event('scroll'));
    },
    index,
  );
}

async function setPickerTime(page, hour12, minute, pm) {
  await setWheel(page, 'hour', hour12 % 12); // wheel order is 12, 1, 2 … 11
  await setWheel(page, 'minute', minute);
  await setWheel(page, 'ampm', pm ? 1 : 0);
}

async function pickerFlow(browser) {
  const context = await browser.newContext(phone);
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  // You got to work at 8:00 but only remember to clock in at 8:30
  await page.clock.install({ time: at(2026, 11, 5, 8, 30) });
  await page.addInitScript(() => {
    if (!localStorage.getItem('hourtracker.v1')) {
      localStorage.setItem('hourtracker.v1', JSON.stringify({ version: 1, jobs: [{ id: 'church', name: 'Church', color: '#2f7cf6', createdAt: 1 }], entries: [], settings: {} }));
    }
  });
  await page.goto(url);
  await shot(page, '10-clock-buttons');

  const summary = page.locator('#sheet-root .picker-summary');
  const confirm = page.locator('#sheet-root .confirm');

  await page.getByRole('button', { name: 'Clock In At…' }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await page.waitForFunction(() => document.querySelector('#sheet-root .confirm')?.textContent);
  assert.equal(await confirm.textContent(), 'Clock In at 8:30 AM'); // starts on the current time
  await setPickerTime(page, 8, 0, false);
  assert.equal(await confirm.textContent(), 'Clock In at 8:00 AM');
  assert.equal(await summary.textContent(), 'Clocking in at 8:00 AM today · 30m ago');
  await shot(page, '11-clock-in-at');

  // 9:00 AM hasn't happened today, so it assumes yesterday; forcing "Today" is refused
  await setPickerTime(page, 9, 0, false);
  assert.match(await summary.textContent(), /9:00 AM yesterday/);
  await page.locator('#sheet-root [data-action="pick-day"]', { hasText: 'Today' }).click();
  assert.equal(await summary.textContent(), "That time hasn't happened yet.");
  assert.equal(await confirm.isDisabled(), true);
  await setPickerTime(page, 8, 0, false);
  assert.equal(await confirm.isDisabled(), false);
  await confirm.click();
  assert.match(await page.locator('#toast').textContent(), /Clocked in at 8:00 AM/);
  assert.match(await page.locator('.since').textContent(), /since 8:00 AM/);
  await page.clock.runFor(1500);
  assert.match(await page.locator('.timer').textContent(), /^0:30:0\d$/);

  // You left at 4:30 PM but only notice at home at 6:00 PM
  await page.clock.setSystemTime(at(2026, 11, 5, 18, 0));
  await page.getByRole('button', { name: 'Clock Out At…' }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await page.waitForFunction(() => document.querySelector('#sheet-root .confirm')?.textContent);
  assert.equal(await confirm.textContent(), 'Clock Out at 6:00 PM'); // opens on the current time, not the clock-in time
  await setPickerTime(page, 4, 30, true);
  assert.equal(await summary.textContent(), 'Shift: 8:00 AM – 4:30 PM today · 8.5h');
  await shot(page, '12-clock-out-at');
  // A time before the clock-in is refused
  await setPickerTime(page, 7, 0, false);
  assert.equal(await summary.textContent(), 'That\'s before you clocked in (8:00 AM).');
  await setPickerTime(page, 4, 30, true);
  await confirm.click();
  assert.match(await page.locator('#toast').textContent(), /Clocked out at 4:30 PM · 8.5h/);
  assert.match(await page.locator('.card.list').textContent(), /8:00 AM – 4:30 PM\s*8.5h/);

  // Clocking in during a shift you already logged is refused
  await page.getByRole('button', { name: 'Clock In At…' }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await setPickerTime(page, 4, 0, true);
  assert.equal(await summary.textContent(), 'That overlaps your last shift, which ended at 4:30 PM.');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  // Just after midnight: clock in at 11 PM means last night
  await page.clock.setSystemTime(at(2026, 11, 6, 0, 30));
  await page.reload();
  await page.getByRole('button', { name: 'Clock In At…' }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await setPickerTime(page, 11, 0, true);
  assert.equal(await summary.textContent(), 'Clocking in at 11:00 PM yesterday · 1h 30m ago');
  await confirm.click();
  assert.match(await page.locator('.since').textContent(), /since 11:00 PM on Thu Nov 5/);

  // Tapping a number on the wheel scrolls to it
  await page.getByRole('button', { name: 'Clock Out At…' }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await page.locator('#sheet-root .wheel-col[data-col="minute"] .wheel-item').nth(31).click();
  await page.waitForFunction(() => document.querySelector('#sheet-root .confirm').textContent.endsWith(':31 AM'));
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();

  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ clock in/out at a different time: wheel, auto day, validation, overlap, overnight');
}

async function breakFlow(browser) {
  const context = await browser.newContext({ ...phone, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  watchErrors(page, errors);
  await page.clock.install({ time: at(2026, 11, 5, 9, 0) });
  await page.addInitScript(() => {
    if (!localStorage.getItem('hourtracker.v1')) {
      localStorage.setItem('hourtracker.v1', JSON.stringify({ version: 1, jobs: [{ id: 'church', name: 'Church', color: '#2f7cf6', createdAt: 1 }], entries: [], settings: {} }));
    }
  });
  await page.goto(url);
  const summary = page.locator('#sheet-root .picker-summary');
  const confirm = page.locator('#sheet-root .confirm');

  // Clock in at 9:00, add a break at noon (defaults to 1 hour)
  await page.getByRole('button', { name: 'Clock In Now', exact: true }).click();
  await page.clock.setSystemTime(at(2026, 11, 5, 12, 0));
  await page.getByRole('button', { name: 'Add break', exact: true }).click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  await page.waitForFunction(() => document.querySelector('#sheet-root .confirm')?.textContent);
  assert.equal(await confirm.textContent(), 'Save 1h break');
  assert.equal(await summary.textContent(), 'Worked so far: 2h after the break');
  await shot(page, '13-add-break');
  // 5-minute steps: 45 min
  await setWheel(page, 'bh', 0);
  await setWheel(page, 'bm', 9);
  assert.equal(await confirm.textContent(), 'Save 45m break');
  await setWheel(page, 'bh', 1);
  await setWheel(page, 'bm', 0);
  await confirm.click();
  assert.match(await page.locator('#toast').textContent(), /1h break saved/);
  await page.clock.runFor(1500);
  assert.match(await page.locator('.timer').textContent(), /^2:00:0\d$/);
  assert.match(await page.locator('.since').textContent(), /1h break taken off/);
  assert.equal(await page.locator('.stats b').first().textContent(), '2h');
  assert.equal(await page.getByRole('button', { name: 'Break: 1h' }).count(), 1);
  await shot(page, '14-on-clock-with-break');

  // Clock out at 5:56 PM: 8h 56m minus 1h = 7.93h; no "Add break" since one is already logged
  await page.clock.setSystemTime(at(2026, 11, 5, 17, 56));
  await page.getByRole('button', { name: 'Clock Out Now', exact: true }).click();
  assert.match(await page.locator('#toast').textContent(), /Clocked out at 5:56 PM · 7.93h/);
  assert.equal(await page.locator('#toast [data-action="add-break"]').count(), 0);
  const row = page.locator('.card.list .row').first();
  assert.match(await row.textContent(), /1h break/);

  // Change it to 30 minutes from the shift's edit screen
  await row.click();
  await page.locator('select[name="breakMin"]').selectOption('30');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await row.textContent(), /30m break[\s\S]*8.43h/);

  // Evening shift with no break: the clock-out message offers "Add break"
  await page.clock.setSystemTime(at(2026, 11, 5, 18, 30));
  await page.getByRole('button', { name: 'Clock In Now', exact: true }).click();
  await page.clock.setSystemTime(at(2026, 11, 5, 20, 30));
  await page.getByRole('button', { name: 'Clock Out Now', exact: true }).click();
  await shot(page, '15-clock-out-add-break');
  await page.locator('#toast [data-action="add-break"]').click();
  await page.locator('#sheet-root.open .wheel').waitFor();
  // A break as long as the shift is refused
  await setWheel(page, 'bh', 2);
  await setWheel(page, 'bm', 0);
  assert.equal(await summary.textContent(), "That's as long as the whole shift.");
  assert.equal(await confirm.isDisabled(), true);
  await setWheel(page, 'bh', 0);
  await setWheel(page, 'bm', 3);
  assert.equal(await summary.textContent(), 'Worked: 1.75h after the break');
  await confirm.click();
  assert.match(await page.locator('.card.list .row').nth(1).textContent(), /15m break[\s\S]*1.75h/);

  // Remove a break
  await page.locator('.card.list .row').nth(1).click();
  await page.locator('select[name="breakMin"]').selectOption('0');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  assert.match(await page.locator('.card.list .row').nth(1).textContent(), /2h/);

  // Export shows the break column and rounds after the break
  await page.locator('.tabbar [data-tab="weeks"]').click();
  await page.locator('[data-action="open-week"]').first().click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Spreadsheet (CSV)' }).click()]);
  const csv = fs.readFileSync(await download.path(), 'utf8');
  assert.match(csv, /Date,Day,Job,Clock In,Clock Out,Break,Hours,Note/);
  assert.match(csv, /2026-11-05,Thu,Church,9:00 AM,5:56 PM,30m,8.5,/); // 8h 26m -> 8.5
  assert.match(csv, /2026-11-05,Thu,Church,6:30 PM,8:30 PM,,2,/);
  assert.match(csv, /Day total \(Thu Nov 5\),10.5,/);

  // Email timesheet: first time asks for addresses, then drafts the email
  await page.evaluate(() => {
    const click = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      if (this.href.startsWith('mailto:')) window.__mailto = this.href;
      else click.call(this);
    };
  });
  await page.getByRole('button', { name: 'Email timesheet' }).click();
  await page.locator('#sheet-root.open input[name="to"]').fill('me@example');
  await shot(page, '16-email-setup');
  await page.getByRole('button', { name: 'Save & draft email' }).click();
  assert.equal(await page.locator('.form-error').textContent(), 'Check this address: me@example');
  await page.locator('#sheet-root input[name="to"]').fill('me@example.com, office@example.com');
  await page.getByRole('button', { name: 'Save & draft email' }).click();
  const mailto = await page.waitForFunction(() => window.__mailto).then((h) => h.jsonValue());
  const [addr, query] = mailto.slice('mailto:'.length).split('?');
  assert.equal(addr, 'me@example.com,office@example.com');
  const params = new URLSearchParams(query);
  assert.equal(params.get('subject'), 'Church hours — week of Nov 2 – Nov 8, 2026');
  const body = params.get('body');
  assert.match(body, /^Church — Nov 2 – Nov 8, 2026/);
  assert.match(body, /9:00 AM – 5:56 PM {3}8.5h \(30m break\)/);
  assert.match(body, /Week total: 10.5h$/); // no rounding note in the email
  assert.doesNotMatch(body, /rounded/);
  // After setup it's one tap, and the addresses show under the button
  assert.match(await page.locator('.email-to').textContent(), /To: me@example.com, office@example.com/);
  await page.locator('.export').scrollIntoViewIfNeeded();
  await shot(page, '17-email-button');
  await page.evaluate(() => (window.__mailto = null));
  await page.getByRole('button', { name: 'Email timesheet' }).click();
  assert.ok(await page.waitForFunction(() => window.__mailto?.startsWith('mailto:me@example.com,office@example.com?')));
  await page.locator('.tabbar [data-tab="settings"]').click();
  assert.match(await page.locator('[data-action="edit-email"]').textContent(), /me@example.com, office@example.com/);

  assert.deepEqual(errors, []);
  await context.close();
  console.log('✓ breaks: add during shift, after clock-out, edit, remove, validation, export; email timesheet');
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  let failed = false;
  try {
    await waitForServer();
    const browser = await chromium.launch();
    await freshFlow(browser);
    await pickerFlow(browser);
    await breakFlow(browser);
    await seededFlow(browser, 'light');
    await seededFlow(browser, 'dark');
    await browser.close();
    console.log(`Screenshots: ${SHOTS}`);
  } catch (err) {
    failed = true;
    console.error(err);
  } finally {
    server.kill();
  }
  process.exit(failed ? 1 : 0);
})();
