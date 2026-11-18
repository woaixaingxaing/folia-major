// src/services/playStats.ts
//
// [local-only] Listening statistics, kept per day AND per song, which is the smallest shape that
// still answers every question the stats page asks: the totals for any range, the top artists and
// songs in that range, and a drill-down from an artist to the songs heard in that range. Hourly
// counts are kept beside them for the listening clock. Covers are copied out once each, so the
// page can show album art without the app being open. Written on this device only.

import type { SongResult } from '../types';
import { readCoverAsset } from './binaryAssetStore';

const STORAGE_KEY = ['folia', 'play', 'stats', 'v3'].join('_');
/** Longest stretch kept: a heatmap never asks for more than a year and a bit. */
const KEEP_DAYS = 400;
/** How long after a change the export is written, so a burst of plays writes once. */
const EXPORT_DELAY_MS = 3000;
/** Covers copied per export, so the first export of a big library does not stall the window. */
const COVERS_PER_EXPORT = 24;

/** One song on one day. */
export interface DaySongEntry {
    p: number;
    ms: number;
}

export interface SongMeta {
    name: string;
    artist: string;
    album?: string;
    /** Relative path under the export folder; '' means "looked for one, there is none". */
    cover?: string;
    /** Where the cover comes from, so the copy can be made on a later export. */
    coverAssetId?: string;
}

type DayMap = Record<string, Record<string, DaySongEntry>>;
/** dateKey → hour of day → plays */
type HourMap = Record<string, Record<string, number>>;

interface PlayStatsStore {
    v: 3;
    days: DayMap;
    hours: HourMap;
    songs: Record<string, SongMeta>;
    updatedAt: number;
}

export interface PlayStatsPayload {
    version: 3;
    generatedAt: string;
    summary: { totalPlays: number; totalDurationMs: number; activeDays: number; trackedSince: string };
    days: DayMap;
    hours: HourMap;
    songs: Record<string, SongMeta>;
}

type CoverApi = {
    statsWrite?: (payload: PlayStatsPayload) => Promise<unknown>;
    statsWriteCover?: (assetId: string, ext: string, bytes: Uint8Array) => Promise<unknown>;
};

const api = (): CoverApi | undefined =>
    (globalThis as { electron?: CoverApi }).electron;

const storage = () => (typeof localStorage === 'undefined' ? null : localStorage);

/** The local calendar day, not the UTC one: a play at 01:00 belongs to that day here. */
export const toLocalDateKey = (ts: number = Date.now()): string => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const emptyStore = (): PlayStatsStore => ({ v: 3, days: {}, hours: {}, songs: {}, updatedAt: 0 });

let cache: PlayStatsStore | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let exportTimer: ReturnType<typeof setTimeout> | null = null;
let coversBusy = false;

const isObject = (value: unknown): value is Record<string, unknown> =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

const read = (): PlayStatsStore => {
    if (cache) return cache;
    try {
        const raw = storage()?.getItem(STORAGE_KEY);
        const parsed: unknown = raw ? JSON.parse(raw) : null;
        if (isObject(parsed) && parsed.v === 3 && isObject(parsed.days) && isObject(parsed.songs)) {
            cache = {
                v: 3,
                days: parsed.days as DayMap,
                hours: isObject(parsed.hours) ? parsed.hours as HourMap : {},
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
    for (const day of Object.keys(store.hours)) {
        if (day < cutoff) delete store.hours[day];
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
    const hourKey = String(new Date(now).getHours());

    const day = store.days[dayKey] ?? (store.days[dayKey] = {});
    const entry = day[songKey] ?? (day[songKey] = { p: 0, ms: 0 });
    entry.ms += Math.round(deltaMs);
    if (countsAsPlay) {
        entry.p += 1;
        const hours = store.hours[dayKey] ?? (store.hours[dayKey] = {});
        hours[hourKey] = (hours[hourKey] ?? 0) + 1;
    }

    // The name is kept beside the play so a file deleted later still reads as itself, not "未知歌曲".
    const artist = (song.artists ?? []).map(a => a.name).filter(Boolean).join(' / ') || '未知歌手';
    const album = song.album?.name || undefined;
    const assetId = (song as { localCoverAssetId?: string }).localCoverAssetId || undefined;
    const meta = store.songs[songKey];
    if (!meta) {
        store.songs[songKey] = { name: song.name || '未知歌曲', artist, album, coverAssetId: assetId };
    } else {
        if (song.name) meta.name = song.name;
        meta.artist = artist;
        if (album) meta.album = album;
        if (assetId && meta.coverAssetId !== assetId) {
            meta.coverAssetId = assetId;
            // A new cover for the same song has to be copied out again.
            delete meta.cover;
        }
    }

    prune(store, now);
    if (saveTimer !== null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { saveTimer = null; save(store); }, 800);
    scheduleExport();
};

const EXTENSIONS: Record<string, string> = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/avif': 'avif',
    'image/bmp': 'bmp',
};

const safeName = (value: string): string => value.replace(/[^A-Za-z0-9._-]/g, '_');

/**
 * Copies out the covers the page has not got yet. Runs a few at a time and remembers the answer,
 * including "there is none", so a library without art does not re-read itself on every export.
 */
const exportMissingCovers = async (store: PlayStatsStore): Promise<void> => {
    if (coversBusy) return;
    const bridge = api();
    if (!bridge?.statsWriteCover) return;
    coversBusy = true;
    try {
        let budget = COVERS_PER_EXPORT;
        for (const meta of Object.values(store.songs)) {
            if (budget <= 0) break;
            if (meta.cover !== undefined) continue;
            const assetId = meta.coverAssetId;
            if (!assetId) { meta.cover = ''; continue; }
            const blob = await readCoverAsset(assetId);
            if (!blob) { meta.cover = ''; continue; }
            const ext = EXTENSIONS[blob.type] || 'jpg';
            const bytes = new Uint8Array(await blob.arrayBuffer());
            const written = await bridge.statsWriteCover(assetId, ext, bytes) as { ok?: boolean } | undefined;
            if (written && written.ok === false) break;
            meta.cover = `covers/${safeName(assetId)}.${ext}`;
            budget -= 1;
        }
    } catch {
        /* a cover that cannot be read is simply not shown */
    } finally {
        coversBusy = false;
    }
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

    return {
        version: 3,
        generatedAt: new Date().toISOString(),
        summary: {
            totalPlays,
            totalDurationMs,
            // A day is in the map only because something was heard on it.
            activeDays: dayKeys.length,
            trackedSince: dayKeys[0] ?? toLocalDateKey(Date.now()),
        },
        days: store.days,
        hours: store.hours,
        songs: store.songs,
    };
};

const writeExport = (): void => {
    const bridge = api();
    if (!bridge?.statsWrite) return;
    const store = read();
    save(store);
    void exportMissingCovers(store)
        .then(() => {
            save(store);
            return bridge.statsWrite?.(buildPlayStatsPayload());
        })
        .catch(() => { /* the page shows what it last got */ });
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
