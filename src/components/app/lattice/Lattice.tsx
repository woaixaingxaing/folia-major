import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { MotionValue } from 'framer-motion';
import { PlayerState, type SongResult, type LyricData } from '../../../types';
import type { OmniCollection, OmniProviderId } from '../../../types/onlineMusic';
import LatticePlaybackProvider, { type LatticePlaybackActions } from './LatticePlaybackProvider';
import { LatticeTransportContext, type LatticeTransport } from './LatticeTransportContext';
import PosterWall from './PosterWall';
import RadioWall from './radio/RadioWall';
import { buildLatticeTiles, type LatticeTile } from './latticeModel';
import { useStableCallbacks } from '../../../hooks/useStableCallbacks';
import { useLatticeSettingsStore } from '../../../stores/useLatticeSettingsStore';
import { useAppViewStore } from '../../../stores/useAppViewStore';
import { countRender } from '../../../dev/renderCount';
import '../../wall/wall.css';
import './Lattice.css';
import LatticeLyricsProvider from './lyrics/LatticeLyricsProvider';
import type { LatticeLyricSource } from './lyrics/types';
import { getPlaybackSongKey } from '../../../utils/appPlaybackGuards';
import { isPrimaryModifierPressed, isSecondaryModifierPressed } from '../../../utils/platform';
import { isTextEntryTarget } from '../../../utils/keyboardTargets';
import { resolveWallHandoffRole, useWallHandoffStore } from '../../../stores/useWallHandoffStore';
import { useExploreWall } from './useExploreWall';
import { useReducedMotionFor } from '../../../hooks/useReducedMotionFor';
import { isFlightBackArmed, planPageFromWall } from './wallFlight';
import { beginWallTrip, WallTripLog } from './wallTripLog';
import { LATTICE_WALL_ATTR } from '../../collectionFlight';
import { locatePlayingSongOnWall } from './wallLocate';

// The wall's display layer. It renders the play queue and never mutates it; opened from the
// explore tab (`latticeSource` in useAppViewStore) it renders the explore page's entries in the
// queue's place (useExploreWall.ts), and the queue stays what the player plays. The queue can also be drawn as
// the radio wall (radio/RadioWall.tsx, a ring of cards): the wall form setting (useLatticeSettingsStore.latticeWallForm)
// picks it for a plain queue, and Personal FM always has it, its cards played within the radio.
// 翻牌交接（设计稿 §7「进入队列」，与资料库墙 bravais）：根节点挂 data-wall-handoff（in / out）与阶段。叠在资料库墙上面的
// 这段时间里墙面底色不画（下面那面墙的墙面就是同一份），颗粒与暗角由上面这层统一画一份（见 Lattice.css）。

type LatticeProps = {
    controls: LatticePlaybackActions;
    lyrics: LyricData | null;
    lyricSource: LatticeLyricSource;
    lyricKeywordColoringEnabled: boolean;
    currentSong: SongResult | null;
    playerState: PlayerState;
    currentTime: MotionValue<number>;
    /** The lyric clock, for the lyric timeline: media time + preview clip start - manual lyric offset. */
    lyricCurrentTime: MotionValue<number>;
    playbackDuration: number;
    canTogglePlayback: boolean;
    queue: SongResult[];
    isDaylight: boolean;
    onBack: () => void;
    /** 工具面板的「主页」：总是回首页（左上角返回仍是历史返回）；缺省时没有那一格。 */
    onGoHome?: () => void;
    onOpenPlayer: () => void;
    /** `asFm`: a card of the radio wall, played within Personal FM (the queue stays the radio's). */
    onPlaySong: (song: SongResult, queue: SongResult[], asFm: boolean) => void;
    onTogglePlayback: () => void;
    onSeek: (time: number) => void;
    /** For a wall of the explore page's entries: the provider and the account the explore tab shows its page for. */
    exploreProviderId?: OmniProviderId;
    exploreAccountId?: string;
    /** For a wall of the explore page's entries: opens a collection's page, as the explore tab does for a card. */
    onOpenCollection?: (collection: OmniCollection) => void;
};


