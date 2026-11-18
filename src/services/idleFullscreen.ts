// src/services/idleFullscreen.ts
//
// [local-only] 只有一条规则：**放歌就是全屏模式，不放歌就是壁纸模式**。
//
// 这两个能力应用本来就有：
//   - 壁纸模式：applyWallpaperMode(true/false)
//   - 全屏：window.electron.toggleFullscreenWindow()
// 这里只负责按播放状态在两者之间切换，不再做空闲计时、鼠标阈值那些花样。
//
// 顺序不能反：壁纸模式下的 setFullScreen 会被主进程拒绝（会把窗口撕出桌面层），
// 所以要进全屏必须先退出壁纸模式；退全屏要先退全屏再回壁纸模式。

import { usePlaybackStore } from '../stores/usePlaybackStore';
import { useDesktopSettingsStore } from '../stores/useDesktopSettingsStore';
import { PlayerState } from '../types';

/** 退出壁纸模式到能进全屏之间要等一拍，桌面层解挂是异步的。 */
const SWITCH_DELAY_MS = 400;

type Bridge = { toggleFullscreenWindow?: () => Promise<unknown> | void };

export const installIdleFullscreen = (): void => {
    if (typeof window === 'undefined') return;
    const bridge = (globalThis as { electron?: Bridge }).electron;
    if (!bridge?.toggleFullscreenWindow) return;

    const isPlaying = (): boolean =>
        usePlaybackStore.getState().playerState === PlayerState.PLAYING;

    /** 切换进行中，避免连续的状态变化把两次切换叠在一起。 */
    let switching = false;
    let showingFullscreen = false;

    const apply = (): void => {
        if (switching) return;
        const playing = isPlaying();
        if (playing === showingFullscreen) return;

        switching = true;
        if (playing) {
            // 放歌：离开壁纸 → 全屏
            useDesktopSettingsStore.getState().applyWallpaperMode(false);
            setTimeout(() => {
                void bridge.toggleFullscreenWindow?.();
                showingFullscreen = true;
                switching = false;
            }, SWITCH_DELAY_MS);
        } else {
            // 停歌：退全屏 → 回壁纸
            void bridge.toggleFullscreenWindow?.();
            setTimeout(() => {
                useDesktopSettingsStore.getState().applyWallpaperMode(true);
                showingFullscreen = false;
                switching = false;
            }, SWITCH_DELAY_MS);
        }
    };

    // 播放状态一变就切，没有别的条件。
    usePlaybackStore.subscribe(apply);
    apply();
};
