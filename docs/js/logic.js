// Pure date/time and reporting helpers. No DOM access, so it can be unit tested in Node.
// All times are stored as epoch milliseconds and interpreted in the phone's local time zone.

const HOUR_MS = 3600000;

const pad = (n) => String(n).padStart(2, '0');

export function startOfDay(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Monday 00:00 of the week containing `t`. Weeks run Monday to Sunday. */
export function startOfWeek(t) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

/** Calendar-aware day arithmetic (safe across daylight saving changes). */
export function addDays(t, n) {
  const d = new Date(t);
  d.setDate(d.getDate() + n);
  return d.getTime();
}

export function dayKey(t) {
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Worked time, counted in whole minutes from the minute you clocked in to the minute you clocked out,
 * minus any break.
 * That way the hours always match the clock-in/out times shown (which have no seconds).
 */
export function entryDuration(entry, now) {
  return Math.max(0, shiftSpan(entry, now) - (entry.breakMs || 0));
}

/** Clock-in to clock-out, before any break is taken off. */
export function shiftSpan(entry, now) {
  const end = entry.end ?? now;
  return Math.max(0, minuteFloor(end) - minuteFloor(entry.start));
}

/** "1h", "45m", "1h 30m", or '' for no break. */
export function formatBreak(ms) {
  return ms > 0 ? formatHours(ms, 'hm') : '';
}

const minuteFloor = (t) => Math.floor(t / 60000) * 60000;

// ---------- Formatting ----------

/** 7.25h / 18h (decimal) or 7h 15m (hm). */
export function formatHours(ms, mode = 'decimal') {
  if (mode === 'hm') {
    const totalMin = Math.round(ms / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    if (!h) return `${m}m`;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  return `${decimalHours(ms)}h`;
}

/** Decimal hours rounded to 2 places with trailing zeros removed: 7.25, 7.5, 18. */
export function decimalHours(ms) {
  return (Math.round((ms / HOUR_MS) * 100) / 100).toFixed(2).replace(/\.?0+$/, '');
}

/** Running timer: 1:05:09 */
export function formatElapsed(ms) {
  const s = Math.floor(Math.max(0, ms) / 1000);
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}

export function formatTime(t) {
  // Newer engines put a narrow no-break space before AM/PM; use a plain space so exports stay clean.
  return new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).replace(/[\u202f\u00a0]/g, ' ');
}

/** Mon Nov 2 */
export function formatDay(t) {
  const d = new Date(t);
  const wd = d.toLocaleDateString('en-US', { weekday: 'short' });
  const md = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return `${wd} ${md}`;
}

/** Nov 2 – Nov 8, 2026 (year shown once, or on both ends if the week spans New Year). */
export function formatWeekRange(weekStart) {
  const end = addDays(weekStart, 6);
  const s = new Date(weekStart);
  const e = new Date(end);
  const md = (d) => d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  if (s.getFullYear() !== e.getFullYear()) {
    return `${md(s)}, ${s.getFullYear()} – ${md(e)}, ${e.getFullYear()}`;
  }
  return `${md(s)} – ${md(e)}, ${e.getFullYear()}`;
}

/** Value for <input type="datetime-local">, in local time. */
export function toDateTimeLocal(t) {
  const d = new Date(t);
  return `${dayKey(t)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fromDateTimeLocal(value) {
  if (!value) return null;
  const [date, time] = value.split('T');
  const [y, mo, da] = date.split('-').map(Number);
  const [h, mi] = (time || '0:0').split(':').map(Number);
  const t = new Date(y, mo - 1, da, h, mi, 0, 0).getTime();
  return Number.isNaN(t) ? null : t;
}

// ---------- Grouping ----------

/**
 * Group entries into Monday–Sunday weeks, newest week first.
 * A shift belongs to the day (and week) it was clocked in on.
 * Each week: { weekStart, total, byJob: {jobId: ms}, days: [{ dayStart, total, entries }] }
 * Days are oldest first within a week; entries are oldest first within a day.
 */
export function groupByWeek(entries, now) {
  const weeks = new Map();
  const sorted = [...entries].sort((a, b) => a.start - b.start);
  for (const e of sorted) {
    const ws = startOfWeek(e.start);
    let week = weeks.get(ws);
    if (!week) {
      week = { weekStart: ws, total: 0, byJob: {}, days: [] };
      weeks.set(ws, week);
    }
    const ds = startOfDay(e.start);
    let day = week.days[week.days.length - 1];
    if (!day || day.dayStart !== ds) {
      day = { dayStart: ds, total: 0, entries: [] };
      week.days.push(day);
    }
    const dur = entryDuration(e, now);
    day.entries.push(e);
    day.total += dur;
    week.total += dur;
    week.byJob[e.jobId] = (week.byJob[e.jobId] || 0) + dur;
  }
  return [...weeks.values()].sort((a, b) => b.weekStart - a.weekStart);
}

export function totalBetween(entries, from, to, now) {
  let sum = 0;
  for (const e of entries) {
    if (e.start >= from && e.start < to) sum += entryDuration(e, now);
  }
  return sum;
}

// ---------- Export ----------

function csvCell(v) {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const QUARTER_MS = 15 * 60000;

/** Round a duration to the nearest 15 minutes (8 min or more rounds up). */
export function roundToQuarter(ms) {
  return Math.round(ms / QUARTER_MS) * QUARTER_MS;
}

/**
 * The hours a timesheet shows for one week. With `round`, each shift is rounded to the nearest
 * 15 minutes and the day/week totals add up those rounded shifts, so the sheet always adds up.
 * Returns { weekStart, total, byJob, days: [{ dayStart, total, entries: [{ entry, ms }] }] }.
 */
export function timesheet(week, now, round = false) {
  const dur = (e) => (round ? roundToQuarter(entryDuration(e, now)) : entryDuration(e, now));
  const byJob = {};
  const days = week.days.map((d) => {
    const entries = d.entries.map((entry) => ({ entry, ms: dur(entry) }));
    for (const x of entries) byJob[x.entry.jobId] = (byJob[x.entry.jobId] || 0) + x.ms;
    return { dayStart: d.dayStart, entries, total: entries.reduce((sum, x) => sum + x.ms, 0) };
  });
  return { weekStart: week.weekStart, days, byJob, total: days.reduce((sum, d) => sum + d.total, 0) };
}

export const ROUNDING_NOTE = 'Hours are rounded to the nearest 15 minutes.';

/**
 * CSV with one row per shift, plus a total row after each day and each week.
 * `weeks` is the output of groupByWeek (any order; exported oldest first).
 */
export function weeksToCSV(weeks, jobsById, now, { round = false } = {}) {
  const rows = [['Date', 'Day', 'Job', 'Clock In', 'Clock Out', 'Break', 'Hours', 'Note']];
  const ordered = [...weeks].sort((a, b) => a.weekStart - b.weekStart);
  for (const week of ordered.map((w) => timesheet(w, now, round))) {
    for (const day of week.days) {
      const d = new Date(day.dayStart);
      for (const { entry: e, ms } of day.entries) {
        rows.push([
          dayKey(day.dayStart),
          d.toLocaleDateString('en-US', { weekday: 'short' }),
          jobsById[e.jobId]?.name ?? '',
          formatTime(e.start),
          e.end == null ? 'still clocked in' : formatTime(e.end),
          formatBreak(e.breakMs),
          decimalHours(ms),
          e.note || '',
        ]);
      }
      rows.push(['', '', '', '', '', `Day total (${formatDay(day.dayStart)})`, decimalHours(day.total), '']);
    }
    rows.push(['', '', '', '', '', `Week total (${formatWeekRange(week.weekStart)})`, decimalHours(week.total), '']);
    rows.push([]);
  }
  if (round) rows.push([ROUNDING_NOTE]);
  // Leading BOM so Excel opens the file as UTF-8.
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** Plain-text summary for pasting into a message or email. */
export function weekToText(week, jobsById, { now, mode = 'decimal', showJob = false, title = '', round = false } = {}) {
  const fh = (ms) => formatHours(ms, mode);
  const sheet = timesheet(week, now, round);
  const lines = [];
  lines.push(`${title ? `${title} — ` : ''}${formatWeekRange(week.weekStart)}`);
  lines.push('');
  for (const day of sheet.days) {
    lines.push(`${formatDay(day.dayStart)}  (${fh(day.total)})`);
    for (const { entry: e, ms } of day.entries) {
      const end = e.end == null ? 'now' : formatTime(e.end);
      const job = showJob ? `  [${jobsById[e.jobId]?.name ?? ''}]` : '';
      const note = e.note ? `  – ${e.note}` : '';
      const brk = e.breakMs > 0 ? ` (${formatBreak(e.breakMs)} break)` : '';
      lines.push(`  ${formatTime(e.start)} – ${end}   ${fh(ms)}${brk}${job}${note}`);
    }
  }
  lines.push('');
  if (showJob && Object.keys(sheet.byJob).length > 1) {
    for (const [jobId, ms] of Object.entries(sheet.byJob)) {
      lines.push(`${jobsById[jobId]?.name ?? 'Job'}: ${fh(ms)}`);
    }
  }
  lines.push(`Week total: ${fh(sheet.total)}`);
  if (round) lines.push(`(${ROUNDING_NOTE})`);
  return lines.join('\n');
}

// ---------- "Clock in/out at…" time picker ----------

/** The moment `minutes` after midnight (0–1439) on the calendar day starting at `dayStart`. */
export function atMinuteOfDay(dayStart, minutes) {
  const d = new Date(dayStart);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d.getTime();
}

/**
 * Which day a picked time of day most likely means: the newest of `days` (newest first) where that
 * time has already happened and falls after `after`. Picking 11:00 PM at 12:30 AM means last night.
 */
export function pickDay(days, minutes, now, after = -Infinity) {
  for (const ds of days) {
    const t = atMinuteOfDay(ds, minutes);
    if (t <= now && t > after) return ds;
  }
  return days[0];
}

/** Day starts from today back to `oldest` (inclusive), newest first, at most `max` days. */
export function recentDays(now, oldest, max) {
  const days = [];
  for (let ds = startOfDay(now); ds >= startOfDay(oldest) && days.length < max; ds = addDays(ds, -1)) days.push(ds);
  return days;
}

// ---------- Email timesheet ----------

/** Split "a@x.com, b@y.com" (commas, semicolons or spaces) into valid and invalid addresses. */
export function parseEmails(text) {
  const parts = String(text || '')
    .split(/[\s,;]+/)
    .map((p) => p.trim())
    .filter(Boolean);
  const ok = (p) => /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]+$/.test(p);
  return { valid: [...new Set(parts.filter(ok))], invalid: parts.filter((p) => !ok(p)) };
}

/** mailto: link that opens a drafted email in the phone's mail app. */
export function mailtoLink(to, subject, body) {
  const q = `subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body.replace(/\r?\n/g, '\r\n'))}`;
  return `mailto:${to.map((a) => encodeURIComponent(a).replace(/%40/g, '@')).join(',')}?${q}`;
}
