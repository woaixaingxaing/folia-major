// src/services/idleFullscreen.ts
//
// 放歌 → 主屏全屏；停歌 → 回到壁纸模式。纯粹由播放状态驱动。
//
// 关键点：在 Windows 上「退出壁纸模式」会 detach helper 并重建主窗口，所以这个切换
// 必须整段在主进程里做（见 main.cjs 的 local-only:playback-presentation）。渲染进程只
// 负责说一句「我现在要全屏」或「我现在要壁纸」，然后它自己会被重建掉 —— 这一点也不影响
// 主进程把 sequence 走完。
//
// 渲染进程这边唯一要小心的是：窗口重建后页面会重新加载，此时播放状态还没被 handoff
// 恢复回来，如果立刻按「暂停」去切壁纸，就会和刚才那次切换打架，表现就是一直闪。
// 所以启动后先静默 4 秒，只认之后的真实变化。

import { PlayerState } from '../types';
import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';

const SETTLE_MS = 4000;
const DEBOUNCE_MS = 600;

type Presentation = 'fullscreen' | 'wallpaper';

export const installIdleFullscreen = (): void => {
    const electron = window.electron;
    if (!electron || typeof electron.setPlaybackPresentation !== 'function') {
        return;
    }

    let lastApplied: Presentation | null = useDesktopSettingsStore.getState().wallpaperMode ? 'wallpaper' : 'fullscreen';
    let pendingTimer: number | null = null;
    let inflight = false;
    let ready = false;

    const wantOf = (state: PlayerState): Presentation => (
        state === PlayerState.PLAYING ? 'fullscreen' : 'wallpaper'
    );

    const apply = async (next: Presentation) => {
        if (inflight || next === lastApplied) {
            return;
        }
        inflight = true;
        lastApplied = next;
        try {
            await electron.setPlaybackPresentation(next);
        } catch (error) {
            console.warn('[idle-fullscreen] switch failed', error);
            lastApplied = null;
        } finally {
            inflight = false;
        }
    };

    const evaluate = () => {
        if (!ready) {
            return;
        }
        const want = wantOf(usePlaybackStore.getState().playerState);
        if (pendingTimer !== null) {
            window.clearTimeout(pendingTimer);
        }
        pendingTimer = window.setTimeout(() => {
            pendingTimer = null;
            // 状态可能在防抖窗口里又变了，重新读一次当前值再决定。
            void apply(wantOf(usePlaybackStore.getState().playerState));
        }, DEBOUNCE_MS);
    };

    window.setTimeout(() => {
        ready = true;
        console.log('[idle-fullscreen] ready, playerState =', usePlaybackStore.getState().playerState);
        void apply(wantOf(usePlaybackStore.getState().playerState));
        usePlaybackStore.subscribe((state, previous) => {
            if (state.playerState !== previous.playerState) {
                console.log('[idle-fullscreen] playerState', previous.playerState, '->', state.playerState);
                evaluate();
            }
        });
    }, SETTLE_MS);
};
