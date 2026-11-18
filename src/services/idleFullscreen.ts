// src/services/idleFullscreen.ts
//
// [local-only] 放歌的时候手停十秒，就在壁纸上面盖一层无边框置顶窗口（能挡住任务栏）；
// 一动鼠标就撤掉。
//
// 为什么不用 setFullScreen：壁纸窗口是 WorkerW 的子窗口（WS_CHILD），setFullScreen 会改窗口
// 样式把它从桌面层摘下来，实测表现是整片白。遮挡改用另一个顶层窗口，完全不碰壁纸窗口。

import { usePlaybackStore } from '../stores/usePlaybackStore';
import { PlayerState } from '../types';

const IDLE_MS = 3_000;  // [local-only][test] 临时改成 3 秒，方便验证，验完改回 10000
const MOVE_THRESHOLD_PX = 4;

type Bridge = { setPeek?: (on: boolean) => Promise<unknown> | void };

export const installIdleFullscreen = (): void => {
    if (typeof window === 'undefined') return;
    const bridge = (globalThis as { electron?: Bridge }).electron;
    if (!bridge?.setPeek) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let peeking = false;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const isPlaying = (): boolean => usePlaybackStore.getState().playerState === PlayerState.PLAYING;

    const show = (): void => {
        if (peeking || !isPlaying()) return;
        peeking = true;
        void bridge.setPeek?.(true);
    };

    const hide = (): void => {
        if (!peeking) return;
        peeking = false;
        void bridge.setPeek?.(false);
    };

    const arm = (): void => {
        if (timer !== null) clearTimeout(timer);
        timer = setTimeout(() => { timer = null; show(); }, IDLE_MS);
    };

    const wake = (): void => {
        hide();
        arm();
    };

    window.addEventListener('pointerdown', wake, { passive: true });
    window.addEventListener('wheel', wake, { passive: true });
    window.addEventListener('keydown', wake, { passive: true });
    window.addEventListener('touchstart', wake, { passive: true });
    window.addEventListener('pointermove', event => {
        const moved = lastX === null || lastY === null
            || Math.abs(event.clientX - lastX) > MOVE_THRESHOLD_PX
            || Math.abs(event.clientY - lastY) > MOVE_THRESHOLD_PX;
        lastX = event.clientX;
        lastY = event.clientY;
        if (moved) wake();
    }, { passive: true });

    // 暂停了就撤掉遮挡。
    usePlaybackStore.subscribe(state => {
        if (state.playerState !== PlayerState.PLAYING) hide();
    });

    arm();
};
