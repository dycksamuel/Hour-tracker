import {
  addDays,
  dayKey,
  entryDuration,
  formatDay,
  formatElapsed,
  formatHours,
  formatTime,
  formatWeekRange,
  fromDateTimeLocal,
  groupByWeek,
  startOfDay,
  startOfWeek,
  toDateTimeLocal,
  totalBetween,
  weeksToCSV,
  weekToText,
} from './logic.js';
import { JOB_COLORS, load, normalize, save, uid } from './store.js';

const APP_VERSION = '1.0.0';
const LONG_SHIFT_MS = 12 * 3600000;

let state = load();
const ui = { tab: 'clock', weekFilter: 'all', openWeek: null };
let renderedDay = dayKey(Date.now());
let sheetOpen = false;
let toastTimer = null;
let undoAction = null;

// ---------- helpers ----------

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const now = () => Date.now();
const fh = (ms) => formatHours(ms, state.settings.hoursFormat);
const jobsById = () => Object.fromEntries(state.jobs.map((j) => [j.id, j]));
const jobById = (id) => state.jobs.find((j) => j.id === id);
const entriesFor = (jobId) => (jobId === 'all' ? state.entries : state.entries.filter((e) => e.jobId === jobId));
const activeEntry = (jobId) => state.entries.find((e) => e.jobId === jobId && e.end == null);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;
const multiJob = () => state.jobs.length > 1;

function commit(mutate) {
  mutate(state);
  try {
    save(state);
  } catch (err) {
    alert(`Could not save your data: ${err.message}`);
  }
  updateBadge();
  render();
}

function weekTitle(weekStart) {
  const thisWeek = startOfWeek(now());
  if (weekStart === thisWeek) return 'This week';
  if (weekStart === startOfWeek(addDays(thisWeek, -1))) return 'Last week';
  return '';
}

function dotFor(jobId) {
  const job = jobById(jobId);
  return job ? `<span class="dot" style="--job:${esc(job.color)}"></span>` : '';
}

// Live totals: elements carry what they measure and tick() refreshes them in place,
// so the page never re-renders under your finger while a shift is running.
const liveTotal = (jobId, from, to) => `data-total="${esc(jobId)}|${from}|${to}"`;

// ---------- clock ----------

function clockIn(jobId) {
  if (activeEntry(jobId)) return;
  const entry = { id: uid(), jobId, start: now(), end: null, note: '' };
  commit((s) => s.entries.push(entry));
  const job = jobById(jobId);
  showToast(`Clocked in${multiJob() ? ` to ${job.name}` : ''} at ${formatTime(entry.start)}`, () =>
    commit((s) => {
      s.entries = s.entries.filter((e) => e.id !== entry.id);
    }),
  );
}

function clockOut(jobId) {
  const active = activeEntry(jobId);
  if (!active) return;
  const id = active.id;
  const t = now();
  commit((s) => {
    s.entries.find((e) => e.id === id).end = t;
  });
  const done = state.entries.find((e) => e.id === id);
  showToast(`Clocked out at ${formatTime(t)} · ${fh(entryDuration(done, t))}`, () =>
    commit((s) => {
      const e = s.entries.find((x) => x.id === id);
      if (e) e.end = null;
    }),
  );
}

// ---------- views ----------

function pageHead(title, sub = '', extra = '') {
  return `<header class="page-head"><div><h1>${esc(title)}</h1>${sub ? `<p>${esc(sub)}</p>` : ''}</div>${extra}</header>`;
}

