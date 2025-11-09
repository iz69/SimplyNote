import { useEffect, useState, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { getNotes, createNote, updateNote, deleteNote, saveNote } from "./api";
import { saveAttachments, deleteAttachment, getAllTags, addTag, removeTag } from "./api";

export default function App() {

  const BASE_PATH = import.meta.env.VITE_BASE_PATH || "";

  const [notes, setNotes] = useState<Note[]>([]);
  const [selected, setSelected] = useState<Note | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const [draftFiles, setDraftFiles] = useState([]);       // 新しく追加するファイル
  const [attachments, setAttachments] = useState([]);     // サーバ上の既存添付ファイル
  const [previewFile, setPreviewFile] = useState<any | null>(null);

  const [tags, setTags] = useState<string[]>([]);
  const [newTagInput, setNewTagInput] = useState("");

  const handleSelect = (note: Note) => {
    setSelected(note);
    setIsEditing(false);
    setDraft(note.content);
    setDraftFiles([]);
    setAttachments(note.files || []);
    setTags(note.tags || []);
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
          const title = value.split("\n")[0].slice(0, 30) || "新しいノート";
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
        setDraft(first.content);
        setAttachments(first.files || []);
        setTags(first.tags || []); 
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

alert(data.map(tag => tag.name).join(", "));

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

  // タグで絞り込み
  const fetchNotesByTag = async (tagName: string) => {
    try {
      const data = await getNotesByTag(token!, tagName);
      setNotes(data);
      setSelected(data[0] || null);
      setDraft(data[0]?.content || "");
      setAttachments(data[0]?.files || []);
      setTags(data[0].tags || []);

    } catch (err: any) {
      if (err.message === "unauthorized") {
        localStorage.removeItem("token");
        window.location.href = `${BASE_PATH}/login`;
      } else {
        console.error(err);
        alert("ノートの取得に失敗しました。");
      }
    }
  };
 
  // 新規作成（空ノートを開く）
  const handleNew = () => {
    setSelected(null);
    setDraft("");
    setIsEditing(true);
  };
 
  // 保存
  const handleSave = async () => {

    try {

      const updated = await saveNote( token!, selected, draft );
  
      setSelected(updated);
      setNotes((prev) =>
        prev.map((n) => (n.id === updated.id ? updated : n))
      );
      setAttachments(updated.files || []);
//      setTags((updated.tags || []).map((name) => ({ name })));
      setTags(updated.tags || []);

      setDraftFiles([]);
      setIsEditing(false);

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
  
  // 削除
  const handleDelete = async () => {
    if (!selected) return;
    if (!confirm("このノートを削除しますか？")) return;
    try {
      await deleteNote(token!, selected.id);
      setNotes((prev) => prev.filter((n) => n.id !== selected.id));
      setSelected(null);
      setDraft("");
      setIsEditing(false);
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
      await deleteAttachment(token!, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
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
//      setTags(updatedTags.map((name) => ({ name })));
//      setTags(updatedTags.tags || []);
      setTags(updatedTags || []);
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
    if (!confirm(`タグ「${tagName}」を削除しますか？`)) return;
  
    try {
      const updatedTags = await removeTag(token!, noteId, tagName);
//      setTags(updatedTags.map((name) => ({ name })));
//      setTags(updatedTags.tags || []);
      setTags(updatedTags || []);
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
//    fetchTags();
  }, []);

  // ------------------------------------------------------------
  // UI 表示
  // ------------------------------------------------------------
  return (
    <div className="h-screen flex text-gray-800">

      {/* 左カラム */}
      <div className="w-1/3 border-r border-gray-300 flex flex-col">

        {/* ヘッダー */}
        <div className="p-3 border-b flex justify-between items-center">
          <h1 className="font-semibold text-lg">All Notes</h1>
          <button onClick={handleNew} className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600">
            ＋ 新規
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {notes.map((note) => (
            <div key={note.id} onClick={() => handleSelect(note)} className={`p-3 cursor-pointer border-b hover:bg-gray-100 ${selected?.id === note.id ? "bg-gray-200" : ""}`} >
              <div className="font-medium">{note.title}</div>
              <div className="text-sm text-gray-500">{note.updated_at?.slice(0, 10)}</div>
            </div>
          ))}
        </div>

        {/* フッター */}
        <div className="p-3 border-t mt-auto">
          <button onClick={handleLogout} className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600">
            ログアウト
          </button>
        </div>

      </div>

      {/* 右カラム */}
      <div className="flex-1 flex flex-col">

        {/* ヘッダー */}
        <div className="p-3 border-b">

          {/* ヘッダー タイトル＋削除ボタン */}
          <div className="flex justify-between items-center">

            <h2 className="font-semibold text-lg">
              {selected ? selected.title : "新しいノート"}
            </h2>
            {!isEditing && selected && (
              <button onClick={handleDelete} className="text-red-600 hover:text-red-800">
                🗑️ 削除
              </button>
            )}
          </div>
  
          {/* ヘッダー タグ */}
          {selected && (
 
            <div className="mt-2">
              <div className="flex flex-wrap items-center gap-2">
 
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
                  className="border rounded px-2 py-1 mt-2"
                />

                {/* タグ一覧 */}
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="px-2 py-1 bg-gray-200 rounded cursor-pointer hover:bg-gray-300"
                    onClick={() => handleRemoveTag(selected.id, tag)}
                  >
                    #{tag}
                  </span>
                ))}
        
              </div>
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
              onBlur={() => {
                setIsEditing(false);
                handleSave();                            // フォーカスが外れたとき自動保存
              }}
              placeholder="ここにノートを書き始めましょう..."
              autoFocus
            />
          )}
        </div>


        {/* 添付ファイル（本文の下・フッターの上） */}
        <div className="px-4 py-3 border-t bg-gray-50">
          <div className="font-semibold text-sm mb-1">添付ファイル</div>

          {attachments?.length > 0 ? (
            <ul className="list-disc list-inside text-sm">
              {attachments.map((f) => (
                <li key={f.id} className="flex items-center justify-between">
                  {/*
                  <a
                    href={f.url}
                    target="_blank"
                    className="text-blue-600 underline break-all"
                  >
                    {f.filename}
                  </a>
                  */}

                  <button
                    onClick={() => setPreviewFile(f)}
                    className="text-blue-600 underline break-all text-left hover:text-blue-800" >
                    {f.filename}
                  </button>

                  <button
                    onClick={() => handleDeleteAttachment(f.id, f.filename)}
                    className="ml-2 text-red-500 hover:text-red-700"
                    title="削除" >
                    🗑️
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-sm text-gray-400">添付なし</div>
          )}
        
          {/* ← 編集モード関係なく常にファイル追加を出す
        
       
          {/* ← 編集モード関係なく常にファイル追加を出す */}
          <div className="mt-2">
            <input
              type="file"
              multiple
              onChange={(e) => {
                const files = Array.from(e.target.files || []);
                setDraftFiles(files);
                e.target.value = ""; 
              }}
              className="text-sm"
            />
  
            {draftFiles.length > 0 && selected?.id && (
              <div className="mt-2">
                <ul className="list-disc list-inside text-sm mb-2">
                  {draftFiles.map((f) => (
                    <li key={f.name}>{f.name}</li>
                  ))}
                </ul>
  
                <button
                  onClick={handleSaveAttachment}
                  className="bg-blue-500 text-white text-sm px-3 py-1 rounded hover:bg-blue-600"
                >
                  📤 アップロード
                </button>
              </div>
            )}
          </div>

        </div>
        

        {/* フッター
        <div className="p-3 border-t flex justify-end items-center space-x-3">
        </div>
        */}

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
                src={previewFile.url}
                alt={previewFile.filename}
                className="max-w-full max-h-[70vh] object-contain mx-auto"
              />
            ) : previewFile.filename.match(/\.(pdf)$/i) ? (
              <iframe
                src={previewFile.url}
                className="w-full h-[70vh]"
                title={previewFile.filename}
              />
            ) : (
              <div className="text-center">
                <p className="text-gray-600 mb-3">
                  このファイルはプレビューできません。
                </p>
                <a
                  href={previewFile.url}
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

