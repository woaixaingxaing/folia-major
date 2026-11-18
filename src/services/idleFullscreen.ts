// src/services/idleFullscreen.ts
//
// [local-only] 播放时手停十秒 → 全屏（盖住任务栏）；一动鼠标就退回来。
//
// 走的是应用自己的路径：壁纸模式下 setFullScreen 会被主进程拒绝（源码里写明
// "Fullscreen would tear the wallpaper window out of its desktop-layer geometry"），
// 所以顺序是「退出壁纸模式 → 全屏 → 退出全屏 → 回壁纸模式」。

import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { PlayerState } from '../types';

const IDLE_MS = 3_000;  // [local-only][test] 临时 3 秒，验证完改回 10_000
const MOVE_THRESHOLD_PX = 4;
/** 退出壁纸模式到能进全屏之间要等一拍，桌面层解挂是异步的。 */
const MODE_SWITCH_DELAY_MS = 400;

type Bridge = { toggleFullscreenWindow?: () => Promise<unknown> | void };

export const installIdleFullscreen = (): void => {
    if (typeof window === 'undefined') return;
    const bridge = (globalThis as { electron?: Bridge }).electron;
    if (!bridge?.toggleFullscreenWindow) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let active = false;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const isPlaying = (): boolean => usePlaybackStore.getState().playerState === PlayerState.PLAYING;
    const wallpaper = useDesktopSettingsStore.getState();

    const enter = (): void => {
        if (active || !isPlaying()) return;
        active = true;
        // 先离开壁纸模式，窗口才能进全屏而不被撕出桌面层。
        wallpaper.applyWallpaperMode(false);
        setTimeout(() => {
            void bridge.toggleFullscreenWindow?.();
        }, MODE_SWITCH_DELAY_MS);
    };

    const leave = (): void => {
        if (!active) return;
        active = false;
        void bridge.toggleFullscreenWindow?.();
        setTimeout(() => {
            useDesktopSettingsStore.getState().applyWallpaperMode(true);
        }, MODE_SWITCH_DELAY_MS);
    };

    const arm = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; enter(); }, IDLE_MS);
    };

    const wake = (): void => {
        leave();
        arm();
    };

    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
    window.addEventListener('touchstart', wake, { passive: true });
    window.addEventListener('keydown', event => {
        if (event.key === 'Escape') leave();
    }, { passive: true });
    window.addEventListener('pointermove', event => {
        const moved = lastX === null || lastY === null
            || Math.abs(event.clientX - lastX) > MOVE_THRESHOLD_PX
            || Math.abs(event.clientY - lastY) > MOVE_THRESHOLD_PX;
        lastX = event.clientX;
        lastY = event.clientY;
        if (moved) wake();
    }, { passive: true });

    usePlaybackStore.subscribe(state => {
        if (state.playerState !== PlayerState.PLAYING) leave();
    });

    arm();
};