function renderClock() {
  const t = now();
  const todayLabel = new Date(t).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });

  if (!state.jobs.length) {
    return `${pageHead('Clock', todayLabel)}
      <section class="card welcome">
        <h2>Let's get you set up</h2>
        <p>What job do you want to track? You can add a second one later in Settings.</p>
        <form data-form="first-job" class="stack">
          <input name="name" placeholder="Job name, e.g. Church" required maxlength="40" autocomplete="off" enterkeyhint="done">
          <button class="btn primary" type="submit">Add job</button>
        </form>
      </section>`;
  }

  const ds = startOfDay(t);
  const de = addDays(ds, 1);
  const ws = startOfWeek(t);
  const we = addDays(ws, 7);

  const cards = state.jobs
    .map((job) => {
      const a = activeEntry(job.id);
      const list = entriesFor(job.id);
      const otherDay = a && startOfDay(a.start) !== ds;
      const long = a && t - a.start > LONG_SHIFT_MS;
      return `<section class="card job ${a ? 'is-on' : ''}" style="--job:${esc(job.color)}">
        <div class="job-top">
          <h2 class="job-name"><span class="dot"></span>${esc(job.name)}</h2>
          <span class="pill">${a ? 'On the clock' : 'Off the clock'}</span>
        </div>
        ${
          a
            ? `<div class="timer" data-elapsed="${a.start}">${formatElapsed(t - a.start)}</div>
               <div class="since">since ${formatTime(a.start)}${otherDay ? ` on ${formatDay(a.start)}` : ''}</div>`
            : `<div class="timer idle">0:00:00</div><div class="since">Tap Clock In when you start</div>`
        }
        ${
          long
            ? `<div class="warn" role="alert">You've been clocked in for more than 12 hours. Forgot to clock out?
                 <button class="link-btn" data-action="edit-entry" data-id="${a.id}">Fix the time</button></div>`
            : ''
        }
        <button class="btn big ${a ? 'out' : 'in'}" data-action="${a ? 'clock-out' : 'clock-in'}" data-job="${esc(job.id)}">
          ${a ? 'Clock Out' : 'Clock In'}
        </button>
        ${
          a
            ? `<button class="link-btn center" data-action="edit-entry" data-id="${a.id}">Adjust clock-in or clock-out time</button>`
            : ''
        }
        <div class="stats">
          <div><span>Today</span><b ${liveTotal(job.id, ds, de)}>${fh(totalBetween(list, ds, de, t))}</b></div>
          <div><span>This week</span><b ${liveTotal(job.id, ws, we)}>${fh(totalBetween(list, ws, we, t))}</b></div>
        </div>
      </section>`;
    })
    .join('');

  const today = state.entries.filter((e) => e.start >= ds && e.start < de).sort((a, b) => a.start - b.start);
  const todayCard = today.length
    ? `<section class="card list">
        <h3 class="list-title">Today's shifts</h3>
        ${today.map(entryRow).join('')}
      </section>`
    : '';

  return `${pageHead('Clock', todayLabel)}${cards}${todayCard}`;
}

function entryRow(e) {
  const t = now();
  const end = e.end == null ? '<span class="now-tag">now</span>' : esc(formatTime(e.end));
  const crossesMidnight = e.end != null && startOfDay(e.end) !== startOfDay(e.start);
  return `<button class="row" data-action="edit-entry" data-id="${e.id}">
    <span class="row-main">
      <span class="row-title">${multiJob() ? dotFor(e.jobId) : ''}${esc(formatTime(e.start))} – ${end}${crossesMidnight ? ' <small>(next day)</small>' : ''}</span>
      ${e.note ? `<span class="row-sub">${esc(e.note)}</span>` : ''}
    </span>
    <span class="row-value" ${e.end == null ? `data-dur="${e.id}"` : ''}>${fh(entryDuration(e, t))}</span>
    <span class="chev" aria-hidden="true"></span>
  </button>`;
}

function filterBar() {
  if (!multiJob()) return '';
  const opts = [{ id: 'all', name: 'All jobs' }, ...state.jobs];
  return `<div class="segmented" role="tablist">
    ${opts
      .map(
        (o) =>
          `<button role="tab" aria-selected="${ui.weekFilter === o.id}" data-action="filter" data-job="${esc(o.id)}">${esc(o.name)}</button>`,
      )
      .join('')}
  </div>`;
}

function weeksFor(t) {
  const weeks = groupByWeek(entriesFor(ui.weekFilter), t);
  const current = startOfWeek(t);
  if (!weeks.some((w) => w.weekStart === current)) {
    weeks.unshift({ weekStart: current, total: 0, byJob: {}, days: [] });
  }
  return weeks.sort((a, b) => b.weekStart - a.weekStart);
}

