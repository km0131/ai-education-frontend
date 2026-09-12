'use client';

import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { TerminalPane, ConnectionPhase, TerminalHandle } from './TerminalPane';
import { Icon } from './Icon';

interface TerminalsPaneProps {
    classId: string;
    // アクティブなタブの接続状態だけをWorkspaceLayoutの上部ヘッダーへ伝える
    // (複数タブ全部の状態を上に出しても意味が薄いため、「今見ているタブ」の
    // 状態だけを反映する)。
    onActivePhaseChange?: (phase: ConnectionPhase) => void;
}

// 「実行」ボタン(EditorPane/WorkspaceLayout)がこのターミナル群へコマンドを
// 送るための命令的API。
export interface TerminalsHandle {
    // 今アクティブなタブへコマンドを送る。タブが1つも無ければ新規に1つ
    // 作成し、それがmountされ次第(まだ接続前でもキューイングされる、
    // TerminalPane.runCommand参照)送信する。
    runInActiveTerminal: (command: string) => void;
}

// idがそのまま表示番号(「ターミナル N」のN)を兼ねる。実際のターミナル
// マルチプレクサ(tmux等)と同じく、閉じた番号は次に開いた時に再利用する
// (後述のnextAvailableId) - モジュールスコープのカウンタを使い続けると
// 開閉を繰り返すだけで番号が際限なく増え続けてしまうため(実際に報告された
// 不具合)。
interface TerminalTab {
    id: number;
}

const PHASE_DOT: Record<ConnectionPhase, string> = {
    connecting: 'bg-[#cca700] animate-pulse',
    open: 'bg-[#6a9955]',
    closed: 'bg-[#8a8a8a]',
    error: 'bg-[#f44747]',
};

// 現在開いているタブの番号を避けた、最小の未使用番号を返す(1,2,3,...の
// 空いている枠に詰める)。ワークスペースを開き直すたびにtabsは空から始まる
// ので、モジュールレベルの状態を一切持たなくても自然に1から数え直される。
function nextAvailableId(tabs: TerminalTab[]): number {
    const used = new Set(tabs.map((t) => t.id));
    let id = 1;
    while (used.has(id)) id++;
    return id;
}

// 1タブ分の本体。onPhaseChange(親から渡された、tab.idに紐づくコールバック)
// をuseCallbackで包んでTerminalPaneへ渡すことで、親(TerminalsPane)が
// 再レンダーされてもこのコンポーネントインスタンス自身が同じidを持つ限り
// 同一の関数参照を保つ - これが無いと、TerminalPaneの
// `useEffect(() => onPhaseChange?.(phase), [phase, onPhaseChange])`が
// 「onPhaseChangeの参照が毎回変わる」せいで親の再レンダーごとに発火し続け、
// 無限ループ(Maximum update depth exceeded)になる。
//
// タブが閉じられる(tabsから取り除かれる)と、このコンポーネント自体が
// アンマウントされ、中のTerminalPaneのクリーンアップ(WebSocketのclose)が
// 実行される - それによりバックエンド側もexecセッションを終了する
// (relayShellの読み取りループがエラーで終わりsession.Close()が呼ばれる、
// shell_handler.go参照)。エディターを閉じる場合も同様で、WorkspaceLayout
// がisOpen=falseでnullを返すとこのツリーごとアンマウントされるため、
// 開いていた全タブが同じ経路で片付く。
const TerminalTabBody = React.forwardRef<
    TerminalHandle,
    {
        id: number;
        classId: string;
        active: boolean;
        onPhaseChange: (id: number, phase: ConnectionPhase) => void;
    }
>(function TerminalTabBody({ id, classId, active, onPhaseChange }, terminalRef) {
    const handlePhaseChange = useCallback((phase: ConnectionPhase) => onPhaseChange(id, phase), [id, onPhaseChange]);
    return (
        <div className={active ? 'h-full' : 'hidden'}>
            <TerminalPane ref={terminalRef} classId={classId} onPhaseChange={handlePhaseChange} />
        </div>
    );
});

