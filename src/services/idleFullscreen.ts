// src/services/idleFullscreen.ts
//
// [local-only] 桌面上一面墙，看完不该还留着一个窗口边框。手停下来十秒就进全屏，鼠标一动就退出来。
// 判断"有没有操作"只看真实的输入事件：鼠标移动、按下、滚轮、键盘、触摸。

const IDLE_MS = 10_000;
/** 鼠标只有停在原地时的细碎抖动不算操作，超过这个距离才算。 */
const MOVE_THRESHOLD_PX = 4;

type Bridge = { setFullscreen?: (on: boolean) => Promise<unknown> | void };

export const installIdleFullscreen = (): void => {
    if (typeof window === 'undefined') return;
    const bridge = (globalThis as { electron?: Bridge }).electron;
    if (!bridge?.setFullscreen) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    let fullscreen = false;
    let lastX: number | null = null;
    let lastY: number | null = null;

    const enter = (): void => {
        if (fullscreen) return;
        fullscreen = true;
        void bridge.setFullscreen?.(true);
    };

    const leave = (): void => {
        if (!fullscreen) return;
        fullscreen = false;
        void bridge.setFullscreen?.(false);
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

    window.addEventListener('pointermove', event => {
        const moved = lastX === null || lastY === null
            || Math.abs(event.clientX - lastX) > MOVE_THRESHOLD_PX
            || Math.abs(event.clientY - lastY) > MOVE_THRESHOLD_PX;
        lastX = event.clientX;
        lastY = event.clientY;
        if (moved) wake();
    }, { passive: true });

    arm();
};