function renderWeeks() {
  const t = now();
  const weeks = weeksFor(t);
  const allTime = totalBetween(entriesFor(ui.weekFilter), -Infinity, Infinity, t);
  const filterName = ui.weekFilter === 'all' ? '' : jobById(ui.weekFilter)?.name;

  const rows = weeks
    .map((w) => {
      const label = weekTitle(w.weekStart);
      const shifts = w.days.reduce((n, d) => n + d.entries.length, 0);
      const sub = [label, shifts ? `${shifts} shift${shifts === 1 ? '' : 's'} · ${w.days.length} day${w.days.length === 1 ? '' : 's'}` : 'No shifts yet']
        .filter(Boolean)
        .join(' · ');
      return `<button class="row" data-action="open-week" data-week="${w.weekStart}">
        <span class="row-main">
          <span class="row-title">${esc(formatWeekRange(w.weekStart))}</span>
          <span class="row-sub">${esc(sub)}</span>
        </span>
        <span class="row-value strong" ${liveTotal(ui.weekFilter, w.weekStart, addDays(w.weekStart, 7))}>${fh(w.total)}</span>
        <span class="chev" aria-hidden="true"></span>
      </button>`;
    })
    .join('');

  return `${pageHead('Pay Periods', 'Weeks run Monday to Sunday', `<button class="btn small tinted" data-action="add-entry">+ Add shift</button>`)}
    ${filterBar()}
    <section class="card total-card">
      <span>All time${filterName ? ` · ${esc(filterName)}` : ''}</span>
      <b ${liveTotal(ui.weekFilter, -1e15, 1e15)}>${fh(allTime)}</b>
    </section>
    <section class="card list">${rows}</section>`;
}

function currentWeekData(t) {
  return (
    groupByWeek(entriesFor(ui.weekFilter), t).find((w) => w.weekStart === ui.openWeek) || {
      weekStart: ui.openWeek,
      total: 0,
      byJob: {},
      days: [],
    }
  );
}

function renderWeekDetail() {
  const t = now();
  const week = currentWeekData(t);
  const ws = week.weekStart;
  const showJob = multiJob() && ui.weekFilter === 'all';
  const shifts = week.days.reduce((n, d) => n + d.entries.length, 0);
  const label = weekTitle(ws);
  const canGoNext = ws < startOfWeek(t);

  const breakdown =
    showJob && Object.keys(week.byJob).length
      ? `<div class="breakdown">${state.jobs
          .filter((j) => week.byJob[j.id])
          .map((j) => `<div>${dotFor(j.id)}<span>${esc(j.name)}</span><b ${liveTotal(j.id, ws, addDays(ws, 7))}>${fh(week.byJob[j.id])}</b></div>`)
          .join('')}</div>`
      : '';

  const days = week.days.length
    ? week.days
        .map(
          (d) => `<section class="card list day">
            <div class="day-head">
              <h3>${esc(formatDay(d.dayStart))}</h3>
              <b ${liveTotal(ui.weekFilter, d.dayStart, addDays(d.dayStart, 1))}>${fh(d.total)}</b>
            </div>
            ${d.entries.map(entryRow).join('')}
          </section>`,
        )
        .join('')
    : `<section class="card empty"><p>No shifts this week.</p></section>`;

  return `<div class="subnav">
      <button class="back" data-action="close-week"><span class="chev left" aria-hidden="true"></span>Pay Periods</button>
      <div class="week-step">
        <button class="icon-btn" data-action="step-week" data-dir="-1" aria-label="Previous week"><span class="chev left" aria-hidden="true"></span></button>
        <button class="icon-btn" data-action="step-week" data-dir="1" aria-label="Next week" ${canGoNext ? '' : 'disabled'}><span class="chev" aria-hidden="true"></span></button>
      </div>
    </div>
    ${pageHead(formatWeekRange(ws), [label, ui.weekFilter !== 'all' ? jobById(ui.weekFilter)?.name : ''].filter(Boolean).join(' · '))}
    ${filterBar()}
    <section class="card summary">
      <div class="summary-main">
        <span>Week total</span>
        <b ${liveTotal(ui.weekFilter, ws, addDays(ws, 7))}>${fh(week.total)}</b>
        <small>${shifts} shift${shifts === 1 ? '' : 's'} on ${week.days.length} day${week.days.length === 1 ? '' : 's'}</small>
      </div>
      ${breakdown}
    </section>
    ${days}
    <section class="card export">
      <h3 class="list-title">Export this week</h3>
      <div class="export-grid">
        <button class="btn tinted" data-action="share-text">Share as text</button>
        <button class="btn tinted" data-action="share-csv">Spreadsheet (CSV)</button>
        <button class="btn tinted" data-action="print-week">Print / PDF</button>
      </div>
    </section>
    <button class="btn tinted block" data-action="add-entry" data-week="${ws}">+ Add a shift to this week</button>`;
}