// 実際のターミナルアプリ(iTerm/VS Code等)のような複数タブ管理。各タブは
// 独立したdocker execセッションを持つ(バックエンドは1接続=1セッションで、
// 同時接続数の制限はない - shell_handler.go/ticket_service.go参照。チケット
// 発行もWebSocket接続も特に「1コンテナにつき1本まで」という制約がない)。
//
// 非アクティブなタブもDOMごとアンマウントせず`hidden`で隠すだけにする
// (EditorPaneの編集/プレビュー切り替えと同じ手法) - こうしないとタブを
// 切り替えるたびにWebSocket接続とシェルの状態(カレントディレクトリ、
// 実行中プロセス、コマンド履歴)が失われてしまい、「タブ」として機能しない。
export const TerminalsPane = forwardRef<TerminalsHandle, TerminalsPaneProps>(function TerminalsPane(
    { classId, onActivePhaseChange },
    handleRef,
) {
    const [tabs, setTabs] = useState<TerminalTab[]>(() => [{ id: 1 }]);
    const [activeId, setActiveId] = useState<number | null>(1);
    const [phases, setPhases] = useState<Record<number, ConnectionPhase>>({});
    // 各タブのTerminalHandle(実行コマンド送信用)。Map自体はrefで持ち、
    // 再レンダーのたびに作り直さない。
    const terminalHandles = useRef(new Map<number, TerminalHandle>());
    // 「アクティブなタブが無かったので新規作成した」直後、そのタブがmount
    // されてterminalHandlesに登録されるまで実行を保留しておく場所。
    const pendingRunRef = useRef<{ id: number; command: string } | null>(null);

    // handlePhaseChange自体の参照を常に安定させるため(refに逃がして)最新の
    // activeId/onActivePhaseChangeを読む。こうしないとactiveIdが変わるたびに
    // handlePhaseChangeの参照も変わり、上のTerminalTabBodyのuseCallbackが
    // 依存する[onPhaseChange]経由で結局同じ無限ループを引き起こしてしまう。
    const activeIdRef = useRef(activeId);
    useEffect(() => {
        activeIdRef.current = activeId;
    }, [activeId]);
    const onActivePhaseChangeRef = useRef(onActivePhaseChange);
    useEffect(() => {
        onActivePhaseChangeRef.current = onActivePhaseChange;
    }, [onActivePhaseChange]);

    const handlePhaseChange = useCallback((id: number, phase: ConnectionPhase) => {
        setPhases((prev) => (prev[id] === phase ? prev : { ...prev, [id]: phase }));
        if (id === activeIdRef.current) onActivePhaseChangeRef.current?.(phase);
    }, []);

    const handleActivate = (id: number) => {
        setActiveId(id);
        onActivePhaseChange?.(phases[id] ?? 'connecting');
    };

    const handleAdd = () => {
        const id = nextAvailableId(tabs);
        setTabs((prev) => [...prev, { id }]);
        handleActivate(id);
    };

    // タブを閉じる: tabsから取り除く(→TerminalTabBodyがアンマウントされ、
    // WebSocket/execセッションが実際に終了する)。番号(id)はここで完全に
    // 手放され、次にhandleAddが呼ばれた時点でnextAvailableIdが再び拾える
    // ようになる - 閉じた分だけ番号が永遠に増え続けることはない。
    const handleClose = (id: number) => {
        const idx = tabs.findIndex((t) => t.id === id);
        const next = tabs.filter((t) => t.id !== id);
        setTabs(next);
        terminalHandles.current.delete(id);
        setPhases((prev) => {
            if (!(id in prev)) return prev;
            const rest = { ...prev };
            delete rest[id];
            return rest;
        });
        if (id === activeId) {
            const fallback = next[idx] ?? next[idx - 1] ?? null;
            setActiveId(fallback?.id ?? null);
            onActivePhaseChange?.(fallback ? phases[fallback.id] ?? 'connecting' : 'closed');
        }
    };

    useImperativeHandle(
        handleRef,
        () => ({
            runInActiveTerminal: (command: string) => {
                if (activeIdRef.current !== null) {
                    const handle = terminalHandles.current.get(activeIdRef.current);
                    if (handle) {
                        handle.runCommand(command);
                        return;
                    }
                }
                // アクティブなタブが無い(全て閉じられている) - 新規に1つ作り、
                // mount完了(下のuseEffect)を待ってから送信する。
                const id = nextAvailableId(tabs);
                pendingRunRef.current = { id, command };
                setTabs((prev) => [...prev, { id }]);
                setActiveId(id);
            },
        }),
        [tabs],
    );

    // 新規作成したタブがmountされ、TerminalHandleがterminalHandlesに登録
    // された直後にpendingRunRef分を実行する(タブが増えるたびにチェックする
    // だけの軽い処理)。
    useEffect(() => {
        const pending = pendingRunRef.current;
        if (!pending) return;
        const handle = terminalHandles.current.get(pending.id);
        if (handle) {
            handle.runCommand(pending.command);
            pendingRunRef.current = null;
        }
    }, [tabs]);

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#181818]">
            {/* タブバー */}
            <div className="flex items-stretch bg-[#252526] border-b border-[#3c3c3c] shrink-0 overflow-x-auto">
                {tabs.map((tab) => {
                    const phase = phases[tab.id] ?? 'connecting';
                    const isActive = tab.id === activeId;
                    return (
                        <div
                            key={tab.id}
                            role="button"
                            tabIndex={0}
                            onClick={() => handleActivate(tab.id)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') handleActivate(tab.id);
                            }}
                            className={`group flex items-center gap-2 px-3 py-1.5 text-xs shrink-0 border-r border-[#3c3c3c] cursor-pointer transition-colors ${
                                isActive ? 'bg-[#181818] text-white' : 'text-[#a0a0a0] hover:bg-[#2a2d2e]'
                            }`}
                        >
                            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${PHASE_DOT[phase]}`} />
                            <Icon name="terminal" />
                            <span className="whitespace-nowrap">ターミナル {tab.id}</span>
                            <button
                                type="button"
                                title="ターミナルを閉じる"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleClose(tab.id);
                                }}
                                className="ml-1 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-[#4a4a4a] transition-opacity"
                            >
                                <Icon name="close" />
                            </button>
                        </div>
                    );
                })}
                <button
                    onClick={handleAdd}
                    title="新しいターミナル"
                    className="flex items-center justify-center px-2.5 shrink-0 text-[#a0a0a0] hover:bg-[#2a2d2e] hover:text-white transition-colors"
                >
                    <Icon name="add" />
                </button>
            </div>

            {/* ターミナル本体。非アクティブなタブもマウントしたまま隠す */}
            <div className="flex-1 min-h-0 relative">
                {tabs.map((tab) => (
                    <TerminalTabBody
                        key={tab.id}
                        ref={(handle) => {
                            if (handle) terminalHandles.current.set(tab.id, handle);
                            else terminalHandles.current.delete(tab.id);
                        }}
                        id={tab.id}
                        classId={classId}
                        active={tab.id === activeId}
                        onPhaseChange={handlePhaseChange}
                    />
                ))}
                {tabs.length === 0 && (
                    <div className="h-full flex flex-col items-center justify-center gap-2 text-sm text-[#8a8a8a]">
                        <span>ターミナルが開かれていません</span>
                        <button
                            onClick={handleAdd}
                            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[#0e639c] hover:bg-[#1177bb] transition-colors"
                        >
                            <Icon name="add" /> 新しいターミナル
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
});
