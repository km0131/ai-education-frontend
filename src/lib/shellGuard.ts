// クライアント側の「危険コマンド」事前警告(タスク指示書 §2 タスク1)。
//
// これはあくまでUI上の親切なヒントであり、セキュリティ境界ではない -
// 実際の防護はバックエンド(gVisor / seccomp / CapDrop: ALL / cgroups /
// ディスククォータ)が担っており、ここでの判定結果に関わらずキー入力は
// そのままサーバーへ転送される(入力を遮断すると、矢印キーでの履歴移動や
// Ctrl+C、tab補完等シェルの通常操作が壊れてしまうため)。
//
// 行バッファはあくまでベストエフォートの近似: xterm.onData()で受け取る
// 生のキーストロークから「今のところ入力されているであろう1行」を推測する
// だけで、カーソル移動(Home/End)やタブ補完展開など、サーバー側readlineの
// 実際の編集結果を完全には追跡できない。ここでの誤検知・見逃しは実害がない
// (最終的な可否は必ずサーバー側の保護機能が判定するため)。

const DANGEROUS_COMMAND_TESTS: ((cmd: string) => boolean)[] = [
    // システム変更/特権コマンド
    (cmd) => /(^|\s)(mount|umount|reboot|shutdown|insmod|modprobe|iptables|systemctl|service)(\s|$)/.test(cmd),
    // 破壊的ファイル操作: rm -rf / (オプションの並び順・rf/fr等の揺れを軽く許容)
    (cmd) => /rm\s+-[a-z]*r[a-z]*f[a-z]*\s+\/(\s|\*|$)/.test(cmd) || cmd.includes('rm -rf /') || cmd.includes('rm -rf /*'),
    (cmd) => cmd.includes('dd if='),
    // プロセス/デバッグ系
    (cmd) => /(^|\s)(ptrace|gdb)(\s|$)/.test(cmd),
    // Fork bomb
    (cmd) => cmd.includes(':(){'),
];

export function isDangerousCommand(rawCmd: string): boolean {
    const cmd = rawCmd.trim();
    if (!cmd) return false;
    return DANGEROUS_COMMAND_TESTS.some((test) => test(cmd));
}

const ANSI_YELLOW = '\x1b[33m';
const ANSI_BOLD = '\x1b[1m';
const ANSI_RESET = '\x1b[0m';

// buildDangerCommandWarning はタスク指示書 §2 タスク1-3の表示フォーマットに
// 準拠した警告テキストを返す(xterm.jsへそのままterm.write()できる形)。
export function buildDangerCommandWarning(cmd: string): string {
    return (
        `\r\n${ANSI_BOLD}${ANSI_YELLOW}⚠️  [セキュリティガイド]: このコマンドはシステム設定の変更や保護領域への操作を検知しました。${ANSI_RESET}\r\n` +
        `${ANSI_YELLOW}   ▶ 実行しようとしたコマンド: \`${cmd}\`${ANSI_RESET}\r\n` +
        `${ANSI_YELLOW}   (保護機能によりブロックされるか、サンドボックス内のみに影響が限定されます)${ANSI_RESET}\r\n`
    );
}

export interface LineBufferUpdate {
    next: string;
    completedLines: string[];
}

// updateLineBuffer は、直前までの行バッファ(current)に、今回xterm.onData()で
// 届いた生データ(data)を反映し、Enter/改行で確定した行(completedLines)を返す。
// 矢印キー等のエスケープシーケンス(ESCで始まるチャンク)はまとめて無視する
// (履歴移動等をそのまま文字として溜め込んでしまうのを避けるため)。
export function updateLineBuffer(current: string, data: string): LineBufferUpdate {
    if (data.startsWith('\x1b')) {
        return { next: current, completedLines: [] };
    }

    let buf = current;
    const completedLines: string[] = [];

    for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
            completedLines.push(buf);
            buf = '';
        } else if (ch === '\x7f' || ch === '\b') {
            buf = buf.slice(0, -1);
        } else if (ch === '\x03' || ch === '\x15') {
            // Ctrl+C(中断) / Ctrl+U(行クリア)
            buf = '';
        } else if (ch >= ' ') {
            buf += ch;
        }
        // その他の制御文字(Tab等)はバッファに反映しない
    }

    return { next: buf, completedLines };
}