function renderSettings() {
  const jobs = state.jobs
    .map(
      (j) => `<button class="row" data-action="edit-job" data-id="${esc(j.id)}">
        <span class="row-main"><span class="row-title">${dotFor(j.id)}${esc(j.name)}</span></span>
        <span class="row-value muted">${activeEntry(j.id) ? 'On the clock' : ''}</span>
        <span class="chev" aria-hidden="true"></span>
      </button>`,
    )
    .join('');

  const badgeSupported = 'setAppBadge' in navigator;
  const install = isStandalone()
    ? ''
    : `<section class="card note">
        <h3>Put it on your Home Screen</h3>
        <ol>
          <li>Open this page in <b>Safari</b>.</li>
          <li>Tap the <b>Share</b> button, then <b>Add to Home Screen</b>.</li>
          <li>Open <b>Hours</b> from your Home Screen from now on. Your hours are saved inside that app.</li>
        </ol>
      </section>`;

  return `${pageHead('Settings')}
    ${install}
    <h3 class="section-label">Jobs</h3>
    <section class="card list">
      ${jobs}
      <button class="row add" data-action="add-job"><span class="row-main"><span class="row-title">+ Add job</span></span></button>
    </section>

    <h3 class="section-label">Show hours as</h3>
    <div class="segmented">
      <button aria-selected="${state.settings.hoursFormat === 'decimal'}" data-action="hours-format" data-value="decimal">Decimal (7.25h)</button>
      <button aria-selected="${state.settings.hoursFormat === 'hm'}" data-action="hours-format" data-value="hm">Hours &amp; min (7h 15m)</button>
    </div>

    <h3 class="section-label">App icon</h3>
    <section class="card list">
      <label class="row toggle">
        <span class="row-main">
          <span class="row-title">Badge while clocked in</span>
          <span class="row-sub">${
            badgeSupported
              ? 'Shows a red 1 on the Hours icon so you can see you forgot to clock out. iPhone asks to allow notifications first; the app never sends any.'
              : 'Available once Hours is added to your Home Screen.'
          }</span>
        </span>
        <input type="checkbox" class="switch" data-action="badge-toggle" ${state.settings.badge ? 'checked' : ''} ${badgeSupported ? '' : 'disabled'}>
      </label>
    </section>

    <h3 class="section-label">Your data</h3>
    <section class="card list">
      <button class="row" data-action="export-all-csv"><span class="row-main"><span class="row-title">Export all shifts (CSV)</span></span><span class="chev" aria-hidden="true"></span></button>
      <button class="row" data-action="backup"><span class="row-main"><span class="row-title">Back up everything</span><span class="row-sub">Save the file to iCloud Drive or email it to yourself.</span></span><span class="chev" aria-hidden="true"></span></button>
      <label class="row" for="restore-file"><span class="row-main"><span class="row-title">Restore from a backup</span></span><span class="chev" aria-hidden="true"></span></label>
      <input id="restore-file" class="visually-hidden" type="file" accept="application/json,.json" data-action="restore">
    </section>
    <p class="footnote">Your hours are stored only on this iPhone. Back up now and then in case you lose or replace your phone.<br>Hours ${APP_VERSION}</p>`;
}

function render() {
  renderedDay = dayKey(now());
  if (ui.weekFilter !== 'all' && !jobById(ui.weekFilter)) ui.weekFilter = 'all';
  document.querySelectorAll('.tabbar [data-tab]').forEach((b) => {
    const on = b.dataset.tab === ui.tab;
    b.classList.toggle('active', on);
    if (on) b.setAttribute('aria-current', 'page');
    else b.removeAttribute('aria-current');
  });
  let html;
  if (ui.tab === 'clock') html = renderClock();
  else if (ui.tab === 'weeks') html = ui.openWeek != null ? renderWeekDetail() : renderWeeks();
  else html = renderSettings();
  $('#view').innerHTML = html;
}

