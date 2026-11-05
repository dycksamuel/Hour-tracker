// Run: npm test   (uses TZ=America/Toronto so daylight-saving weeks are exercised)
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  startOfWeek, addDays, dayKey, entryDuration, formatHours, decimalHours, formatElapsed,
  groupByWeek, totalBetween, weeksToCSV, weekToText, toDateTimeLocal, fromDateTimeLocal, formatWeekRange,
} from '../docs/js/logic.js';
import { normalize, load, save, emptyState } from '../docs/js/store.js';

const at = (y, m, d, h = 0, mi = 0, s = 0) => new Date(y, m - 1, d, h, mi, s).getTime();
const H = 3600000;

test('weeks start on Monday', () => {
  // Thu Nov 5 2026 -> Mon Nov 2
  assert.equal(dayKey(startOfWeek(at(2026, 11, 5, 10, 19))), '2026-11-02');
  // Sunday belongs to the week that started the previous Monday
  assert.equal(dayKey(startOfWeek(at(2026, 11, 8, 23, 59))), '2026-11-02');
  // Monday just after midnight starts a new week
  assert.equal(dayKey(startOfWeek(at(2026, 11, 9, 0, 1))), '2026-11-09');
});

test('week math survives daylight saving (Nov 1 2026 in Toronto)', () => {
  const ws = startOfWeek(at(2026, 11, 1, 12)); // Sunday, DST ends that morning
  assert.equal(dayKey(ws), '2026-10-26');
  assert.equal(dayKey(addDays(ws, 7)), '2026-11-02');
  assert.equal(new Date(addDays(ws, 7)).getHours(), 0);
});

test('durations count whole minutes between the shown clock times', () => {
  const e = { start: at(2026, 11, 2, 9, 6, 50), end: at(2026, 11, 2, 16, 21, 5) };
  assert.equal(entryDuration(e), 7 * H + 15 * 60000); // 9:06 -> 4:21 = 7h 15m
  assert.equal(formatHours(entryDuration(e)), '7.25h');
  assert.equal(formatHours(entryDuration(e), 'hm'), '7h 15m');
  // active shift measured to now
  assert.equal(entryDuration({ start: at(2026, 11, 5, 9, 7), end: null }, at(2026, 11, 5, 10, 22)), 1.25 * H);
});

test('hour formatting', () => {
  assert.equal(decimalHours(18 * H), '18');
  assert.equal(decimalHours(7.5 * H), '7.5');
  assert.equal(decimalHours(20 * 60000), '0.33');
  assert.equal(formatHours(0), '0h');
  assert.equal(formatHours(45 * 60000, 'hm'), '45m');
  assert.equal(formatHours(2 * H, 'hm'), '2h');
  assert.equal(formatElapsed(H + 5 * 60000 + 9000), '1:05:09');
});

const jobs = { a: { id: 'a', name: 'Church' }, b: { id: 'b', name: 'Cafe, Downtown' } };
const entries = [
  { id: '1', jobId: 'a', start: at(2026, 11, 2, 9, 6), end: at(2026, 11, 2, 16, 21), note: '' },
  { id: '2', jobId: 'a', start: at(2026, 11, 3, 18, 1), end: at(2026, 11, 3, 20, 35), note: 'Youth "night"' },
  { id: '3', jobId: 'a', start: at(2026, 11, 3, 9, 6), end: at(2026, 11, 3, 16, 21), note: '' },
  { id: '4', jobId: 'b', start: at(2026, 11, 8, 22, 0), end: at(2026, 11, 9, 2, 0), note: '' }, // Sun night -> Mon
  { id: '5', jobId: 'a', start: at(2026, 10, 30, 9, 0), end: at(2026, 10, 30, 12, 30), note: '' },
];

test('grouping into weeks and days', () => {
  const weeks = groupByWeek(entries, at(2026, 11, 10));
  assert.deepEqual(weeks.map((w) => dayKey(w.weekStart)), ['2026-11-02', '2026-10-26']);
  const w = weeks[0];
  assert.deepEqual(w.days.map((d) => dayKey(d.dayStart)), ['2026-11-02', '2026-11-03', '2026-11-08']);
  // Tuesday's shifts are sorted by clock-in time
  assert.deepEqual(w.days[1].entries.map((e) => e.id), ['3', '2']);
  // A shift that runs past midnight on Sunday counts toward the day/week it started
  assert.equal(w.days[2].total, 4 * H);
  assert.equal(formatHours(w.byJob.a), '17.07h'); // 7h15 + 7h15 + 2h34 = 17h04m
  assert.equal(w.byJob.b, 4 * H);
  assert.equal(w.total, w.byJob.a + w.byJob.b);
});

test('totals for a range', () => {
  const ws = at(2026, 11, 2);
  assert.equal(totalBetween(entries.filter((e) => e.jobId === 'a'), ws, addDays(ws, 7)), 7.25 * H + 7.25 * H + 154 * 60000);
});

