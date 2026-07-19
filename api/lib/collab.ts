import type { IncomingMessage } from "http";
import type { Duplex } from "stream";
import { createRequire as createRequireForWs } from "module";
import { setupWSConnection, setPersistence, docs } from "./ywsUtils";
import * as Y from "yjs";
import { and, eq } from "drizzle-orm";
import { getDb } from "../queries/connection";
import { documents, workspaceMembers } from "@db/schema";
import { getSessionFromRequest } from "./auth";

// "ws" se carga en tiempo de ejecucion (el empaquetado ESM no soporta
// el require interno de "ws"). Se usa un alias porque el banner del
// build ya importa "createRequire" a nivel global del paquete.
const nodeRequire = createRequireForWs(import.meta.url);
const { WebSocketServer } = nodeRequire("ws") as any;

/* ================================================================
   EDICION EN VIVO (colaboracion letra por letra, estilo Google Docs)
   - Usa Yjs + y-websocket sobre el MISMO puerto del servidor
     (ruta /collab/), sin abrir puertos nuevos.
   - Solo entran usuarios con sesion iniciada que sean miembros
     de la mesa a la que pertenece el documento.
   - El estado del documento se guarda en MySQL (documents.yjs_state):
     cuando se cierra la ultima conexion del documento y, por seguridad,
     cada 20 segundos mientras haya documentos abiertos.
   ================================================================ */

function docIdFromText(text: string): number | null {
  const m = text.match(/doc-(\d+)/);
  return m ? parseInt(m[1], 10) : null;
}

async function loadState(docId: number): Promise<Uint8Array | null> {
  try {
    const db = getDb();
    const row = await db.query.documents.findFirst({ where: eq(documents.id, docId) });
    if (!row || !(row as any).yjsState) return null;
    return new Uint8Array(Buffer.from((row as any).yjsState, "base64"));
  } catch (e: any) {
    console.error("[collab] No se pudo cargar el documento", docId, e.message);
    return null;
  }
}

async function saveState(docId: number, ydoc: Y.Doc): Promise<void> {
  try {
    const db = getDb();
    const b64 = Buffer.from(Y.encodeStateAsUpdate(ydoc)).toString("base64");
    await db.update(documents).set({ yjsState: b64 } as any).where(eq(documents.id, docId));
  } catch (e: any) {
    console.error("[collab] No se pudo guardar el documento", docId, e.message);
  }
}

// Solo puede abrir la conexion quien tenga sesion y pertenezca a la mesa del documento
async function allowConnection(req: IncomingMessage): Promise<boolean> {
  try {
    const session = getSessionFromRequest(req as any);
    if (!session) return false;
    const docId = docIdFromText(req.url || "");
    if (!docId) return false;
    const db = getDb();
    const doc = await db.query.documents.findFirst({ where: eq(documents.id, docId) });
    if (!doc) return false;
    if (session.role === "admin") return true;
    const member = await db.query.workspaceMembers.findFirst({
      where: and(
        eq(workspaceMembers.workspaceId, doc.workspaceId),
        eq(workspaceMembers.userId, session.userId),
      ),
    });
    return !!member;
  } catch (e: any) {
    console.error("[collab] Error verificando acceso:", e.message);
    return false;
  }
}

let started = false;

export function attachCollabServer(server: { on: (event: string, cb: (...args: any[]) => void) => void }): void {
  if (started) return;
  started = true;

  setPersistence({
    provider: null,
    bindState: async (docName: string, ydoc: Y.Doc) => {
      const docId = docIdFromText(docName);
      if (!docId) return;
      const state = await loadState(docId);
      if (state && state.length > 0) Y.applyUpdate(ydoc, state);
    },
    writeState: async (docName: string, ydoc: Y.Doc) => {
      const docId = docIdFromText(docName);
      if (docId) await saveState(docId, ydoc);
    },
  } as any);

  // Respaldo periodico: si el proceso se reinicia con gente escribiendo,
  // se pierden como maximo unos segundos de trabajo.
  setInterval(() => {
    try {
      (docs as Map<string, Y.Doc>).forEach((ydoc, name) => {
        const docId = docIdFromText(name);
        if (docId) void saveState(docId, ydoc);
      });
    } catch { /* nunca tumbar el proceso por el respaldo */ }
  }, 20000);

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req: IncomingMessage, socket: Duplex, head: Buffer) => {
    const url = req.url || "";
    if (!url.startsWith("/collab/")) {
      socket.destroy();
      return;
    }
    void allowConnection(req).then((ok) => {
      if (!ok) {
        socket.destroy();
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => {
        setupWSConnection(ws, req);
      });
    }).catch(() => socket.destroy());
  });

  console.log("[collab] Edicion en vivo lista en la ruta /collab/");
}