function tick() {
  const t = now();
  if (dayKey(t) !== renderedDay) {
    if (!sheetOpen) render();
    return;
  }
  if (!state.entries.some((e) => e.end == null)) return;
  document.querySelectorAll('[data-elapsed]').forEach((el) => {
    el.textContent = formatElapsed(t - Number(el.dataset.elapsed));
  });
  document.querySelectorAll('[data-total]').forEach((el) => {
    const [jobId, from, to] = el.dataset.total.split('|');
    el.textContent = fh(totalBetween(entriesFor(jobId), Number(from), Number(to), t));
  });
  document.querySelectorAll('[data-dur]').forEach((el) => {
    const e = state.entries.find((x) => x.id === el.dataset.dur);
    if (e) el.textContent = fh(entryDuration(e, t));
  });
}

// ---------- sheets ----------

function openSheet(html) {
  hideToast();
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-action="close-sheet"></div>
    <div class="sheet" role="dialog" aria-modal="true"><div class="grabber"></div>${html}</div>`;
  sheetOpen = true;
  requestAnimationFrame(() => root.classList.add('open'));
}

function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  sheetOpen = false;
  setTimeout(() => {
    if (!sheetOpen) root.innerHTML = '';
  }, 250);
}

function sheetError(msg) {
  const el = $('#sheet-root .form-error');
  el.textContent = msg;
  el.hidden = false;
}

function openEntrySheet(entryId, weekStart) {
  const e = entryId ? state.entries.find((x) => x.id === entryId) : null;
  const active = e && e.end == null;
  let start;
  let end;
  if (e) {
    start = e.start;
    end = e.end ?? now();
  } else {
    // New shift: default to 9–5 today, or Monday of the chosen week if it's a past week.
    const base = weekStart != null && weekStart !== startOfWeek(now()) ? weekStart : startOfDay(now());
    start = base + 9 * 3600000;
    end = base + 17 * 3600000;
  }
  const defaultJob = e?.jobId ?? (ui.weekFilter !== 'all' ? ui.weekFilter : state.jobs[0]?.id);
  const jobField = multiJob()
    ? `<label>Job<select name="jobId">${state.jobs
        .map((j) => `<option value="${esc(j.id)}" ${j.id === defaultJob ? 'selected' : ''}>${esc(j.name)}</option>`)
        .join('')}</select></label>`
    : `<input type="hidden" name="jobId" value="${esc(defaultJob)}">`;

  openSheet(`<form data-form="entry" data-id="${e ? e.id : ''}" class="stack">
      <h2>${e ? (active ? 'Current shift' : 'Edit shift') : 'Add shift'}</h2>
      ${jobField}
      <label>Clock in<input type="datetime-local" name="start" value="${toDateTimeLocal(start)}" required></label>
      ${active ? `<label class="check"><input type="checkbox" name="active" checked> Still clocked in</label>` : ''}
      <label class="end-field" ${active ? 'hidden' : ''}>Clock out<input type="datetime-local" name="end" value="${toDateTimeLocal(end)}"></label>
      <label>Note<input name="note" maxlength="200" placeholder="Optional" value="${esc(e?.note || '')}" autocomplete="off"></label>
      <p class="form-error" hidden></p>
      <div class="sheet-actions">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
      ${e ? `<button type="button" class="link-btn danger center" data-action="delete-entry" data-id="${e.id}">Delete this shift</button>` : ''}
    </form>`);
}

/** Keep the original seconds when the user didn't change that minute. */
function keepSeconds(original, edited) {
  if (original == null || edited == null) return edited;
  return Math.floor(original / 60000) === Math.floor(edited / 60000) ? original : edited;
}

function saveEntry(form) {
  const fd = new FormData(form);
  const id = form.dataset.id;
  const existing = id ? state.entries.find((x) => x.id === id) : null;
  const jobId = fd.get('jobId');
  const stillActive = fd.get('active') === 'on';
  const start = keepSeconds(existing?.start, fromDateTimeLocal(fd.get('start')));
  const end = stillActive ? null : keepSeconds(existing?.end, fromDateTimeLocal(fd.get('end')));
  const note = String(fd.get('note') || '').trim();
  const t = now();

  if (!jobById(jobId)) return sheetError('Pick a job.');
  if (start == null) return sheetError('Enter a clock-in time.');
  if (stillActive) {
    if (start > t) return sheetError("Clock-in time can't be in the future while you're still clocked in.");
    if (state.entries.some((x) => x.jobId === jobId && x.end == null && x.id !== id)) {
      return sheetError('You are already clocked in to that job.');
    }
  } else {
    if (end == null) return sheetError('Enter a clock-out time.');
    if (end <= start) return sheetError('Clock-out has to be after clock-in.');
    if (end - start > 24 * 3600000 && !confirm(`That shift is ${fh(end - start)} long. Save it anyway?`)) return;
  }

  closeSheet();
  commit((s) => {
    if (existing) {
      const e = s.entries.find((x) => x.id === id);
      Object.assign(e, { jobId, start, end, note });
    } else {
      s.entries.push({ id: uid(), jobId, start, end, note });
    }
  });
  showToast(existing ? 'Shift updated' : 'Shift added');
}

function openJobSheet(jobId) {
  const job = jobId ? jobById(jobId) : null;
  const used = new Set(state.jobs.map((j) => j.color));
  const color = job?.color ?? (JOB_COLORS.find((c) => !used.has(c)) || JOB_COLORS[0]);
  openSheet(`<form data-form="job" data-id="${job ? esc(job.id) : ''}" class="stack">
      <h2>${job ? 'Edit job' : 'New job'}</h2>
      <label>Name<input name="name" required maxlength="40" value="${esc(job?.name || '')}" autocomplete="off" placeholder="e.g. Church"></label>
      <fieldset class="colors"><legend>Color</legend>
        ${JOB_COLORS.map(
          (c) => `<label class="swatch" style="--job:${c}"><input type="radio" name="color" value="${c}" ${c === color ? 'checked' : ''}><span></span></label>`,
        ).join('')}
      </fieldset>
      <p class="form-error" hidden></p>
      <div class="sheet-actions">
        <button type="button" class="btn" data-action="close-sheet">Cancel</button>
        <button type="submit" class="btn primary">Save</button>
      </div>
      ${job ? `<button type="button" class="link-btn danger center" data-action="delete-job" data-id="${esc(job.id)}">Delete job</button>` : ''}
    </form>`);
}

function saveJob(form) {
  const fd = new FormData(form);
  const name = String(fd.get('name') || '').trim();
  const color = String(fd.get('color') || JOB_COLORS[0]);
  if (!name) return sheetError('Give the job a name.');
  const id = form.dataset.id;
  closeSheet();
  commit((s) => {
    if (id) Object.assign(s.jobs.find((j) => j.id === id), { name, color });
    else s.jobs.push({ id: uid(), name, color, createdAt: now() });
  });
}

// ---------- export ----------

function shareFile(name, type, content) {
  const file = new File([content], name, { type });
  if (navigator.canShare?.({ files: [file] })) {
    navigator.share({ files: [file], title: name }).catch((err) => {
      if (err.name !== 'AbortError') downloadFile(file);
    });
    return;
  }
  downloadFile(file);
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function exportTitle() {
  if (ui.weekFilter !== 'all') return jobById(ui.weekFilter)?.name || '';
  return state.jobs.length === 1 ? state.jobs[0].name : '';
}

function fileStem(weekStart) {
  const job = exportTitle();
  const slug = job ? `${job.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-` : '';
  return `hours-${slug}week-of-${dayKey(weekStart)}`;
}

function shareWeekText() {
  const t = now();
  const week = currentWeekData(t);
  const text = weekToText(week, jobsById(), {
    now: t,
    mode: state.settings.hoursFormat,
    showJob: multiJob() && ui.weekFilter === 'all',
    title: exportTitle(),
  });
  if (navigator.share) {
    navigator.share({ text }).catch((err) => {
      if (err.name !== 'AbortError') copyText(text);
    });
  } else {
    copyText(text);
  }
}

function copyText(text) {
  navigator.clipboard?.writeText(text).then(
    () => showToast('Copied to clipboard'),
    () => alert(text),
  );
}

function shareWeekCSV() {
  const t = now();
  const week = currentWeekData(t);
  shareFile(`${fileStem(week.weekStart)}.csv`, 'text/csv', weeksToCSV([week], jobsById(), t));
}

function printWeek() {
  const t = now();
  const week = currentWeekData(t);
  const showJob = multiJob() && ui.weekFilter === 'all';
  const title = exportTitle();
  const rows = week.days
    .map((d) => {
      const shiftRows = d.entries
        .map(
          (e, i) => `<tr>
            <td>${i === 0 ? esc(formatDay(d.dayStart)) : ''}</td>
            ${showJob ? `<td>${esc(jobById(e.jobId)?.name || '')}</td>` : ''}
            <td>${esc(formatTime(e.start))}</td>
            <td>${e.end == null ? 'still clocked in' : esc(formatTime(e.end))}</td>
            <td class="num">${fh(entryDuration(e, t))}</td>
            <td>${esc(e.note || '')}</td>
          </tr>`,
        )
        .join('');
      return `${shiftRows}<tr class="day-total"><td colspan="${showJob ? 4 : 3}"></td><td class="num">${fh(d.total)}</td><td>Day total</td></tr>`;
    })
    .join('');
  const byJob =
    showJob && Object.keys(week.byJob).length > 1
      ? state.jobs.filter((j) => week.byJob[j.id]).map((j) => `<p>${esc(j.name)}: <b>${fh(week.byJob[j.id])}</b></p>`).join('')
      : '';
  $('#print-root').innerHTML = `<div class="report">
    <h1>${title ? `${esc(title)} — ` : ''}Hours</h1>
    <h2>Week of ${esc(formatWeekRange(week.weekStart))}</h2>
    <table>
      <thead><tr><th>Day</th>${showJob ? '<th>Job</th>' : ''}<th>Clock in</th><th>Clock out</th><th class="num">Hours</th><th>Note</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${showJob ? 6 : 5}">No shifts this week.</td></tr>`}</tbody>
    </table>
    ${byJob}
    <p class="week-total">Week total: <b>${fh(week.total)}</b></p>
  </div>`;
  window.print();
}

function exportAllCSV() {
  const t = now();
  const weeks = groupByWeek(state.entries, t);
  if (!weeks.length) return showToast('No shifts to export yet');
  shareFile(`hours-all-${dayKey(t)}.csv`, 'text/csv', weeksToCSV(weeks, jobsById(), t));
}

function backup() {
  const t = now();
  const data = JSON.stringify({ ...state, exportedAt: new Date(t).toISOString(), app: 'Hours' }, null, 2);
  shareFile(`hours-backup-${dayKey(t)}.json`, 'application/json', data);
}

async function restore(input) {
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    const restored = normalize(JSON.parse(await file.text()));
    const msg = `Replace everything on this phone with this backup?\n\n${restored.jobs.length} job(s), ${restored.entries.length} shift(s).\n\nYour current data will be overwritten.`;
    if (!confirm(msg)) return;
    commit((s) => {
      s.jobs = restored.jobs;
      s.entries = restored.entries;
      s.settings = restored.settings;
    });
    showToast('Backup restored');
  } catch (err) {
    alert(`Couldn't restore that file. ${err.message}`);
  }
}

