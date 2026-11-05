// Saves everything on the phone in localStorage. Nothing leaves the device unless you export it.

const KEY = 'hourtracker.v1';

export const JOB_COLORS = ['#2f7cf6', '#e5484d', '#30a46c', '#f76b15', '#8e4ec6', '#0d9488'];

export function emptyState() {
  return {
    version: 1,
    jobs: [], // { id, name, color, createdAt }
    entries: [], // { id, jobId, start, end|null, note }
    settings: { hoursFormat: 'decimal', badge: false, roundExports: true },
  };
}

export function uid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

/** Validate and fill defaults. Throws on data that is not a Hour Tracker backup. */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.jobs) || !Array.isArray(raw.entries)) {
    throw new Error('This file is not a Hour Tracker backup.');
  }
  const base = emptyState();
  const jobs = raw.jobs
    .filter((j) => j && j.id && typeof j.name === 'string')
    .map((j, i) => ({
      id: String(j.id),
      name: j.name,
      color: j.color || JOB_COLORS[i % JOB_COLORS.length],
      createdAt: Number(j.createdAt) || Date.now(),
    }));
  const jobIds = new Set(jobs.map((j) => j.id));
  const entries = raw.entries
    .filter((e) => e && e.id && jobIds.has(String(e.jobId)) && Number.isFinite(Number(e.start)))
    .map((e) => ({
      id: String(e.id),
      jobId: String(e.jobId),
      start: Number(e.start),
      end: e.end == null ? null : Number(e.end),
      note: typeof e.note === 'string' ? e.note : '',
    }));
  return { version: 1, jobs, entries, settings: { ...base.settings, ...(raw.settings || {}) } };
}

export function load(storage = globalThis.localStorage) {
  let text = null;
  try {
    text = storage.getItem(KEY);
    if (text) return normalize(JSON.parse(text));
  } catch (err) {
    console.error('Could not read saved data', err);
    // Keep the unreadable copy instead of letting the next save overwrite it.
    try {
      if (text) storage.setItem(`${KEY}.unreadable-${Date.now()}`, text);
    } catch {}
  }
  return emptyState();
}

export function save(state, storage = globalThis.localStorage) {
  storage.setItem(KEY, JSON.stringify(state));
}
