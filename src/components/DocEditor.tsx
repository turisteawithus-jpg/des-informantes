import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, EditorContent } from "@tiptap/react";
import type { Editor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCursor from "@tiptap/extension-collaboration-cursor";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { Document, Packer, Paragraph, TextRun, HeadingLevel } from "docx";
import { Button } from "@/components/ui/button";
import {
  Loader2, X, Bold, Italic, Strikethrough, Heading2, Heading3,
  List, ListOrdered, Undo2, Redo2, Download, FileText, Users,
} from "lucide-react";

/* ================================================================
   Documento en linea de DES Informantes
   - EDICION EN VIVO (modo principal): varias personas escriben al
     mismo tiempo, letra por letra, con cursores de colores y nombre.
     Funciona con Yjs sobre el mismo servidor (ruta /collab/).
   - MODO CLASICO (respaldo automatico): si la conexion en vivo no
     responde en 5 segundos, el documento abre igual con guardado
     automatico y actualizacion cada pocos segundos.
   - En ambos modos: descarga en .docx real en cualquier momento.
   ================================================================ */

const EDITOR_CLASS =
  "min-h-[55vh] max-h-[55vh] overflow-y-auto p-4 outline-none text-sm leading-relaxed bg-white rounded-b-xl";

type SaveState = "clean" | "dirty" | "saving" | "saved";
type CollabBundle = { ydoc: Y.Doc; provider: WebsocketProvider };

/* Convierte el HTML del editor a corridas de texto (negrita/cursiva/tachado) */
function textRunsFrom(el: Element): TextRun[] {
  const runs: TextRun[] = [];
  el.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const parent = n.parentElement;
      const bold = !!parent?.closest("strong,b");
      const italics = !!parent?.closest("em,i");
      const strike = !!parent?.closest("s,del");
      if (n.textContent) runs.push(new TextRun({ text: n.textContent, bold, italics, strike }));
    } else if (n.nodeType === 1) {
      runs.push(...textRunsFrom(n as Element));
    }
  });
  return runs;
}

/* Convierte el HTML del editor a un .docx real (titulos, parrafos, listas) */
function htmlToDocx(html: string, title: string): Document {
  const dom = new DOMParser().parseFromString(html, "text/html");
  const children: Paragraph[] = [
    new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: title, bold: true })] }),
  ];
  dom.body.childNodes.forEach((n) => {
    if (n.nodeType !== 1) return;
    const el = n as Element;
    const tag = el.tagName.toLowerCase();
    if (/^h[1-6]$/.test(tag)) {
      const lvl = tag === "h1" ? HeadingLevel.HEADING_1 : tag === "h2" ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3;
      children.push(new Paragraph({ heading: lvl, children: textRunsFrom(el) }));
    } else if (tag === "ul" || tag === "ol") {
      el.querySelectorAll(":scope > li").forEach((li) => {
        children.push(new Paragraph({ bullet: { level: 0 }, children: textRunsFrom(li) }));
      });
    } else if (tag === "blockquote") {
      children.push(new Paragraph({ children: textRunsFrom(el), indent: { left: 400 } }));
    } else {
      children.push(new Paragraph({ children: textRunsFrom(el) }));
    }
  });
  if (children.length === 1) children.push(new Paragraph({ children: [] }));
  return new Document({ sections: [{ children }] });
}

/* Color estable por nombre de usuario (para el cursor en vivo) */
const COLLAB_COLORS = ["#e8590c", "#7048e8", "#2f9e44", "#1971c2", "#c2255c", "#0c8599", "#f08c00", "#862e9c"];
function colorFor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return COLLAB_COLORS[h % COLLAB_COLORS.length];
}

/* Estilos de los cursores de otras personas (etiqueta con su nombre) */
const CURSOR_CSS = `
.collaboration-cursor__caret { position: relative; margin-left: -1px; margin-right: -1px; border-left: 1px solid; border-right: 1px solid; word-break: normal; pointer-events: none; }
.collaboration-cursor__label { position: absolute; top: -1.35em; left: -1px; padding: 0.08rem 0.35rem; border-radius: 4px 4px 4px 0; color: #ffffff; font-size: 11px; font-weight: 600; line-height: normal; white-space: nowrap; user-select: none; }
`;

async function putContent(docId: number, html: string): Promise<void> {
  await fetch(`/api/rest/workspaces/documents/${docId}/content`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content: html }),
    credentials: "include",
  });
}

/* Guardado automatico compartido por ambos modos: cada 4s si hay cambios */
function useAutosave(
  editorRef: React.MutableRefObject<Editor | null>,
  docId: number,
  dirtyRef: React.MutableRefObject<boolean>,
  setSaveState: (s: SaveState) => void,
) {
  useEffect(() => {
    const iv = setInterval(async () => {
      const ed = editorRef.current;
      if (!ed || !dirtyRef.current) return;
      const html = ed.getHTML();
      dirtyRef.current = false;
      setSaveState("saving");
      try {
        await putContent(docId, html);
        setSaveState("saved");
      } catch {
        dirtyRef.current = true;
        setSaveState("dirty");
      }
    }, 4000);
    return () => clearInterval(iv);
  }, [editorRef, docId, dirtyRef, setSaveState]);
}

