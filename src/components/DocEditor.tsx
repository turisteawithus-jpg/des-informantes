import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Button } from "@/components/ui/button";
import {
  Loader2, X, Bold, Italic, Strikethrough, Heading2, Heading3,
  List, ListOrdered, Undo2, Redo2, Download, FileText,
} from "lucide-react";

/**
 * Editor de documentos en linea de DES Informantes.
 * - Se abre dentro de la plataforma (overlay), sin salir de la pagina.
 * - Autoguardado cada 3 segundos cuando hay cambios (en la base de datos).
 * - Descarga el documento como .doc compatible con Word.
 */
export function DocEditor({
  docId,
  title,
  onClose,
}: {
  docId: number;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<"clean" | "dirty" | "saving" | "saved">("clean");
  const dirtyRef = useRef(false);
  const editorRef = useRef<ReturnType<typeof useEditor>>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editorProps: {
      attributes: {
        class: "min-h-[55vh] max-h-[55vh] overflow-y-auto p-4 outline-none text-sm leading-relaxed bg-white rounded-b-xl",
      },
    },
    onUpdate: () => {
      dirtyRef.current = true;
      setSaveState("dirty");
    },
  });
  editorRef.current = editor;

  // Carga inicial del contenido
  useEffect(() => {
    if (!editor) return;
    (async () => {
      try {
        const res = await fetch(`/api/rest/workspaces/documents/${docId}/content`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          editor.commands.setContent(data.content || "<p></p>");
          dirtyRef.current = false;
          setSaveState("clean");
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [docId, editor]);

  // Autoguardado: cada 3 segundos, solo si hay cambios
  useEffect(() => {
    const iv = setInterval(async () => {
      const ed = editorRef.current;
      if (!ed || !dirtyRef.current) return;
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        await fetch(`/api/rest/workspaces/documents/${docId}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: ed.getHTML() }),
          credentials: "include",
        });
        setSaveState("saved");
      } catch {
        dirtyRef.current = true;
        setSaveState("dirty");
      }
    }, 3000);
    return () => clearInterval(iv);
  }, [docId]);

  async function handleClose() {
    const ed = editorRef.current;
    if (ed && dirtyRef.current) {
      setSaveState("saving");
      try {
        await fetch(`/api/rest/workspaces/documents/${docId}/content`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: ed.getHTML() }),
          credentials: "include",
        });
      } catch { /* el ultimo cambio se reintentara en la proxima apertura */ }
    }
    onClose();
  }

  function downloadDoc() {
    const ed = editorRef.current;
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"><title>${title}</title></head><body>${ed?.getHTML() ?? ""}</body></html>`;
    const blob = new Blob(["\ufeff", html], { type: "application/msword" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60).trim() || "documento"}.doc`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const tb = (active: boolean) =>
    `p-1.5 rounded-md ${active ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4">
      <div className="w-full max-w-3xl border-2 rounded-xl shadow-2xl bg-card overflow-hidden">
        <div className="di-gradient px-4 py-3 text-white flex items-center justify-between">
          <p className="font-display text-lg flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 shrink-0" />
            <span className="truncate">{title}</span>
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-white/85 flex items-center gap-1">
              {saveState === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Guardando...</>}
              {saveState === "dirty" && "Cambios sin guardar"}
              {(saveState === "saved" || saveState === "clean") && "Guardado automaticamente"}
            </span>
            <button onClick={handleClose} className="text-white/80 hover:text-white" title="Cerrar (se guarda solo)">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {editor && (
          <div className="flex items-center gap-0.5 px-3 py-2 border-b bg-secondary/50 flex-wrap">
            <button className={tb(editor.isActive("bold"))} onClick={() => editor.chain().focus().toggleBold().run()} title="Negrita"><Bold className="h-4 w-4" /></button>
            <button className={tb(editor.isActive("italic"))} onClick={() => editor.chain().focus().toggleItalic().run()} title="Cursiva"><Italic className="h-4 w-4" /></button>
            <button className={tb(editor.isActive("strike"))} onClick={() => editor.chain().focus().toggleStrike().run()} title="Tachado"><Strikethrough className="h-4 w-4" /></button>
            <span className="w-px h-5 bg-border mx-1" />
            <button className={tb(editor.isActive("heading", { level: 2 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Titulo"><Heading2 className="h-4 w-4" /></button>
            <button className={tb(editor.isActive("heading", { level: 3 }))} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Subtitulo"><Heading3 className="h-4 w-4" /></button>
            <span className="w-px h-5 bg-border mx-1" />
            <button className={tb(editor.isActive("bulletList"))} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Viñetas"><List className="h-4 w-4" /></button>
            <button className={tb(editor.isActive("orderedList"))} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numeracion"><ListOrdered className="h-4 w-4" /></button>
            <span className="w-px h-5 bg-border mx-1" />
            <button className={tb(false)} onClick={() => editor.chain().focus().undo().run()} title="Deshacer"><Undo2 className="h-4 w-4" /></button>
            <button className={tb(false)} onClick={() => editor.chain().focus().redo().run()} title="Rehacer"><Redo2 className="h-4 w-4" /></button>
            <span className="flex-1" />
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={downloadDoc}>
              <Download className="h-3.5 w-3.5" /> Descargar .doc
            </Button>
          </div>
        )}

        {loading ? (
          <div className="min-h-[55vh] flex items-center justify-center">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
          </div>
        ) : (
          <EditorContent editor={editor} />
        )}
        <p className="text-[10px] text-muted-foreground px-4 py-2 border-t">
          El documento se guarda solo cada pocos segundos. Cualquier miembro de la mesa puede editarlo; veran los cambios la proxima vez que lo abran.
        </p>
      </div>
    </div>,
    document.body,
  );
}
