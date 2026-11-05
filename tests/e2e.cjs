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
  await page.getByRole('button', { name: 'Clock In', exact: true }).waitFor();
  assert.equal(await page.locator('.pill').textContent(), 'Off the clock');

  // Clock in: uses the current time automatically
  await page.getByRole('button', { name: 'Clock In', exact: true }).click();
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
  await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
  assert.match(await page.locator('#toast').textContent(), /Clocked out at 4:21 PM · 7.23h/);
  assert.equal(await page.locator('.pill').textContent(), 'Off the clock');
  assert.match(await page.locator('.card.list').textContent(), /9:07 AM – 4:21 PM/);

  // Undo the clock-out, then clock out again
  await page.getByRole('button', { name: 'Undo' }).click();
  assert.equal(await page.locator('.pill').textContent(), 'On the clock');
  await page.getByRole('button', { name: 'Clock Out', exact: true }).click();
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
  await page.getByRole('button', { name: 'Clock In', exact: true }).first().waitFor();
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
    assert.match(csv, /2026-11-03,Tue,Church,6:01 PM,8:35 PM,2.57,Youth night/);
    assert.match(csv, /,,,,Day total \(Tue Nov 3\),9.82,/);
    assert.match(csv, /Week total \(Nov 2 – Nov 8, 2026\)",22.7,/);

    // Print view renders the report
    await page.evaluate(() => {
      window.print = () => {};
    });
    await page.getByRole('button', { name: 'Print / PDF' }).click();
    assert.match(await page.locator('#print-root').textContent(), /Week total: 22.7h/);
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

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1', '--directory', ROOT], { stdio: 'ignore' });
  let failed = false;
  try {
    await waitForServer();
    const browser = await chromium.launch();
    await freshFlow(browser);
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
