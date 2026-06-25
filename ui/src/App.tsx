import { useEffect, useState, useRef } from "react";
import { FilePlus, RefreshCcw, Clock, Trash2, Globe } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getDataSource, clearDataSource } from "./dataSource";
import type { Note, Tag, Attachment } from "./dataSource";
import { basePath } from "./utils"
import { msUntilDriveTokenExpiry, hasDriveRefreshToken, clearDriveToken } from "./drive/driveAuth"

export default function App() {
  const { t, i18n } = useTranslation();

  const loginUrl = basePath() + "/login";
  const ds = getDataSource();

  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);

  const [title, setTitle] = useState(selected?.title || "");
  const [content, setContent] = useState("");

  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [draftFiles, setDraftFiles] = useState<File[]>([]);
  const [previewFile, setPreviewFile] = useState<any | null>(null);

  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  const [allTags, setAllTags] = useState<Tag[]>([]);            // 全タグ
  const [searchQuery, setSearchQuery] = useState("");
  const [showTagList, setShowTagList] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [isCreating, setIsCreating] = useState(false);          // 新規ノート
  const [showTrashOnly, setShowTrashOnly] = useState(false);    // ゴミ箱表示

  const [showMenu, setShowMenu] = useState(false);

  const [unsavedNoteIds, setUnsavedNoteIds] = useState<number[]>([]);  // 未保存ノート
  const [isLoading, setIsLoading] = useState(false);  // 読み込み中
  const [isSavingNew, setIsSavingNew] = useState(false);  // 新規ノート保存中
  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);  // ゴミ箱削除中
  const [uploadProgress, setUploadProgress] = useState<{ current: number; total: number } | null>(null);  // アップロード進捗
  const [autoRefreshOnFocus, setAutoRefreshOnFocus] = useState(
    () => localStorage.getItem("autoRefreshOnFocus") !== "false"  // デフォルトはON
  );

  // フィルタ済みノート一覧を生成
  const filteredNotes = notes.filter((note) => {

    const q = searchQuery.trim().toLowerCase();

    const isTrash = note.tags?.some(tag => tag.toLowerCase() === "trash");

    // ゴミ箱モードなら Trash のみ表示
    if (showTrashOnly) return isTrash;

    // 通常モードでは Trash を除外
    if (isTrash) return false;

    if (!q) return true;

    // タグ抽出（#tag）— より堅牢
    const tagsInQuery = [...q.matchAll(/#([^\s#]+)/g)].map(m => m[1]);

    // テキスト部分を除去
    const textPart = q.replace(/#([^\s#]+)/g, "").trim();

    // テキスト一致
    const matchText =
      textPart === "" ||
      note.title.toLowerCase().includes(textPart) ||
      note.content.toLowerCase().includes(textPart);

    // タグ一致（すべてのタグを含む）
    const matchTags =
      tagsInQuery.length === 0 ||
      tagsInQuery.every(queryTag =>
        note.tags?.some(noteTag => noteTag.toLowerCase() === queryTag.toLowerCase())
      );

    // 両方をANDで評価
    return matchTags && matchText;
  }).sort((a, b) => {
    // is_important DESC, updated_at DESC
    if ((a.is_important ?? 0) !== (b.is_important ?? 0)) {
      return (b.is_important ?? 0) - (a.is_important ?? 0);
    }
    return new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime();
  });

  // 表示リストが変わったら、先頭のノートを自動選択
  useEffect(() => {

    if (isCreating) return;

    if (filteredNotes.length === 0) {
      setSelected(null);
      return;
    }

    // 現在の選択ノートが filteredNotes に含まれていれば維持
    const exists = filteredNotes.some(n => n.id === selected?.id);
    if (!exists) {
      setSelected(filteredNotes[0]);
    }
  }, [filteredNotes, isCreating]);

  // 選択ノートが変わったら表示を更新
  useEffect(() => {

    if (!selected) {
      setTitle("");
      setContent("");
      setAttachments([]);
      setDraftFiles([]);
      setTags([]);
      return;
    }

    setTitle(selected.title || "");
    setContent(selected.content);
    setAttachments(selected.files || []);
    setDraftFiles([]);
    setTags(selected.tags || []);

  }, [selected]);

  // --------------------

  const handleSelect = (note: Note) => {
    // 新規作成中で内容がある場合、確認ダイアログを表示
    if (isCreating && content.trim()) {
      const confirmed = window.confirm(t("confirm.unsavedNew"));
      if (!confirmed) return;
    }

    // 既存ノートに未保存の変更がある場合も確認
    if (selected && unsavedNoteIds.includes(selected.id)) {
      const confirmed = window.confirm(t("confirm.unsavedChanges"));
      if (!confirmed) return;
    }

    // 保存タイマーをキャンセル
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    setIsCreating(false);
    setSelected(note);
  };

  // --------------------

  // JWT の exp を読み取る関数を App.tsx に追加
  function parseJwtExp(token: string) {
    try {
      const base64Url = token.split(".")[1];
      const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
      const payload = JSON.parse(atob(base64));
      return payload.exp ? payload.exp * 1000 : null; // ms
    } catch {
      return null;
    }
  }

  function msUntilExpiry(token: string) {
    const expMs = parseJwtExp(token);
    return expMs ? expMs - Date.now() : null;
  }

  useEffect(() => {
    // APIモードのみトークンリフレッシュをスケジュール
    const backend = localStorage.getItem("backend") || "api";
    if (backend !== "api") return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let isMounted = true;

    async function scheduleRefresh() {
      const token = localStorage.getItem("token");
      if (!token) return;

      const ms = msUntilExpiry(token);
      if (ms == null) return;

      // 有効期限の1分前を狙ってリフレッシュ
      const ahead = Math.max(5000, ms - 60_000);

      timeoutId = setTimeout(async () => {
        if (!isMounted) return;
        try {
          await ds.refreshAccessToken();
          if (isMounted) {
            scheduleRefresh();  // 更新後も次のスケジュールを再設定
          }
        } catch (err) {
          console.error("Token refresh failed", err);
          localStorage.removeItem("token");
          localStorage.removeItem("refresh_token");
          window.location.href = loginUrl;
        }
      }, ahead);
    }

    scheduleRefresh();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  // Driveモード: トークンリフレッシュをスケジュール
  useEffect(() => {
    const backend = localStorage.getItem("backend") || "api";
    if (backend !== "drive") return;

    // リフレッシュトークンがない場合はスキップ
    if (!hasDriveRefreshToken()) return;

    let timeoutId: ReturnType<typeof setTimeout>;
    let isMounted = true;

    function scheduleRefresh() {
      const ms = msUntilDriveTokenExpiry();
      if (ms == null) return;

      // 有効期限の5分前にリフレッシュ
      const ahead = Math.max(5000, ms - 5 * 60 * 1000);

      timeoutId = setTimeout(async () => {
        if (!isMounted) return;
        try {
          await ds.refreshAccessToken();
          if (isMounted) {
            scheduleRefresh();  // 次のリフレッシュをスケジュール
          }
        } catch (err) {
          console.error("Drive token refresh failed", err);
          // リフレッシュ失敗 → 強制ログアウト
          clearDriveToken();
          localStorage.removeItem("backend");
          clearDataSource();
          window.location.href = loginUrl;
        }
      }, ahead);
    }

    scheduleRefresh();

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, []);

  // --------------------

  // 入力保存タイマー
  const saveTimer = useRef<number | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {

    const value = e.target.value;
    setContent(value);

    if (selected?.id) {
      // 楽観的更新: ローカルのnotes配列を即座に更新
      setNotes((prev) =>
        prev.map((n) =>
          n.id === selected.id
            ? { ...n, content: value, updated_at: new Date().toISOString() }
            : n
        )
      );

      setUnsavedNoteIds((prev) =>
        prev.includes(selected.id) ? prev : [...prev, selected.id]
      );
    }

    // 入力ごとにタイマーリセット
    if (saveTimer.current) clearTimeout(saveTimer.current);

    saveTimer.current = window.setTimeout(async () => {

      // ローカル token が消えていたら保存できない
      const backend = localStorage.getItem("backend") || "api";
      const hasAuth = backend === "drive"
        ? !!localStorage.getItem("drive_token")
        : !!localStorage.getItem("token");
      if (!hasAuth) return;

      // 内容が変わってなければ未保存フラグだけ外す
      if (selected && value === selected.content) {
        setUnsavedNoteIds((prev) => prev.filter((id) => id !== selected.id));
        return;
      }

      try {
        if (selected) {

          // バックグラウンドで保存（結果を待たずにUIは既に更新済み）
          withAuthRetry(() =>
            ds.updateNote(selected.id, { title: selected.title, content: value })
          ).then(() => {
            setUnsavedNoteIds((prev) => prev.filter((id) => id !== selected.id));
          }).catch((err) => {
            console.error("Auto save failed:", err);
            // 保存失敗時も未保存マークは残す（ユーザーに再試行の機会を与える）
          });

        } else if (isCreating && value.trim() !== "") {
          // Google Drive接続時は新規ノートの自動保存をしない（Save New Noteボタンで保存）
          if (backend === "drive") return;

          const newTitle = title.trim() || value.split("\n")[0].slice(0, 30) || "New Note...";
          const created = await withAuthRetry(() =>
            ds.createNote(newTitle, value)
          );

          setNotes((prev) => [created, ...prev]);
          setSelected(created);
          setIsCreating(false);  // 自動保存完了後も通常モードへ移行
        }

      } catch (err) {
        console.error("Auto save failed:", err);
      }
    }, 1000);

  };

  // --------------------

  async function withAuthRetry<T>(fn: () => Promise<T>): Promise<T> {

    try {
      // まず通常実行
      return await fn();
    } catch (err: any) {
      if (err.message !== "unauthorized") {
        throw err;
      }

      // 401 が来た → refresh を試す
      const backend = localStorage.getItem("backend") || "api";

      try {
        await ds.refreshAccessToken();
      } catch {
        // refresh_token もダメ → 強制ログアウト
        if (backend === "drive") {
          localStorage.removeItem("drive_token");
        } else {
          localStorage.removeItem("token");
          localStorage.removeItem("refresh_token");
        }
        localStorage.removeItem("backend");
        clearDataSource();
        window.location.href = loginUrl;
        throw new Error("logout");
      }

      // 成功したら再実行
      return await fn();
    }
  }

  // ノート一覧取得
  const fetchNotes = async () => {

    setIsLoading(true);

    try {
      const data = await withAuthRetry(() => ds.getNotes());

      setNotes(data);

      // 選択状態は現在の最新値を使って判定（非同期中の選択変更を尊重）
      setSelected((currentSelected) => {
        if (data.length === 0) {
          return null;
        }

        // 現在選択中のノートが新データに存在すれば維持
        const found = currentSelected
          ? data.find(n => n.id === currentSelected.id)
          : null;

        if (found) {
          return found;
        }

        // 選択中ノートが削除されていた場合のみ先頭にフォールバック
        return currentSelected ? data[0] : data[0];
      });

    } catch (err) {
      console.error(err);
      alert(t("errors.fetchNotes"));
    } finally {
      setIsLoading(false);
    }
  };

  // タグ一覧を取得
  const fetchTags = async () => {

    try {
      const data = await withAuthRetry(() => ds.getAllTags());

      // Trash を除外
      const filtered = data.filter(tag => tag.name.toLowerCase() !== "trash");

      setAllTags(filtered);

    } catch (err) {
      console.error(err);
      alert(t("errors.fetchTags"));
    }
  };

  // 新規作成（空ノートを開く）
  const handleNew = () => {
    // 既存ノートに未保存の変更がある場合、確認ダイアログを表示
    if (selected && unsavedNoteIds.includes(selected.id)) {
      const confirmed = window.confirm(t("confirm.unsavedNewNote"));
      if (!confirmed) return;

      // 保存タイマーをキャンセル
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        saveTimer.current = null;
      }
    }

    setIsCreating(true);
    setSelected(null);
  };

  // 新規ノートを即座に保存
  const handleSaveNewNote = async () => {

    if (!content.trim() || isSavingNew) return;

    // 自動保存タイマーをキャンセル（重複保存を防ぐ）
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }

    const newTitle = title.trim() || content.split("\n")[0].slice(0, 30) || t("notes.newNote");

    setIsSavingNew(true);

    try {
      const created = await withAuthRetry(() =>
        ds.createNote(newTitle, content)
      );

      setNotes((prev) => [created, ...prev]);
      setSelected(created);
      setIsCreating(false);

    } catch (err) {
      console.error("Failed to create note:", err);
      alert(t("errors.createNote"));
    } finally {
      setIsSavingNew(false);
    }
  };

  // 保存
  const handleSave = (overrideTitle?: string) => {

    if (!selected) return;

    const titleToSave = overrideTitle ?? title;
    const noteId = selected.id;

    // 楽観的更新: UIを即座に更新
    const optimisticNote = {
      ...selected,
      title: titleToSave,
      content,
      updated_at: new Date().toISOString(),
    };

    setSelected(optimisticNote);
    setNotes((prev) =>
      prev.map((n) => (n.id === noteId ? { ...n, ...optimisticNote, created_at: n.created_at } : n))
    );
    setUnsavedNoteIds((prev) => prev.filter((id) => id !== noteId));

    // バックグラウンドで保存
    withAuthRetry(() => ds.updateNote(noteId, { title: titleToSave, content }))
      .catch((err) => {
        console.error("Save failed:", err);
        // 失敗時は未保存フラグを戻す
        setUnsavedNoteIds((prev) => [...prev, noteId]);
        alert(t("errors.saveFailed"));
      });
  };

  // ゴミ箱に移動
  const handleRemove = async () => {

    if (!selected || !selected.id) return;
    if (selected.tags?.some(tag => tag.toLowerCase() === "trash")) return;

    if (!confirm(t("confirm.moveToTrash"))) return;

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setUnsavedNoteIds((prev) => prev.filter((id) => id !== selected.id));

    await handleAddTag( selected.id, "Trash" );
  }

  // 削除
  const handleDelete = () => {

    if (!selected || !selected.id) return;
    if (!confirm(t("confirm.deleteNote"))) return;

    const deletedNote = selected;
    const currentNotes = [...notes];

    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    setUnsavedNoteIds((prev) => prev.filter((id) => id !== deletedNote.id));

    // 楽観的更新: UIから即座に削除
    setNotes((prev) => prev.filter((n) => n.id !== deletedNote.id));
    setSelected(null);

    // バックグラウンドで削除
    withAuthRetry(() => ds.deleteNote(deletedNote.id))
      .catch((err) => {
        console.error("Delete failed:", err);
        // ロールバック
        setNotes(currentNotes);
        setSelected(deletedNote);
        alert(t("errors.deleteFailed"));
      });
  };

  // 添付ファイル保存
  const handleSaveAttachment = async () => {

    if (!selected?.id || draftFiles.length === 0) return;

    const total = draftFiles.length;
    setUploadProgress({ current: 0, total });

    try {
      // 1ファイルずつアップロードして進捗を更新
      for (let i = 0; i < draftFiles.length; i++) {
        await withAuthRetry(() => ds.uploadAttachment(selected.id, draftFiles[i]));
        setUploadProgress({ current: i + 1, total });
      }

      // ノートを再取得
      const refreshed = await withAuthRetry(() => ds.getNoteById(selected.id));

      setDraftFiles([]);
      setAttachments(refreshed.files || []);

      // ノート一覧も更新
      setNotes((prev) =>
        prev.map((n) => (n.id === refreshed.id ? { ...n, ...refreshed, created_at: n.created_at } : n))
      );

    } catch (err) {
      console.error(err);
      alert(t("errors.saveFailed"));
    } finally {
      setUploadProgress(null);
    }
  };

  // 添付ファイル削除
  const handleDeleteAttachment = (attachmentId: number, filename: string) => {

    if (!selected) return;
    if (!confirm(`${t("actions.delete")} "${filename}"?`)) return;

    // 現在の添付ファイル一覧を保存（ロールバック用）
    const currentAttachments = [...attachments];

    // 楽観的更新: UIから即座に削除
    const optimisticAttachments = attachments.filter(a => a.id !== attachmentId);
    setAttachments(optimisticAttachments);

    // バックグラウンドで削除
    withAuthRetry(() => ds.deleteAttachment(attachmentId))
      .catch((err) => {
        console.error("Attachment delete failed:", err);
        // ロールバック
        setAttachments(currentAttachments);
        alert(t("errors.deleteAttachment"));
      });
  };

  // タグ追加
  const handleAddTag = (noteId: number, tagName: string) => {

    if (!tagName.trim()) return;

    const trimmedTag = tagName.trim();
    const currentNote = notes.find(n => n.id === noteId);
    if (!currentNote) return;

    const currentTags = currentNote.tags || [];
    if (currentTags.includes(trimmedTag)) return; // 既に存在

    const optimisticTags = [...currentTags, trimmedTag];

    // 楽観的更新
    setTags(optimisticTags);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, tags: optimisticTags } : n
      )
    );

    // バックグラウンドで保存
    withAuthRetry(() => ds.addTag(noteId, trimmedTag))
      .then(() => {
        fetchTags(); // タグ一覧も更新
      })
      .catch((err) => {
        console.error("Tag add failed:", err);
        // ロールバック
        setTags(currentTags);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId ? { ...n, tags: currentTags } : n
          )
        );
      });
  };

  // タグ削除
  const handleRemoveTag = (noteId: number, tagName: string) => {

    const currentNote = notes.find(n => n.id === noteId);
    if (!currentNote) return;

    const currentTags = currentNote.tags || [];
    const optimisticTags = currentTags.filter(t => t !== tagName);

    // 楽観的更新
    setTags(optimisticTags);
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, tags: optimisticTags } : n
      )
    );

    // バックグラウンドで保存
    withAuthRetry(() => ds.removeTag(noteId, tagName))
      .catch((err) => {
        console.error("Tag remove failed:", err);
        // ロールバック
        setTags(currentTags);
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId ? { ...n, tags: currentTags } : n
          )
        );
      });
  };

  // Star（is_important）のトグル
  const handleToggleStar = (noteId: number) => {

    // 現在の値を取得
    const currentNote = notes.find(n => n.id === noteId);
    if (!currentNote) return;

    const optimisticValue = currentNote.is_important ? 0 : 1;

    // 楽観的更新: UIを即座に更新
    setNotes((prev) =>
      prev.map((n) =>
        n.id === noteId ? { ...n, is_important: optimisticValue } : n
      )
    );

    if (selected && selected.id === noteId) {
      setSelected({ ...selected, is_important: optimisticValue });
    }

    // バックグラウンドで保存
    withAuthRetry(() => ds.toggleStar(noteId))
      .catch((err) => {
        console.error("Star toggle failed:", err);
        // 失敗時はロールバック
        setNotes((prev) =>
          prev.map((n) =>
            n.id === noteId ? { ...n, is_important: currentNote.is_important } : n
          )
        );
        if (selected && selected.id === noteId) {
          setSelected((curr) => curr ? { ...curr, is_important: currentNote.is_important } : null);
        }
      });
  };

  // インポート
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {

    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const result = await withAuthRetry(() =>
        ds.importNotes(file)
      );

      alert(result.message);

      // インポート後に一覧更新
      await fetchNotes();

    } catch (err) {
      console.error(err);
      alert(t("errors.importFailed"));
    } finally {
      e.target.value = "";
    }
  };

  // エクスポート
  const handleExport = async () => {

    try {
      const blob = await withAuthRetry(() =>
        ds.exportNotes()
      );

      const url = window.URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = `simplynotes_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();

      window.URL.revokeObjectURL(url);

    } catch (err) {
      console.error(err);
      alert(t("errors.exportFailed"));
    }
  };

  // ログアウト
  const handleLogout = () => {
    // API用
    localStorage.removeItem("token");
    localStorage.removeItem("refresh_token");
    // Drive用（clearDriveTokenでまとめて削除）
    clearDriveToken();
    // 共通
    localStorage.removeItem("backend");
    clearDataSource();
    window.location.href = loginUrl;
  };

  // ------------------------------------------------------------
  // 初回処理
  // ------------------------------------------------------------

  useEffect(() => {

    async function init() {
      const backend = localStorage.getItem("backend") || "api";

      if (backend === "drive") {
        // Google Drive モード: drive_token をチェック
        const driveToken = localStorage.getItem("drive_token");
        if (!driveToken) {
          window.location.href = loginUrl;
          return;
        }
      } else {
        // API モード: token と refresh_token をチェック
        const token = localStorage.getItem("token");
        const refresh = localStorage.getItem("refresh_token");

        if (!token || !refresh) {
          window.location.href = loginUrl;
          return;
        }

        // 初回ロード時に token の期限をチェック
        const ms = msUntilExpiry(token);

        // exp が切れてる or 残り少ない時に refresh を試す
        if (ms !== null && ms < 60_000) {

          try {
            await ds.refreshAccessToken();
          } catch {
            localStorage.removeItem("token");
            localStorage.removeItem("refresh_token");
            window.location.href = loginUrl;
            return;
          }
        }
      }

      // 初期ロード
      fetchNotes();
      fetchTags();
    }

    init();

  }, []);


  // ------------------------------------------------------------
  // UIイベントリスナー
  // ------------------------------------------------------------

  useEffect(() => {

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && !target.closest(".menu-area")) {
        setShowMenu(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);

  }, []);

  // タブがフォーカスされた時に自動リフレッシュ
  useEffect(() => {

    const handleVisibilityChange = () => {
      if (autoRefreshOnFocus && document.visibilityState === "visible") {
        fetchNotes();
        fetchTags();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);

  }, [autoRefreshOnFocus]);

  // ------------------------------------------------------------
  // UI 表示
  // ------------------------------------------------------------

  const tagColorClass = (tag: string) => {

    const t = tag.toLowerCase();

    if (t === 'memo' )  return 'bg-yellow-200 text-yellow-800';
    if (t === 'work')  return 'bg-blue-200 text-blue-800';
    if (t === 'idea' )  return 'bg-green-200 text-green-800';
    if (t === 'trash') return 'bg-red-200 text-red-800';

    return 'bg-blue-100 text-blue-600';
  };

  return (
    <div className="h-screen flex text-gray-800">

      {/* 左カラム */}
      <div className="w-1/4 border-r border-gray-300 flex flex-col">

        {/* ヘッダー */}
        <div className="p-3 border-b flex justify-between items-center relative menu-area">

          {/* メニュー＋タイトル */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="px-2 py-1 text-gray-600 hover:text-gray-900"
              title={t("menu.title")}
            >
              ☰
            </button>

            {/* All Notes + 件数 */}
            <h2 className="font-semibold text-lg flex items-baseline">
              <span>{t("menu.allNotes")}</span>
              <span className="ml-2 text-sm text-gray-500">
                ({filteredNotes.length})
              </span>
            </h2>

          </div>

          <div className="flex items-center space-x-2">

            {showTrashOnly ? (
              /* ゴミ箱を空にするボタン */
              filteredNotes.length > 0 && (
                <button
                  disabled={isEmptyingTrash}
                  onClick={async () => {
                    if (!confirm(t("confirm.emptyTrash"))) return;
                    setIsEmptyingTrash(true);
                    try {
                      const result = await withAuthRetry(() => ds.emptyTrash());
                      alert(t("confirm.deletedNotes", { count: result.deleted }));
                      fetchNotes();
                      fetchTags();
                    } catch (err) {
                      console.error(err);
                      alert(t("errors.emptyTrash"));
                    } finally {
                      setIsEmptyingTrash(false);
                    }
                  }}
                  className={`flex items-center gap-1 px-2 py-2 rounded ${
                    isEmptyingTrash
                      ? "bg-red-400 text-white cursor-wait"
                      : "bg-red-600 text-white hover:bg-red-700"
                  }`}
                  title={t("menu.emptyTrash")}
                >
                  {isEmptyingTrash ? (
                    <RefreshCcw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Trash2 className="w-4 h-4" />
                  )}
                </button>
              )
            ) : (
              /* 新規ボタン */
              <button
                onClick={handleNew}
                className="bg-green-500 text-white px-2 py-2 rounded hover:bg-green-600"
                title={t("notes.new")}
              >
                <FilePlus className="w-4 h-4" />
              </button>
            )}
          </div>

          {/* 隠し importfile input */}
          <input
            id="importInput"
            type="file"
            accept=".zip"
            style={{ display: "none" }}
            onChange={handleImport}
          />

          {/* ドロップダウンメニュー */}
          {showMenu && (
            <div className="absolute top-12 left-3 bg-white border border-gray-200 rounded-lg shadow-lg z-10
                            transition-all duration-150 transform origin-top" >

              <button
                className="w-full text-left px-4 py-2 hover:bg-gray-100 flex items-center justify-between"
                onClick={() => {
                  const newValue = !autoRefreshOnFocus;
                  setAutoRefreshOnFocus(newValue);
                  localStorage.setItem("autoRefreshOnFocus", String(newValue));
                }}
              >
                <span>🔄 {t("menu.autoRefresh")}</span>
                <span className={`ml-2 text-xs px-2 py-0.5 rounded ${
                  autoRefreshOnFocus
                    ? "bg-green-100 text-green-700"
                    : "bg-gray-200 text-gray-500"
                }`}>
                  {autoRefreshOnFocus ? "ON" : "OFF"}
                </span>
              </button>

              <hr className="my-1 border-gray-200" />

              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  const input = document.getElementById("importInput") as HTMLInputElement | null;
                  input?.click();
                  setShowMenu(false);
                }}
              >
                📂 {t("menu.import")}
              </button>

              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  handleExport();
                  setShowMenu(false);
                }}
              >
                💾 {t("menu.export")}
              </button>

              <hr className="my-1 border-gray-200" />

              <div className="px-4 py-2">
                <div className="flex items-center gap-2">
                  <Globe className="w-4 h-4 text-gray-500" />
                  <span className="text-sm text-gray-600">{t("language.label")}</span>
                </div>
                <div className="flex gap-2 mt-2">
                  <button
                    className={`px-3 py-1 text-sm rounded ${
                      i18n.language === "en"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300"
                    }`}
                    onClick={() => i18n.changeLanguage("en")}
                  >
                    {t("language.en")}
                  </button>
                  <button
                    className={`px-3 py-1 text-sm rounded ${
                      i18n.language === "ja"
                        ? "bg-blue-500 text-white"
                        : "bg-gray-200 hover:bg-gray-300"
                    }`}
                    onClick={() => i18n.changeLanguage("ja")}
                  >
                    {t("language.ja")}
                  </button>
                </div>
              </div>

            </div>
          )}
        </div>

        {/* 検索バー */}
        <div className="border-t border-b-2 relative">

          <input
            type="text"
            placeholder={t("notes.filterPlaceholder")}
            value={searchQuery}
            onChange={(e) => {
              const v = e.target.value;
              setSearchQuery(v);

              // 「#」を含んでいてフォーカス中なら TagList 表示
              if (isFocused && v.includes("#")) {
                setShowTagList(true);
              } else {
                setShowTagList(false);
              }

            }}
            onFocus={() => {
              setIsFocused(true);
              if (searchQuery.includes("#")) setShowTagList(true);
            }}
            onBlur={() => {
              setIsFocused(false);
            }}

            className="w-full border-none px-3 py-2 outline-none bg-transparent"
          />

          {/* タグ候補（#で始まる時だけ出す） */}
          {isFocused && searchQuery.includes("#") && showTagList && (
            <div className="absolute left-0 right-0 top-full bg-gray-50 border border-gray-300 rounded-b max-h-32 overflow-y-auto z-10 text-sm shadow-sm">

              {allTags
                .map((tag) => (
                  <div
                    key={tag.name}

                    onMouseDown={(e) => {
                      e.preventDefault(); // inputにフォーカスを戻さない
                      setSearchQuery(prev => {

                        // すでに同じタグが含まれていたら追加しない
                        if (prev.includes(`#${tag.name}`)) return prev;

                        // 最後の単語が "#" の場合はそこに補完
                        if (prev.trim().endsWith("#")) {
                          return prev.trim() + tag.name + " ";
                        }

                        // 通常は末尾に追記
                        return `${prev.trim()} #${tag.name} `;
                      });
                    }}

                    className="px-2 py-1 hover:bg-gray-100 cursor-pointer" >
                    #{tag.name} ({tag.note_count ?? 0})
                  </div>
                ))}
            </div>
          )}
        </div>

        {/* フィルタ済みノート一覧 */}
        <div tabIndex={-1} className="flex-1 border-b overflow-y-auto relative">

          {/* ローディングオーバーレイ */}
          {isLoading && (
            <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-10">
              <div className="text-gray-500 flex items-center gap-2">
                <RefreshCcw className="w-5 h-5 animate-spin" />
                <span>{t("app.loading")}</span>
              </div>
            </div>
          )}

          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleSelect(note)}
              className={`p-3 cursor-pointer border-b hover:bg-gray-100 ${
                selected?.id === note.id ? "bg-gray-200" : ""
              }`}
            >

              <div className="font-medium flex items-center justify-between">
                <span className="truncate max-w-[85%]">{note.title}</span>
                {unsavedNoteIds.includes(note.id) && (
                  <div className="w-5 h-5 ml-2 shrink-0 flex items-center justify-center">
                    <Clock size={16} className="text-orange-500 animate-pulse" />
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between">

                {/* 左：日付＋タグ */}
                <div className="flex items-center flex-wrap gap-1">
                  <span className="mr-2">
                    {note.updated_at && new Date(note.updated_at).toLocaleDateString()}
                  </span>
                  {note.tags?.map((tag) => (
                    <span
                      key={tag}
                      className={`text-xs px-1.5 py-0.5 rounded ${tagColorClass(tag)}`} >
                      {tag}
                    </span>
                  ))}
                </div>

                {/* 右：スター（SVGアイコン） */}
                <button
                  tabIndex={-1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleToggleStar(note.id);
                  }}
                  className="ml-2 shrink-0 w-5 h-5 flex items-center justify-center hover:opacity-80" >

                  {note.is_important ? (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      className="w-5 h-5 text-yellow-500" >
                      <path d="M12 17.27l6.18 3.73-1.64-7.03L21 9.24l-7.19-.61L12 2l-1.81 6.63L3 9.24l4.46 4.73L5.82 21z" />
                    </svg>
                  ) : (
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      className="w-5 h-5 text-gray-400" >
                      <path d="M12 17.27l6.18 3.73-1.64-7.03L21 9.24l-7.19-.61L12 2l-1.81 6.63L3 9.24l4.46 4.73L5.82 21z" />
                    </svg>
                  )}
                </button>

              </div>

            </div>
          ))}

        </div>

        <div className="p-3 border-t mt-auto flex justify-between items-center min-h-[58px]">

          {/* 左：ログアウトボタン */}
          <button
            tabIndex={-1}
            onClick={handleLogout}
            className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
          >
            {t("menu.logout")}
          </button>

          {/* 右：Trashボタン */}
          <button
            tabIndex={-1}
            onClick={() => setShowTrashOnly(prev => !prev)}
            className={`flex items-center gap-1 px-3 py-1 rounded ${
              showTrashOnly ? "bg-red-500 text-white" : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            <Trash2 className="w-4 h-4" /> {t("menu.trash")}
          </button>
        </div>


      </div>

      {/* 右カラム */}
      <div className="flex-1 flex flex-col relative">

        {/* ローディングオーバーレイ */}
        {isLoading && (
          <div className="absolute inset-0 bg-white bg-opacity-70 flex items-center justify-center z-10">
            <div className="text-gray-500 flex items-center gap-2">
              <RefreshCcw className="w-5 h-5 animate-spin" />
              <span>{t("app.loading")}</span>
            </div>
          </div>
        )}

        {/* ヘッダー */}
        <div className="p-3 border-b">

          {/* タイトル＋削除ボタン */}
          <div className="flex justify-between items-center">

            <input
              type="text"
              className="font-semibold text-lg border-gray-300 focus:outline-none focus:border-blue-400 flex-grow mr-2"
              value={title}
              disabled={!selected && !isCreating}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={(e) => {
                const value = e.currentTarget.value
                setTitle(value)
                if (selected) {
                  setSelected({ ...selected, title: value });
                }
                handleSave(value)
              }}
              autoFocus
            />

            {selected && (
              <div className="flex items-center gap-3">

                {/* ★ スターアイコン */}
                {selected && (

                  <button
                    tabIndex={-1}
                    onClick={() => handleToggleStar(selected.id)}
                    className="hover:opacity-80" >

                    {selected.is_important ? (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="currentColor"
                        className="w-6 h-6 text-yellow-500" >
                        <path d="M12 17.27l6.18 3.73-1.64-7.03L21 9.24l-7.19-.61L12 2 10.19 8.63 3 9.24l4.46 4.73L5.82 21z" />
                      </svg>
                    ) : (
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        className="w-6 h-6 text-gray-400" >
                        <path d="M12 17.27l6.18 3.73-1.64-7.03L21 9.24l-7.19-.61L12 2 10.19 8.63 3 9.24l4.46 4.73L5.82 21z" />
                      </svg>
                    )}
                  </button>
                )}

                {selected && (
                  showTrashOnly ? (
                    <button tabIndex={-1} onClick={handleDelete} className="text-red-600 hover:text-red-800">
                      🗑️ {t("actions.deletePermanently")}
                    </button>
                  ) : (
                    <button tabIndex={-1} onClick={handleRemove} className="text-red-600 hover:text-red-800">
                      🗑️ {t("menu.trash")}
                    </button>
                  )
                )}

              </div>
            )}
          </div>


          {selected && (

            <div className="flex flex-wrap items-center gap-2 mt-2">

              {/* タグ追加 */}
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    const value = newTagInput.trim();
                    if (value && selected?.id) {
                      handleAddTag(selected.id, value);
                      setNewTagInput("");
                    }
                  }
                }}
                onBlur={() => {
                  // フォーカスが外れたらキャンセル（入力だけクリア）
                  setNewTagInput("");
                }}
                placeholder={t("notes.addTagPlaceholder")}
                className="border rounded px-2 py-1 text-sm w-25 text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* タグ一覧 */}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className={`relative inline-flex items-center px-2 py-1 rounded text-sm mr-2 ${tagColorClass(tag)}`} >
                  #{tag}

                  <button
                    type="button"
                    onClick={() => handleRemoveTag(selected.id, tag)}
                    className="absolute -top-[6px] -right-[8px] w-4 h-4 flex items-center justify-center
                               bg-white border border-gray-300 rounded-full hover:bg-gray-100" >
                    <span className="relative w-2 h-2">
                      <span className="absolute left-0 top-1/2 w-full h-[1px] bg-gray-600 rotate-45 origin-center"></span>
                      <span className="absolute left-0 top-1/2 w-full h-[1px] bg-gray-600 -rotate-45 origin-center"></span>
                    </span>
                  </button>

                </span>
              ))}

            </div>
          )}
        </div>


        {/* 本文 */}
        <div
          className="flex-1 p-4 overflow-y-auto" >
            <textarea
              className="w-full h-full rounded p-2 focus:outline-none"
              value={content}
              onChange={handleChange}
              disabled={!selected && !isCreating}
              placeholder={t("notes.writePlaceholder")}
              autoFocus
            />
        </div>

        {/* 添付ファイル（本文の下・フッターの上） */}
        <div className="px-4 py-3 border-t bg-gray-50">

          <div className="flex items-center justify-start flex-wrap gap-3 mb-2">

            <span className="font-semibold text-sm">{t("attachments.title")}</span>

            {/* 見た目用のカスタムボタン */}
            {selected && (
              <label
                htmlFor="fileInput"
                className="bg-gray-200 text-gray-800 text-sm px-2 py-0.5 rounded cursor-pointer hover:bg-gray-300"
              >
                📁 {t("attachments.selectFile")}
              </label>
            )}

            {/* ファイル選択の実体（非表示） */}
            <input
              id="fileInput"
              type="file"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setDraftFiles(files);
                e.target.value = "";
              }}
              className="hidden"
            />

            {/* 選択状態の表示 */}
            {draftFiles.length > 0 && (
              <span className="text-sm text-gray-600">
                {t("attachments.pendingUpload", { count: draftFiles.length })}
              </span>
            )}
          </div>

          {attachments?.length > 0 && selected?.id && (

            <ul className="list-disc list-inside text-sm">
              {attachments.map((f) => (

                <li key={f.id} className="flex items-center justify-between">

                  <button
                    onClick={() => handleDeleteAttachment(f.id, f.filename)}
                    className="mr-2 px-2 py-0.5 rounded cursor-pointer hover:bg-red-500"
                    title={t("actions.delete")}>
                    🗑️
                  </button>

                  <button
                    onClick={() => setPreviewFile(f)}
                    className="text-blue-600 underline break-all text-left hover:text-blue-800 flex-1" >
                    {f.filename}
                  </button>

                </li>
              ))}
            </ul>
          )}

          {/* 添付ファイル追加 */}
          {draftFiles.length > 0 && selected?.id && (

            <div className="mt-2">
              <div className="mt-2 mb-4 flex items-start gap-4">

                <button
                  onClick={handleSaveAttachment}
                  disabled={uploadProgress !== null}
                  className={`text-white text-sm px-2 py-0.5 rounded ${
                    uploadProgress !== null
                      ? "bg-gray-400 cursor-not-allowed"
                      : "bg-blue-500 hover:bg-blue-600"
                  }`} >
                  📤
                </button>

                <ul className="list-disc list-inside text-sm mb-0">
                  {draftFiles.map((f) => (
                    <li key={f.name}>{f.name}</li>
                  ))}
                </ul>
              </div>

              {/* プログレスバー */}
              {uploadProgress && (
                <div className="mb-2">
                  <div className="flex items-center gap-2 text-sm text-gray-600 mb-1">
                    <span>{t("attachments.uploading", { current: uploadProgress.current, total: uploadProgress.total })}</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div
                      className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${(uploadProgress.current / uploadProgress.total) * 100}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

        </div>

        {/* フッター */}
        <div className="p-3 border-t flex justify-between items-center min-h-[58px]">

          {/* 左：Saveボタン */}
          <div>
            {isCreating && localStorage.getItem("backend") === "drive" ? (
              // Google Drive接続時のみ新規ノートのSaveボタンを表示（API接続時は自動保存）
              <button
                onClick={handleSaveNewNote}
                disabled={!content.trim() || isSavingNew}
                className={`px-3 py-1 rounded flex items-center gap-2 ${
                  isSavingNew
                    ? "bg-green-400 text-white cursor-wait"
                    : content.trim()
                      ? "bg-green-500 text-white hover:bg-green-600"
                      : "bg-gray-300 text-gray-500 cursor-not-allowed"
                }`}>
                {isSavingNew ? (
                  <>
                    <RefreshCcw className="w-4 h-4 animate-spin" />
                    {t("actions.saving")}
                  </>
                ) : (
                  <>💾 {t("actions.saveNewNote")}</>
                )}
              </button>
            ) : !unsavedNoteIds.includes(selected?.id ?? -1) ? (
              <div className="px-3 py-1"> </div>
            ) : (
              <button
                onClick={() => handleSave()}
                className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
                💾 {t("actions.save")}
              </button>
            )}
          </div>

          {/* 右：作成日時・更新日時（2行） */}
          <div className="text-xs text-gray-500 text-right leading-tight">
            {!isCreating && selected && (() => {
              const currentNote = notes.find(n => n.id === selected.id);
              return (
                <>
                  <div>{t("timestamps.created")}: {currentNote?.created_at ? new Date(currentNote.created_at).toLocaleString() : "-"}</div>
                  <div>{t("timestamps.updated")}: {currentNote?.updated_at ? new Date(currentNote.updated_at).toLocaleString() : "-"}</div>
                </>
              );
            })()}
          </div>
        </div>

      </div>

      {previewFile && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50"
          onClick={() => setPreviewFile(null)} >

          <div
            className="bg-white rounded-lg shadow-xl p-4 max-w-3xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3 break-all">
              {previewFile.filename}
            </h3>

            {previewFile.filename.match(/\.(png|jpe?g|gif|webp)$/i) ? (
              <img
                src={ds.resolveAttachmentUrl(previewFile.url)}
                alt={previewFile.filename}
                className="max-w-full max-h-[70vh] object-contain mx-auto"
              />
            ) : previewFile.filename.match(/\.(pdf)$/i) ? (
              <iframe
                src={ds.resolveAttachmentUrl(previewFile.url)}
                className="w-full h-[70vh]"
                title={previewFile.filename}
              />
            ) : (
              <div className="text-center">
                <p className="text-gray-600 mb-3">
                  Preview is not available for this file.
                </p>
                <a
                  href={ds.resolveAttachmentUrl(previewFile.url)}
                  target="_blank"
                  className="text-blue-600 underline" >

                  Download
                </a>
              </div>
            )}

            <button
              onClick={() => setPreviewFile(null)}
              className="mt-4 bg-gray-200 px-3 py-1 rounded hover:bg-gray-300" >

              {t("actions.close")}
            </button>
          </div>
        </div>
      )}

    </div>
 );
}
