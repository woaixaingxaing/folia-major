import React, { useEffect, useMemo, useRef } from 'react';
import { X, Play } from 'lucide-react';
import { SongResult, Theme } from '../../types';

// src/components/modal/LyricsTimelineModal.tsx
//
// 原「时间线」（歌词时间轴）改造成轻量的「接下来播放」抽屉：
// - 非模态：外层 pointer-events-none，只有卡片本身接事件，背后海报墙照常滚动/点击
// - 底部右下停靠，24 条（当前 + 接下来 23 首），永远不渲染全库
// - 关闭或队列为空时直接 return null，杜绝「0 首」幽灵浮层

interface LyricsTimelineModalProps {
    isOpen: boolean;
    onClose: () => void;
    queue: SongResult[];
    currentSong: SongResult | null;
    onPlay: (song: SongResult) => void;
    isDaylight: boolean;
    theme?: Theme;
    /** 鼠标移入卡片：调用方用来取消收起定时器 */
    onHoverEnter?: () => void;
    /** 鼠标移出卡片：调用方用来启动 250ms 收起 */
    onHoverLeave?: () => void;
}

const LyricsTimelineModal: React.FC<LyricsTimelineModalProps> = ({
    isOpen,
    onClose,
    queue,
    currentSong,
    onPlay,
    isDaylight,
    onHoverEnter,
    onHoverLeave,
}) => {
    const glassBg = isDaylight ? 'bg-white/80' : 'bg-black/55';
    const borderColor = isDaylight ? 'border-black/10' : 'border-white/12';
    const headerText = isDaylight ? 'text-zinc-800/90' : 'text-white/90';
    const itemBg = isDaylight ? 'bg-white/60' : 'bg-white/[0.06]';
    const itemBorder = isDaylight ? 'border-black/5' : 'border-white/8';
    const itemHover = isDaylight ? 'hover:bg-white/80' : 'hover:bg-white/12';
    const itemText = isDaylight ? 'text-zinc-800' : 'text-white';
    const itemSub = isDaylight ? 'text-zinc-500' : 'text-white/55';
    const closeIconColor = isDaylight ? 'text-zinc-800/70' : 'text-white/70';
    const closeBtnHover = isDaylight ? 'hover:bg-black/5' : 'hover:bg-white/10';

    const activeRef = useRef<HTMLDivElement>(null);

    // 只渲染「当前 + 接下来 23 首」，支持循环回绕
    const visibleQueue = useMemo(() => {
        if (queue.length === 0) {
            return [] as { song: SongResult; index: number }[];
        }
        const foundIndex = currentSong ? queue.findIndex(song => song.id === currentSong.id) : -1;
        const startIndex = foundIndex >= 0 ? foundIndex : 0;
        const total = Math.min(24, queue.length);
        const rows: { song: SongResult; index: number }[] = [];
        for (let offset = 0; offset < total; offset += 1) {
            const index = (startIndex + offset) % queue.length;
            rows.push({ song: queue[index], index });
        }
        return rows;
    }, [currentSong, queue]);

    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        const timer = window.setTimeout(() => {
            activeRef.current?.scrollIntoView({ block: 'nearest' });
        }, 50);
        return () => window.clearTimeout(timer);
    }, [isOpen, queue.length]);

    // Esc 关闭
    useEffect(() => {
        if (!isOpen) {
            return undefined;
        }
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [isOpen, onClose]);

    if (!isOpen || visibleQueue.length === 0) {
        return null;
    }

    return (
        // 外层不接指针事件：背后海报墙照常可滚可点
        <div className="pointer-events-none fixed bottom-24 left-1/2 z-40 -translate-x-1/2">
            <div
                className={`pointer-events-auto flex max-h-[440px] w-[380px] flex-col overflow-hidden rounded-2xl border ${borderColor} ${glassBg} shadow-2xl backdrop-blur-2xl`}
                onMouseEnter={onHoverEnter}
                onMouseLeave={onHoverLeave}
            >
                <div className="flex items-center justify-between px-4 py-2.5">
                    <span className={`text-xs font-semibold tracking-wide ${headerText}`}>
                        接下来播放
                    </span>
                    <button
                        type="button"
                        aria-label="关闭"
                        className={`rounded-full p-1 transition ${closeBtnHover}`}
                        onClick={onClose}
                    >
                        <X size={14} className={closeIconColor} />
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto px-2 pb-2">
                    {visibleQueue.map(({ song }, rowIndex) => {
                        const isCurrent = rowIndex === 0;
                        const artistNames = (song.artists ?? []).map(artist => artist.name).join(' / ');
                        return (
                            <div
                                key={`${song.id}-${rowIndex}`}
                                ref={isCurrent ? activeRef : undefined}
                                className={`mb-1 flex cursor-pointer items-center gap-2.5 rounded-lg border px-2 py-1.5 transition ${itemBorder} ${
                                    isCurrent ? 'bg-white/18 ring-1 ring-white/35' : `${itemBg} ${itemHover}`
                                }`}
                                onClick={() => onPlay(song)}
                            >
                                <span className={`w-5 shrink-0 text-right text-[10px] tabular-nums ${itemSub}`}>
                                    {rowIndex === 0 ? '' : `#${rowIndex}`}
                                </span>
                                <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-black/30">
                                    {song.album?.coverUrl && (
                                        <img src={song.album.coverUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                                    )}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className={`truncate text-xs ${itemText}`}>{song.name}</div>
                                    <div className={`truncate text-[10px] ${itemSub}`}>{artistNames || '未知歌手'}</div>
                                </div>
                                {rowIndex === 0 ? (
                                    <span className={`shrink-0 text-[10px] ${itemSub}`}>正在播放</span>
                                ) : rowIndex === 1 ? (
                                    <span className={`shrink-0 text-[10px] ${itemSub}`}>下一首</span>
                                ) : (
                                    <Play size={12} className={`shrink-0 ${closeIconColor}`} />
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default LyricsTimelineModal;
