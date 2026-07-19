/* ================================================================
   Servidor de colaboracion Yjs sobre WebSocket.
   Puerto fiel (a ESM) de "y-websocket/bin/utils" v1.5.4 (MIT,
   (c) Kevin Jahns), con dos recortes deliberados:
   - Sin persistencia en LevelDB: la persistencia es propia (MySQL).
   - Sin webhook de callback: no se usa en esta plataforma.
   Expone la misma API: docs, setPersistence, getYDoc, setupWSConnection.
   ================================================================ */

import * as Y from "yjs";
import * as syncProtocol from "y-protocols/sync";
import * as awarenessProtocol from "y-protocols/awareness";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import * as map from "lib0/map";

const messageSync = 0;
const messageAwareness = 1;

const wsReadyStateConnecting = 0;
const wsReadyStateOpen = 1;

const pingTimeout = 30000;

// disable gc when using snapshots! (GC !== "false" y GC !== "0")
const gcEnabled = process.env.GC !== "false" && process.env.GC !== "0";

type Persistence = {
  bindState: (docName: string, ydoc: WSSharedDoc) => void | Promise<void>;
  writeState: (docName: string, ydoc: WSSharedDoc) => Promise<any>;
  provider?: any;
};

let persistence: Persistence | null = null;

export const setPersistence = (persistence_: Persistence | null): void => {
  persistence = persistence_;
};

export const getPersistence = (): Persistence | null => persistence;

export const docs: Map<string, WSSharedDoc> = new Map();

const updateHandler = (update: Uint8Array, _origin: any, doc: WSSharedDoc): void => {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, messageSync);
  syncProtocol.writeUpdate(encoder, update);
  const buff = encoding.toUint8Array(encoder);
  doc.conns.forEach((_, c) => {
    send(doc, c, buff);
  });
};

class WSSharedDoc extends Y.Doc {
  name: string;
  conns: Map<any, Set<number>>;
  awareness: awarenessProtocol.Awareness;

  constructor(name: string) {
    super({ gc: gcEnabled });
    this.name = name;
    this.conns = new Map();
    this.awareness = new awarenessProtocol.Awareness(this);
    this.awareness.setLocalState(null);

    const awarenessChangeHandler = (
      { added, updated, removed }: { added: number[]; updated: number[]; removed: number[] },
      conn: any | null,
    ) => {
      const changedClients = added.concat(updated, removed);
      if (conn !== null) {
        const connControlledIDs = this.conns.get(conn);
        if (connControlledIDs !== undefined) {
          added.forEach((clientID) => { connControlledIDs.add(clientID); });
          removed.forEach((clientID) => { connControlledIDs.delete(clientID); });
        }
      }
      // broadcast awareness update
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageAwareness);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClients),
      );
      const buff = encoding.toUint8Array(encoder);
      this.conns.forEach((_, c) => {
        send(this, c, buff);
      });
    };
    this.awareness.on("update", awarenessChangeHandler);
    this.on("update", updateHandler);
  }
}

export const getYDoc = (docname: string, gc = true): WSSharedDoc =>
  map.setIfUndefined(docs, docname, () => {
    const doc = new WSSharedDoc(docname);
    doc.gc = gc;
    if (persistence !== null) {
      void persistence.bindState(docname, doc);
    }
    docs.set(docname, doc);
    return doc;
  });

const messageListener = (conn: any, doc: WSSharedDoc, message: Uint8Array): void => {
  try {
    const encoder = encoding.createEncoder();
    const decoder = decoding.createDecoder(message);
    const messageType = decoding.readVarUint(decoder);
    switch (messageType) {
      case messageSync:
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.readSyncMessage(decoder, encoder, doc, conn);
        // Si el encoder solo tiene el tipo de respuesta y ningun mensaje,
        // no hay necesidad de enviar nada (length 1 = solo el tipo).
        if (encoding.length(encoder) > 1) {
          send(doc, conn, encoding.toUint8Array(encoder));
        }
        break;
      case messageAwareness: {
        awarenessProtocol.applyAwarenessUpdate(
          doc.awareness,
          decoding.readVarUint8Array(decoder),
          conn,
        );
        break;
      }
    }
  } catch (err) {
    console.error(err);
    doc.emit("error", [err]);
  }
};

const closeConn = (doc: WSSharedDoc, conn: any): void => {
  if (doc.conns.has(conn)) {
    const controlledIds = doc.conns.get(conn) as Set<number>;
    doc.conns.delete(conn);
    awarenessProtocol.removeAwarenessStates(doc.awareness, Array.from(controlledIds), null);
    if (doc.conns.size === 0 && persistence !== null) {
      // si hay persistencia, guardar el estado y destruir el documento
      persistence.writeState(doc.name, doc).then(() => {
        doc.destroy();
      });
      docs.delete(doc.name);
    }
  }
  conn.close();
};

const send = (doc: WSSharedDoc, conn: any, m: Uint8Array): void => {
  if (conn.readyState !== wsReadyStateConnecting && conn.readyState !== wsReadyStateOpen) {
    closeConn(doc, conn);
  }
  try {
    conn.send(m, (err: any) => { err != null && closeConn(doc, conn); });
  } catch (e) {
    closeConn(doc, conn);
  }
};

export const setupWSConnection = (
  conn: any,
  req: any,
  { docName = (req.url || "").slice(1).split("?")[0], gc = true }: { docName?: string; gc?: boolean } = {},
): void => {
  conn.binaryType = "arraybuffer";
  // obtener el documento; crearlo si no existe
  const doc = getYDoc(docName, gc);
  doc.conns.set(conn, new Set());
  // escuchar y responder eventos
  conn.on("message", (message: ArrayBuffer) => messageListener(conn, doc, new Uint8Array(message)));

  // verificar que la conexion siga viva (ping/pong)
  let pongReceived = true;
  const pingInterval = setInterval(() => {
    if (!pongReceived) {
      if (doc.conns.has(conn)) {
        closeConn(doc, conn);
      }
      clearInterval(pingInterval);
    } else if (doc.conns.has(conn)) {
      pongReceived = false;
      try {
        conn.ping();
      } catch (e) {
        closeConn(doc, conn);
        clearInterval(pingInterval);
      }
    }
  }, pingTimeout);
  conn.on("close", () => {
    closeConn(doc, conn);
    clearInterval(pingInterval);
  });
  conn.on("pong", () => {
    pongReceived = true;
  });

  {
    // enviar sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    send(doc, conn, encoding.toUint8Array(encoder));
    const awarenessStates = doc.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(doc.awareness, Array.from(awarenessStates.keys())),
      );
      send(doc, conn, encoding.toUint8Array(awarenessEncoder));
    }
  }
};
