import { useEffect, useState, useRef } from "react";
import { FilePlus } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getNotes, createNote, updateNote, deleteNote, saveNote } from "./api";
import { saveAttachments, removeAttachment, getAllTags, addTag, removeTag } from "./api";
import { importNotes, exportNotes } from "./api";

export default function App() {

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";

  const API_URL = import.meta.env.VITE_API_URL || "/api";
  const API_BASE = new URL(API_URL, window.location.origin).toString();

  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);

  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState(selected?.title || "");

  const [draftFiles, setDraftFiles] = useState([]);       // 新しく追加するファイル
  const [attachments, setAttachments] = useState([]);     // サーバ上の既存添付ファイル
  const [previewFile, setPreviewFile] = useState<any | null>(null);

  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  const [allTags, setAllTags] = useState<Tag[]>([]);      // API から取得する全タグ
  const [searchQuery, setSearchQuery] = useState("");
  const [showTagList, setShowTagList] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  const [isCreating, setIsCreating] = useState(false);          // 新規ノート
  const [showTrashOnly, setShowTrashOnly] = useState(false);    // ゴミ箱表示

  const [showMenu, setShowMenu] = useState(false);

  // フィルタ済みノート一覧を生成
  const filteredNotes = notes.filter((note) => {

    const q = searchQuery.trim().toLowerCase();

    const isTrash = note.tags?.some(t => t.toLowerCase() === "trash");
  
    // ゴミ箱モードなら Trash のみ表示
    if (showTrashOnly) return isTrash;
  
    // 通常モードでは Trash を除外
    if (isTrash) return false;

    if (!q) return true;

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
      setDraft("");
      setDraftTitle("");
      setAttachments([]);
      setDraftFiles([]);
      setTags([]);
      return;
    }
  
    setDraft(selected.content);
    setDraftTitle(selected.title || "");
    setAttachments(selected.files || []);
    setDraftFiles([]);
    setTags(selected.tags || []);

  }, [selected]);
 
  // --------------------

  const handleSelect = (note: Note) => {
    setIsCreating(false);
    setSelected(note);
    setIsEditing(false);
    setIsEditingTitle(false);
  };

  // --------------------

  // 入力保存タイマー
  const saveTimer = useRef<NodeJS.Timeout | null>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setDraft(value);

    // 入力のたびにタイマーをリセット
    if (saveTimer.current) clearTimeout(saveTimer.current);

    // 1秒後に自動保存
    saveTimer.current = setTimeout(async () => {
      if (!token) return;
      try {
        if (selected) {
          const updated = await updateNote(token, selected.id, { title: selected.title, content: value });
          setNotes((prev) => prev.map((n) => (n.id === updated.id ? updated : n)));
          setSelected(updated);
        } else if (value.trim() !== "") {
          const title = value.split("\n")[0].slice(0, 30) || "New Note...";
          const created = await createNote(token, { title, content: value });
          setNotes((prev) => [created, ...prev]);
          setSelected(created);
        }
      } catch (err) {
        console.error("Auto save failed:", err);
      }
    }, 1000);
  };

  // --------------------

  const token = localStorage.getItem("token");

  // ノート一覧取得
  const fetchNotes = async () => {

    try {
      const data = await getNotes(token!);
      setNotes(data);
      if (data.length > 0) {
        const first = data[0];
        setSelected(first);
      }
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
      }
    }
  };

  // タグ一覧を取得
  const fetchTags = async () => {
    try {
      const data = await getAllTags(token!);
      // data は [{ name: "仕事", note_count: 3 }, ...]

      // Trash を除外（大文字・小文字を無視）
      const filtered = data.filter(tag => tag.name.toLowerCase() !== "trash");

      setAllTags(filtered);

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("タグ一覧の取得に失敗しました。");
      }
    }
  };

  // 新規作成（空ノートを開く）
  const handleNew = () => {

    setIsCreating(true);
    setSelected(null);

    setIsEditing(true);
    setIsEditingTitle(false);
  };
 
  // 保存
  const handleSave = async () => {

    try {

      const updated = await saveNote( token!, selected, draft );
  
      setSelected(updated);
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );

      setIsEditing(false);
      setIsEditingTitle(false);

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("保存に失敗しました。");
      }
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
      await deleteNote(token!, selected.id);
      setNotes((prev) => prev.filter((n) => n.id !== selected.id));
      setSelected(null);
      setIsEditing(false);
      setIsEditingTitle(false);

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("削除に失敗しました。");
      }
    }
  };

  // 添付ファイル保存
  const handleSaveAttachment = async () => {

    if (!selected?.id || draftFiles.length === 0) return;

    try {

      const updated = await saveAttachments( token!, selected.id, draftFiles);
      
      setDraftFiles([]);
      setAttachments(updated.files || []);

      // 更新
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("保存に失敗しました。");
      }
    }
  };
  
  // 添付ファイル削除
  const handleDeleteAttachment = async (attachmentId: number, filename: string) => {

    if (!confirm(`「${filename}」を削除しますか？`)) return;

    try {

      const updated = await removeAttachment(token!, selected.id, attachmentId);

      setDraftFiles([]);
      setAttachments(updated.files || []);

      // 更新
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("添付ファイルの削除に失敗しました。");
      }
    }
  };

  // タグ追加
  const handleAddTag = async (noteId: number, tagName: string) => {
    if (!tagName.trim()) return;
    try {
      const updatedTags = await addTag(token!, noteId, tagName.trim());

      setTags(updatedTags || []);
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, tags: updatedTags } : n))
      );

      // タグ一覧の再取得
      await fetchTags();

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("タグの追加に失敗しました。");
      }
    }
  };
  
  // タグ削除
  const handleRemoveTag = async (noteId: number, tagName: string) => {

//    if (!confirm(`タグ「${tagName}」を削除しますか？`)) return;
  
    try {
      const updatedTags = await removeTag(token!, noteId, tagName);

      setTags(updatedTags || []);
      setNotes((prev) =>
        prev.map((n) => (n.id === noteId ? { ...n, tags: updatedTags } : n))
      );

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("タグの削除に失敗しました。");
      }
    }
  };

  // インポート
  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {

    const file = e.target.files?.[0];
    if (!file) return;
  
    try {
      const result = await importNotes(token!, file);
      alert(result.message);
      await fetchNotes(); // インポート後に一覧更新
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("Import failed.");
      }
    } finally {
      e.target.value = "";
    }
  };

  // エクスポート
  const handleExport = async () => {
    try {
      const blob = await exportNotes(token!);
      const url = window.URL.createObjectURL(blob);
  
      const a = document.createElement("a");
      a.href = url;
      a.download = `simplynotes_export_${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
  
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("エクスポートに失敗しました。");
      }
    }
  };


  // ログアウト
  const handleLogout = () => {
    localStorage.removeItem("token"); // トークン削除
    window.location.href = `${BASE_PATH}/login`;
  };

  // ------------------------------------------------------------
  // 初回処理
  // ------------------------------------------------------------

  useEffect(() => {
    fetchNotes();
    fetchTags();
  }, []);

  // ------------------------------------------------------------
  // UIイベントリスナー
  // ------------------------------------------------------------

  useEffect(() => {

    const handleClickOutside = (e) => {
      if (!e.target.closest(".menu-area")) setShowMenu(false);
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
        {/*
        <div className="p-3 border-b flex justify-between items-center">
          <h1 className="font-semibold text-lg">All Notes</h1>
          <button onClick={handleNew} className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">
            ＋ 新規
          </button>
        </div>
        */}

        <div className="p-3 border-b flex justify-between items-center relative menu-area">

          {/* 左：メニュー＋タイトル */}
          <div className="flex items-center space-x-2">
            <button
              onClick={() => setShowMenu(!showMenu)}
              className="px-2 py-1 text-gray-600 hover:text-gray-900"
              title="メニュー"
            >
              ☰
            </button>

            <h2 className="font-semibold text-lg">All Notes</h2>
          </div>

          {/* 右：操作ボタン */}
          <div className="flex items-center space-x-2">
            <button
              onClick={handleNew}
              className="bg-green-500 text-white px-2 py-2 rounded hover:bg-green-600" >
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
            <div
              className="absolute top-12 left-3 bg-white border border-gray-200 rounded-lg shadow-lg z-10 
                         transition-all duration-150 transform origin-top" >

              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  document.getElementById("importInput").click();
                  setShowMenu(false);
                }}
              >
                📂 Import
              </button>

              <button
                className="block w-full text-left px-4 py-2 hover:bg-gray-100"
                onClick={() => {
                  handleExport();
                  setShowMenu(false);
                }}
              >
                💾 Export
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
        <div className="flex-1 border-b overflow-y-auto">

          {filteredNotes.map((note) => (
            <div
              key={note.id}
              onClick={() => handleSelect(note)}
              className={`p-3 cursor-pointer border-b hover:bg-gray-100 ${
                selected?.id === note.id ? "bg-gray-200" : ""
              }`}
            >

              <div className="font-medium truncate overflow-hidden whitespace-nowrap">
                {note.title}
              </div>

              <div className="text-sm text-gray-500 flex items-center flex-wrap gap-1">
                <span className="mr-2">{note.updated_at?.slice(0, 10)}</span>
                {note.tags?.map((tag) => (
                  <span
                    key={tag}
                    className="text-xs bg-gray-200 text-gray-700 px-1.5 py-0.5 rounded"
                  >
                    {tag}
                  </span>
                ))}
              </div>

            </div>
          ))}
  
        </div>

        {/* フッター */}

        <div className="p-3 border-t mt-auto flex justify-between items-center">
          {/* 左：ログアウトボタン */}
          <button
            onClick={handleLogout}
            className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600"
          >
            ログアウト
          </button>

          {/* 右：Trashボタン */}
          <button
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

          {/* ヘッダー タイトル＋削除ボタン */}
          <div className="flex justify-between items-center">

            {!isEditingTitle ? (
              // 表示モード
              <h2
                className="font-semibold text-lg cursor-pointer"
                onClick={() => setIsEditingTitle(true)} >
                {selected ? selected.title : "New Note..."}
              </h2>
            ) : (
              // 編集モード
              <input
                type="text"
                className="font-semibold text-lg border-b border-gray-300 focus:outline-none focus:border-blue-400 flex-grow mr-2"
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    setDraftTitle(e.target.value)
                    selected.title = e.target.value
                    handleSave()
                    setIsEditingTitle(false)
                  } else if (e.key === "Escape") {
                    setIsEditingTitle(false)
                    setDraftTitle(selected?.title || "")
                  }
                }}
                onBlur={() => {
                  // フォーカスが外れたらキャンセル扱い
                  setIsEditingTitle(false)
                  setDraftTitle(selected?.title || "")
                }}
                autoFocus
              />
            )}

            {selected && (
              showTrashOnly ? (
                <button onClick={handleDelete} className="text-red-600 hover:text-red-800"> 
                  🗑️ 完全削除
                </button>
              ) : (
                <button onClick={handleRemove} className="text-red-600 hover:text-red-800">
                  🗑️ 削除
                </button>
              )
            )}
          </div>
  
          {/* ヘッダー タグ */}
          {selected && (
 
            <div className="flex flex-wrap items-center gap-2 mt-2">

              {/* タグ追加 */}
              <input
                type="text"
                value={newTagInput}
                onChange={(e) => setNewTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // フォーム送信防止
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
                placeholder="タグを追加..."
                className="border rounded px-2 py-1 text-sm w-25 focus:outline-none focus:ring-1 focus:ring-blue-400" />

              {/* タグ一覧 */}
              {tags.map((tag) => (
                <span
                  key={tag}
                  className="px-2 py-1 bg-gray-200 rounded cursor-pointer hover:bg-gray-300 text-sm"
                  onClick={() => handleRemoveTag(selected.id, tag)}
                >
                  #{tag}
                </span>
              ))}
      
            </div>
          )}
        </div>
  

        {/* 本文 */}
        <div
          className="flex-1 p-4 overflow-y-auto"
          onClick={(e) => {
            // textareaがまだ出ていないときだけ編集開始
            if (!isEditing && selected) {
              setIsEditing(true);
            }
          }} >

          {!isEditing ? (
            <div className="prose max-w-none whitespace-pre-wrap">
              <ReactMarkdown remarkPlugins={[[remarkGfm, { breaks: true }]]}>
                {(selected ? selected.content : "").replace(/\r\n/g, "\n")}
              </ReactMarkdown>
            </div>
          ) : (
            <textarea
              className="w-full h-full border rounded p-2 focus:outline-none"
              value={draft}
              onChange={handleChange}

              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  setIsEditing(false)
                }
              }}

              placeholder="ここにノートを書き始めましょう..."
              autoFocus
            />
          )}
        </div>


        {/* 添付ファイル（本文の下・フッターの上） */}
        <div className="px-4 py-3 border-t bg-gray-50">

          <div className="flex items-center justify-start flex-wrap gap-3 mb-2">

            <span className="font-semibold text-sm">添付ファイル</span>

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
                { `${draftFiles.length} 件 アップロード待ち` }
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
                    title="削除">
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

        {/* フッター
        {isEditing && (
          <div className="p-3 border-t flex justify-start items-center space-x-3">
            <button
              onClick={handleSave}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
              💾 保存
            </button>
          </div>
        )}
        */}

        {/* フッター */}
        <div className="p-3 border-t flex justify-end items-center space-x-3">
          {!isEditing ? (
            <button
              onClick={() => setIsEditing(true)}
              className="bg-gray-200 px-3 py-1 rounded hover:bg-gray-300" >
              ✏️  編集
            </button>
          ) : (
            <button
              onClick={handleSave}
              className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
              💾 保存
            </button>
          )}
        </div>

      </div>

      {previewFile && (
        <div
          className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50"
          onClick={() => setPreviewFile(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl p-4 max-w-3xl max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold mb-3 break-all">
              {previewFile.filename}
            </h3>
      
            {previewFile.filename.match(/\.(png|jpe?g|gif|webp)$/i) ? (
              <img
//                src={previewFile.url}
                src={`${API_BASE}${previewFile.url}`}
                alt={previewFile.filename}
                className="max-w-full max-h-[70vh] object-contain mx-auto"
              />
            ) : previewFile.filename.match(/\.(pdf)$/i) ? (
              <iframe
//                src={previewFile.url}
                src={`${API_BASE}${previewFile.url}`}
                className="w-full h-[70vh]"
                title={previewFile.filename}
              />
            ) : (
              <div className="text-center">
                <p className="text-gray-600 mb-3">
                  このファイルはプレビューできません。
                </p>
                <a
//                  href={previewFile.url}
                  href={`${API_BASE}${previewFile.url}`}
                  target="_blank"
                  className="text-blue-600 underline"
                >
                  ダウンロードする
                </a>
              </div>
            )}
      
            <button
              onClick={() => setPreviewFile(null)}
              className="mt-4 bg-gray-200 px-3 py-1 rounded hover:bg-gray-300"
            >
              閉じる
            </button>
          </div>
        </div>
      )}
      
    </div>
 );
}
