import { Fragment, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import {
  Send, Loader2, Mic, MessageSquareText, Sparkles, ScrollText,
  ArrowLeft, Lock, Volume2, Pin, PinOff, Trash2, Pencil, X, Plus,
  CheckCircle2, ListOrdered, Hand, ChevronRight, ChevronDown,
  ChevronUp, Paperclip, Link2, FileText, Milestone, Handshake,
  FilePlus2, FilePenLine,
} from "lucide-react";
import { uploadDocument } from "@/lib/upload";
import { DocEditor } from "@/components/DocEditor";

const PHASE_INFO: Record<string, { name: string; desc: string }> = {
  apertura: { name: "Apertura", desc: "Se presenta el tema central y las reglas del dialogo. Cada participante se ubica frente al tema." },
  contextualizacion: { name: "Contextualizacion", desc: "Se ubica el tema en su contexto: antecedentes, datos y situacion actual del asunto a tratar." },
  comprension: { name: "Comprension", desc: "Cada participante expresa su entendimiento del tema. Se aclaran dudas y terminos." },
  sintesis_parcial: { name: "Sintesis parcial", desc: "Se resume lo dicho hasta ahora y el grupo verifica que todos esten en la misma pagina." },
  profundizacion: { name: "Profundizacion", desc: "Se exploran en detalle los puntos mas importantes o que generan mas debate." },
  coincidencias_diferencias: { name: "Coincidencias y diferencias", desc: "Se identifican abiertamente los acuerdos y desacuerdos entre los participantes." },
  alternativas: { name: "Alternativas", desc: "Se proponen opciones y soluciones para cada punto de discusion sobre la mesa." },
  evaluacion: { name: "Evaluacion", desc: "Se valoran las alternativas propuestas: ventajas, desventajas y viabilidad real." },
  acuerdo: { name: "Acuerdo", desc: "Se construye consenso alrededor de las mejores alternativas disponibles." },
  conclusion: { name: "Conclusion", desc: "Se formulan las conclusiones finales del tema." },
  compromisos: { name: "Compromisos", desc: "Se definen compromisos concretos, responsables y proximos pasos." },
};

function phaseName(key: string | undefined) {
  return (key && PHASE_INFO[key]?.name) || "Apertura";
}

// Separa el cuerpo de la conclusion de sus compromisos estructurados
// (formato: "- texto | Responsable: X | Fecha: Y")
function splitCommitments(content: string): {
  main: string;
  commitments: { text: string; responsable: string; fecha: string }[];
} {
  const idx = (content || "").indexOf("## Compromisos asumidos");
  if (idx < 0) return { main: content || "", commitments: [] };
  const main = content.slice(0, idx);
  const block = content.slice(idx).replace("## Compromisos asumidos", "");
  const commitments = block
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith("-") || l.startsWith("*"))
    .map((l) => {
      const clean = l.replace(/^[-*]\s*/, "");
      const parts = clean.split("|").map((p) => p.trim());
      let responsable = "Por definir";
      let fecha = "Sin fecha";
      for (const p of parts.slice(1)) {
        const m = p.match(/^(responsable|fecha)\s*:\s*(.+)$/i);
        if (m) {
          if (m[1].toLowerCase() === "responsable") responsable = m[2];
          else fecha = m[2];
        }
      }
      return { text: parts[0] || clean, responsable, fecha };
    });
  return { main, commitments };
}

