import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import {
  Send, Loader2, Mic, MessageSquareText, Sparkles, ScrollText,
  ArrowLeft, Lock, Volume2, Pin, PinOff, Trash2, Pencil, X, Plus,
  CheckCircle2, ListOrdered,
} from "lucide-react";

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

type Overlay = {
  kind: "activated" | "topics" | "topic" | "phase" | "finished";
  phase?: string;
  prevPhase?: string;
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

  async function loadAll() {
    setLoading(true);
    await Promise.all([fetchDiscussion(), fetchMessages(), fetchSummaries(), fetchRelatoria(), fetchModState()]);
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

  // Deteccion de transiciones del moderador automatico
  const currentPhase: string | undefined = modState?.state?.currentPhase;
  const modActiveNow = !!modState?.state?.active;
  const topicsList: string[] = modState?.state?.topics ?? [];
  const topicIdx: number = modState?.state?.currentTopicIndex ?? 0;

  useEffect(() => {
    if (!modState?.state) return;
    if (!modActiveNow) {
      prevTopicsCountRef.current = topicsList.length;
      prevTopicIdxRef.current = topicIdx;
      prevPhaseRef.current = currentPhase ?? null;
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
    // 3. Cambio de fase dentro del mismo tema
    else if (
      topicsList.length > 0 &&
      prevPhaseRef.current &&
      prevPhaseRef.current !== currentPhase
    ) {
      setOverlay({ kind: "phase", phase: currentPhase, prevPhase: prevPhaseRef.current });
    }
    prevTopicsCountRef.current = topicsList.length;
    prevTopicIdxRef.current = topicIdx;
    prevPhaseRef.current = currentPhase ?? null;
  }, [currentPhase, topicIdx, topicsList.length, modActiveNow]);

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
  const interventionsCompleted = modState?.state?.interventionsCompleted ?? 0;
  const interventionsRequired = modState?.state?.interventionsRequired ?? 5;
  const progressPct = Math.min(100, Math.round((interventionsCompleted / Math.max(1, interventionsRequired)) * 100));
  const roundComplete = modActiveNow && interventionsCompleted >= interventionsRequired;
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
                      <p className="text-sm whitespace-pre-wrap leading-relaxed">
                        {m.type === "audio" && <span className="text-[10px] uppercase opacity-60 block mb-0.5">Transcripcion</span>}
                        {m.content}
                      </p>
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
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder={selectingTopics ? "Propone un tema para la discusion..." : "Escribe un mensaje..."} className="flex-1" />
                <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : <div className="border-t pt-3 text-center text-sm text-muted-foreground">La discusion esta cerrada. Revisa la relatoria.</div>}
        </div>

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
                              {roundComplete ? (
                                <p className="text-xs text-primary flex items-center gap-1.5 mt-1">
                                  <Loader2 className="h-3 w-3 animate-spin" /> La IA esta redactando la conclusion...
                                </p>
                              ) : (
                                <>
                                  <p className="text-xs mt-1">Ronda de palabras: <strong>{interventionsCompleted} de {interventionsRequired}</strong></p>
                                  <div className="h-1.5 bg-secondary rounded-full overflow-hidden mt-1">
                                    <div className="h-1.5 di-gradient rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                                  </div>
                                </>
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
        <Button onClick={() => setModOpen(!modOpen)} className={`rounded-full shadow-lg gap-2 di-gradient text-white ${roundComplete ? "animate-pulse" : ""}`}>
          <Sparkles className="h-4 w-4" />
          {!modState ? "Moderador IA"
            : roundComplete ? "La IA esta trabajando..."
            : selectingTopics ? `Propuesta de temas`
            : modActiveNow ? `Tema ${topicIdx + 1}/${topicsList.length}: ${phaseName(currentPhase)}`
            : "Relatoria en proceso"}
          {modActiveNow && !roundComplete && (
            <span className="text-[10px] bg-white/25 rounded-full px-2 py-0.5">{interventionsCompleted}/{interventionsRequired}</span>
          )}
          {modActiveNow && roundComplete && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
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
                {overlay.kind === "phase" && `Fase: ${phaseName(overlay.phase)}`}
                {overlay.kind === "finished" && "Moderacion finalizada"}
              </h2>
            </div>
            <CardContent className="pt-5 space-y-4 max-h-[60vh] overflow-y-auto">
              {overlay.kind === "activated" && (
                <p className="text-center text-sm text-muted-foreground leading-relaxed">
                  Iniciamos con la <strong>propuesta de temas</strong>. En esta primera ronda de palabras, cada participante escribe en el chat <strong>los temas que quiere tratar</strong>. La IA <strong>no propone temas</strong>: solo organiza los que ustedes definan.
                  <br /><br />Cuando la ronda termine, la IA ordenara los temas propuestos y comenzaremos con el primero. Tambien puedes agregar temas en cualquier momento desde la pestana <strong>Temas</strong> de la ventana flotante.
                </p>
              )}
              {overlay.kind === "topics" && (
                <>
                  <p className="text-center text-sm text-muted-foreground">La IA organizo los temas propuestos por los participantes:</p>
                  <ol className="space-y-1.5">
                    {topicsList.map((t, i) => (
                      <li key={i} className="flex items-center gap-2.5 border rounded-lg px-3 py-2 bg-secondary/40">
                        <span className="w-6 h-6 rounded-full di-gradient text-white text-xs flex items-center justify-center shrink-0">{i + 1}</span>
                        <span className="text-sm font-medium">{t}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-center text-sm leading-relaxed">
                    Comenzamos con el <strong>Tema 1: {topicsList[0]}</strong>. Si el grupo quiere tratar algo mas, puedes agregar temas en cualquier momento desde la pestana <strong>Temas</strong> de la ventana flotante.
                  </p>
                </>
              )}
              {overlay.kind === "topic" && (
                <>
                  {lastConclusion && (
                    <div className="border rounded-lg p-3 bg-secondary/40">
                      <p className="text-[10px] uppercase tracking-wide text-primary font-semibold mb-1">
                        El tema anterior concluyo con: {lastConclusion.title}
                      </p>
                      <div className="text-sm text-muted-foreground">
                        <MarkdownView content={lastConclusion.content} />
                      </div>
                    </div>
                  )}
                  <p className="text-center text-sm leading-relaxed">
                    Abrimos un nuevo tema. La <strong>Relatoria en proceso</strong> se reinicia: ahora se llenara con las conclusiones de este tema.
                  </p>
                </>
              )}
              {overlay.kind === "phase" && (
                <>
                  {lastConclusion && (
                    <div className="border rounded-lg p-3 bg-secondary/40">
                      <p className="text-[10px] uppercase tracking-wide text-primary font-semibold mb-1">
                        Conclusion de la fase {phaseName(overlay.prevPhase)}: {lastConclusion.title}
                      </p>
                      <div className="text-sm text-muted-foreground">
                        <MarkdownView content={lastConclusion.content} />
                      </div>
                    </div>
                  )}
                  <p className="text-center text-sm leading-relaxed">
                    <strong>Siguiente momento:</strong> {PHASE_INFO[overlay.phase ?? ""]?.desc}
                  </p>
                </>
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
                <Button className="flex-1 di-gradient text-white" onClick={() => setOverlay(null)}>Continuar</Button>
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
    </div>
  );
}
