'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import { securedFetch } from '@/src/lib/api';
import { Icon } from './Icon';
import { ConfirmModal, ConfirmModalState } from './ConfirmModal';
import { pushToast } from './Toast';

interface SqlSandboxViewerProps {
    classId: string;
    onClose?: () => void;
}

type DBType = 'sqlite' | 'postgres' | 'mysql';

interface QueryResult {
    columns: string[];
    rows: Record<string, unknown>[];
    error?: string | null;
}

// PRAGMA table_info(...)の1行(SQLite標準) - 行(Row)追加/削除ボタンで
// どの列が主キー(pk > 0、複合PKの場合は1始まりの並び順)か、どの列が
// NOT NULLかを知るために使う(テーブル/行操作ボタンの作業指示書)。
interface ColumnInfo {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: unknown;
    pk: number;
}

interface ColumnDraft {
    name: string;
    type: string;
    isPrimaryKey: boolean;
    isNotNull: boolean;
}

const DEFAULT_DB_TARGET = '/root/workspace/app.db';
const SQLITE_COLUMN_TYPES = ['INTEGER', 'TEXT', 'VARCHAR', 'REAL', 'BLOB', 'NUMERIC'];

const TABLE_LIST_QUERY =
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';";

// 「SELECT * FROM "table" [LIMIT n];」形式かどうかを判定し、テーブル名を
// 取り出す。テーブル一覧のクリックで発行するクエリとまったく同じ形なので、
// これに一致する間だけ「今表示しているのは特定の1テーブルの全件」とみなし、
// 行の追加・削除ボタン付きグリッドを出す(自由なJOIN/集計クエリの結果には
// 行追加・削除の概念が意味を持たないため)。
function extractSimpleTableSelect(query: string): string | null {
    const m = query.trim().match(/^SELECT\s+\*\s+FROM\s+"?([A-Za-z0-9_]+)"?\s*(?:LIMIT\s+\d+)?\s*;?\s*$/i);
    return m ? m[1] : null;
}

// SQL文字列リテラルとして安全な形に変換する(このAPIはパラメータ化クエリ
// ではなく生SQL文字列を送る設計のため、シングルクォートを二重化して
// エスケープする)。数値らしい入力はクォートせずそのまま数値として渡す
// (型カラムへ文字列として渡ってしまうのを避ける)。"NULL"(大小文字問わず)
// と入力した場合はSQLのNULLリテラルそのものとして扱う(GUIツールでよくある
// 慣習)。
function sqlLiteral(raw: string): string {
    const trimmed = raw.trim();
    if (/^null$/i.test(trimmed)) return 'NULL';
    if (/^-?\d+(\.\d+)?$/.test(trimmed)) return trimmed;
    return `'${trimmed.replace(/'/g, "''")}'`;
}

// INSERT INTO "table" (col1, col2) VALUES (...) を組み立てる。空欄のセルは
// カラムごと省略する - INTEGER PRIMARY KEYのようなauto increment列を
// 省略可能にする要件を、特別扱いせずこの1ルールだけで満たす(省略された
// 列はSQLite側のDEFAULT/自動採番に任せる。NOT NULL列を空欄のまま省略すれば
// NOT NULL制約違反として素直にエラーになる、というのも検証要件通りの挙動)。
function buildInsertSQL(table: string, columns: string[], row: Record<string, string>): string | null {
    const cols: string[] = [];
    const vals: string[] = [];
    for (const col of columns) {
        const raw = row[col] ?? '';
        if (raw.trim() === '') continue;
        cols.push(`"${col}"`);
        vals.push(sqlLiteral(raw));
    }
    if (cols.length === 0) return null;
    return `INSERT INTO "${table}" (${cols.join(', ')}) VALUES (${vals.join(', ')});`;
}

// DELETE FROM "table" WHERE "pk1" = ... [AND "pk2" = ...] を組み立てる
// (複合主キーにも対応、PRAGMA table_infoのpk列の並び順どおり)。
// 行を一意に特定するWHERE句("pk1" = ... [AND "pk2" = ...])を組み立てる
// (複合主キーにも対応、PRAGMA table_infoのpk列の並び順どおり)。DELETE・
// インライン編集のUPDATEの両方から共通で使う。
function buildPkWhereClause(pkColumns: string[], row: Record<string, unknown>): string {
    return pkColumns
        .map((col) => {
            const value = row[col];
            if (value === null || value === undefined) return `"${col}" IS NULL`;
            return `"${col}" = ${sqlLiteral(String(value))}`;
        })
        .join(' AND ');
}

function buildDeleteSQL(table: string, pkColumns: string[], row: Record<string, unknown>): string {
    return `DELETE FROM "${table}" WHERE ${buildPkWhereClause(pkColumns, row)};`;
}

// UPDATE "table" SET "col" = '新しい値' WHERE "pk" = ...; を組み立てる
// (セルのインライン編集機能)。
function buildUpdateSQL(table: string, pkColumns: string[], row: Record<string, unknown>, col: string, newValue: string): string {
    return `UPDATE "${table}" SET "${col}" = ${sqlLiteral(newValue)} WHERE ${buildPkWhereClause(pkColumns, row)};`;
}