// ---------- badge ----------

function updateBadge() {
  if (!('setAppBadge' in navigator)) return;
  const n = state.entries.filter((e) => e.end == null).length;
  const p = state.settings.badge && n ? navigator.setAppBadge(n) : navigator.clearAppBadge();
  p?.catch?.(() => {});
}

async function toggleBadge(input) {
  const want = input.checked;
  if (want && 'Notification' in window && Notification.permission !== 'granted') {
    const result = await Notification.requestPermission();
    if (result !== 'granted') {
      input.checked = false;
      alert('The badge needs notification permission. You can turn it on in iPhone Settings › Notifications › Hours.');
      return;
    }
  }
  commit((s) => {
    s.settings.badge = want;
  });
}

// ---------- toast ----------

function showToast(msg, undo) {
  const el = $('#toast');
  clearTimeout(toastTimer);
  undoAction = undo || null;
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button data-action="undo">Undo</button>' : ''}`;
  el.classList.add('show');
  toastTimer = setTimeout(hideToast, undo ? 6000 : 2500);
}

function hideToast() {
  $('#toast').classList.remove('show');
  undoAction = null;
}

// ---------- events ----------

document.addEventListener('click', (ev) => {
  const tabBtn = ev.target.closest('[data-tab]');
  if (tabBtn) {
    const tab = tabBtn.dataset.tab;
    if (tab === 'weeks' && ui.tab === 'weeks') ui.openWeek = null;
    ui.tab = tab;
    render();
    window.scrollTo(0, 0);
    return;
  }
  const el = ev.target.closest('[data-action]');
  if (!el || el.tagName === 'INPUT') return;
  const { action } = el.dataset;
  switch (action) {
    case 'clock-in':
      return clockIn(el.dataset.job);
    case 'clock-out':
      return clockOut(el.dataset.job);
    case 'edit-entry':
      return openEntrySheet(el.dataset.id);
    case 'add-entry':
      return openEntrySheet(null, el.dataset.week ? Number(el.dataset.week) : null);
    case 'delete-entry':
      if (confirm('Delete this shift?')) {
        const id = el.dataset.id;
        const removed = state.entries.find((e) => e.id === id);
        closeSheet();
        commit((s) => {
          s.entries = s.entries.filter((e) => e.id !== id);
        });
        showToast('Shift deleted', () => commit((s) => s.entries.push(removed)));
      }
      return;
    case 'open-week':
      ui.openWeek = Number(el.dataset.week);
      render();
      window.scrollTo(0, 0);
      return;
    case 'close-week':
      ui.openWeek = null;
      render();
      return;
    case 'step-week': {
      const next = addDays(ui.openWeek, 7 * Number(el.dataset.dir));
      if (next > startOfWeek(now())) return;
      ui.openWeek = next;
      render();
      return;
    }
    case 'filter':
      ui.weekFilter = el.dataset.job;
      render();
      return;
    case 'share-text':
      return shareWeekText();
    case 'share-csv':
      return shareWeekCSV();
    case 'print-week':
      return printWeek();
    case 'add-job':
      return openJobSheet(null);
    case 'edit-job':
      return openJobSheet(el.dataset.id);
    case 'delete-job': {
      const job = jobById(el.dataset.id);
      const count = state.entries.filter((e) => e.jobId === job.id).length;
      const msg = count
        ? `Delete "${job.name}" and its ${count} shift${count === 1 ? '' : 's'}? This can't be undone. Consider backing up first.`
        : `Delete "${job.name}"?`;
      if (!confirm(msg)) return;
      closeSheet();
      commit((s) => {
        s.jobs = s.jobs.filter((j) => j.id !== job.id);
        s.entries = s.entries.filter((e) => e.jobId !== job.id);
      });
      return;
    }
    case 'hours-format':
      return commit((s) => {
        s.settings.hoursFormat = el.dataset.value;
      });
    case 'export-all-csv':
      return exportAllCSV();
    case 'backup':
      return backup();
    case 'close-sheet':
      return closeSheet();
    case 'undo': {
      const fn = undoAction;
      hideToast();
      fn?.();
      return;
    }
  }
});