async function downloadDocx(editor: Editor | null, title: string) {
  if (!editor) return;
  const doc = htmlToDocx(editor.getHTML(), title);
  const blob = await Packer.toBlob(doc);
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${title.replace(/[^a-zA-Z0-9 _-]/g, "").slice(0, 60).trim() || "documento"}.docx`;
  a.click();
  URL.revokeObjectURL(a.href);
}

/* Marco visual compartido: encabezado, barra de herramientas, cuerpo y pie */
function EditorShell({
  editor, title, live, peers, loading, saveState, onClose,
}: {
  editor: Editor | null;
  title: string;
  live: boolean;
  peers: number;
  loading: boolean;
  saveState: SaveState;
  onClose: () => void;
}) {
  const tb = (active: boolean) =>
    `p-1.5 rounded-md ${active ? "bg-primary text-white" : "text-muted-foreground hover:bg-secondary"}`;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4">
      <style>{CURSOR_CSS}</style>
      <div className="w-full max-w-3xl border-2 rounded-xl shadow-2xl bg-card overflow-hidden">
        <div className="di-gradient px-4 py-3 text-white flex items-center justify-between">
          <p className="font-display text-lg flex items-center gap-2 min-w-0">
            <FileText className="h-5 w-5 shrink-0" />
            <span className="truncate">{title}</span>
            {live && (
              <span className="shrink-0 text-[11px] font-normal bg-white/20 rounded-full px-2.5 py-0.5 flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-300 animate-pulse" />
                En vivo{peers > 1 ? ` · ${peers} personas` : ""}
              </span>
            )}
          </p>
          <div className="flex items-center gap-3 shrink-0">
            <span className="text-[11px] text-white/85 flex items-center gap-1">
              {saveState === "saving" && <><Loader2 className="h-3 w-3 animate-spin" /> Guardando...</>}
              {saveState === "dirty" && "Cambios sin guardar"}
              {(saveState === "saved" || saveState === "clean") && "Guardado automaticamente"}
            </span>
            <button onClick={onClose} className="text-white/80 hover:text-white" title="Cerrar (se guarda solo)">
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
            <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => void downloadDocx(editor, title)}>
              <Download className="h-3.5 w-3.5" /> Descargar .docx
            </Button>
          </div>
        )}

        {loading || !editor ? (
          <div className="min-h-[55vh] flex flex-col items-center justify-center gap-2">
            <Loader2 className="h-7 w-7 animate-spin text-primary" />
            <p className="text-xs text-muted-foreground">Abriendo el documento...</p>
          </div>
        ) : (
          <EditorContent editor={editor} />
        )}
        <p className="text-[10px] text-muted-foreground px-4 py-2 border-t flex items-center gap-1.5">
          <Users className="h-3 w-3 shrink-0" />
          {live
            ? "Estas editando en vivo: si otra persona de la mesa abre este documento, veras su cursor con su nombre y podran escribir al mismo tiempo. Todo se guarda solo."
            : "Documento compartido: lo que escribes se guarda solo, y mientras lees, los cambios de los demas aparecen cada pocos segundos."}
        </p>
      </div>
    </div>,
    document.body,
  );
}

/* Cuerpo en modo EN VIVO: colaboracion letra por letra con Yjs */
function LiveBody({
  docId, title, username, collab, getSeed, onClose,
}: {
  docId: number;
  title: string;
  username: string;
  collab: CollabBundle;
  getSeed: () => Promise<string>;
  onClose: () => void;
}) {
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [peers, setPeers] = useState(1);
  const dirtyRef = useRef(false);
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ history: false }),
      Collaboration.configure({ document: collab.ydoc }),
      CollaborationCursor.configure({
        provider: collab.provider,
        user: { name: username, color: colorFor(username) },
      }),
    ],
    editorProps: { attributes: { class: EDITOR_CLASS } },
    onCreate: ({ editor: ed }) => {
      // Si el documento compartido esta vacio, sembrarlo con lo que haya guardado la base
      void (async () => {
        const seed = await getSeed();
        if (!seed || seed === "<p></p>") return;
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 450));
        if (!ed.isDestroyed && ed.isEmpty) ed.commands.setContent(seed);
      })();
    },
    onUpdate: () => {
      dirtyRef.current = true;
      setSaveState("dirty");
    },
  }, []);
  editorRef.current = editor;

  // Conteo de personas conectadas (para la pastilla "En vivo")
  useEffect(() => {
    const aw = collab.provider.awareness;
    const update = () => setPeers(aw.getStates().size);
    aw.on("change", update);
    update();
    return () => { aw.off("change", update); };
  }, [collab]);

  useAutosave(editorRef, docId, dirtyRef, setSaveState);

  async function handleClose() {
    if (editorRef.current && dirtyRef.current) {
      setSaveState("saving");
      try { await putContent(docId, editorRef.current.getHTML()); } catch { /* queda para el autoguardado */ }
    }
    onClose();
  }

  return (
    <EditorShell
      editor={editor}
      title={title}
      live
      peers={peers}
      loading={!editor}
      saveState={saveState}
      onClose={() => void handleClose()}
    />
  );
}

/* Cuerpo en modo CLASICO (respaldo): guardado automatico + refresco cada 4s */
function ClassicBody({
  docId, title, onClose,
}: {
  docId: number;
  title: string;
  onClose: () => void;
}) {
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const dirtyRef = useRef(false);
  const lastRemoteRef = useRef<string>("");
  const editorRef = useRef<Editor | null>(null);

  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p></p>",
    editorProps: { attributes: { class: EDITOR_CLASS } },
    onUpdate: () => {
      dirtyRef.current = true;
      setSaveState("dirty");
    },
  }, []);
  editorRef.current = editor;

  // Carga inicial del contenido
  useEffect(() => {
    if (!editor) return;
    (async () => {
      try {
        const res = await fetch(`/api/rest/workspaces/documents/${docId}/content`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          const content = data.content || "<p></p>";
          lastRemoteRef.current = content;
          editor.commands.setContent(content);
          dirtyRef.current = false;
          setSaveState("clean");
        }
      } catch (e) { console.error(e); }
      setLoading(false);
    })();
  }, [docId, editor]);

  useAutosave(editorRef, docId, dirtyRef, setSaveState);

  // Refresco de cambios de otros (solo si tu no estas escribiendo)
  useEffect(() => {
    const iv = setInterval(async () => {
      const ed = editorRef.current;
      if (!ed) return;
      try {
        const res = await fetch(`/api/rest/workspaces/documents/${docId}/content`, { credentials: "include" });
        if (!res.ok) return;
        const data = await res.json();
        const remote = data.content || "<p></p>";
        if (remote !== lastRemoteRef.current) {
          lastRemoteRef.current = remote;
          if (!dirtyRef.current && ed.getHTML() !== remote) {
            ed.commands.setContent(remote);
            setSaveState("clean");
          }
        }
      } catch { /* sin conexion, se reintenta en el siguiente ciclo */ }
    }, 4000);
    return () => clearInterval(iv);
  }, [docId]);

  async function handleClose() {
    if (editorRef.current && dirtyRef.current) {
      setSaveState("saving");
      try { await putContent(docId, editorRef.current.getHTML()); } catch { /* el ultimo cambio se reintentara */ }
    }
    onClose();
  }

  return (
    <EditorShell
      editor={editor}
      title={title}
      live={false}
      peers={1}
      loading={loading || !editor}
      saveState={saveState}
      onClose={() => void handleClose()}
    />
  );
}

/**
 * Componente principal: intenta la edicion en vivo y, si el canal no
 * responde en 5 segundos, abre el modo clasico sin que el usuario note
 * mas que una pequeña espera.
 */
export function DocEditor({
  docId,
  title,
  username,
  onClose,
}: {
  docId: number;
  title: string;
  username: string;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<"connecting" | "live" | "classic">("connecting");
  const [collab, setCollab] = useState<CollabBundle | null>(null);
  const seedPromiseRef = useRef<Promise<string> | null>(null);

  // HTML guardado en la base: sirve de semilla si el documento en vivo esta vacio
  useEffect(() => {
    seedPromiseRef.current = fetch(`/api/rest/workspaces/documents/${docId}/content`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d?.content || "")
      .catch(() => "");
  }, [docId]);

  // Conexion en vivo con respaldo automatico al modo clasico
  useEffect(() => {
    const ydoc = new Y.Doc();
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    const provider = new WebsocketProvider(`${proto}://${window.location.host}/collab`, `doc-${docId}`, ydoc);
    let resolved = false;
    const goLive = () => {
      if (resolved) return;
      resolved = true;
      setCollab({ ydoc, provider });
      setMode("live");
    };
    provider.on("synced", (state: boolean) => { if (state) goLive(); });
    if (provider.synced) goLive();
    const timer = setTimeout(() => {
      if (resolved) return;
      resolved = true;
      provider.destroy();
      ydoc.destroy();
      setMode("classic");
    }, 5000);
    return () => {
      clearTimeout(timer);
      provider.destroy();
      ydoc.destroy();
    };
  }, [docId]);

  if (mode === "live" && collab) {
    return (
      <LiveBody
        docId={docId}
        title={title}
        username={username}
        collab={collab}
        getSeed={() => seedPromiseRef.current ?? Promise.resolve("")}
        onClose={onClose}
      />
    );
  }
  if (mode === "classic") {
    return <ClassicBody docId={docId} title={title} onClose={onClose} />;
  }
  // Conectando: marco con indicador de carga
  return (
    <EditorShell
      editor={null}
      title={title}
      live={false}
      peers={1}
      loading
      saveState="clean"
      onClose={onClose}
    />
  );
}