// CREATE TABLE "table" ("col1" TYPE PRIMARY KEY, "col2" TYPE NOT NULL, ...) を
// 組み立てる。主キーに指定された列が2つ以上ある場合は、列ごとのインライン
// PRIMARY KEYではなく末尾のテーブル制約(PRIMARY KEY (colA, colB))にする
// (SQLiteの複合主キーの書き方)。
function buildCreateTableSQL(tableName: string, columns: ColumnDraft[]): string {
    const pkCols = columns.filter((c) => c.isPrimaryKey).map((c) => c.name);
    const defs = columns.map((c) => {
        let def = `"${c.name}" ${c.type}`;
        if (pkCols.length === 1 && c.isPrimaryKey) def += ' PRIMARY KEY';
        if (c.isNotNull) def += ' NOT NULL';
        return def;
    });
    let sql = `CREATE TABLE "${tableName}" (\n  ${defs.join(',\n  ')}`;
    if (pkCols.length > 1) {
        sql += `,\n  PRIMARY KEY (${pkCols.map((c) => `"${c}"`).join(', ')})`;
    }
    sql += '\n);';
    return sql;
}

// サンドボックス内DBの閲覧・SQL実行パネル(マルチDB対応SQL実行&閲覧UI /
// データ行・テーブル構造のボタン操作 作業指示書)。バックエンドは現状SQLite
// のみ対応(internal/handler/sql_handler.goのコメント参照 - sandbox-netの
// 分離設計上、backendから直接Postgres/MySQLへ接続することがそもそも技術的
// に成立しないため、Postgres/MySQLは見送り)。db_type選択自体はUIとして
// 残しているが、sqlite以外は選べないようにしておく。
//
// 行・テーブルの追加/削除はすべて、既存の自由なSQL実行API(POST
// /container/sql/execute)へ生成したSQL文字列を送るだけで実現している -
// バックエンド側に専用のINSERT/DELETE/CREATE/DROP用エンドポイントを新設する
// 必要はない(あのAPIは元々任意のSQLを実行できる設計のため)。
export function SqlSandboxViewer({ classId, onClose }: SqlSandboxViewerProps) {
    const [dbType] = useState<DBType>('sqlite');
    const [dbTarget, setDbTarget] = useState(DEFAULT_DB_TARGET);
    const [dbTargetInput, setDbTargetInput] = useState(DEFAULT_DB_TARGET);
    const [tables, setTables] = useState<string[]>([]);
    const [tablesError, setTablesError] = useState<string | null>(null);
    const [sqlQuery, setSqlQuery] = useState('SELECT 1;');
    const [queryResult, setQueryResult] = useState<QueryResult | null>(null);
    const [isRunning, setIsRunning] = useState(false);
    const [isLoadingTables, setIsLoadingTables] = useState(false);
    const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

    // 「テーブル一覧のこの1テーブルを丸ごと見ている」状態(extractSimpleTableSelect
    // 参照)。null なら行追加・削除UIは出さない(自由なクエリの結果には
    // 意味を持たないため)。
    const [currentTable, setCurrentTable] = useState<string | null>(null);
    const [tableSchema, setTableSchema] = useState<ColumnInfo[] | null>(null);
    const [draftRows, setDraftRows] = useState<Record<string, string>[]>([]);
    const [savingDraftIndex, setSavingDraftIndex] = useState<number | null>(null);
    const [deletingRowKey, setDeletingRowKey] = useState<string | null>(null);

    // セルのインライン編集(クリック→<input>→Enter/BlurでUPDATE、Escapeで
    // キャンセル)。editingCellがnullでない間、対象の<td>だけ表示モードから
    // 入力モードに切り替わる。skipNextBlurRefは、Escapeキーでの取り消し時に
    // input自身がblurすることで二重にUPDATEが飛んでしまうのを防ぐための
    // 一回性フラグ(handleCancelEditCellが立て、次のonBlurが1回だけ無視する)。
    const [editingCell, setEditingCell] = useState<{ rowIndex: number; col: string } | null>(null);
    const [editingValue, setEditingValue] = useState('');
    const [isSavingCell, setIsSavingCell] = useState(false);
    const skipNextBlurRef = useRef(false);

    const [isCreateTableModalOpen, setIsCreateTableModalOpen] = useState(false);

    const runQuery = useCallback(
        async (query: string, target: string): Promise<QueryResult> => {
            const res = await securedFetch('/api/v2/program/container/sql/execute', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    course_id: Number(classId),
                    db_type: dbType,
                    db_target: target,
                    query,
                }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                return { columns: [], rows: [], error: data.error || 'SQLの実行に失敗しました' };
            }
            return {
                columns: Array.isArray(data.columns) ? data.columns : [],
                rows: Array.isArray(data.rows) ? data.rows : [],
                error: data.error ?? null,
            };
        },
        [classId, dbType],
    );

    const loadTables = useCallback(
        async (target: string) => {
            setIsLoadingTables(true);
            setTablesError(null);
            try {
                const result = await runQuery(TABLE_LIST_QUERY, target);
                if (result.error) {
                    setTablesError(result.error);
                    setTables([]);
                    return;
                }
                setTables(result.rows.map((r) => String(r.name)));
            } catch (err) {
                setTablesError(err instanceof Error ? err.message : 'テーブル一覧の取得に失敗しました');
                setTables([]);
            } finally {
                setIsLoadingTables(false);
            }
        },
        [runQuery],
    );

    // 初回マウント時に既定のDBファイルのテーブル一覧を読み込む。
    useEffect(() => {
        loadTables(DEFAULT_DB_TARGET);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleRunQuery = useCallback(
        async (query: string) => {
            setIsRunning(true);
            try {
                const result = await runQuery(query, dbTarget);
                setQueryResult(result);
                setCurrentTable(result.error ? null : extractSimpleTableSelect(query));
                setDraftRows([]);
                setEditingCell(null);
            } catch (err) {
                setQueryResult({
                    columns: [],
                    rows: [],
                    error: err instanceof Error ? err.message : 'SQLの実行に失敗しました',
                });
                setCurrentTable(null);
            } finally {
                setIsRunning(false);
            }
        },
        [runQuery, dbTarget],
    );

    // currentTableが確定するたびにPRAGMA table_info(...)で主キー/NOT NULLの
    // 情報を取得する(行追加・削除ボタンの活性/非活性、INSERT/DELETE文の
    // 組み立てに使う)。
    useEffect(() => {
        if (!currentTable) {
            setTableSchema(null);
            return;
        }
        let cancelled = false;
        runQuery(`PRAGMA table_info("${currentTable}");`, dbTarget).then((result) => {
            if (cancelled) return;
            if (result.error) {
                setTableSchema([]);
                return;
            }
            setTableSchema(
                result.rows.map((r) => ({
                    cid: Number(r.cid),
                    name: String(r.name),
                    type: String(r.type),
                    notnull: Number(r.notnull),
                    dflt_value: r.dflt_value,
                    pk: Number(r.pk),
                })),
            );
        });
        return () => {
            cancelled = true;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [currentTable, dbTarget]);

    const pkColumns = (tableSchema ?? [])
        .filter((c) => c.pk > 0)
        .sort((a, b) => a.pk - b.pk)
        .map((c) => c.name);

    const handleConnect = useCallback(() => {
        const target = dbTargetInput.trim() || DEFAULT_DB_TARGET;
        setDbTarget(target);
        loadTables(target);
    }, [dbTargetInput, loadTables]);

    const handleTableClick = useCallback(
        (table: string) => {
            const query = `SELECT * FROM "${table}" LIMIT 50;`;
            setSqlQuery(query);
            handleRunQuery(query);
        },
        [handleRunQuery],
    );

    // 「ℹ️ データ形式を確認」: PRAGMA table_info(...)をそのまま通常のクエリ
    // として実行する - 結果はcid/name/type/notnull/dflt_value/pkという
    // 列を持つ普通のSELECT結果として既存のグリッドにそのまま表示される
    // (name=カラム名、type=データ型、notnull=NOT NULL制約、pk=主キー、
    // という表示項目の要件を、専用UIを新設せずこの1点で満たす)。PRAGMA結果
    // はテーブルの行データではないため、extractSimpleTableSelectには一致
    // せずcurrentTableは自動的にnullになり、行追加・削除UIは出ない。
    const handleShowSchema = useCallback(
        (table: string) => {
            const query = `PRAGMA table_info('${table}');`;
            setSqlQuery(query);
            handleRunQuery(query);
        },
        [handleRunQuery],
    );

    const handleRunClick = useCallback(() => {
        handleRunQuery(sqlQuery);
    }, [handleRunQuery, sqlQuery]);

    // 「🔄 リフレッシュ」: 今表示しているテーブルを再取得する(他の操作で
    // 変わった行データを最新化する)。currentTableが決まっている間だけ、
    // その全件SELECTをもう一度発行するだけの単純な処理 - スキーマ
    // (tableSchema)はcurrentTable自体は変わらないため再取得の対象外
    // (スキーマ変更はテーブル一覧のℹ️ボタンで別途確認できる)。
    const handleRefreshTable = useCallback(() => {
        if (!currentTable) return;
        handleRunQuery(`SELECT * FROM "${currentTable}" LIMIT 50;`);
    }, [currentTable, handleRunQuery]);

    // 「＋ 行を追加」: グリッド末尾に空の入力行(draft)を1つ足す。まだ
    // サーバーへは何も送らない(作業指示書のdraftRows仕様)。
    const handleAddDraftRow = useCallback(() => {
        if (!queryResult) return;
        const blank: Record<string, string> = {};
        for (const col of queryResult.columns) blank[col] = '';
        setDraftRows((prev) => [...prev, blank]);
    }, [queryResult]);

    const handleUpdateDraftCell = useCallback((index: number, col: string, value: string) => {
        setDraftRows((prev) => prev.map((row, i) => (i === index ? { ...row, [col]: value } : row)));
    }, []);

    const handleCancelDraftRow = useCallback((index: number) => {
        setDraftRows((prev) => prev.filter((_, i) => i !== index));
    }, []);

    // draft行の「保存」: その行だけのINSERTを発行する。成功したらdraftから
    // 外し、テーブルを再読み込みして実際に永続化されたデータを表示する。
    // 失敗した場合はdraft行をそのまま残す(直して再度保存できるように)。
    const handleSaveDraftRow = useCallback(
        async (index: number) => {
            if (!currentTable || !queryResult) return;
            const row = draftRows[index];
            const insertSQL = buildInsertSQL(currentTable, queryResult.columns, row);
            if (!insertSQL) {
                pushToast('少なくとも1つのセルに値を入力してください');
                return;
            }
            setSavingDraftIndex(index);
            try {
                const result = await runQuery(insertSQL, dbTarget);
                if (result.error) {
                    pushToast(`行の追加に失敗しました: ${result.error}`);
                    return;
                }
                setDraftRows((prev) => prev.filter((_, i) => i !== index));
                await handleRunQuery(`SELECT * FROM "${currentTable}" LIMIT 50;`);
            } catch (err) {
                pushToast(`行の追加に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
            } finally {
                setSavingDraftIndex(null);
            }
        },
        [currentTable, queryResult, draftRows, runQuery, dbTarget, handleRunQuery],
    );

    // 「ー 削除」(既存行): 確認ダイアログを挟んでからDELETEを発行する
    // (作業指示書の要件)。主キーが無いテーブルではボタン自体を出さない
    // (pkColumns参照)。
    const handleRequestDeleteRow = useCallback(
        (row: Record<string, unknown>) => {
            if (!currentTable || pkColumns.length === 0) return;
            const rowKey = pkColumns.map((c) => String(row[c])).join('/');
            setConfirmModal({
                title: '行を削除',
                message: `テーブル「${currentTable}」からこの行を削除しますか？この操作は取り消せません。`,
                confirmLabel: '削除',
                danger: true,
                onConfirm: async () => {
                    setDeletingRowKey(rowKey);
                    try {
                        const deleteSQL = buildDeleteSQL(currentTable, pkColumns, row);
                        const result = await runQuery(deleteSQL, dbTarget);
                        if (result.error) {
                            pushToast(`行の削除に失敗しました: ${result.error}`);
                            return;
                        }
                        await handleRunQuery(`SELECT * FROM "${currentTable}" LIMIT 50;`);
                    } catch (err) {
                        pushToast(`行の削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                        setDeletingRowKey(null);
                    }
                },
            });
        },
        [currentTable, pkColumns, runQuery, dbTarget, handleRunQuery],
    );

    // セルをクリックして編集モードへ入る。主キー列・BLOB列は呼び出し元
    // (SqlResultGrid)がそもそもクリックを許可しない(readOnly扱い)。
    const handleStartEditCell = useCallback((rowIndex: number, col: string, currentValue: unknown) => {
        setEditingCell({ rowIndex, col });
        setEditingValue(currentValue === null || currentValue === undefined ? '' : String(currentValue));
    }, []);

    // Escapeキー: 何も送らずに編集モードを抜けるだけ。直後に<input>自身の
    // onBlurが発火するが、それによる二重コミットをskipNextBlurRefで防ぐ。
    const handleCancelEditCell = useCallback(() => {
        skipNextBlurRef.current = true;
        setEditingCell(null);
    }, []);

    // Enter / Blur: 値が変わっていなければ何も送らずに抜ける(無駄な
    // UPDATEを避ける)。変わっていればUPDATEを発行し、成功したら表示モードへ
    // 戻してテーブルを再取得(リフレッシュしても変更が保持されていることの
    // 確認要件を、実際に再SELECTすることでそのまま満たす)、成功トースト
    // (success variant)を出す。失敗時は編集モードのまま(入力し直せるように)
    // エラートーストだけ出す。
    const handleCommitEditCell = useCallback(async () => {
        if (!editingCell || !currentTable) return;
        const row = queryResult?.rows[editingCell.rowIndex];
        if (!row) {
            setEditingCell(null);
            return;
        }
        const originalValue = row[editingCell.col];
        const originalStr = originalValue === null || originalValue === undefined ? '' : String(originalValue);
        if (editingValue === originalStr) {
            setEditingCell(null);
            return;
        }

        setIsSavingCell(true);
        try {
            const updateSQL = buildUpdateSQL(currentTable, pkColumns, row, editingCell.col, editingValue);
            const result = await runQuery(updateSQL, dbTarget);
            if (result.error) {
                pushToast(`更新に失敗しました: ${result.error}`);
                return;
            }
            setEditingCell(null);
            await handleRunQuery(`SELECT * FROM "${currentTable}" LIMIT 50;`);
            pushToast('更新完了', { variant: 'success', durationMs: 3000 });
        } catch (err) {
            pushToast(`更新に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setIsSavingCell(false);
        }
    }, [editingCell, editingValue, currentTable, queryResult, pkColumns, runQuery, dbTarget, handleRunQuery]);

    // 「ー テーブル削除」(サイドバーのゴミ箱アイコン): 確認ダイアログを
    // 挟んでからDROP TABLEを発行する。削除後はテーブル一覧を再取得し、
    // 削除したテーブルを表示中だった場合はグリッドをクリアする。
    const handleRequestDropTable = useCallback(
        (table: string) => {
            setConfirmModal({
                title: 'テーブルを削除',
                message: `テーブル「${table}」を削除しますか？中のデータも含めて完全に失われ、取り消せません。`,
                confirmLabel: 'テーブルを削除',
                danger: true,
                onConfirm: async () => {
                    try {
                        const result = await runQuery(`DROP TABLE "${table}";`, dbTarget);
                        if (result.error) {
                            pushToast(`テーブルの削除に失敗しました: ${result.error}`);
                            return;
                        }
                        if (currentTable === table) {
                            setCurrentTable(null);
                            setQueryResult(null);
                        }
                        await loadTables(dbTarget);
                    } catch (err) {
                        pushToast(`テーブルの削除に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
                    }
                },
            });
        },
        [runQuery, dbTarget, currentTable, loadTables],
    );

    const handleCreateTable = useCallback(
        async (tableName: string, columns: ColumnDraft[]) => {
            const sql = buildCreateTableSQL(tableName, columns);
            const result = await runQuery(sql, dbTarget);
            if (result.error) {
                pushToast(`テーブルの作成に失敗しました: ${result.error}`);
                return false;
            }
            await loadTables(dbTarget);
            return true;
        },
        [runQuery, dbTarget, loadTables],
    );

    return (
        <div className="flex flex-col h-full min-h-0 bg-[#1e1e1e]">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
                <Icon name="database" className="text-[#8a8a8a] shrink-0" />
                <span className="text-[11px] font-bold text-[#cccccc]">SQL ビューア</span>
                <div className="flex-1" />
                {onClose && (
                    <button
                        type="button"
                        onClick={onClose}
                        title="SQLビューアを閉じる"
                        className="shrink-0 p-1 rounded text-[#cccccc] hover:bg-[#3c3c3c] transition-colors"
                    >
                        <Icon name="close" />
                    </button>
                )}
            </div>

            <div className="flex-1 min-h-0 flex">
                {/* 左サイドバー: DB種別・接続先・テーブル一覧 */}
                <div className="w-56 shrink-0 border-r border-[#3c3c3c] flex flex-col min-h-0 bg-[#252526]">
                    <div className="p-2 flex flex-col gap-1.5 border-b border-[#3c3c3c]">
                        <label className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">DB種別</label>
                        <select
                            value={dbType}
                            disabled
                            title="現在SQLiteのみ対応しています"
                            className="w-full rounded-md bg-[#3c3c3c] text-[#cccccc] text-xs px-2 py-1 border border-[#3c3c3c] disabled:opacity-60"
                        >
                            <option value="sqlite">SQLite</option>
                            <option value="postgres">PostgreSQL(準備中)</option>
                            <option value="mysql">MySQL(準備中)</option>
                        </select>
                        <label className="text-[10px] uppercase tracking-wide text-[#8a8a8a] mt-1">
                            DBファイルパス
                        </label>
                        <input
                            value={dbTargetInput}
                            onChange={(e) => setDbTargetInput(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleConnect();
                            }}
                            placeholder={DEFAULT_DB_TARGET}
                            className="w-full rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-2 py-1 placeholder:text-[#8a8a8a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                        />
                        <button
                            type="button"
                            onClick={handleConnect}
                            disabled={isLoadingTables}
                            className="mt-1 rounded-md bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 text-white text-[11px] font-bold py-1"
                        >
                            接続 / テーブル更新
                        </button>
                    </div>

                    <div className="px-2 pt-2">
                        <button
                            type="button"
                            onClick={() => setIsCreateTableModalOpen(true)}
                            className="w-full flex items-center justify-center gap-1.5 rounded-md bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] text-[11px] font-bold py-1"
                        >
                            <Icon name="add" />＋ テーブル作成
                        </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto p-1">
                        {isLoadingTables && (
                            <div className="text-[11px] text-[#8a8a8a] px-2 py-1">読み込み中...</div>
                        )}
                        {tablesError && (
                            <div className="text-[11px] text-[#f44747] px-2 py-1 break-words">
                                <Icon name="warning" /> {tablesError}
                            </div>
                        )}
                        {!isLoadingTables && !tablesError && tables.length === 0 && (
                            <div className="text-[11px] text-[#8a8a8a] px-2 py-1">テーブルがありません</div>
                        )}
                        {tables.map((table) => (
                            <div key={table} className="flex items-center">
                                <button
                                    type="button"
                                    onClick={() => handleTableClick(table)}
                                    className={`flex-1 min-w-0 flex items-center gap-1.5 text-left px-2 py-1 rounded text-[12px] hover:bg-[#3c3c3c] transition-colors ${
                                        currentTable === table ? 'bg-[#37373d] text-white' : 'text-[#cccccc]'
                                    }`}
                                    title={`SELECT * FROM "${table}" LIMIT 50;`}
                                >
                                    <Icon name="table" className="text-[#8a8a8a] shrink-0" />
                                    <span className="truncate">{table}</span>
                                </button>
                                <button
                                    type="button"
                                    title="データ形式を確認 (PRAGMA table_info)"
                                    onClick={() => handleShowSchema(table)}
                                    className="shrink-0 px-1.5 text-[#cccccc] hover:text-white"
                                >
                                    <Icon name="info" />
                                </button>
                                <button
                                    type="button"
                                    title={`テーブル「${table}」を削除`}
                                    onClick={() => handleRequestDropTable(table)}
                                    className="shrink-0 px-1.5 text-[#cccccc] hover:text-[#f44747]"
                                >
                                    <Icon name="trash" />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 右側: SQLエディタ + 結果グリッド */}
                <div className="flex-1 min-w-0 flex flex-col min-h-0">
                    <div className="shrink-0 border-b border-[#3c3c3c]">
                        <Editor
                            height="160px"
                            defaultLanguage="sql"
                            theme="vs-dark"
                            value={sqlQuery}
                            onChange={(value) => setSqlQuery(value ?? '')}
                            options={{ minimap: { enabled: false }, fontSize: 13, scrollBeyondLastLine: false }}
                        />
                        <div className="flex items-center justify-end gap-2 px-2 py-1.5 bg-[#252526]">
                            <button
                                type="button"
                                onClick={handleRunClick}
                                disabled={isRunning || !sqlQuery.trim()}
                                className="flex items-center gap-1.5 px-3 py-1 rounded-md text-[11px] font-bold bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 text-white transition-colors"
                            >
                                <Icon name="play" />
                                {isRunning ? '実行中...' : '実行'}
                            </button>
                        </div>
                    </div>

                    {currentTable && (
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-[#252526] border-b border-[#3c3c3c] shrink-0">
                            <button
                                type="button"
                                onClick={handleAddDraftRow}
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#3c3c3c] hover:bg-[#4a4a4a] text-[#cccccc] transition-colors"
                            >
                                <Icon name="add" />＋ 行を追加
                            </button>
                            <button
                                type="button"
                                onClick={handleRefreshTable}
                                disabled={isRunning}
                                title="テーブルを再取得"
                                className="flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] font-bold bg-[#3c3c3c] hover:bg-[#4a4a4a] disabled:opacity-50 text-[#cccccc] transition-colors"
                            >
                                <Icon name="refresh" />🔄 リフレッシュ
                            </button>
                        </div>
                    )}

                    <div className="flex-1 min-h-0 overflow-auto">
                        {queryResult?.error && (
                            <div className="m-2 px-2 py-1.5 bg-[#f44747]/15 text-[#f44747] text-[12px] font-bold rounded border border-[#f44747]/40 break-words">
                                <Icon name="warning" /> {queryResult.error}
                            </div>
                        )}
                        {queryResult && !queryResult.error && (
                            <SqlResultGrid
                                result={queryResult}
                                currentTable={currentTable}
                                pkColumns={pkColumns}
                                schemaLoaded={!currentTable || tableSchema !== null}
                                draftRows={draftRows}
                                savingDraftIndex={savingDraftIndex}
                                deletingRowKey={deletingRowKey}
                                onUpdateDraftCell={handleUpdateDraftCell}
                                onCancelDraftRow={handleCancelDraftRow}
                                onSaveDraftRow={handleSaveDraftRow}
                                onDeleteRow={handleRequestDeleteRow}
                                editingCell={editingCell}
                                editingValue={editingValue}
                                isSavingCell={isSavingCell}
                                skipNextBlurRef={skipNextBlurRef}
                                onStartEditCell={handleStartEditCell}
                                onChangeEditingValue={setEditingValue}
                                onCommitEditCell={handleCommitEditCell}
                                onCancelEditCell={handleCancelEditCell}
                            />
                        )}
                        {!queryResult && (
                            <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                                クエリを実行するとここに結果が表示されます
                            </div>
                        )}
                    </div>
                </div>
            </div>

            <ConfirmModal state={confirmModal} onClose={() => setConfirmModal(null)} />
            {isCreateTableModalOpen && (
                <CreateTableModal onClose={() => setIsCreateTableModalOpen(false)} onCreate={handleCreateTable} />
            )}
        </div>
    );
}

// 取得したcolumnsに応じて動的に<th>/<td>を描画する結果グリッド。null値は
// 通常の文字列("null"等)と混同しないよう、斜体グレーの"NULL"バッジとして
// 視覚的に区別する。currentTableが設定されている(=単一テーブルの全件表示)
// 間だけ、行削除ボタン(主キーがある場合のみ)・draft行の編集セルを重ねて
// 表示する(「+ 行を追加」自体はこのグリッドの外、親コンポーネントの
// ツールバー行(SqlSandboxViewer側、[＋ 行を追加][🔄 リフレッシュ])に
// ある)。
function SqlResultGrid({
    result,
    currentTable,
    pkColumns,
    schemaLoaded,
    draftRows,
    savingDraftIndex,
    deletingRowKey,
    onUpdateDraftCell,
    onCancelDraftRow,
    onSaveDraftRow,
    onDeleteRow,
    editingCell,
    editingValue,
    isSavingCell,
    skipNextBlurRef,
    onStartEditCell,
    onChangeEditingValue,
    onCommitEditCell,
    onCancelEditCell,
}: {
    result: QueryResult;
    currentTable: string | null;
    pkColumns: string[];
    schemaLoaded: boolean;
    draftRows: Record<string, string>[];
    savingDraftIndex: number | null;
    deletingRowKey: string | null;
    onUpdateDraftCell: (index: number, col: string, value: string) => void;
    onCancelDraftRow: (index: number) => void;
    onSaveDraftRow: (index: number) => void;
    onDeleteRow: (row: Record<string, unknown>) => void;
    editingCell: { rowIndex: number; col: string } | null;
    editingValue: string;
    isSavingCell: boolean;
    skipNextBlurRef: React.MutableRefObject<boolean>;
    onStartEditCell: (rowIndex: number, col: string, currentValue: unknown) => void;
    onChangeEditingValue: (value: string) => void;
    onCommitEditCell: () => void;
    onCancelEditCell: () => void;
}) {
    // インライン編集は行削除と同じ前提(主キーで一意に特定できること)を
    // 必要とする - 主キーが無いテーブルでは安全にWHERE句を組み立てられない
    // ため、セルは常に表示専用のまま(canDeleteRowsと同じ条件を再利用)。
    const canEditRows = currentTable !== null;
    const canDeleteRows = canEditRows && schemaLoaded && pkColumns.length > 0;
    const canEditCells = canDeleteRows;

    if (result.columns.length === 0 && !canEditRows) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-[#8a8a8a]">
                {result.rows.length === 0 ? '実行しました(返却行なし)' : ''}
            </div>
        );
    }

    return (
        <div>
            <table className="w-full text-[12px] border-collapse">
                <thead className="sticky top-0 bg-[#252526] z-10">
                    <tr>
                        {canEditRows && <th className="w-7 border-b border-[#3c3c3c]" />}
                        {result.columns.map((col) => (
                            <th
                                key={col}
                                className="text-left px-2 py-1 border-b border-[#3c3c3c] text-[#cccccc] font-bold whitespace-nowrap"
                            >
                                {col}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {result.rows.map((row, i) => {
                        const rowKey = pkColumns.length > 0 ? pkColumns.map((c) => String(row[c])).join('/') : String(i);
                        const isDeleting = deletingRowKey === rowKey;
                        return (
                            <tr key={i} className={`hover:bg-[#2a2d2e] ${isDeleting ? 'opacity-40' : ''}`}>
                                {canEditRows && (
                                    <td className="border-b border-[#3c3c3c]/60 text-center">
                                        {canDeleteRows && (
                                            <button
                                                type="button"
                                                title="この行を削除"
                                                disabled={isDeleting}
                                                onClick={() => onDeleteRow(row)}
                                                className="text-[#cccccc] hover:text-[#f44747] disabled:opacity-40"
                                            >
                                                <Icon name="dash" />
                                            </button>
                                        )}
                                    </td>
                                )}
                                {result.columns.map((col) => {
                                    const isPkColumn = pkColumns.includes(col);
                                    const cellValue = row[col];
                                    const isBlobCell = typeof cellValue === 'object' && cellValue !== null;
                                    // 主キー列・BLOB列は編集不可(read-only) -
                                    // 主キーは行を一意に特定するWHERE句の
                                    // 根拠そのものなので書き換え対象から除外
                                    // する(作業指示書の要件)。
                                    const isCellEditable = canEditCells && !isPkColumn && !isBlobCell;
                                    const isEditingThisCell =
                                        editingCell !== null && editingCell.rowIndex === i && editingCell.col === col;

                                    if (isEditingThisCell) {
                                        return (
                                            <td key={col} className="px-1 py-1 border-b border-[#3c3c3c]/60">
                                                <input
                                                    autoFocus
                                                    value={editingValue}
                                                    disabled={isSavingCell}
                                                    onChange={(e) => onChangeEditingValue(e.target.value)}
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter') {
                                                            e.preventDefault();
                                                            onCommitEditCell();
                                                        } else if (e.key === 'Escape') {
                                                            e.preventDefault();
                                                            onCancelEditCell();
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (skipNextBlurRef.current) {
                                                            skipNextBlurRef.current = false;
                                                            return;
                                                        }
                                                        onCommitEditCell();
                                                    }}
                                                    placeholder="NULL"
                                                    className="w-full min-w-[80px] bg-[#3c3c3c] text-[#ffffff] text-xs px-1.5 py-0.5 rounded border border-[#007acc] focus:outline-none placeholder:text-[#8a8a8a]"
                                                />
                                            </td>
                                        );
                                    }

                                    return (
                                        <td
                                            key={col}
                                            onClick={isCellEditable ? () => onStartEditCell(i, col, cellValue) : undefined}
                                            title={isCellEditable ? 'クリックして編集' : undefined}
                                            className={`px-2 py-1 border-b border-[#3c3c3c]/60 text-[#cccccc] whitespace-nowrap ${
                                                isCellEditable ? 'cursor-text hover:bg-[#2a2d2e] hover:outline hover:outline-1 hover:outline-[#3c3c3c]' : ''
                                            }`}
                                        >
                                            {renderCellValue(cellValue)}
                                        </td>
                                    );
                                })}
                            </tr>
                        );
                    })}

                    {draftRows.map((draft, index) => (
                        <tr key={`draft-${index}`} className="bg-[#0e639c]/10">
                            <td className="border-b border-[#3c3c3c]/60 text-center">
                                <div className="flex items-center justify-center gap-1">
                                    <button
                                        type="button"
                                        title="保存"
                                        disabled={savingDraftIndex === index}
                                        onClick={() => onSaveDraftRow(index)}
                                        className="text-[#6a9955] hover:text-[#8fce6d] disabled:opacity-40"
                                    >
                                        <Icon name="check" />
                                    </button>
                                    <button
                                        type="button"
                                        title="キャンセル"
                                        disabled={savingDraftIndex === index}
                                        onClick={() => onCancelDraftRow(index)}
                                        className="text-[#cccccc] hover:text-[#f44747] disabled:opacity-40"
                                    >
                                        <Icon name="close" />
                                    </button>
                                </div>
                            </td>
                            {result.columns.map((col) => (
                                <td key={col} className="px-1 py-1 border-b border-[#3c3c3c]/60">
                                    <input
                                        value={draft[col] ?? ''}
                                        disabled={savingDraftIndex === index}
                                        onChange={(e) => onUpdateDraftCell(index, col, e.target.value)}
                                        placeholder="NULL"
                                        className="w-full min-w-[80px] bg-[#3c3c3c] text-[#ffffff] text-xs px-1.5 py-0.5 rounded border border-[#3c3c3c] focus:outline-none focus:border-[#007acc] placeholder:text-[#8a8a8a]"
                                    />
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>

            {canEditRows && schemaLoaded && pkColumns.length === 0 && (
                <div className="px-2 py-1 text-[11px] text-[#8a8a8a]">
                    主キーが無いため、行の削除はできません。
                </div>
            )}
        </div>
    );
}

function renderCellValue(value: unknown): React.ReactNode {
    if (value === null || value === undefined) {
        return <span className="italic text-[#8a8a8a]">NULL</span>;
    }
    if (typeof value === 'object') {
        // BLOB列(バックエンドが{"__blob__": "<hex>"}として返す、sql_service.go参照)。
        const blob = (value as { __blob__?: string }).__blob__;
        if (typeof blob === 'string') {
            return <span className="text-[#8a8a8a]">{`<blob ${blob.length / 2} bytes>`}</span>;
        }
        return JSON.stringify(value);
    }
    return String(value);
}

// 「＋ テーブル作成」モーダル。テーブル名と、可変長のカラム定義(列名・型・
// PRIMARY KEY・NOT NULL)を入力し、「作成」でCREATE TABLEを発行する
// (テーブル構造操作 作業指示書)。
function CreateTableModal({
    onClose,
    onCreate,
}: {
    onClose: () => void;
    onCreate: (tableName: string, columns: ColumnDraft[]) => Promise<boolean>;
}) {
    const [tableName, setTableName] = useState('');
    const [columns, setColumns] = useState<ColumnDraft[]>([
        { name: 'id', type: 'INTEGER', isPrimaryKey: true, isNotNull: false },
    ]);
    const [isCreating, setIsCreating] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const updateColumn = (index: number, patch: Partial<ColumnDraft>) => {
        setColumns((prev) => prev.map((c, i) => (i === index ? { ...c, ...patch } : c)));
    };

    const addColumn = () => {
        setColumns((prev) => [...prev, { name: '', type: 'TEXT', isPrimaryKey: false, isNotNull: false }]);
    };

    const removeColumn = (index: number) => {
        setColumns((prev) => prev.filter((_, i) => i !== index));
    };

    const isValid =
        tableName.trim() !== '' &&
        columns.length > 0 &&
        columns.every((c) => c.name.trim() !== '');

    const handleSubmit = async () => {
        if (!isValid) return;
        setIsCreating(true);
        try {
            const ok = await onCreate(tableName.trim(), columns);
            if (ok) onClose();
        } finally {
            setIsCreating(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
            <div
                role="dialog"
                aria-modal="true"
                aria-label="テーブル作成"
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-lg rounded-lg bg-[#252526] border border-[#3c3c3c] shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
            >
                <div className="px-4 py-3 border-b border-[#3c3c3c] shrink-0">
                    <h3 className="text-sm font-bold text-[#cccccc]">テーブル作成</h3>
                </div>

                <div className="px-4 py-4 flex-1 overflow-y-auto flex flex-col gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">テーブル名</label>
                        <input
                            value={tableName}
                            onChange={(e) => setTableName(e.target.value)}
                            placeholder="例: products"
                            autoFocus
                            className="w-full rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-2 py-1.5 placeholder:text-[#8a8a8a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                        />
                    </div>

                    <div className="flex flex-col gap-1.5">
                        <label className="text-[10px] uppercase tracking-wide text-[#8a8a8a]">カラム</label>
                        {columns.map((col, index) => (
                            <div key={index} className="flex items-center gap-1.5">
                                <input
                                    value={col.name}
                                    onChange={(e) => updateColumn(index, { name: e.target.value })}
                                    placeholder="カラム名"
                                    className="flex-1 min-w-0 rounded-md bg-[#3c3c3c] text-[#ffffff] text-xs px-2 py-1 placeholder:text-[#8a8a8a] border border-[#3c3c3c] focus:outline-none focus:border-[#007acc]"
                                />
                                <select
                                    value={col.type}
                                    onChange={(e) => updateColumn(index, { type: e.target.value })}
                                    className="w-24 shrink-0 rounded-md bg-[#3c3c3c] text-[#cccccc] text-xs px-1 py-1 border border-[#3c3c3c]"
                                >
                                    {SQLITE_COLUMN_TYPES.map((t) => (
                                        <option key={t} value={t}>
                                            {t}
                                        </option>
                                    ))}
                                </select>
                                <label className="flex items-center gap-1 text-[10px] text-[#cccccc] shrink-0" title="PRIMARY KEY">
                                    <input
                                        type="checkbox"
                                        checked={col.isPrimaryKey}
                                        onChange={(e) => updateColumn(index, { isPrimaryKey: e.target.checked })}
                                    />
                                    PK
                                </label>
                                <label className="flex items-center gap-1 text-[10px] text-[#cccccc] shrink-0" title="NOT NULL">
                                    <input
                                        type="checkbox"
                                        checked={col.isNotNull}
                                        onChange={(e) => updateColumn(index, { isNotNull: e.target.checked })}
                                    />
                                    NN
                                </label>
                                <button
                                    type="button"
                                    title="このカラムを削除"
                                    disabled={columns.length <= 1}
                                    onClick={() => removeColumn(index)}
                                    className="shrink-0 text-[#cccccc] hover:text-[#f44747] disabled:opacity-30"
                                >
                                    <Icon name="trash" />
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            onClick={addColumn}
                            className="self-start flex items-center gap-1 text-[11px] text-[#8a8a8a] hover:text-white"
                        >
                            <Icon name="add" />
                            カラムを追加
                        </button>
                    </div>
                </div>

                <div className="px-4 pb-4 pt-2 border-t border-[#3c3c3c] flex justify-end gap-2 shrink-0">
                    <button
                        type="button"
                        onClick={onClose}
                        className="px-3 py-1.5 rounded-md text-xs font-bold text-[#cccccc] bg-[#3c3c3c] hover:bg-[#4a4a4a] transition-colors"
                    >
                        キャンセル
                    </button>
                    <button
                        type="button"
                        disabled={!isValid || isCreating}
                        onClick={handleSubmit}
                        className="px-3 py-1.5 rounded-md text-xs font-bold text-white bg-[#0e639c] hover:bg-[#1177bb] disabled:opacity-50 transition-colors"
                    >
                        {isCreating ? '作成中...' : '作成'}
                    </button>
                </div>
            </div>
        </div>
    );
}