// Vista previa del recuadro secundario: el ANALISIS de lo que se discutio
// (cuerpo de las secciones de la conclusion, sin los titulos de seccion)
function sectionSnippet(content: string, max = 140): string {
  const { main } = splitCommitments(content);
  const body = main
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith("#"))
    .join(" ")
    .replace(/[#*>`]/g, "")
    .trim();
  return body.slice(0, max);
}

// Tarjeta de documento en linea dentro del chat: cualquier usuario la abre
function DocMessageCard({
  content,
  mine,
  onOpen,
}: {
  content: string;
  mine: boolean;
  onOpen: (id: number, title: string) => void;
}) {
  const match = content.match(/\[\[doc:(\d+)\]\]\s*([\s\S]*)/);
  if (!match) return <p className="text-sm whitespace-pre-wrap leading-relaxed">{content}</p>;
  const docTitle = (match[2] || "Documento en linea").trim();
  return (
    <button
      onClick={() => onOpen(Number(match[1]), docTitle)}
      className={`flex items-center gap-2.5 rounded-xl border-2 border-dashed px-3 py-2.5 text-left transition-colors min-w-[260px] ${
        mine
          ? "border-white/60 bg-white/10 hover:bg-white/20 text-white"
          : "border-primary/50 bg-primary/5 hover:border-primary"
      }`}
    >
      <FilePenLine className="h-6 w-6 shrink-0" />
      <span>
        <span className="block text-[10px] uppercase tracking-wide opacity-80">Documento en linea · editable por todos</span>
        <span className="block text-sm font-semibold leading-tight">{docTitle}</span>
        <span className="block text-[10px] opacity-70 mt-0.5">Toca para abrirlo y editarlo en tiempo real</span>
      </span>
    </button>
  );
}

type Overlay = {
  kind: "activated" | "topics" | "topic" | "phase" | "finished" | "round" | "decision" | "waiting" | "welcomeback";
  phase?: string;
  prevPhase?: string;
  text?: string;
} | null;

export default function DiscussionRoom() {
  const { id } = useParams<{ id: string }>();
  const discussionId = Number(id);
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin: isGeneralAdmin, isLoading: authLoading } = useAuth();

  const [discussion, setDiscussion] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [summaries, setSummaries] = useState<any[]>([]);
  const [relatoria, setRelatoria] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Moderador IA (automatico, por temas)
  const [modState, setModState] = useState<any>(null);
  const [modOpen, setModOpen] = useState(false);
  const [modTab, setModTab] = useState<"temas" | "relatoria" | "resumenes">("temas");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [addingTopic, setAddingTopic] = useState(false);
  const [newTopic, setNewTopic] = useState("");
  const [savingTopic, setSavingTopic] = useState(false);
  const prevTopicsCountRef = useRef<number | null>(null);
  const prevTopicIdxRef = useRef<number | null>(null);
  const prevPhaseRef = useRef<string | null>(null);
  const prevActiveRef = useRef<boolean>(false);
  const prevWordRoundRef = useRef<number | null>(null);
  const prevRoundCompleteRef = useRef<boolean>(false);
  const [overlayStep, setOverlayStep] = useState<1 | 2>(1);
  const [deciding, setDeciding] = useState<"round" | "advance" | null>(null);
  const [raisingHand, setRaisingHand] = useState(false);

  // Linea de tiempo: documentos anclados + notas de temas + plegado por tema
  const [docsList, setDocsList] = useState<any[]>([]);
  const [topicInfos, setTopicInfos] = useState<Record<number, { desc: string | null; status?: string }>>({});
  const [expandedTopics, setExpandedTopics] = useState<Record<number, boolean>>({});
  const [docFor, setDocFor] = useState<{ conclusionId: number | null; topicTitle: string } | null>(null);
  const [docTitle, setDocTitle] = useState("");
  const [docUrl, setDocUrl] = useState("");
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docSaving, setDocSaving] = useState(false);
  // Editor en linea + modales de la linea de tiempo
  const [editorDoc, setEditorDoc] = useState<{ id: number; title: string } | null>(null);
  const [conclModal, setConclModal] = useState<any | null>(null);
  const [commitModal, setCommitModal] = useState<any | null>(null);
  const [newDocOpen, setNewDocOpen] = useState(false);
  const [newDocTitle, setNewDocTitle] = useState("");
  const [newDocSaving, setNewDocSaving] = useState(false);

  // Moderacion de mensajes: admin general (en cualquier chat) o admin de ESTA mesa
  const canModerate = discussion?.memberRole === "admin" || isGeneralAdmin;
  const isOpen = discussion?.status === "open";

  async function fetchDiscussion() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDiscussion(data);
      }
    } catch (e) { console.error(e); }
  }

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/messages`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  }

  async function fetchSummaries() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/summaries`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setSummaries(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  }

  async function fetchRelatoria() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/relatoria`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setRelatoria(data);
      }
    } catch (e) { console.error(e); }
  }

  async function fetchModState() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/moderation-state`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setModState(data);
      } else {
        setModState(null);
      }
    } catch (e) { console.error(e); }
  }

  async function fetchDocs() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/docs`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setDocsList(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
  }

  async function loadAll() {
    setLoading(true);
    await Promise.all([fetchDiscussion(), fetchMessages(), fetchSummaries(), fetchRelatoria(), fetchModState(), fetchDocs()]);
    setLoading(false);
  }

  useEffect(() => {
    if (!isAuthenticated || !discussionId) return;
    loadAll();
  }, [isAuthenticated, discussionId]);

  useEffect(() => {
    if (!isAuthenticated || !isOpen) return;
    const iv = setInterval(() => {
      fetchMessages();
      fetchSummaries();
      fetchModState();
    }, 4000);
    return () => clearInterval(iv);
  }, [isAuthenticated, isOpen, discussionId]);

  useEffect(() => {
    if (discussion?.status === "closed") fetchRelatoria();
  }, [discussion?.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  // Deteccion de transiciones del moderador
  const currentPhase: string | undefined = modState?.state?.currentPhase;
  const modActiveNow = !!modState?.state?.active;
  const topicsList: string[] = modState?.state?.topics ?? [];
  const topicIdx: number = modState?.state?.currentTopicIndex ?? 0;
  const wordRound: number = modState?.state?.wordRound ?? 1;

  // El moderador (persona): quien activo el moderador, admin de la mesa o admin general.
  // SOLO esta persona ve la pregunta "otra ronda o siguiente momento".
  const canDecide =
    !!user &&
    (user.userId === modState?.state?.activatedBy ||
      discussion?.memberRole === "admin" ||
      isGeneralAdmin);

  useEffect(() => {
    if (!modState?.state) return;
    if (!modActiveNow) {
      prevTopicsCountRef.current = topicsList.length;
      prevTopicIdxRef.current = topicIdx;
      prevPhaseRef.current = currentPhase ?? null;
      prevWordRoundRef.current = wordRound;
      return;
    }
    // 1. Se acaban de definir los temas (primera ronda completada)
    if (prevTopicsCountRef.current === 0 && topicsList.length > 0) {
      setOverlay({ kind: "topics" });
    }
    // 2. Se concluyo un tema y arranca el siguiente
    else if (
      topicsList.length > 0 &&
      prevTopicIdxRef.current !== null &&
      topicIdx !== prevTopicIdxRef.current
    ) {
      setOverlay({ kind: "topic", phase: currentPhase });
    }
    // 3. El moderador abrio un nuevo momento (cambio de fase dentro del mismo tema)
    else if (
      topicsList.length > 0 &&
      prevPhaseRef.current &&
      prevPhaseRef.current !== currentPhase
    ) {
      setOverlay({ kind: "phase", phase: currentPhase, prevPhase: prevPhaseRef.current });
    }
    // 4. El moderador pidio OTRA ronda de palabras (mismo tema y fase, cambia la ronda)
    else if (
      prevWordRoundRef.current !== null &&
      wordRound !== prevWordRoundRef.current
    ) {
      setOverlay({ kind: "round" });
    }
    prevTopicsCountRef.current = topicsList.length;
    prevTopicIdxRef.current = topicIdx;
    prevPhaseRef.current = currentPhase ?? null;
    prevWordRoundRef.current = wordRound;
  }, [currentPhase, topicIdx, topicsList.length, modActiveNow, wordRound]);

  // Cuando la ronda se completa: el moderador (persona) ve la decision;
  // los demas usuarios ven el aviso de espera con la opcion de pedir la palabra.
  // La ronda se completa igual en la ronda de propuestas (sin temas aun)
  // que en los momentos: en ambos casos el moderador decide que sigue.
  const roundCompleteNow =
    modActiveNow &&
    (modState?.state?.interventionsCompleted ?? 0) >= (modState?.state?.interventionsRequired ?? 5);
  useEffect(() => {
    if (roundCompleteNow && !prevRoundCompleteRef.current) {
      if (canDecide) setOverlay((cur) => cur ?? { kind: "decision" });
      else setOverlay((cur) => cur ?? { kind: "waiting" });
    }
    prevRoundCompleteRef.current = roundCompleteNow;
  }, [roundCompleteNow, canDecide]);

  // Bienvenida del moderador: la PRIMERA vez se explica la propuesta de temas.
  // En cada REINGRESO posterior, la IA recibe al usuario por su nombre y lo
  // contextualiza: en que momento va la discusion y que ha pasado en este tema.
  useEffect(() => {
    if (!modState?.state?.active) return;
    const key = `di-mod-welcome-${discussionId}`;
    if (!localStorage.getItem(key)) {
      localStorage.setItem(key, "1");
      setOverlay((cur) => cur ?? { kind: "activated" });
      return;
    }
    if (topicsList.length === 0) return;
    (async () => {
      try {
        const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/welcome-back`, { credentials: "include" });
        if (res.ok) {
          const data = await res.json();
          if (data.text) setOverlay((cur) => cur ?? { kind: "welcomeback", text: data.text });
        }
      } catch { /* sin bienvenida de reingreso, no pasa nada */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modState?.state?.active, discussionId, topicsList.length]);

  // Notas (block) del recuadro principal de cada tema. La nota solo existe
  // cuando el tema ya CONCLUYO; en curso o pendiente solo se muestra el nombre.
  useEffect(() => {
    if (topicsList.length === 0) return;
    topicsList.forEach((_t, i) => {
      if (topicInfos[i]) return;
      (async () => {
        try {
          const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/topic-info?index=${i}`, { credentials: "include" });
          if (res.ok) {
            const data = await res.json();
            setTopicInfos((prev) => ({ ...prev, [i]: { desc: data.desc ?? null, status: data.status ?? "listo" } }));
          }
        } catch { /* la nota queda pendiente para la proxima carga */ }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topicsList.length, discussionId]);

  // Cada anuncio nuevo arranca en su primer paso
  useEffect(() => {
    setOverlayStep(1);
  }, [overlay?.kind, overlay?.phase]);

  // Cuando el moderador termina todos los temas
  useEffect(() => {
    if (prevActiveRef.current && !modActiveNow && (modState?.conclusions?.length ?? 0) > 0) {
      setOverlay({ kind: "finished" });
    }
    prevActiveRef.current = modActiveNow;
  }, [modActiveNow]);

  async function sendTextMsg(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim(), type: "text" }),
        credentials: "include",
      });
      if (res.ok) {
        setText("");
        await fetchMessages();
        await fetchSummaries();
        await fetchModState();
      }
    } catch (e) { console.error(e); }
    setSending(false);
  }

  async function closeDisc() {
    if (!confirm("Cerrar la discusion? Se generara la relatoria con IA.")) return;
    setClosing(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/close`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchDiscussion();
        await fetchRelatoria();
        setOverlay(null);
      }
    } catch (e) { console.error(e); }
    setClosing(false);
  }

  async function togglePin(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    const endpoint = msg.pinned
      ? `/api/rest/workspaces/messages/${msgId}/unpin`
      : `/api/rest/workspaces/messages/${msgId}/pin`;
    try {
      const res = await fetch(endpoint, { method: "POST", credentials: "include" });
      if (res.ok) fetchMessages();
    } catch (e) { console.error(e); }
  }

  async function deleteMsg(msgId: number) {
    if (!confirm("Eliminar este mensaje?")) return;
    try {
      const res = await fetch(`/api/rest/workspaces/messages/${msgId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) fetchMessages();
    } catch (e) { console.error(e); }
  }

  async function editMsg(msgId: number) {
    if (!editText.trim()) return;
    try {
      const res = await fetch(`/api/rest/workspaces/messages/${msgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText.trim() }),
        credentials: "include",
      });
      if (res.ok) { setEditingId(null); setEditText(""); fetchMessages(); }
    } catch (e) { console.error(e); }
  }

  async function activateModerator() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/activate-moderator`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchModState();
        setOverlay({ kind: "activated" });
      }
    } catch (e) { console.error(e); }
  }

  async function addTopic() {
    if (!newTopic.trim() || savingTopic) return;
    setSavingTopic(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: newTopic.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        setNewTopic("");
        setAddingTopic(false);
        await fetchModState();
      }
    } catch (e) { console.error(e); }
    setSavingTopic(false);
  }

  // El moderador (persona) decide: OTRA ronda de palabras
  async function decideNextRound() {
    if (deciding) return;
    setDeciding("round");
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/next-round`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setOverlay(null);
        await fetchModState(); // el cambio de ronda dispara el anuncio breve para TODOS
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "No se pudo aplicar la decision");
      }
    } catch (e) { console.error(e); }
    setDeciding(null);
  }

  // El moderador (persona) decide: AVANZAR (la IA cierra el momento y abre el siguiente)
  async function decideAdvance() {
    if (deciding) return;
    setDeciding("advance");
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/advance-phase`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        setOverlay(null);
        await fetchModState(); // el cambio de fase dispara el anuncio en 2 pasos para TODOS
      } else {
        const d = await res.json().catch(() => ({}));
        alert(d.error || "No se pudo aplicar la decision");
      }
    } catch (e) { console.error(e); }
    setDeciding(null);
  }

  // Levantar o bajar la mano (pedir la palabra mientras el moderador decide)
  async function toggleHand() {
    if (raisingHand) return;
    setRaisingHand(true);
    try {
      await fetch(`/api/rest/workspaces/discussion/${discussionId}/raise-hand`, {
        method: "POST",
        credentials: "include",
      });
      await fetchModState();
    } catch (e) { console.error(e); }
    setRaisingHand(false);
  }

  // Anexar documento a un recuadro de la linea de tiempo (archivo PDF/Word o enlace Drive)
  async function saveDoc() {
    if (!docFor || !docTitle.trim() || docSaving) return;
    setDocSaving(true);
    try {
      if (docFile) {
        const up = await uploadDocument({
          workspaceId: discussion.workspaceId,
          title: docTitle.trim(),
          topic: docFor.topicTitle,
          discussionId,
          file: docFile,
        });
        if (up.ok && up.documentId && docFor.conclusionId) {
          await fetch(`/api/rest/workspaces/documents/${up.documentId}/attach`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ conclusionId: docFor.conclusionId }),
            credentials: "include",
          });
        } else if (!up.ok) {
          alert(up.error || "No se pudo subir el documento");
        }
      } else if (docUrl.trim()) {
        const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/link-doc`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: docTitle.trim(),
            url: docUrl.trim(),
            topicTitle: docFor.topicTitle,
            conclusionId: docFor.conclusionId,
          }),
          credentials: "include",
        });
        if (!res.ok) {
          const d = await res.json().catch(() => ({}));
          alert(d.error || "No se pudo anexar el enlace");
        }
      }
      await fetchDocs();
      setDocFor(null); setDocTitle(""); setDocUrl(""); setDocFile(null);
    } catch (e) { console.error(e); }
    setDocSaving(false);
  }

  // Crear un documento en linea desde el chat y abrirlo en el editor
  async function createOnlineDoc() {
    if (!newDocTitle.trim() || newDocSaving) return;
    setNewDocSaving(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/editor-doc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newDocTitle.trim(),
          topicTitle: topicsList[topicIdx] ?? "General",
        }),
        credentials: "include",
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        await fetchDocs();
        // El documento nace como un mensaje del chat: cualquier usuario lo abre tocandolo
        await fetch(`/api/rest/workspaces/discussion/${discussionId}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: `📄 [[doc:${data.documentId}]] ${newDocTitle.trim()}` }),
          credentials: "include",
        });
        fetchMessages();
        setEditorDoc({ id: data.documentId, title: newDocTitle.trim() });
        setNewDocOpen(false);
        setNewDocTitle("");
      } else {
        alert(data.error || "No se pudo crear el documento");
      }
    } catch (e) { console.error(e); }
    setNewDocSaving(false);
  }

  async function generatePartialSummary() {
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/partial-summary`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchSummaries();
        setModTab("resumenes");
        setModOpen(true);
      }
    } catch (e) { console.error(e); }
    setGeneratingSummary(false);
  }

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusion no encontrada.</main></div>;

  const pinnedMessages = messages.filter((m) => m.pinned);
  const normalMessages = messages.filter((m) => !m.pinned);
  const interventionsCompleted = Math.min(modState?.state?.interventionsCompleted ?? 0, modState?.state?.interventionsRequired ?? 5);
  const interventionsRequired = modState?.state?.interventionsRequired ?? 5;
  const progressPct = Math.min(100, Math.round((interventionsCompleted / Math.max(1, interventionsRequired)) * 100));
  const roundComplete = modActiveNow && interventionsCompleted >= interventionsRequired;
  // Ronda completa con temas ya definidos: el avance queda en manos del moderador (persona)
  const decisionPending = roundComplete && topicsList.length > 0;
  // Manos levantadas: usuarios que piden la palabra mientras el moderador decide
  const handsRaised: number[] = modState?.state?.handsRaised ?? [];
  const handsCount = handsRaised.length;
  const myHandRaised = !!user && handsRaised.includes(user.userId);
  const conclusions: any[] = modState?.conclusions ?? [];
  const lastConclusion = conclusions.length > 0 ? conclusions[conclusions.length - 1] : null;
  // La relatoria en proceso muestra SOLO las conclusiones del tema actual (se reinicia por tema)
  const topicConclusions = conclusions.filter((cn) => (cn.topicIndex ?? 0) === topicIdx);
  const selectingTopics = modActiveNow && topicsList.length === 0;

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <div className="border-b bg-card">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/workspace/${discussion.workspaceId}`)}><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0">
              <h1 className="font-display text-xl truncate">{discussion.title}</h1>
              {discussion.description && <p className="text-xs text-muted-foreground truncate">{discussion.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOpen ? (
              <>
                <Badge className="bg-green-600">En curso</Badge>
                {canModerate && (
                  <Button variant="outline" size="sm" className="gap-1" disabled={closing} onClick={closeDisc}>
                    {closing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}Cerrar y generar relatoria
                  </Button>
                )}
              </>
            ) : <Badge variant="secondary">Cerrada</Badge>}
          </div>
        </div>
      </div>

      {/* La barra de progreso de la discusion vive ahora en las tarjetas de la mesa (WorkspaceView) */}

      <div className="flex-1 max-w-4xl mx-auto w-full px-4 py-4">
        <div className="flex flex-col min-h-[60vh]">
          {selectingTopics && (
            <Card className="border-2 border-primary/60 bg-primary/5 mb-3">
              <CardContent className="py-3 px-4 text-sm text-center leading-relaxed">
                <strong className="font-display">Ronda de propuesta de temas:</strong> los temas los definen ustedes. Escribe tus propuestas en el chat o agregalas desde la pestana <strong>Temas</strong> de la ventana flotante. Cuando la ronda termine, la IA organizara <strong>solo lo que el grupo propuso</strong>.
              </CardContent>
            </Card>
          )}
          {pinnedMessages.length > 0 && (
            <div className="mb-3 space-y-2">
              <p className="text-xs font-medium text-amber-600 flex items-center gap-1"><Pin className="h-3 w-3" /> MENSAJES FIJADOS</p>
              {pinnedMessages.map((m) => (
                <div key={`pinned-${m.id}`} className="border-2 border-amber-300 bg-amber-50 rounded-xl px-4 py-2.5 shadow-sm relative group">
                  {canModerate && (
                    <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                      <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-amber-100" title="Dejar de fijar" onClick={() => togglePin(m.id)}>
                        <PinOff className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-blue-100 text-blue-500" title="Editar mensaje" onClick={() => { setEditingId(m.id); setEditText(m.content || ""); }}>
                        <Pencil className="h-3 w-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-red-100 text-red-500" title="Eliminar mensaje" onClick={() => deleteMsg(m.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-amber-700">{m.username}</span>
                    <Pin className="h-3 w-3 text-amber-500" />
                    <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  {editingId === m.id ? (
                    <div className="space-y-2">
                      <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="text-sm bg-background text-foreground" rows={4} autoFocus />
                      <div className="flex gap-2">
                        <Button size="sm" onClick={() => editMsg(m.id)} className="h-7 text-xs">Guardar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 text-xs">Cancelar</Button>
                      </div>
                    </div>
                  ) : (
                    <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto pb-4">
            {normalMessages.length === 0 && (
              <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground">
                <MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-50" />La discusion esta lista. Escribe el primer mensaje.
              </CardContent></Card>
            )}
            {normalMessages.map((m) => {
              const mine = m.userId === user?.userId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "di-gradient text-white" : "bg-card border-2"} relative group`}>
                    {canModerate && (
                      <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-amber-100" title="Fijar" onClick={() => togglePin(m.id)}>
                          <Pin className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-blue-100 text-blue-500" title="Editar mensaje" onClick={() => { setEditingId(m.id); setEditText(m.content || ""); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-red-100 text-red-500" title="Eliminar mensaje" onClick={() => deleteMsg(m.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs font-semibold opacity-90 ${mine ? "text-white" : ""}`}>{m.username}</span>
                      {m.type === "audio" ? <Mic className="h-3 w-3 opacity-70" /> : <MessageSquareText className="h-3 w-3 opacity-70" />}
                      <span className="text-[10px] opacity-60">{new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {m.type === "audio" && m.audioUrl && (
                      <div className="flex items-center gap-2 mb-1.5">
                        <Volume2 className="h-4 w-4 shrink-0 opacity-80" />
                        <audio controls src={m.audioUrl} className="h-8 max-w-full" />
                      </div>
                    )}
                    {editingId === m.id ? (
                      <div className="space-y-2 min-w-[280px]">
                        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="text-sm bg-background text-foreground" rows={4} autoFocus />
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => editMsg(m.id)} className="h-7 text-xs">Guardar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditingId(null)} className="h-7 text-xs">Cancelar</Button>
                        </div>
                      </div>
                    ) : m.content ? (
                      m.content.includes("[[doc:") ? (
                        <DocMessageCard content={m.content} mine={mine} onOpen={(id, t) => setEditorDoc({ id, title: t })} />
                      ) : (
                        <p className="text-sm whitespace-pre-wrap leading-relaxed">
                          {m.type === "audio" && <span className="text-[10px] uppercase opacity-60 block mb-0.5">Transcripcion</span>}
                          {m.content}
                        </p>
                      )
                    ) : null}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {isOpen ? (
            <div className="border-t pt-3">
              <form className="flex items-center gap-2" onSubmit={sendTextMsg}>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  title="Crear un documento en linea (editable aqui mismo, se guarda solo)"
                  onClick={() => { setNewDocOpen(true); setNewDocTitle(""); }}
                >
                  <FilePlus2 className="h-4 w-4" />
                </Button>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={selectingTopics ? "Propone un tema para la discusion..." : "Escribe un mensaje..."} className="flex-1" />
                <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : <div className="border-t pt-3 text-center text-sm text-muted-foreground">La discusion esta cerrada. Revisa la relatoria.</div>}
        </div>

        {/* Linea de tiempo de la discusion: recuadros de temas conectados con
            flechas; cada tema despliega sus recuadros de momento; los documentos
            quedan visibles aun con el tema retraido */}
        {topicsList.length > 0 && (
          <div className="mt-6">
            <h2 className="font-display text-lg flex items-center gap-2 mb-3">
              <Milestone className="h-5 w-5" /> Linea de tiempo de la discusion
            </h2>
            <div className="flex flex-wrap items-center gap-y-3">
              {topicsList.map((t, ti) => {
                const topicConcl = conclusions.filter((cn) => (cn.topicIndex ?? 0) === ti);
                const topicDocs = docsList.filter((d) => {
                  if (d.conclusionId) {
                    const cn = conclusions.find((x) => x.id === d.conclusionId);
                    return cn ? (cn.topicIndex ?? 0) === ti : false;
                  }
                  return d.topic === t;
                });
                const expanded = expandedTopics[ti] ?? (ti === topicsList.length - 1);
                const looseDocs = topicDocs.filter((d) => !d.conclusionId || !topicConcl.some((cn) => cn.id === d.conclusionId));
                return (
                  <Fragment key={ti}>
                    {/* Recuadro principal del tema con su block de notas */}
                    <div className="w-56 border-2 rounded-xl bg-card shadow-sm flex flex-col overflow-hidden self-stretch">
                      <div className="di-gradient text-white px-3 py-1.5 flex items-center gap-1.5">
                        <span className="w-5 h-5 rounded-full bg-white/25 text-[10px] flex items-center justify-center shrink-0">{ti + 1}</span>
                        <p className="text-xs font-semibold leading-tight">{t}</p>
                      </div>
                      <div className="p-2.5 bg-amber-50/70 flex-1">
                        {topicInfos[ti]?.desc ? (
                          <p className="text-[11px] leading-snug text-muted-foreground">{topicInfos[ti].desc}</p>
                        ) : (
                          <p className="text-[10px] text-center text-muted-foreground py-1">
                            {topicInfos[ti]?.status === "en-curso"
                              ? "Tema en curso"
                              : topicInfos[ti]?.status === "pendiente"
                                ? "Tema pendiente"
                                : "..."}
                          </p>
                        )}
                      </div>
                      <button
                        className="text-[10px] py-1 border-t flex items-center justify-center gap-1 text-muted-foreground hover:text-foreground"
                        onClick={() => setExpandedTopics((prev) => ({ ...prev, [ti]: !expanded }))}
                      >
                        {expanded
                          ? <><ChevronUp className="h-3 w-3" /> Retraer</>
                          : <><ChevronDown className="h-3 w-3" /> Desplegar ({topicConcl.length + topicDocs.length})</>}
                      </button>
                    </div>
                    {/* Recuadros secundarios: uno por cada momento concluido del tema */}
                    {expanded && topicConcl.map((cn) => {
                      const { commitments } = splitCommitments(cn.content || "");
                      const snippet = sectionSnippet(cn.content || "");
                      const momentDocs = topicDocs.filter((d) => d.conclusionId === cn.id);
                      return (
                        <Fragment key={cn.id}>
                          <div className="flex items-center px-0.5"><ChevronRight className="h-4 w-4 text-primary" /></div>
                          <div
                            className="w-48 border-2 rounded-xl bg-amber-50/70 shadow-sm p-2.5 flex flex-col self-stretch cursor-pointer hover:shadow-md hover:border-primary/50 transition-all"
                            onClick={() => setConclModal(cn)}
                            title="Toca para abrir el block de notas completo de este momento"
                          >
                            <p className="text-[9px] uppercase tracking-wide text-primary font-semibold">{phaseName(cn.phase)}</p>
                            <p className="text-[11px] font-semibold leading-tight mt-0.5">{cn.title}</p>
                            <p className="text-[10px] text-muted-foreground leading-snug mt-1 line-clamp-3">{snippet}</p>
                            <p className="text-[9px] text-primary/70 mt-0.5">Toca para leer el block completo</p>
                            {commitments.length > 0 && (
                              <button
                                className="mt-1.5 text-[10px] font-semibold text-amber-900 bg-amber-200 border border-amber-400 rounded-full px-2 py-0.5 flex items-center gap-1 animate-pulse hover:bg-amber-300"
                                onClick={(e) => { e.stopPropagation(); setCommitModal(cn); }}
                              >
                                <Handshake className="h-3 w-3" /> Por entregar ({commitments.length})
                              </button>
                            )}
                            <button
                              className="mt-auto pt-1.5 text-[10px] text-primary flex items-center gap-1 hover:underline"
                              onClick={(e) => { e.stopPropagation(); setDocFor({ conclusionId: cn.id, topicTitle: t }); setDocTitle(""); setDocUrl(""); setDocFile(null); }}
                            >
                              <Paperclip className="h-3 w-3" /> Anexar documento
                            </button>
                          </div>
                          {/* Documentos anclados a este momento: van a su lado */}
                          {momentDocs.map((d) => (
                            <Fragment key={d.id}>
                              <div className="flex items-center px-0.5"><ChevronRight className="h-4 w-4 text-primary" /></div>
                              {d.mimeType === "editor/html" ? (
                                <button
                                  onClick={() => setEditorDoc({ id: d.id, title: d.title })}
                                  className="w-44 border-2 border-dashed border-primary/50 rounded-xl bg-card shadow-sm p-2.5 flex flex-col self-stretch hover:border-primary transition-colors text-left"
                                >
                                  <p className="text-[9px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1">
                                    <FilePenLine className="h-3 w-3" /> Documento en linea
                                  </p>
                                  <p className="text-[11px] font-semibold leading-tight mt-0.5">{d.title}</p>
                                  {d.topic && <p className="text-[9px] text-muted-foreground mt-1">{d.topic}</p>}
                                </button>
                              ) : (
                                <a
                                  href={d.fileUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="w-44 border-2 border-dashed border-primary/50 rounded-xl bg-card shadow-sm p-2.5 flex flex-col self-stretch hover:border-primary transition-colors"
                                >
                                  <p className="text-[9px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1">
                                    {d.mimeType === "link/externo" ? <Link2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                                    Documento
                                  </p>
                                  <p className="text-[11px] font-semibold leading-tight mt-0.5">{d.title}</p>
                                  {d.topic && <p className="text-[9px] text-muted-foreground mt-1">{d.topic}</p>}
                                </a>
                              )}
                            </Fragment>
                          ))}
                        </Fragment>
                      );
                    })}
                    {/* Documentos sueltos del tema: siempre visibles, retraido o no */}
                    {looseDocs.map((d) => (
                      <Fragment key={d.id}>
                        <div className="flex items-center px-0.5"><ChevronRight className="h-4 w-4 text-primary" /></div>
                        {d.mimeType === "editor/html" ? (
                          <button
                            onClick={() => setEditorDoc({ id: d.id, title: d.title })}
                            className="w-44 border-2 border-dashed border-primary/50 rounded-xl bg-card shadow-sm p-2.5 flex flex-col self-stretch hover:border-primary transition-colors text-left"
                          >
                            <p className="text-[9px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1">
                              <FilePenLine className="h-3 w-3" /> Documento en linea
                            </p>
                            <p className="text-[11px] font-semibold leading-tight mt-0.5">{d.title}</p>
                            {d.topic && <p className="text-[9px] text-muted-foreground mt-1">{d.topic}</p>}
                          </button>
                        ) : (
                          <a
                            href={d.fileUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="w-44 border-2 border-dashed border-primary/50 rounded-xl bg-card shadow-sm p-2.5 flex flex-col self-stretch hover:border-primary transition-colors"
                          >
                            <p className="text-[9px] uppercase tracking-wide text-primary font-semibold flex items-center gap-1">
                              {d.mimeType === "link/externo" ? <Link2 className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                              Documento
                            </p>
                            <p className="text-[11px] font-semibold leading-tight mt-0.5">{d.title}</p>
                            {d.topic && <p className="text-[9px] text-muted-foreground mt-1">{d.topic}</p>}
                          </a>
                        )}
                      </Fragment>
                    ))}
                    {/* Flecha hacia el siguiente recuadro de tema */}
                    {ti < topicsList.length - 1 && (
                      <div className="flex items-center px-0.5"><ChevronRight className="h-5 w-5 text-primary" /></div>
                    )}
                  </Fragment>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground mt-2">
              Cualquier usuario puede desplegar o retraer un tema, y anexar documentos (PDF, Word o enlace de Drive) a cualquier recuadro de momento.
            </p>
          </div>
        )}

        {closing && (
          <Card className="border-2 mt-4">
            <CardContent className="py-6 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
              La IA esta redactando la relatoria...
            </CardContent>
          </Card>
        )}

        {relatoria && (
          <Card className="border-2 border-primary mt-4">
            <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl">
              <ScrollText className="h-4 w-4" /> Relatoria oficial
            </div>
            <CardContent className="pt-3">
              <MarkdownView content={relatoria.content} />
            </CardContent>
          </Card>
        )}
      </div>

      {/* Ventana flotante: Temas + Relatoria en proceso. Va en portal directo al body
          para que NADA la desplace: queda fija aunque se haga scroll. */}
      {createPortal(
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
        {modOpen && (
          <Card className="w-96 border-2 shadow-2xl">
            <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center justify-between rounded-t-xl">
              <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Relatoria en proceso</span>
              <button onClick={() => setModOpen(false)} className="text-white/80 hover:text-white" title="Cerrar panel"><X className="h-4 w-4" /></button>
            </div>
            <div className="flex border-b text-xs">
              <button onClick={() => setModTab("temas")} className={`flex-1 py-2 font-medium flex items-center justify-center gap-1 ${modTab === "temas" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}><ListOrdered className="h-3 w-3" /> Temas</button>
              <button onClick={() => setModTab("relatoria")} className={`flex-1 py-2 font-medium ${modTab === "relatoria" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>Conclusiones IA</button>
              <button onClick={() => setModTab("resumenes")} className={`flex-1 py-2 font-medium ${modTab === "resumenes" ? "border-b-2 border-primary text-primary" : "text-muted-foreground"}`}>Resumenes</button>
            </div>
            <CardContent className="pt-3 space-y-3 max-h-[55vh] overflow-y-auto">
              {modTab === "temas" ? (
                <>
                  {!modState ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        Los temas de la discusion los proponen los participantes, no la IA. Activa el Moderador IA y escribe tus propuestas en el chat: la IA solo las organiza y guia el trabajo tema por tema.
                      </p>
                      <Button size="sm" className="w-full gap-1 di-gradient text-white" onClick={activateModerator}>
                        <Sparkles className="h-3.5 w-3.5" /> Activar moderador
                      </Button>
                    </>
                  ) : (
                    <>
                      {topicsList.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          Aun no hay temas definidos. Escribe tus propuestas en el chat o agrega un tema aqui abajo. La IA organizara <strong>solo los temas que ustedes propongan</strong>.
                        </p>
                      ) : (
                        <ol className="space-y-1.5">
                          {topicsList.map((t, i) => {
                            const done = i < topicIdx || !modActiveNow;
                            const current = i === topicIdx && modActiveNow;
                            return (
                              <li key={i} className={`flex items-center gap-2 border rounded-lg px-2.5 py-1.5 ${current ? "border-primary bg-primary/5" : "bg-secondary/40"}`}>
                                {done ? (
                                  <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                                ) : (
                                  <span className={`w-5 h-5 rounded-full text-[10px] flex items-center justify-center shrink-0 ${current ? "di-gradient text-white" : "bg-secondary text-muted-foreground"}`}>{i + 1}</span>
                                )}
                                <span className={`text-xs leading-tight ${current ? "font-semibold" : ""} ${done ? "text-muted-foreground line-through" : ""}`}>{t}</span>
                              </li>
                            );
                          })}
                        </ol>
                      )}
                      {isOpen && (
                        addingTopic ? (
                          <div className="flex gap-1.5">
                            <Input
                              value={newTopic}
                              onChange={(e) => setNewTopic(e.target.value)}
                              placeholder="Titulo del nuevo tema..."
                              className="h-8 text-sm"
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTopic(); } }}
                              autoFocus
                            />
                            <Button size="sm" className="h-8 px-2.5" onClick={addTopic} disabled={!newTopic.trim() || savingTopic}>
                              {savingTopic ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "OK"}
                            </Button>
                            <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => { setAddingTopic(false); setNewTopic(""); }}>
                              <X className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        ) : (
                          <Button size="sm" variant="outline" className="w-full gap-1 text-xs" onClick={() => setAddingTopic(true)}>
                            <Plus className="h-3.5 w-3.5" /> Agregar tema
                          </Button>
                        )
                      )}
                    </>
                  )}
                </>
              ) : modTab === "resumenes" ? (
                <>
                  {!summaries.length && <p className="text-xs text-muted-foreground">Aqui aparecen los resumenes parciales que la IA genera de la discusion.</p>}
                  {summaries.map((s) => (
                    <div key={s.id} className="border rounded-lg p-2.5 bg-secondary/40">
                      <p className="text-[10px] text-muted-foreground mb-1">
                        Resumen tras {s.messageCount} mensajes · {new Date(s.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                      </p>
                      <MarkdownView content={s.content} />
                    </div>
                  ))}
                  <Button size="sm" variant="ghost" className="w-full" disabled={generatingSummary} onClick={generatePartialSummary}>
                    {generatingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generar resumen ahora"}
                  </Button>
                </>
              ) : (
                <>
                  {!modState ? (
                    <>
                      <p className="text-xs text-muted-foreground">
                        El Moderador IA guia la discusion automaticamente. Primero organiza los temas que ustedes propongan y luego genera la conclusion de cada fase. Aqui se van guardando las conclusiones del tema en curso.
                      </p>
                      <Button size="sm" className="w-full gap-1 di-gradient text-white" onClick={activateModerator}>
                        <Sparkles className="h-3.5 w-3.5" /> Activar moderador
                      </Button>
                    </>
                  ) : (
                    <>
                      {modActiveNow && (
                        <div className="border rounded-lg p-2.5 bg-secondary/40">
                          {selectingTopics ? (
                            <>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Momento actual</p>
                              <p className="font-display text-base leading-tight">Propuesta de temas</p>
                              {roundComplete ? (
                                <p className="text-xs text-primary flex items-center gap-1.5 mt-1">
                                  <Loader2 className="h-3 w-3 animate-spin" /> La IA esta organizando los temas propuestos...
                                </p>
                              ) : (
                                <p className="text-xs mt-1">Propuestas: <strong>{interventionsCompleted} de {interventionsRequired}</strong></p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                Tema {topicIdx + 1}/{topicsList.length} · Fase actual
                              </p>
                              <p className="font-display text-base leading-tight">{phaseName(currentPhase)}</p>
                              {decisionPending ? (
                                <div className="mt-1">
                                  <p className="text-xs text-primary font-medium">
                                    Ronda completa ({interventionsRequired} palabras).
                                  </p>
                                  {canDecide ? (
                                    <>
                                      <p className="text-xs text-muted-foreground mt-0.5">Te toca decidir el siguiente paso.</p>
                                      <Button size="sm" className="w-full mt-1.5 h-7 text-xs di-gradient text-white" onClick={() => { setModOpen(false); setOverlay({ kind: "decision" }); }}>
                                        Decidir ahora
                                      </Button>
                                    </>
                                  ) : (
                                    <p className="text-xs text-muted-foreground mt-0.5">El moderador esta definiendo el siguiente paso.</p>
                                  )}
                                </div>
                              ) : (
                                <>
                                  <p className="text-xs mt-1">Ronda de palabras: <strong>{interventionsCompleted} de {interventionsRequired}</strong></p>
                                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                                    <div className="h-1.5 di-gradient rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                                  </div>
                                </>
                              )}
                              {/* El moderador (persona) puede forzar el avance aunque la ronda no se complete */}
                              {canDecide && !decisionPending && topicsList.length > 0 && isOpen && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="w-full mt-2 h-7 text-xs gap-1"
                                  disabled={deciding !== null}
                                  onClick={decideAdvance}
                                >
                                  {deciding === "advance" && <Loader2 className="h-3 w-3 animate-spin" />}
                                  Abrir el siguiente momento ahora
                                </Button>
                              )}
                            </>
                          )}
                        </div>
                      )}
                      {!modActiveNow && conclusions.length > 0 && (
                        <div className="border rounded-lg p-2.5 bg-green-50 border-green-300">
                          <p className="text-xs text-green-800 font-medium">El moderador concluyo todos los temas. La memoria completa esta guardada.</p>
                        </div>
                      )}
                      {topicsList.length > 0 && (
                        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Conclusiones del tema actual: {topicsList[topicIdx]}
                        </p>
                      )}
                      {topicConclusions.length === 0 && modActiveNow && (
                        <p className="text-xs text-muted-foreground">Cuando la IA concluya la primera fase de este tema, la conclusion aparecera aqui.</p>
                      )}
                      {topicConclusions.map((cn) => (
                        <div key={cn.id} className="border rounded-lg p-2.5 bg-card">
                          <p className="text-[10px] uppercase tracking-wide text-primary font-semibold">{phaseName(cn.phase)}</p>
                          <p className="font-semibold text-sm leading-tight">{cn.title}</p>
                          <div className="text-xs text-muted-foreground mt-1">
                            <MarkdownView content={cn.content} />
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
        <Button
          onClick={() => {
            if (decisionPending && canDecide) setOverlay({ kind: "decision" });
            else setModOpen(!modOpen);
          }}
          className={`rounded-full shadow-lg gap-2 di-gradient text-white ${decisionPending && canDecide ? "animate-pulse" : ""}`}
        >
          <Sparkles className="h-4 w-4" />
          {!modState ? "Moderador IA"
            : decisionPending ? (canDecide ? "Decidir el siguiente paso" : "El moderador esta decidiendo...")
            : selectingTopics ? (roundComplete ? "La IA organiza los temas..." : "Propuesta de temas")
            : modActiveNow ? `Tema ${topicIdx + 1}/${topicsList.length}: ${phaseName(currentPhase)}`
            : "Relatoria en proceso"}
          {modActiveNow && !roundComplete && (
            <span className="text-[10px] bg-white/25 rounded-full px-2 py-0.5">{interventionsCompleted}/{interventionsRequired}</span>
          )}
          {selectingTopics && roundComplete && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
        </Button>
      </div>,
      document.body,
      )}

      {/* Anuncios grandes del Moderador IA (portal: siempre por encima de todo) */}
      {overlay && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4">
          <Card className="max-w-2xl w-full border-2 shadow-2xl">
            <div className="di-gradient px-6 py-6 text-white rounded-t-xl text-center">
              <Sparkles className="h-10 w-10 mx-auto mb-2" />
              <p className="text-[11px] uppercase tracking-[0.25em] opacity-85">Moderador IA</p>
              <h2 className="font-display text-4xl leading-tight font-bold">
                {overlay.kind === "activated" && "Propuesta de temas"}
                {overlay.kind === "topics" && "Temas de la discusion"}
                {overlay.kind === "topic" && `Tema ${topicIdx + 1}: ${topicsList[topicIdx] ?? ""}`}
                {overlay.kind === "phase" && (overlayStep === 1 ? "Cierre del momento" : `Fase: ${phaseName(overlay.phase)}`)}
                {overlay.kind === "round" && (topicsList.length === 0 ? "Nueva ronda de propuestas" : "Nueva ronda de palabras")}
                {overlay.kind === "decision" && (topicsList.length === 0 ? "Ya estan las propuestas" : "La ronda se completo")}
                {overlay.kind === "waiting" && (topicsList.length === 0 ? "Propuestas completas" : "Ronda de palabras completa")}
                {overlay.kind === "welcomeback" && `De vuelta, ${user?.username ?? ""}`}
                {overlay.kind === "finished" && "Moderacion finalizada"}
              </h2>
            </div>
            <CardContent className="pt-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {overlay.kind === "activated" && (
                <p className="text-center text-sm text-muted-foreground leading-relaxed">
                  Para empezar, vamos con la <strong>propuesta de temas</strong>: en esta primera ronda, cada quien escribe en el chat <strong>los temas que le gustaria tratar</strong>. La IA <strong>no propone temas</strong>, solo organiza los que ustedes decidan.
                  <br /><br />Cuando termine la ronda, arrancamos con el primer tema. Si mas adelante quieren agregar otro, pueden hacerlo en cualquier momento desde la pestana <strong>Temas</strong> de la ventana flotante.
                </p>
              )}
              {overlay.kind === "topics" && (
                <>
                  <p className="text-center text-sm text-muted-foreground">Estos son los temas que propuso el grupo, ya organizados:</p>
                  <ol className="space-y-1.5">
                    {topicsList.map((t, i) => (
                      <li key={i} className="flex items-center gap-2.5 border rounded-lg px-3 py-2 bg-secondary/40">
                        <span className="w-6 h-6 rounded-full di-gradient text-white text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-sm font-medium">{t}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-center text-sm leading-relaxed">
                    Arrancamos con el <strong>Tema 1: {topicsList[0]}</strong>. Si mas adelante quieren tratar algo mas, agreguenlo desde la pestana <strong>Temas</strong> de la ventana flotante.
                  </p>
                </>
              )}
              {overlay.kind === "round" && (
                <p className="text-center text-sm text-muted-foreground leading-relaxed">
                  {topicsList.length === 0 ? (
                    <>El moderador quiere escucharlos una vez mas: <strong>tenemos otra ronda de propuestas</strong>.
                    <br /><br />Cada quien puede seguir proponiendo temas antes de definir la lista.</>
                  ) : (
                    <>El moderador quiere escucharlos una vez mas: <strong>tenemos otra ronda de palabras</strong> sobre este mismo tema.
                    <br /><br />Cada quien puede volver a intervenir antes de seguir adelante.</>
                  )}
                </p>
              )}
              {overlay.kind === "decision" && (
                <>
                  <p className="text-center text-sm text-muted-foreground leading-relaxed">
                    {topicsList.length === 0
                      ? "El grupo ya propuso sus temas. Como moderador, tu decides que sigue:"
                      : "Ya completamos esta ronda de palabras. Como moderador, tu decides que sigue:"}
                  </p>
                  <div className="grid sm:grid-cols-2 gap-3">
                    <button
                      onClick={decideNextRound}
                      disabled={deciding !== null}
                      className="border-2 rounded-xl p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
                    >
                      <p className="font-display text-lg leading-tight">{topicsList.length === 0 ? "Otra ronda de propuestas" : "Otra ronda de palabras"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{topicsList.length === 0 ? "El grupo puede proponer mas temas antes de definir la lista." : "El grupo vuelve a hablar sobre este mismo tema, sin avanzar todavia."}</p>
                      {deciding === "round" && <Loader2 className="h-4 w-4 animate-spin mt-2 text-primary" />}
                    </button>
                    <button
                      onClick={decideAdvance}
                      disabled={deciding !== null}
                      className="border-2 rounded-xl p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors disabled:opacity-60"
                    >
                      <p className="font-display text-lg leading-tight">{topicsList.length === 0 ? "Definir temas y comenzar" : "Abrir el siguiente momento"}</p>
                      <p className="text-xs text-muted-foreground mt-1">{topicsList.length === 0 ? "La IA organiza los temas propuestos y arrancamos con el primero." : "La IA resume lo que se logro y abre el siguiente paso con el contexto."}</p>
                      {deciding === "advance" && (
                        <p className="text-xs text-primary flex items-center gap-1.5 mt-2"><Loader2 className="h-4 w-4 animate-spin" /> La IA esta trabajando...</p>
                      )}
                    </button>
                  </div>
                  <p className="text-center text-xs text-muted-foreground flex items-center justify-center gap-1.5">
                    <Hand className="h-3.5 w-3.5" />
                    {handsCount === 0
                      ? "Nadie ha pedido la palabra aun"
                      : `${handsCount} participante${handsCount !== 1 ? "s" : ""} piden la palabra`}
                  </p>
                </>
              )}
              {overlay.kind === "welcomeback" && (
                <>
                  <p className="text-sm leading-relaxed whitespace-pre-line">{overlay.text}</p>
                  <p className="text-center text-xs text-muted-foreground border rounded-lg bg-secondary/40 px-3 py-2">
                    <strong>Tema {topicIdx + 1} de {topicsList.length}:</strong> {topicsList[topicIdx]} · <strong>{phaseName(currentPhase)}</strong>
                  </p>
                </>
              )}
              {overlay.kind === "waiting" && (
                <>
                  <p className="text-center text-sm text-muted-foreground leading-relaxed">
                    {topicsList.length === 0 ? (
                      <>Estamos esperando a que el moderador decida si hay <strong>otra ronda de propuestas</strong> o si <strong>definimos los temas y arrancamos</strong>.
                      <br /><br />Si quieres proponer otro tema, levanta la mano.</>
                    ) : (
                      <>Estamos esperando a que el moderador decida si hay <strong>otra ronda de palabras</strong> o si <strong>seguimos al siguiente paso</strong>.
                      <br /><br />Si quieres decir algo mas, levanta la mano.</>
                    )}
                  </p>
                  <div className="flex justify-center">
                    <Button
                      variant={myHandRaised ? "default" : "outline"}
                      className={`gap-2 ${myHandRaised ? "di-gradient text-white" : ""}`}
                      disabled={raisingHand}
                      onClick={toggleHand}
                    >
                      {raisingHand ? <Loader2 className="h-4 w-4 animate-spin" /> : <Hand className="h-4 w-4" />}
                      {myHandRaised ? "Mano levantada (toca para bajarla)" : "Levantar la mano"}
                    </Button>
                  </div>
                </>
              )}
              {/* Avance de momento: PASO 1 = analisis de lo logrado; PASO 2 = contexto del nuevo momento */}
              {(overlay.kind === "topic" || overlay.kind === "phase") && overlayStep === 1 && (
                <>
                  {lastConclusion && (
                    <div className="border rounded-lg p-3 bg-secondary/40">
                      <p className="text-[10px] uppercase tracking-wide text-primary font-semibold mb-1">
                        {overlay.kind === "topic"
                          ? `El tema anterior concluyo con: ${lastConclusion.title}`
                          : `Conclusion de la fase ${phaseName(overlay.prevPhase)}: ${lastConclusion.title}`}
                      </p>
                      <div className="text-sm text-muted-foreground">
                        <MarkdownView content={lastConclusion.content} />
                      </div>
                    </div>
                  )}
                  {overlay.kind === "topic" && (
                    <p className="text-center text-sm leading-relaxed">
                      Empezamos un tema nuevo. La <strong>Relatoria en proceso</strong> arranca de cero y se ira llenando con las conclusiones de este tema.
                    </p>
                  )}
                </>
              )}
              {(overlay.kind === "topic" || overlay.kind === "phase") && overlayStep === 2 && (
                <div className="border-l-4 border-primary bg-primary/5 rounded-r-xl p-4">
                  <p className="text-[10px] uppercase tracking-wide text-primary font-semibold mb-1.5">
                    Contexto del nuevo momento
                  </p>
                  <p className="text-sm leading-relaxed">
                    {modState?.state?.bridgeText || PHASE_INFO[overlay.phase ?? ""]?.desc || "Comenzamos un nuevo momento de la discusion."}
                  </p>
                </div>
              )}
              {overlay.kind === "finished" && (
                <>
                  <p className="text-center text-sm text-muted-foreground leading-relaxed">
                    El Moderador IA concluyo todos los temas y fases de la discusion. Toda la memoria del proceso quedo guardada.
                  </p>
                  {lastConclusion && (
                    <div className="border rounded-lg p-3 bg-secondary/40">
                      <p className="text-[10px] uppercase tracking-wide text-primary font-semibold mb-1">
                        Ultima conclusion: {lastConclusion.title}
                      </p>
                      <div className="text-sm text-muted-foreground">
                        <MarkdownView content={lastConclusion.content} />
                      </div>
                    </div>
                  )}
                </>
              )}
              <div className="flex gap-2">
                {overlay.kind === "decision" ? (
                  <Button className="flex-1" variant="ghost" onClick={() => setOverlay(null)} disabled={deciding !== null}>
                    Decidir despues
                  </Button>
                ) : (overlay.kind === "topic" || overlay.kind === "phase") && overlayStep === 1 ? (
                  <Button className="flex-1 di-gradient text-white" onClick={() => setOverlayStep(2)}>Continuar</Button>
                ) : (
                  <Button className="flex-1 di-gradient text-white" onClick={() => setOverlay(null)}>
                    {overlay.kind === "topic" || overlay.kind === "phase" ? "Comenzar" : "Continuar"}
                  </Button>
                )}
                {overlay.kind === "finished" && canModerate && isOpen && (
                  <Button className="flex-1" variant="outline" disabled={closing} onClick={closeDisc}>
                    {closing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Cerrar y generar relatoria"}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Modal: anexar documento a un recuadro de la linea de tiempo */}
      {docFor && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4">
          <Card className="max-w-md w-full border-2 shadow-2xl">
            <div className="di-gradient px-4 py-3 text-white rounded-t-xl flex items-center justify-between">
              <p className="font-display text-lg flex items-center gap-2"><Paperclip className="h-5 w-5" /> Anexar documento</p>
              <button onClick={() => setDocFor(null)} className="text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <CardContent className="pt-4 space-y-3">
              <p className="text-xs text-muted-foreground">Tema del recuadro: <strong>{docFor.topicTitle}</strong></p>
              <div className="space-y-1.5">
                <Label>Tema general del documento *</Label>
                <Input value={docTitle} onChange={(e) => setDocTitle(e.target.value)} placeholder="Ej: Informe de asistencia social" />
              </div>
              <div className="space-y-1.5">
                <Label>Subir archivo (PDF o Word)</Label>
                <Input type="file" accept=".pdf,.doc,.docx" onChange={(e) => setDocFile(e.target.files?.[0] ?? null)} />
              </div>
              <p className="text-center text-xs text-muted-foreground">— o —</p>
              <div className="space-y-1.5">
                <Label>Pegar enlace (Drive, etc.)</Label>
                <Input value={docUrl} onChange={(e) => setDocUrl(e.target.value)} placeholder="https://drive.google.com/..." />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setDocFor(null)}>Cancelar</Button>
                <Button
                  className="flex-1 di-gradient text-white"
                  disabled={!docTitle.trim() || (!docFile && !docUrl.trim()) || docSaving}
                  onClick={saveDoc}
                >
                  {docSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Anexar"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Block de notas detallado de un momento concluido (click en su recuadro) */}
      {conclModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4" onClick={() => setConclModal(null)}>
          <Card className="max-w-lg w-full border-2 shadow-2xl max-h-[80vh] overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="di-gradient px-4 py-3 text-white rounded-t-xl flex items-center justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-white/80">{phaseName(conclModal.phase)}</p>
                <p className="font-display text-lg leading-tight">{conclModal.title}</p>
              </div>
              <button onClick={() => setConclModal(null)} className="text-white/80 hover:text-white shrink-0"><X className="h-5 w-5" /></button>
            </div>
            <CardContent className="pt-4 overflow-y-auto max-h-[60vh]">
              <div className="text-sm leading-relaxed">
                <MarkdownView content={splitCommitments(conclModal.content || "").main} />
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Block de notas de "Por entregar": compromisos con responsable y fecha */}
      {commitModal && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4" onClick={() => setCommitModal(null)}>
          <Card className="max-w-md w-full border-2 border-amber-400 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="bg-amber-200 px-4 py-3 rounded-t-xl flex items-center justify-between">
              <p className="font-display text-lg text-amber-900 flex items-center gap-2"><Handshake className="h-5 w-5" /> Por entregar</p>
              <button onClick={() => setCommitModal(null)} className="text-amber-700 hover:text-amber-900"><X className="h-5 w-5" /></button>
            </div>
            <CardContent className="pt-4 space-y-2.5">
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {phaseName(commitModal.phase)} · {commitModal.title}
              </p>
              {splitCommitments(commitModal.content || "").commitments.map((cm, i) => (
                <div key={i} className="border rounded-lg p-3 bg-amber-50/70">
                  <p className="text-sm font-medium leading-snug">{cm.text}</p>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    <span className="text-[10px] bg-secondary rounded-full px-2 py-0.5">Responsable: <strong>{cm.responsable}</strong></span>
                    <span className="text-[10px] bg-secondary rounded-full px-2 py-0.5">Para: <strong>{cm.fecha}</strong></span>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Modal: crear documento en linea */}
      {newDocOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-md p-4">
          <Card className="max-w-md w-full border-2 shadow-2xl">
            <div className="di-gradient px-4 py-3 text-white rounded-t-xl flex items-center justify-between">
              <p className="font-display text-lg flex items-center gap-2"><FilePlus2 className="h-5 w-5" /> Documento en linea</p>
              <button onClick={() => setNewDocOpen(false)} className="text-white/80 hover:text-white"><X className="h-5 w-5" /></button>
            </div>
            <CardContent className="pt-4 space-y-3">
              <p className="text-xs text-muted-foreground">
                Se crea dentro de la plataforma: lo editan aqui mismo, se guarda solo y queda como recuadro en la linea de tiempo del tema actual{topicsList[topicIdx] ? ` (${topicsList[topicIdx]})` : ""}.
              </p>
              <div className="space-y-1.5">
                <Label>Tema general del documento *</Label>
                <Input
                  value={newDocTitle}
                  onChange={(e) => setNewDocTitle(e.target.value)}
                  placeholder="Ej: Acta de acuerdos del vecindario"
                  autoFocus
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); createOnlineDoc(); } }}
                />
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" className="flex-1" onClick={() => setNewDocOpen(false)}>Cancelar</Button>
                <Button className="flex-1 di-gradient text-white" disabled={!newDocTitle.trim() || newDocSaving} onClick={createOnlineDoc}>
                  {newDocSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear y abrir"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>,
        document.body,
      )}

      {/* Editor de documentos en linea (se abre dentro de la plataforma) */}
      {editorDoc && (
        <DocEditor docId={editorDoc.id} title={editorDoc.title} username={user?.username ?? "Participante"} onClose={() => setEditorDoc(null)} />
      )}
    </div>
  );
}