document.addEventListener('change', (ev) => {
  const el = ev.target;
  if (el.dataset.action === 'restore') return restore(el);
  if (el.dataset.action === 'badge-toggle') return toggleBadge(el);
  if (el.name === 'active' && el.form?.dataset.form === 'entry') {
    el.form.querySelector('.end-field').hidden = el.checked;
  }
});

document.addEventListener('submit', (ev) => {
  const form = ev.target;
  ev.preventDefault();
  switch (form.dataset.form) {
    case 'first-job': {
      const name = String(new FormData(form).get('name') || '').trim();
      if (!name) return;
      return commit((s) => s.jobs.push({ id: uid(), name, color: JOB_COLORS[0], createdAt: now() }));
    }
    case 'entry':
      return saveEntry(form);
    case 'job':
      return saveJob(form);
  }
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && sheetOpen) closeSheet();
});

// Coming back to the app (e.g. unlocking the phone): pick up any changes from another tab and redraw.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (!sheetOpen) {
    state = load();
    render();
  }
  updateBadge();
});

window.addEventListener('storage', (ev) => {
  if (ev.key && ev.key.startsWith('hourtracker') && !sheetOpen) {
    state = load();
    render();
  }
});

// ---------- start ----------

render();
updateBadge();
setInterval(tick, 1000);

navigator.storage?.persist?.().catch(() => {});

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('Service worker failed', err));
  // When an update installs, reload once so you're running the new version.
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (hadController && !sheetOpen) location.reload();
  });
}