/** 一首歌的检索串：歌名 / 歌手 / 专辑，小写。275 首大概 20KB，换来每次过滤只做一次 includes。 */
const searchKeyOf = (song: SongResult): string => (
    `${song.name}\u0000${(song.artists ?? []).map(artist => artist.name).join(' ')}\u0000${song.album?.name ?? ''}`.toLowerCase()
);

export default function Lattice({
    controls,
    lyrics,
    lyricSource,
    lyricKeywordColoringEnabled,
    currentSong,
    playerState,
    currentTime,
    lyricCurrentTime,
    playbackDuration,
    canTogglePlayback,
    queue,
    isDaylight,
    onGoHome,
    onOpenPlayer,
    onPlaySong,
    onTogglePlayback,
    onSeek,
    exploreProviderId,
    exploreAccountId = '',
    onOpenCollection,
}: LatticeProps) {
    countRender('Lattice');
    const { t } = useTranslation();
    const vignette = useLatticeSettingsStore(state => state.latticeVignette);
    const lightsOn = useLatticeSettingsStore(state => state.latticeLightsOn);
    const posterTintEnabled = useLatticeSettingsStore(state => state.latticePosterTintEnabled);
    const posterTintUseCustomColor = useLatticeSettingsStore(state => state.latticePosterTintUseCustomColor);
    const posterTintColor = useLatticeSettingsStore(state => state.latticePosterTintColor);
    const posterTintIntensity = useLatticeSettingsStore(state => state.latticePosterTintIntensity);
    const badgeCurrentOnly = useLatticeSettingsStore(state => state.latticeBadgeCurrentOnly);
    // Set by the way the wall was opened, and the same for as long as it is up.
    const isExplore = useAppViewStore(state => state.latticeSource) === 'explore';
    // The queue as the radio wall: always in Personal FM (it comes and goes with FM while the wall is up),
    // and for a plain queue when the wall form setting says so.
    const wallForm = useLatticeSettingsStore(state => state.latticeWallForm);
    const radioHidesUpcoming = useLatticeSettingsStore(state => state.latticeRadioHideUpcoming);
    const isFm = controls.playback.isFmMode;
    const isRadio = !isExplore && (isFm || wallForm === 'radio');
    const explore = useExploreWall({ isOn: isExplore, currentSong, providerId: exploreProviderId, accountId: exploreAccountId });
    // 搜索：输入即时过滤曲库 → 重建 tiles（而不是把不匹配的卡片藏起来，那样结果会散落在巨型画布角落）。
    const [query, setQuery] = useState('');
    const [settledQuery, setSettledQuery] = useState('');
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef<HTMLInputElement | null>(null);

    // 搜索框收起：失焦 + 让主进程把窗口挂回壁纸层。
    const closeSearch = useCallback(() => {
        // 收起的同时把过滤也撤掉：画面还给完整的 275 张海报墙，而不是一直停在搜索结果上。
        setSearchOpen(false);
        setQuery('');
        setSettledQuery('');
        searchInputRef.current?.blur();
        void window.electron?.exitSearchMode?.();
    }, []);

    // 只有按回车（或点「搜」）才真正过滤：输入过程中墙面不动，不会一边打字一边跳。
    // 搜出结果后 2 秒自动收起，把画面还给海报墙。
    const runSearch = useCallback(() => {
        setSettledQuery(query.trim().toLowerCase());
    }, [query]);

    const filteredQueue = useMemo(() => (
        settledQuery ? queue.filter(song => searchKeyOf(song).includes(settledQuery)) : queue
    ), [queue, settledQuery]);

    const queueTiles = useMemo(() => buildLatticeTiles({ queue: filteredQueue, currentSong }), [currentSong, filteredQueue]);
    const tiles = isExplore ? explore.tiles : queueTiles;
    // The tile whose collection page the wall was left for, when this is the way back from that
    // page: the wall opens on it. Read once and let go of, so that no later opening starts there.
    // Let go of again when the view comes back to a wall that is still up: Back, pressed while
    // the wall leaves for the page, calls this same wall back, and nothing mounts to read the tile.
    const [startTileId] = useState(() => useAppViewStore.getState().latticeReturnTileId);
    useEffect(() => {
        useAppViewStore.getState().setLatticeReturnTileId(null);
        return useAppViewStore.subscribe((state, before) => {
            if (state.view === 'lattice' && before.view !== 'lattice') state.setLatticeReturnTileId(null);
        });
    }, []);
    const isReturn = startTileId !== null;
    // The cover of a collection's tile flies to the tile's page, and back from it
    // (the grid's morph, wallFlight.ts), unless motion is reduced for that flight or for the wall.
    // 递进墙面的“返回”回调：这里没有别的页面可回，所以它是空的。
    const ignoreBack = useCallback(() => undefined, []);
    const reducedMotion = useReducedMotionFor('lattice');
    const coverFlies = !useReducedMotionFor('collectionMorph') && !reducedMotion;
    // Come back to with a flight armed, the wall has the page under it and fades in over it.
    // With none armed nothing is under the wall, which may be the bare window (the app's
    // background can be see-through): it is put up at once. (wallLayer.ts asks the same, to keep
    // the visualizer under a wall that fades in until that wall covers it.)
    const [fadesIn] = useState(() => isReturn && isFlightBackArmed());
    const handoffSession = useWallHandoffStore(state => state.session);
    const handoffRole = resolveWallHandoffRole(handoffSession, 'lattice');
    const handoffPhase = handoffSession?.phase;
    const handoffFlip = handoffSession?.mode === 'flip';
    // 墙面底色：进来时整段不画（资料库墙在下面），离开时开翻起不画（下面的资料库墙已经画好）。
    const surfaceOff = handoffFlip && (handoffRole === 'in' || handoffPhase !== 'waiting');
    // 颗粒与暗角：进来的 closing 里交给下面的资料库墙（两份叠着会压暗两遍），开翻起由这层画；离开时一直由这层画，
    // 只有下面是透光档（没有颗粒）时颗粒在开翻后淡掉。
    const overlaysOff = handoffFlip && handoffRole === 'in' && handoffPhase === 'closing';
    const grainOff = overlaysOff || (handoffFlip && handoffRole === 'out' && handoffPhase !== 'waiting' && handoffSession?.seeThrough === true);

    // 定位正在播放的那首：原来右下角有个准星按钮，现在改成按 F（墙上没有输入框，单键够用）。
    useEffect(() => {
        const handleLocateKey = (event: KeyboardEvent) => {
            if (event.defaultPrevented
                || isTextEntryTarget(event.target)
                || event.repeat
                || event.key.toLowerCase() !== 'f'
                || isPrimaryModifierPressed(event)
                || isSecondaryModifierPressed(event)
                || event.altKey
                || event.shiftKey
            ) return;

            event.preventDefault();
            locatePlayingSongOnWall();
        };

        window.addEventListener('keydown', handleLocateKey);
        return () => window.removeEventListener('keydown', handleLocateKey);
    }, []);


    // 壁纸模式下窗口是 WorkerW 的子窗口，拿不到 WM_CHAR：先让主进程解挂成顶级窗口再聚焦。
    const openSearchPanel = useCallback(async () => {
        await window.electron?.enterSearchMode?.();
        setSearchOpen(true);
        const focusInput = (attempt: number) => {
            const el = searchInputRef.current;
            if (!el) return;
            el.focus();
            if (document.activeElement === el) {
                el.select();
                return;
            }
            if (attempt < 8) {
                window.setTimeout(() => focusInput(attempt + 1), 60);
            }
        };
        requestAnimationFrame(() => focusInput(0));
    }, []);

    // 主进程全局快捷键 Ctrl+Alt+F 唤起搜索（壁纸窗口平时没有键盘焦点，/ 收不到）
    useEffect(() => {
        const off = window.electron?.onOpenSearch?.(() => { void openSearchPanel(); });
        return () => off?.();
    }, [openSearchPanel]);

    // 唤起搜索：/ 或 Ctrl+F。墙面上的单键都有主了（F=定位、S=命令面板），这里不抢。
    useEffect(() => {
        const openSearch = (event: KeyboardEvent) => {
            if (isTextEntryTarget(event.target) || event.repeat) return;
            const isSlash = event.key === '/';
            const isFindShortcut = event.key.toLowerCase() === 'f'
                && isPrimaryModifierPressed(event)
                && !isSecondaryModifierPressed(event)
                && !event.altKey
                && !event.shiftKey;
            if (!isSlash && !isFindShortcut) return;
            event.preventDefault();
            void openSearchPanel();
        };
        window.addEventListener('keydown', openSearch);
        return () => window.removeEventListener('keydown', openSearch);
    }, []);

    // 播放之后搜索框才消失（并把过滤撤掉回到全墙）。
    useEffect(() => {
        if (searchOpen && playerState === PlayerState.PLAYING) {
            closeSearch();
        }
    }, [closeSearch, playerState, searchOpen]);

    // The card's own action. A song is played: within the queue there is on the queue wall,
    // with the songs of its section on the explore wall, as the explore page plays it. A
    // collection's page is opened; the wall is taken down meanwhile, and Back opens it on
    // this tile again. The tile, which is the grown one, is the card whose cover flies to
    // the page: captured, and the page's plan made, before the navigation (wallFlight.ts).
    // A wall that has been left stays on the screen, and can be pressed, while it leaves:
    // a press then (Open pressed twice, Enter held down) opens no page and plays no song.
    const playTile = (tile: LatticeTile) => {
        const appView = useAppViewStore.getState();
        if (appView.view !== 'lattice') return;
        if (tile.kind === 'song') {
            onPlaySong(tile.song, tile.queue ?? queue, isRadio && isFm);
            return;
        }
        beginWallTrip('open');
        planPageFromWall(coverFlies);
        appView.setLatticeReturnTileId(tile.id);
        appView.setIsLatticeLeftForPage(true);
        onOpenCollection?.(tile.collection);
    };

    // App rebuilds these on every render of its own, and the wall hands them to every poster on
    // screen. Given a permanent identity here they stop being a reason for those posters to render.
    const wall = useStableCallbacks({
        onPlay: playTile,
        // #834 a double click on a poster: the tile's own action, as the play button on the poster
        // does it, except that the song playing is resumed when paused and never paused.
        onPlayFromWall: (tile: LatticeTile) => {
            if (tile.kind === 'song' && tile.section === 'now' && canTogglePlayback) {
                if (playerState !== PlayerState.PLAYING) onTogglePlayback();
                return;
            }
            playTile(tile);
        },
        onTogglePlayback,
        onSeek,
        onOpenPlayer,
    });

    // Recomputed only when transport state actually moves, so the expanded chrome is the only
    // subscriber that re-renders on a pause, a resume or a duration update.
    const transport = useMemo<LatticeTransport>(
        () => ({ currentSong, playerState, currentTime, playbackDuration, canTogglePlayback }),
        [canTogglePlayback, currentSong, currentTime, playbackDuration, playerState],
    );

    return (
        <LatticeTransportContext.Provider value={transport}>
        <LatticePlaybackProvider actions={controls} currentSong={currentSong} queue={queue} lyrics={lyrics}
            currentTime={currentTime} lyricCurrentTime={lyricCurrentTime} duration={playbackDuration} onSeek={onSeek} isDaylight={isDaylight}>
        <LatticeLyricsProvider source={lyricSource} songKey={currentSong ? getPlaybackSongKey(currentSong) : ''}
            keywordColoringEnabled={lyricKeywordColoringEnabled}>
        <section
            className={`lattice-root lattice-queue-root ${isDaylight ? 'is-daylight' : ''} ${vignette ? 'has-vignette' : ''} ${lightsOn ? '' : 'is-lights-out'} ${posterTintEnabled ? 'has-poster-tint' : ''} ${posterTintUseCustomColor ? 'uses-custom-poster-tint' : ''} ${badgeCurrentOnly ? 'has-badge-current-only' : ''} ${surfaceOff ? 'is-handoff-surface-off' : ''} ${fadesIn && !reducedMotion ? 'is-returning' : ''} ${isRadio ? 'is-radio' : ''}`}
            data-wall-handoff={handoffRole ?? undefined}
            data-wall-handoff-phase={handoffPhase}
            data-wall-handoff-mode={handoffSession?.mode}
            data-wall-handoff-see-through={handoffSession?.seeThrough || undefined}
            data-wall-handoff-vignette={overlaysOff ? 'off' : undefined}
            data-wall-handoff-grain={grainOff ? 'off' : undefined}
            style={{
                '--lattice-poster-tint-color': posterTintColor,
                '--lattice-poster-tint-intensity': posterTintIntensity,
            } as CSSProperties}
            aria-label={t(isExplore ? 'home.latticeExplore' : isRadio ? (isFm ? 'home.latticeRadioLabel' : 'home.latticeRadioQueueLabel') : 'home.latticeLabel')}
            {...{ [LATTICE_WALL_ATTR]: '' }}
        >
            {isRadio ? (
                <RadioWall
                    tiles={queueTiles}
                    isFm={isFm}
                    // Personal FM's next songs are the radio's to reveal; a plain queue's only when the setting asks.
                    hidesUpcoming={isFm || radioHidesUpcoming}
                    // List loop: the cards after the last song go on from the head of the queue, as playback does.
                    wrapsAround={!isFm && controls.loopMode === 'all'}
                    onPlay={wall.onPlay}
                    onPlayFromWall={wall.onPlayFromWall}
                    onTogglePlayback={wall.onTogglePlayback}
                    onSeek={wall.onSeek}
                    onOpenPlayer={wall.onOpenPlayer}
                    onBack={ignoreBack}
                />
            ) : <PosterWall
                key={settledQuery}
                tiles={tiles}
                sections={isExplore ? explore.sections : undefined}
                startTileId={startTileId}
                currentSong={currentSong}
                onPlay={wall.onPlay}
                onPlayFromWall={wall.onPlayFromWall}
                onTogglePlayback={wall.onTogglePlayback}
                onSeek={wall.onSeek}
                onOpenPlayer={wall.onOpenPlayer}
                onBack={ignoreBack}
            />}
            {!isRadio && searchOpen && (
                <div className="lattice-search is-open">
                    <input
                        ref={searchInputRef}
                        className="lattice-search-input"
                        autoFocus
                        value={query}
                        placeholder="搜索歌名 / 歌手 / 专辑"
                        spellCheck={false}
                        onFocus={() => setSearchOpen(true)}
                        onChange={event => setQuery(event.target.value)}
                        onKeyDown={event => {
                            // 输入 f / s / 方向键时，绝不让墙面跟着动。
                            event.stopPropagation();
                            if (event.key === 'Escape') {
                                event.preventDefault();
                                if (query || settledQuery) {
                                    setQuery('');
                                    setSettledQuery('');
                                } else {
                                    closeSearch();
                                }
                                return;
                            }
                            if (event.key === 'Enter') {
                                event.preventDefault();
                                runSearch();
                            }
                        }}
                    />
                    <button
                        type="button"
                        className="lattice-search-go"
                        aria-label="搜索"
                        onClick={runSearch}
                    >搜</button>
                    {query ? (
                        <button
                            type="button"
                            className="lattice-search-clear"
                            aria-label="清空搜索"
                            onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}
                        >×</button>
                    ) : (
                        <span className="lattice-search-key">Ctrl+F</span>
                    )}
                </div>
            )}
            <WallTripLog isReturn={isReturn} />
            {/* The explore page's own control, beside the way back: other entries take the tiles' places. */}
            {isExplore && (
                // A press with the mouse leaves the focus where it is: the wall's arrow keys and Escape
                // are handled on .lattice-field, and reach it only while the focus is inside it. From
                // the keyboard the button is reached and pressed as any other, and holds the focus
                // then: so `aria-disabled` and not `disabled` (a disabled button cannot hold the focus).
                <button type="button" className="lattice-back lattice-refresh" aria-disabled={!explore.canRefresh}
                    onMouseDown={event => event.preventDefault()}
                    onClick={() => { if (explore.canRefresh) explore.refresh(); }}
                    aria-label={t('home.exploreRefresh')} title={t('home.exploreRefresh')}>
                    <RefreshCw size={18} className={explore.isRefreshing ? 'animate-spin' : ''} />
                </button>
            )}
            {tiles.length === 0 && (isExplore ? explore.emptyText && (
                <div className="lattice-empty">
                    <strong>{t(explore.emptyText)}</strong>
                </div>
            ) : (
                <div className="lattice-empty">
                    <strong>{t('home.latticeEmptyTitle')}</strong>
                    <span>{t('home.latticeEmptyText')}</span>
                </div>
            ))}
        </section>
        </LatticeLyricsProvider>
        </LatticePlaybackProvider>
        </LatticeTransportContext.Provider>
    );
}
