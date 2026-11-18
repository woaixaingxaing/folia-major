// src/services/playStats.ts
//
// [local-only] Listening statistics: how many plays fell on each day, and how much of them was
// heard. Kept as running totals rather than one row per play, so the record stays a few
// kilobytes however long the library is used. Written on this device only; the export exists so
// a plain HTML page opened from disk can draw the heatmap.

import type { SongResult } from '../types';

const STORAGE_KEY = ['folia', 'play', 'stats', 'v1'].join('_');
/** Longest stretch of the list kept: a heatmap never asks for more than a year and a bit. */
const KEEP_DAYS = 400;
/** How long after a change the export is written, so a burst of plays writes once. */
const EXPORT_DELAY_MS = 3000;

export interface PlayStatsBucket {
    /** Plays that fell on this day. */
    p: number;
    /** How much of them was heard, in milliseconds. */
    ms: number;
}

export interface PlayStatsSong {
    name: string;
    artist: string;
    p: number;
    ms: number;
}

interface PlayStatsStore {
    v: 1;
    /** Keyed by local date, "YYYY-MM-DD". */
    days: Record<string, PlayStatsBucket>;
    /** Keyed by song key, so a re-scanned file is still the same song. */
    songs: Record<string, PlayStatsSong>;
    updatedAt: number;
}

export interface PlayStatsPayload {
    generatedAt: string;
    summary: { totalPlays: number; totalDurationMs: number; activeDays: number; trackedSince: string };
    heatmap: Record<string, PlayStatsBucket>;
    topSongs: PlayStatsSong[];
    topArtists: Array<{ artist: string; p: number; ms: number }>;
    last7Days: Array<{ date: string; p: number; ms: number }>;
}

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** The local calendar day, not the UTC one: a play at 01:00 belongs to that day here. */
export const toLocalDateKey = (ts: number = Date.now()): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyStore = (): PlayStatsStore => ({ v: 1, days: {}, songs: {}, updatedAt: 0 });

let cache: PlayStatsStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let exportTimer: ReturnType<typeof setTimeout> | null = null;

const read = (): PlayStatsStore => {
    if (cache) return cache;
    try {
        const raw = storage()?.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (parsed && typeof parsed === 'object' && (parsed as PlayStatsStore).v === 1) {
            const store = parsed as PlayStatsStore;
            cache = {
                v: 1,
                days: store.days && typeof store.days === 'object' ? store.days : {},
                songs: store.songs && typeof store.songs === 'object' ? store.songs : {},
                updatedAt: Number(store.updatedAt) || 0,
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
    if (!Number.isFinite(deltaMs) || deltaMs <= 0) return;
    const store = read();
    const now = Date.now();
    const dayKey = toLocalDateKey(now);

    const day = store.days[dayKey] ?? (store.days[dayKey] = { p: 0, ms: 0 });
    day.ms += Math.round(deltaMs);
    if (countsAsPlay) day.p += 1;

    const artist = (song.artists ?? []).map(a => a.name).filter(Boolean).join(' / ') || '未知歌手';
    const entry = store.songs[songKey] ?? (store.songs[songKey] = { name: song.name || '未知歌曲', artist, p: 0, ms: 0 });
    entry.name = song.name || entry.name;
    entry.artist = artist;
    entry.ms += Math.round(deltaMs);
    if (countsAsPlay) entry.p += 1;

    prune(store, now);
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(store); }, 800);
    scheduleExport();
};

export const buildPlayStatsPayload = (): PlayStatsPayload => {
    const store = read();
    const days = Object.entries(store.days).sort(([a], [b]) => a.localeCompare(b));

    let totalPlays = 0;
    let totalDurationMs = 0;
    for (const [, bucket] of days) {
        totalPlays += bucket.p;
        totalDurationMs += bucket.ms;
    }

    const artists = new Map<string, { artist: string; p: number; ms: number }>();
    for (const song of Object.values(store.songs)) {
        const row = artists.get(song.artist) ?? { artist: song.artist, p: 0, ms: 0 };
        row.p += song.p;
        row.ms += song.ms;
        artists.set(song.artist, row);
    }

    const today = Date.now();
    const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = toLocalDateKey(today - (6 - i) * 24 * 60 * 60 * 1000);
        const bucket = store.days[date];
        return { date, p: bucket?.p ?? 0, ms: bucket?.ms ?? 0 };
    });

    return {
        generatedAt: new Date().toISOString(),
        summary: {
            totalPlays,
            totalDurationMs,
            activeDays: days.filter(([, b]) => b.p > 0).length,
            trackedSince: days[0]?.[0] ?? toLocalDateKey(today),
        },
        heatmap: { ...store.days },
        topSongs: Object.values(store.songs).sort((a, b) => b.p - a.p || b.ms - a.ms).slice(0, 20),
        topArtists: [...artists.values()].sort((a, b) => b.p - a.p || b.ms - a.ms).slice(0, 20),
        last7Days,
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