test('CSV export has shifts, day totals and week totals, properly quoted', () => {
  const csv = weeksToCSV(groupByWeek(entries, at(2026, 11, 10)), jobs, at(2026, 11, 10));
  const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(lines[0], 'Date,Day,Job,Clock In,Clock Out,Hours,Note');
  // oldest week first
  assert.equal(lines[1], '2026-10-30,Fri,Church,9:00 AM,12:30 PM,3.5,');
  assert.ok(lines.includes('2026-11-02,Mon,Church,9:06 AM,4:21 PM,7.25,'));
  assert.ok(lines.includes('2026-11-03,Tue,Church,6:01 PM,8:35 PM,2.57,"Youth ""night"""'));
  assert.ok(lines.includes('2026-11-08,Sun,"Cafe, Downtown",10:00 PM,2:00 AM,4,'));
  assert.ok(lines.includes(',,,,Day total (Tue Nov 3),9.82,'));
  assert.ok(lines.some((l) => l.startsWith(',,,,"Week total (Nov 2 – Nov 8, 2026)",21.07,')));
  assert.ok(csv.startsWith('﻿'));
});

test('CSV marks a shift that is still running', () => {
  const csv = weeksToCSV(groupByWeek([{ id: 'x', jobId: 'a', start: at(2026, 11, 5, 9, 7), end: null }], 0), jobs, at(2026, 11, 5, 10, 22));
  assert.match(csv, /9:07 AM,still clocked in,1\.25,/);
});

test('text summary', () => {
  const [week] = groupByWeek(entries, at(2026, 11, 10));
  const text = weekToText(week, jobs, { now: at(2026, 11, 10), showJob: true, title: 'Hours' });
  assert.match(text, /^Hours — Nov 2 – Nov 8, 2026/);
  assert.match(text, /Mon Nov 2 {2}\(7\.25h\)\n {2}9:06 AM – 4:21 PM {3}7\.25h {2}\[Church\]/);
  assert.match(text, /Cafe, Downtown: 4h/);
  assert.match(text, /Week total: 21\.07h$/);
});

test('week range label', () => {
  assert.equal(formatWeekRange(at(2026, 11, 2)), 'Nov 2 – Nov 8, 2026');
  assert.equal(formatWeekRange(at(2026, 12, 28)), 'Dec 28, 2026 – Jan 3, 2027');
});

test('datetime-local round trip', () => {
  const t = at(2026, 11, 5, 9, 7);
  assert.equal(toDateTimeLocal(t), '2026-11-05T09:07');
  assert.equal(fromDateTimeLocal('2026-11-05T09:07'), t);
  assert.equal(fromDateTimeLocal(''), null);
});

test('store: normalize rejects junk and drops orphan entries', () => {
  assert.throws(() => normalize({ hello: 1 }));
  const s = normalize({ jobs: [{ id: 'a', name: 'Church' }], entries: [{ id: '1', jobId: 'a', start: 5, end: null }, { id: '2', jobId: 'zzz', start: 5 }] });
  assert.equal(s.entries.length, 1);
  assert.equal(s.settings.hoursFormat, 'decimal');
  assert.ok(s.jobs[0].color);
});

test('store: unreadable data is kept aside, not overwritten', () => {
  const mem = new Map([['hourtracker.v1', '{not json']]);
  const storage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, v) };
  const s = load(storage);
  assert.deepEqual(s, emptyState());
  assert.ok([...mem.keys()].some((k) => k.startsWith('hourtracker.v1.unreadable-')));
  save({ ...s, jobs: [{ id: 'a', name: 'X', color: '#000', createdAt: 1 }] }, storage);
  assert.equal(load(storage).jobs[0].name, 'X');
});

import { atMinuteOfDay, pickDay, recentDays } from '../docs/js/logic.js';

test('picker: a picked time means the most recent time it already happened', () => {
  const now = at(2026, 11, 5, 8, 30);
  const days = recentDays(now, addDays(now, -2), 3);
  assert.deepEqual(days.map(dayKey), ['2026-11-05', '2026-11-04', '2026-11-03']);
  // 8:00 AM at 8:30 AM -> today
  assert.equal(dayKey(pickDay(days, 8 * 60, now)), '2026-11-05');
  // 11:00 PM at 12:30 AM -> last night
  const lateNow = at(2026, 11, 6, 0, 30);
  const lateDays = recentDays(lateNow, addDays(lateNow, -2), 3);
  assert.equal(dayKey(pickDay(lateDays, 23 * 60, lateNow)), '2026-11-05');
  assert.equal(atMinuteOfDay(at(2026, 11, 5), 8 * 60 + 5), at(2026, 11, 5, 8, 5));
});

test('picker: clock-out time must come after clock-in', () => {
  // Clocked in Wed 6 PM, realizing at Thu 9 AM that you left at 11 PM -> Wednesday
  const start = at(2026, 11, 4, 18, 0);
  const now = at(2026, 11, 5, 9, 0);
  const days = recentDays(now, start, 7);
  assert.deepEqual(days.map(dayKey), ['2026-11-05', '2026-11-04']);
  assert.equal(dayKey(pickDay(days, 23 * 60, now, start)), '2026-11-04');
  // Left at 1 AM -> Thursday morning
  assert.equal(dayKey(pickDay(days, 60, now, start)), '2026-11-05');
  // Nothing fits (a time later than now today and before the clock-in yesterday) -> today, flagged by the UI
  assert.equal(dayKey(pickDay(days, 10 * 60, now, start)), '2026-11-05');
});
