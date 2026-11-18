// src/services/playStats.ts
//
// [local-only] Listening statistics, kept per day AND per song, which is the smallest shape that
// still answers every question the stats page asks: the totals for any range, the top artists and
// songs in that range, and a drill-down from an artist to the songs heard in that range. Keeping
// one row per play instead would only add resolution nobody reads. Written on this device only;
// the export exists so a plain HTML page opened from disk can draw the whole thing.

import type { SongResult } from '../types';

const STORAGE_KEY = ['folia', 'play', 'stats', 'v2'].join('_');
/** Longest stretch kept: a heatmap never asks for more than a year and a bit. */
const KEEP_DAYS = 400;
/** How long after a change the export is written, so a burst of plays writes once. */
const EXPORT_DELAY_MS = 3000;

/** One song on one day. */
export interface DaySongEntry {
    /** Plays that started on this day. */
    p: number;
    /** How much of it was heard, in milliseconds. */
    ms: number;
}

export interface SongMeta {
    name: string;
    artist: string;
}

/** dateKey → songKey → entry */
type DayMap = Record<string, Record<string, DaySongEntry>>;

interface PlayStatsStore {
    v: 2;
    days: DayMap;
    /** Every song ever recorded, so a deleted file still has a name in the lists. */
    songs: Record<string, SongMeta>;
    updatedAt: number;
}

export interface PlayStatsPayload {
    version: 2;
    generatedAt: string;
    summary: { totalPlays: number; totalDurationMs: number; activeDays: number; trackedSince: string };
    days: DayMap;
    songs: Record<string, SongMeta>;
}

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** The local calendar day, not the UTC one: a play at 01:00 belongs to that day here. */
export const toLocalDateKey = (ts: number = Date.now()): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyStore = (): PlayStatsStore => ({ v: 2, days: {}, songs: {}, updatedAt: 0 });

let cache: PlayStatsStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let exportTimer: ReturnType<typeof setTimeout> | null = null;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const read = (): PlayStatsStore => {
    if (cache) return cache;
    try {
        const raw = storage()?.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isObject(parsed) && parsed.v === 2 && isObject(parsed.days) && isObject(parsed.songs)) {
            cache = {
                v: 2,
                days: parsed.days as DayMap,
                songs: parsed.songs as Record<string, SongMeta>,
                updatedAt: Number(parsed.updatedAt) || 0,
            };
            return cache;
        }
    } catch {
        /* a corrupted record starts over rather than blocking playback */
    }
    cache = emptyStore();
    return cache;
};

const save = (store: PlayStatsStore): void => {
    store.updatedAt = Date.now();
    try {
        storage()?.setItem(STORAGE_KEY, JSON.stringify(store));
    } catch {
        /* out of room: the numbers in memory still work until the app closes */
    }
};

/** Forgets days old enough that no heatmap will ask for them. */
const prune = (store: PlayStatsStore, now: number): void => {
    const cutoff = toLocalDateKey(now - KEEP_DAYS * 24 * 60 * 60 * 1000);
    for (const day of Object.keys(store.days)) {
        if (day < cutoff) delete store.days[day];
    }
};

/**
 * Adds one stretch of listening. `countsAsPlay` is true only for the first report of a song, so a
 * song left playing keeps adding time without being counted again.
 */
export const recordPlayStats = (song: SongResult, songKey: string, deltaMs: number, countsAsPlay: boolean): void => {
    if (!Number.isFinite(deltaMs) || deltaMs <= 0 || !songKey) return;
    const store = read();
    const now = Date.now();
    const dayKey = toLocalDateKey(now);

    const day = store.days[dayKey] ?? (store.days[dayKey] = {});
    const entry = day[songKey] ?? (day[songKey] = { p: 0, ms: 0 });
    entry.ms += Math.round(deltaMs);
    if (countsAsPlay) entry.p += 1;

    // The name is kept beside the play so a file deleted later still reads as itself, not "未知歌曲".
    const artist = (song.artists ?? []).map(a => a.name).filter(Boolean).join(' / ') || '未知歌手';
    const meta = store.songs[songKey];
    if (!meta) store.songs[songKey] = { name: song.name || '未知歌曲', artist };
    else {
        if (song.name) meta.name = song.name;
        meta.artist = artist;
    }

    prune(store, now);
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(store); }, 800);
    scheduleExport();
};

export const buildPlayStatsPayload = (): PlayStatsPayload => {
    const store = read();
    const dayKeys = Object.keys(store.days).sort();

    let totalPlays = 0;
    let totalDurationMs = 0;
    for (const key of dayKeys) {
        for (const entry of Object.values(store.days[key])) {
            totalPlays += entry.p;
            totalDurationMs += entry.ms;
        }
    }
    // A day is in the map only because something was heard on it.
    const activeDays = dayKeys.length;

    return {
        version: 2,
        generatedAt: new Date().toISOString(),
        summary: {
            totalPlays,
            totalDurationMs,
            activeDays,
            trackedSince: dayKeys[0] ?? toLocalDateKey(Date.now()),
        },
        days: store.days,
        songs: store.songs,
    };
};

const writeExport = (): void => {
    const api = (globalThis as { electron?: { statsWrite?: (payload: PlayStatsPayload) => Promise<unknown> } }).electron;
    if (!api?.statsWrite) return;
    save(read());
    void api.statsWrite(buildPlayStatsPayload()).catch(() => { /* the page shows what it last got */ });
};

const scheduleExport = (): void => {
    if (exportTimer !== null) clearTimeout(exportTimer);
    exportTimer = setTimeout(() => { exportTimer = null; writeExport(); }, EXPORT_DELAY_MS);
};

/** Writes the export now: called when the window is going away, where a debounce would not run. */
export const flushPlayStats = (): void => {
    if (exportTimer !== null) clearTimeout(exportTimer);
    exportTimer = null;
    writeExport();
};

export const installPlayStatsFlush = (): void => {
    if (typeof window === 'undefined') return;
    window.addEventListener('pagehide', flushPlayStats);
    window.addEventListener('beforeunload', flushPlayStats);
};
