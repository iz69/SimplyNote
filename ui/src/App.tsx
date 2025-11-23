import { useEffect, useState, useRef } from "react";
import { FilePlus, RefreshCcw, Clock } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { refreshAccessToken } from "./api";
import type { Note, Tag, Attachment } from "./api";
import { getNotes, createNote, updateNote, deleteNote, saveNote } from "./api";
import { saveAttachments, removeAttachment, getAllTags, addTag, removeTag, toggleStar } from "./api";
import { importNotes, exportNotes } from "./api";
import { basePath, apiUrl } from "./utils"

export default function App() {

  const loginUrl = basePath() + "/login";

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

  // フィルタ済みノート一覧を生成
  const filteredNotes = notes.filter((note) => {

    const q = searchQuery.trim().toLowerCase();

    const isTrash = note.tags?.some(t => t.toLowerCase() === "trash");
  
    // ゴミ箱モードなら Trash のみ表示
    if (showTrashOnly) return isTrash;
  
    // 通常モードでは Trash を除外
    if (isTrash) return false;

    if (!q) return true;

    /*
    // テキスト条件
    const textPart = q.replace(/#[^\s#]+/g, "").trim();

    // テキスト条件：タイトル or 本文に含まれる
    const matchText =
      textPart === "" ||
      note.title.toLowerCase().includes(textPart) ||
      note.content.toLowerCase().includes(textPart);

    // タグ条件
    const tagsInQuery = q.match(/#[^\s#]+/g)?.map(t => t.slice(1)) ?? [];

    // タグ条件：すべてのタグを含むノートのみ
    const matchTags =
      tagsInQuery.length === 0 ||
      tagsInQuery.every(tag =>
        note.tags?.some(t => t.toLowerCase() === tag)
      );
    */

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
      tagsInQuery.every(tag =>
        note.tags?.some(t => t.toLowerCase() === tag)
      );


    // 両方をANDで評価
    return matchTags && matchText;
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
  }, [filteredNotes]);
  
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
    async function scheduleRefresh() {
      const token = localStorage.getItem("token");
      if (!token) return;
  
      const ms = msUntilExpiry(token);
      if (ms == null) return;
  
      // 有効期限の1分前を狙ってリフレッシュ
      const ahead = Math.max(5000, ms - 60_000);
  
      setTimeout(async () => {
        try {
          await refreshAccessToken();
          scheduleRefresh();  // 更新後も次のスケジュールを再設定
        } catch (err) {
          console.error("Token refresh failed", err);
          localStorage.removeItem("token");
          localStorage.removeItem("refresh_token");
          window.location.href = loginUrl;
        }
      }, ahead);
    }
  
    scheduleRefresh();
  }, []);

  // --------------------

  // 入力保存タイマー
  const saveTimer = useRef<number | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {

    const value = e.target.value;
    setContent(value);
  
    if (selected?.id) {
      setUnsavedNoteIds((prev) =>
        prev.includes(selected.id) ? prev : [...prev, selected.id]
      );
    }
 
    // 入力ごとにタイマーリセット
    if (saveTimer.current) clearTimeout(saveTimer.current);
  
    saveTimer.current = window.setTimeout(async () => {
  
      // ローカル token が消えていたら保存できない
      if (!localStorage.getItem("token")) return;
  
      // 内容が変わってなければ未保存フラグだけ外す
      if (selected && value === selected.content) {
        setUnsavedNoteIds((prev) => prev.filter((id) => id !== selected.id));
        return;
      }
  
      try {
        if (selected) {

          // 既存ノートの自動保存（401 なら refresh して再実行）
          const updated = await withAuthRetry((token) =>
            updateNote(token, selected.id, { title: selected.title, content: value })
          );
  
          setNotes((prev) =>
            prev.map((n) => (n.id === updated.id ? updated : n))
          );

          // これ入れるとキャレットが飛ぶ
//          setSelected(updated);
  
          setUnsavedNoteIds((prev) => prev.filter((id) => id !== updated.id));
  
        } else if (value.trim() !== "") {
          const title = value.split("\n")[0].slice(0, 30) || "New Note...";
          const created = await withAuthRetry((token) =>
            createNote(token, { title, content: value })
          );
  
          setNotes((prev) => [created, ...prev]);
          setSelected(created);
        }
  
      } catch (err) {
        console.error("Auto save failed:", err);
      }
    }, 1000);

  };

  // --------------------

  async function withAuthRetry<T>(fn: (token: string) => Promise<T>): Promise<T> {

    let token = localStorage.getItem("token");
  
    if (!token) {
      throw new Error("no-token");
    }
  
    try {
      // まず通常実行
      return await fn(token);
    } catch (err: any) {
      if (err.message !== "unauthorized") {
        throw err;
      }
  
      // 401 が来た → refresh を試す
      try {
        await refreshAccessToken();
      } catch {
        // refresh_token もダメ → 強制ログアウト
        localStorage.removeItem("token");
        localStorage.removeItem("refresh_token");
        window.location.href = loginUrl;
        throw new Error("logout");
      }
  
      // 成功したら新しい token で再実行
      token = localStorage.getItem("token")!;
      return await fn(token);
    }
  }

  // ノート一覧取得
  const fetchNotes = async () => {

    try {
      const data = await withAuthRetry((token) =>
        getNotes(token)
      );
  
      setNotes(data);

      const currentId = selected?.id;

      if (data.length === 0) {
        setSelected(null);
        return;
      }

      // 同じ note がまだ存在する？
      const found = currentId
        ? data.find(n => n.id === currentId)
        : null;

      if (found) {
        // そのまま維持
        setSelected(found);
      } else {
        // 無くなっていた → 先頭にフォールバック
        setSelected(data[0]);
      }
  
    } catch (err) {
      console.error(err);
      alert("ノート一覧の取得に失敗しました。");
    }
  };

  // タグ一覧を取得
  const fetchTags = async () => {

    try {
      const data = await withAuthRetry((token) => getAllTags(token));
  
      // Trash を除外
      const filtered = data.filter(tag => tag.name.toLowerCase() !== "trash");
  
      setAllTags(filtered);
  
    } catch (err) {
      console.error(err);
      alert("タグ一覧の取得に失敗しました。");
    }
  };

  // 新規作成（空ノートを開く）
  const handleNew = () => {

    setIsCreating(true);
    setSelected(null);
  };
 
  // 保存
  const handleSave = async () => {

    if (!selected) return;

    try {
      const updated = await withAuthRetry((token) =>
        saveNote(token, selected, content)
      );
  
      setSelected(updated);
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
  
      // 手動保存 → 未保存フラグクリア
      setUnsavedNoteIds((prev) => prev.filter((id) => id !== updated.id));
  
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました。");
    }
  };
 
  // ゴミ箱に移動
  const handleRemove = async () => {

    if (!selected || !selected.id) return;
    if (selected.tags?.some(t => t.toLowerCase() === "trash")) return;

    if (!confirm("このノートをゴミ箱に移動しますか？")) return;

    await handleAddTag( selected.id, "Trash" );
  }
 
  // 削除
  const handleDelete = async () => {

    if (!selected || !selected.id) return;
    if (!confirm("このノートを削除しますか？")) return;

    try {
      await withAuthRetry((token) => deleteNote(token, selected.id));
  
      setNotes((prev) => prev.filter((n) => n.id !== selected.id));
      setSelected(null);
  
    } catch (err) {
      console.error(err);
      alert("削除に失敗しました。");
    }
  };

  // 添付ファイル保存
  const handleSaveAttachment = async () => {

    if (!selected?.id || draftFiles.length === 0) return;

    try {
      const updated = await withAuthRetry((token) =>
        saveAttachments(token, selected.id, draftFiles)
      );
  
      setDraftFiles([]);
      setAttachments(updated.files || []);
  
      // ノート一覧も更新
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
  
    } catch (err) {
      console.error(err);
      alert("保存に失敗しました。");
    }
  };
  
  // 添付ファイル削除
  const handleDeleteAttachment = async (attachmentId: number, filename: string) => {

    if (!selected) return;
    if (!confirm(`「${filename}」を削除しますか？`)) return;

    try {
      const updated = await withAuthRetry((token) =>
        removeAttachment(token, selected.id, attachmentId)
      );
  
      setDraftFiles([]);
      setAttachments(updated.files || []);
  
      // ノート一覧更新
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
  
    } catch (err) {
      console.error(err);
      alert("添付ファイルの削除に失敗しました。");
    }
  };

  // タグ追加
  const handleAddTag = async (noteId: number, tagName: string) => {

    if (!tagName.trim()) return;

    try {
      const updatedTags = await withAuthRetry((token) =>
        addTag(token, noteId, tagName.trim())
      );
  
      setTags(updatedTags || []);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, tags: updatedTags } : n
        )
      );
  
      // タグ一覧も更新
      await fetchTags();
  
    } catch (err) {
      console.error(err);
      alert("タグの追加に失敗しました。");
    }
  };
  
  // タグ削除
  const handleRemoveTag = async (noteId: number, tagName: string) => {

    try {
      const updatedTags = await withAuthRetry((token) =>
        removeTag(token, noteId, tagName)
      );
  
      setTags(updatedTags || []);
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, tags: updatedTags } : n
        )
      );
  
    } catch (err) {
      console.error(err);
      alert("タグの削除に失敗しました。");
    }
  };

  // Star（is_important）のトグル
  const handleToggleStar = async (noteId: number) => {

    try {
      const newValue = await withAuthRetry((token) =>
        toggleStar(token, noteId)
      );
  
      // notes 一覧の該当ノートだけ更新
      setNotes((prev) =>
        prev.map((n) =>
          n.id === noteId ? { ...n, is_important: newValue } : n
        )
      );
  
      // 選択中ノートも更新
      if (selected && selected.id === noteId) {
        setSelected({ ...selected, is_important: newValue });
      }
  
    } catch (err) {
      console.error(err);
      alert("スター更新に失敗しました。");
    }
  };

  // インポート
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {

    const file = e.target.files?.[0];
    if (!file) return;
 
    try {
      const result = await withAuthRetry((token) =>
        importNotes(token, file)
      );
  
      alert(result.message);
  
      // インポート後に一覧更新
      await fetchNotes();
  
    } catch (err) {
      console.error(err);
      alert("Import failed.");
    } finally {
      e.target.value = "";
    }
  };

  // エクスポート
  const handleExport = async () => {

    try {
      const blob = await withAuthRetry((token) =>
        exportNotes(token)
      );
  
      const url = window.URL.createObjectURL(blob);
  
      const a = document.createElement("a");
      a.href = url;
      a.download = `simplynotes_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
  
      window.URL.revokeObjectURL(url);
  
    } catch (err) {
      console.error(err);
      alert("エクスポートに失敗しました。");
    }
  };

  // ログアウト
  const handleLogout = () => {
    localStorage.removeItem("token"); // トークン削除
    window.location.href = loginUrl;
  };

  // ------------------------------------------------------------
  // 初回処理
  // ------------------------------------------------------------

  useEffect(() => {
  
    async function init() {
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
          await refreshAccessToken();
        } catch {
          localStorage.removeItem("token");
          localStorage.removeItem("refresh_token");
          window.location.href = loginUrl;
          return;
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
  
  // ------------------------------------------------------------
  // UI 表示
  // ------------------------------------------------------------

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
              title="メニュー"
            >
              ☰
            </button>

            {/* All Notes + 件数 */}
            <h2 className="font-semibold text-lg flex items-baseline">
              <span>Notes</span>
              <span className="ml-2 text-sm text-gray-500">
                ({filteredNotes.length})
              </span>
            </h2>

          </div>

          <div className="flex items-center space-x-2">
         
            {/* 更新ボタン */}
            <button
              onClick={() => {
                fetchNotes();
                fetchTags();
              }} className="bg-blue-500 text-white px-2 py-2 rounded hover:bg-blue-600" title="Refresh View" >
              <RefreshCcw className="w-4 h-4" />
            </button>
 
            {/* 新規ボタン */}
            <button
              onClick={handleNew}
              className="bg-green-500 text-white px-2 py-2 rounded hover:bg-green-600" title="New Note" >
              <FilePlus className="w-4 h-4" />
            </button>
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
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  const input = document.getElementById("importInput") as HTMLInputElement | null;
                  input?.click();
                  setShowMenu(false);
                }}
              >
                📂 Import ZIP Archive
              </button>

              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  handleExport();
                  setShowMenu(false);
                }}
              >
                💾 Export ZIP Archive
              </button>

            </div>
          )}
        </div>

        {/* 検索バー */}
        <div className="border-t border-b-2 relative">

          <input
            type="text"
            placeholder="Filter by text / #tag..."
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
        <div tabIndex={-1} className="flex-1 border-b overflow-y-auto">

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
                      className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded"
                    >
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
            Logout
          </button>

          {/* 右：Trashボタン */}
          <button
            tabIndex={-1}
            onClick={() => setShowTrashOnly(prev => !prev)}
            className={`flex items-center gap-1 px-3 py-1 rounded ${
              showTrashOnly ? "bg-red-500 text-white" : "bg-gray-200 hover:bg-gray-300"
            }`}
          >
            🗑 Trash
          </button>
        </div>


      </div>

      {/* 右カラム */}
      <div className="flex-1 flex flex-col">

        {/* ヘッダー */}
        <div className="p-3 border-b">

          {/* タイトル＋削除ボタン */}
          <div className="flex justify-between items-center">

            <input
              type="text"
              className="font-semibold text-lg border-gray-300 focus:outline-none focus:border-blue-400 flex-grow mr-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={(e) => {
                const value = e.currentTarget.value
                setTitle(value)
                if (selected) {
                  selected.title = value
                }
                handleSave()
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
                      🗑️ Delete Permanently
                    </button>
                  ) : (
                    <button tabIndex={-1} onClick={handleRemove} className="text-red-600 hover:text-red-800">
                      🗑️ Trash
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
                placeholder="Add tag..."
                className="border rounded px-2 py-1 text-sm w-25 text-center focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* タグ一覧 */}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="relative inline-flex items-center px-2 py-1 bg-gray-200 rounded text-sm mr-2" >
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
              placeholder="Write your note here..."
              autoFocus
            />
        </div>

        {/* 添付ファイル（本文の下・フッターの上） */}
        <div className="px-4 py-3 border-t bg-gray-50">

          <div className="flex items-center justify-start flex-wrap gap-3 mb-2">

            <span className="font-semibold text-sm">Attachments</span>

            {/* 見た目用のカスタムボタン */}
            {selected && (
              <label
                htmlFor="fileInput"
                className="bg-gray-200 text-gray-800 text-sm px-2 py-0.5 rounded cursor-pointer hover:bg-gray-300"
              >
                📁 ファイル選択
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
                { `${draftFiles.length} file(s) pending upload` }
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
                    title="Delete">
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
                  className="bg-blue-500 text-white text-sm px-2 py-0.5 rounded hover:bg-blue-600" >
                  📤
                </button>
              
                <ul className="list-disc list-inside text-sm mb-0">
                  {draftFiles.map((f) => (
                    <li key={f.name}>{f.name}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}

        </div>

        {/* フッター */}
        <div className="p-3 border-t flex justify-end items-center space-x-3 min-h-[58px]">

          {!unsavedNoteIds.includes(selected?.id ?? "") ? (
            <div className="px-3 py-1"> </div>
          ) : (
            <button
              onClick={handleSave}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
              💾 Save
            </button>
          )}
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
                src={apiUrl(previewFile.url)}
                alt={previewFile.filename}
                className="max-w-full max-h-[70vh] object-contain mx-auto"
              />
            ) : previewFile.filename.match(/\.(pdf)$/i) ? (
              <iframe
                src={apiUrl(previewFile.url)}
                className="w-full h-[70vh]"
                title={previewFile.filename}
              />
            ) : (
              <div className="text-center">
                <p className="text-gray-600 mb-3">
                  Preview is not available for this file.
                </p>
                <a
                  href={apiUrl(previewFile.url)}
                  target="_blank"
                  className="text-blue-600 underline" >

                  Download
                </a>
              </div>
            )}
      
            <button
              onClick={() => setPreviewFile(null)}
              className="mt-4 bg-gray-200 px-3 py-1 rounded hover:bg-gray-300" >

              閉じる
            </button>
          </div>
        </div>
      )}
      
    </div>
 );
}
