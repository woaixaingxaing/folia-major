// src/services/idleFullscreen.ts
//
// [local-only][off] 暂停使用。
//
// 原本的意图是：放歌的时候手停十秒就进全屏、动鼠标退出来。但壁纸模式下这个窗口是
// WorkerW 的子窗口（WS_CHILD），而 Electron 的 setFullScreen 会改窗口样式把它从桌面层
// 上摘下来 —— 实测表现就是整个窗口变成白色。真正要做的不是"改窗口样式"，而是
// "把窗口铺满目标显示器并压过任务栏"，那需要先解决挂载与坐标换算，属于原生层的改动。
//
// 在那边修好之前，这个功能保持关闭：留一个空实现，调用点不用改。

export const installIdleFullscreen = (): void => {
    // 故意什么都不做。见文件顶部说明。
};
