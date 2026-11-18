// src/services/idleFullscreen.ts
//
// 只做一件事：把「有没有在放歌」告诉主进程。
// 窗口形态不再变（永远留在 WorkerW 壁纸层，尺寸是整块屏幕 display.bounds），
// 全屏/退全屏那套会触发 Windows 独占全屏语义，导致任务栏唤不出来 —— 已删除。

import { PlayerState } from '../types';
import { usePlaybackStore } from '../stores/usePlaybackStore';

export const installIdleFullscreen = (): void => {
    const electron = window.electron;
    if (!electron || typeof electron.reportPlaybackState !== 'function') {
        return;
    }
    const report = (state: PlayerState) => {
        electron.reportPlaybackState(state === PlayerState.PLAYING);
    };
    report(usePlaybackStore.getState().playerState);
    usePlaybackStore.subscribe((state, previous) => {
        if (state.playerState !== previous.playerState) {
            report(state.playerState);
        }
    });
};
