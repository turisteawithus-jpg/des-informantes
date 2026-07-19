import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { AudioRecorder } from "@/components/AudioRecorder";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import { uploadAudio } from "@/lib/upload";
import {
  Send, Loader2, Mic, MessageSquareText, Sparkles, ScrollText,
  ArrowLeft, Lock, Volume2, Pin, PinOff, Trash2, Pencil, X,
} from "lucide-react";

const PHASE_ORDER = [
  "apertura", "contextualizacion", "comprension", "sintesis_parcial",
  "profundizacion", "coincidencias_diferencias", "alternativas",
  "evaluacion", "acuerdo", "conclusion", "compromisos",
];

const PHASE_INFO: Record<string, { name: string; desc: string }> = {
  apertura: { name: "Apertura", desc: "Bienvenida. Se presenta el tema central y las reglas del dialogo. Cada participante se ubica frente al tema." },
  contextualizacion: { name: "Contextualizacion", desc: "Se ubica el tema en su contexto: antecedentes, datos y situacion actual del asunto a tratar." },
  comprension: { name: "Comprension", desc: "Cada participante expresa su entendimiento del tema. Se aclaran dudas y terminos." },
  sintesis_parcial: { name: "Sintesis parcial", desc: "El moderador resume lo dicho hasta ahora y el grupo verifica que todos esten en la misma pagina." },
  profundizacion: { name: "Profundizacion", desc: "Se exploran en detalle los puntos mas importantes o que generan mas debate." },
  coincidencias_diferencias: { name: "Coincidencias y diferencias", desc: "Se identifican abiertamente los acuerdos y desacuerdos entre los participantes." },
  alternativas: { name: "Alternativas", desc: "Se proponen opciones y soluciones para cada punto de discusion sobre la mesa." },
  evaluacion: { name: "Evaluacion", desc: "Se valoran las alternativas propuestas: ventajas, desventajas y viabilidad real." },
  acuerdo: { name: "Acuerdo", desc: "Se construye consenso alrededor de las mejores alternativas disponibles." },
  conclusion: { name: "Conclusion", desc: "Se formulan las conclusiones finales de la discusion." },
  compromisos: { name: "Compromisos", desc: "Se definen compromisos concretos, responsables y proximos pasos." },
};

function phaseName(key: string | undefined) {
  return (key && PHASE_INFO[key]?.name) || "Apertura";
}
function nextPhaseKey(key: string | undefined) {
  const idx = PHASE_ORDER.indexOf(key || "apertura");
  return PHASE_ORDER[Math.min(idx + 1, PHASE_ORDER.length - 1)];
}

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
  const [audioError, setAudioError] = useState("");
  const [sending, setSending] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Moderador IA
  const [modState, setModState] = useState<any>(null);
  const [modOpen, setModOpen] = useState(false);
  const [overlay, setOverlay] = useState<{ kind: "activated" | "phase" | "roundComplete"; phase?: string } | null>(null);
  const [conclusionTitle, setConclusionTitle] = useState("");
  const [conclusionContent, setConclusionContent] = useState("");
  const [advancing, setAdvancing] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const prevPhaseRef = useRef<string | null>(null);
  const prevRoundCompleteRef = useRef(false);

  // Puede moderar: admin general (en cualquier chat) o admin de ESTA mesa
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

  // Detectar cambio de fase -> anuncio grande para todos
  const currentPhase: string | undefined = modState?.state?.currentPhase;
  useEffect(() => {
    if (!currentPhase || !modState?.state?.active) { prevPhaseRef.current = currentPhase ?? null; return; }
    if (prevPhaseRef.current && prevPhaseRef.current !== currentPhase) {
      setOverlay({ kind: "phase", phase: currentPhase });
    }
    prevPhaseRef.current = currentPhase;
  }, [currentPhase, modState?.state?.active]);

  // Detectar ronda completada -> aviso al que modera
  const roundComplete = !!(modState?.state?.active && modState.state.interventionsCompleted >= modState.state.interventionsRequired);
  useEffect(() => {
    if (roundComplete && !prevRoundCompleteRef.current && canModerate) {
      setOverlay({ kind: "roundComplete", phase: modState.state.currentPhase });
    }
    prevRoundCompleteRef.current = roundComplete;
  }, [roundComplete]);

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

  async function handleAudio(blob: Blob) {
    setAudioError("");
    const res = await uploadAudio(discussionId, blob);
    if (!res.ok) setAudioError(res.error ?? "Error al subir audio");
    await fetchMessages();
    await fetchModState();
  }

  async function activateModerator() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/activate-moderator`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        await fetchModState();
        setOverlay({ kind: "activated", phase: "apertura" });
      }
    } catch (e) { console.error(e); }
  }

  async function advancePhase() {
    setAdvancing(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/next-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conclusionTitle: conclusionTitle.trim() || undefined,
          conclusionContent: conclusionContent.trim() || undefined,
        }),
        credentials: "include",
      });
      if (res.ok) {
        setConclusionTitle("");
        setConclusionContent("");
        setOverlay(null);
        await fetchModState();
      }
    } catch (e) { console.error(e); }
    setAdvancing(false);
  }

  async function generatePartialSummary() {
    setGeneratingSummary(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/partial-summary`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) await fetchSummaries();
    } catch (e) { console.error(e); }
    setGeneratingSummary(false);
  }

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusion no encontrada.</main></div>;

  const pinnedMessages = messages.filter((m) => m.pinned);
  const normalMessages = messages.filter((m) => !m.pinned);
  const modActive = !!modState?.state?.active;
  const interventionsCompleted = modState?.state?.interventionsCompleted ?? 0;
  const interventionsRequired = modState?.state?.interventionsRequired ?? 5;
  const progressPct = Math.min(100, Math.round((interventionsCompleted / Math.max(1, interventionsRequired)) * 100));
  const conclusions: any[] = modState?.conclusions ?? [];

  const overlayTitle =
    overlay?.kind === "activated" ? "Moderador activado"
    : overlay?.kind === "roundComplete" ? "Ronda de palabras completada"
    : `Fase: ${phaseName(overlay?.phase)}`;
  const overlayDesc =
    overlay?.kind === "activated"
      ? `La discusion comienza en la fase de ${phaseName("apertura")}. ${PHASE_INFO.apertura.desc}`
    : overlay?.kind === "roundComplete"
      ? `Se alcanzo el numero de intervenciones de la fase "${phaseName(overlay?.phase)}". El moderador puede registrar una conclusion y avanzar, o seguir conversando.`
    : PHASE_INFO[overlay?.phase ?? ""]?.desc ?? "";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
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

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-4 grid lg:grid-cols-[1fr_340px] gap-4">
        <div className="flex flex-col min-h-[60vh]">
          {pinnedMessages.length > 0 && (
            <div className="mb-3 space-y-2">
              <p className="text-xs font-medium text-amber-600 flex items-center gap-1"><Pin className="h-3 w-3" /> MENSAJES FIJADOS</p>
              {pinnedMessages.map((m) => (
                <div key={`pinned-${m.id}`} className="border-2 border-amber-300 bg-amber-50 rounded-xl px-4 py-2.5 shadow-sm">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-amber-700">{m.username}</span>
                    <Pin className="h-3 w-3 text-amber-500" />
                    <span className="text-[10px] text-muted-foreground">{new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                  </div>
                  <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>
                </div>
              ))}
            </div>
          )}

          <div className="flex-1 space-y-3 overflow-y-auto pb-4">
            {normalMessages.length === 0 && (
              <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground">
                <MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-50" />La discusion esta lista. Escribe o graba un audio.
              </CardContent></Card>
            )}
            {normalMessages.map((m) => {
              const mine = m.userId === user?.userId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "di-gradient text-white" : "bg-card border-2"} relative group`}>
                    {canModerate && (
                      <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-amber-100" title={m.pinned ? "Desfijar" : "Fijar"} onClick={() => togglePin(m.id)}>
                          {m.pinned ? <PinOff className="h-3 w-3" /> : <Pin className="h-3 w-3" />}
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
                    {m.transcriptionStatus === "pending" && (
                      <p className="text-xs italic opacity-80 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Transcribiendo...</p>
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
            <div className="border-t pt-3 space-y-2">
              {audioError && <p className="text-xs text-destructive">{audioError}</p>}
              <form className="flex items-center gap-2" onSubmit={sendTextMsg}>
                <AudioRecorder onRecorded={handleAudio} />
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1" />
                <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : <div className="border-t pt-3 text-center text-sm text-muted-foreground">La discusion esta cerrada. Revisa la relatoria.</div>}
        </div>

        <aside className="space-y-4">
          <Card className="border-2">
            <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl">
              <Sparkles className="h-4 w-4" /> Moderacion IA
            </div>
            <CardContent className="pt-3 space-y-3 max-h-[40vh] overflow-y-auto">
              {!summaries.length && <p className="text-xs text-muted-foreground">Cada 5 mensajes, la IA resume: conclusiones, tareas y ambiente.</p>}
              {summaries.map((s) => (
                <div key={s.id} className="border rounded-lg p-2.5 bg-secondary/40">
                  <p className="text-[10px] text-muted-foreground mb-1">
                    Resumen tras {s.messageCount} mensajes · {new Date(s.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}
                  </p>
                  <MarkdownView content={s.content} />
                </div>
              ))}
            </CardContent>
          </Card>

          {relatoria && (
            <Card className="border-2 border-primary">
              <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl">
                <ScrollText className="h-4 w-4" /> Relatoria oficial
              </div>
              <CardContent className="pt-3 max-h-[50vh] overflow-y-auto">
                <MarkdownView content={relatoria.content} />
              </CardContent>
            </Card>
          )}

          {closing && (
            <Card className="border-2">
              <CardContent className="py-6 text-center text-sm text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />
                La IA esta redactando la relatoria...
              </CardContent>
            </Card>
          )}
        </aside>
      </div>

      {/* Widget flotante del Moderador IA */}
      <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2">
        {modOpen && (
          <Card className="w-80 border-2 shadow-2xl">
            <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center justify-between rounded-t-xl">
              <span className="flex items-center gap-2"><Sparkles className="h-4 w-4" /> Moderador IA</span>
              <button onClick={() => setModOpen(false)} className="text-white/80 hover:text-white" title="Cerrar panel"><X className="h-4 w-4" /></button>
            </div>
            <CardContent className="pt-3 space-y-3 max-h-[50vh] overflow-y-auto">
              {!modActive ? (
                <>
                  <p className="text-xs text-muted-foreground">
                    El moderador guia la discusion por fases (apertura, contextualizacion, acuerdos, compromisos...) con rondas de palabras: cuenta las intervenciones y avisa cuando es momento de avanzar.
                  </p>
                  {canModerate ? (
                    <Button size="sm" className="w-full gap-1 di-gradient text-white" onClick={activateModerator}>
                      <Sparkles className="h-3.5 w-3.5" /> Activar moderador
                    </Button>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">El administrador de la mesa puede activarlo.</p>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Fase actual</p>
                    <p className="font-display text-lg leading-tight">{phaseName(currentPhase)}</p>
                    <p className="text-xs text-muted-foreground">{PHASE_INFO[currentPhase ?? ""]?.desc}</p>
                  </div>
                  <div className="space-y-1">
                    <p className="text-xs">Ronda de palabras: <strong>{interventionsCompleted} de {interventionsRequired}</strong> intervenciones</p>
                    <div className="h-2 bg-secondary rounded-full overflow-hidden">
                      <div className="h-2 di-gradient rounded-full transition-all" style={{ width: `${progressPct}%` }} />
                    </div>
                    <p className="text-[10px] text-muted-foreground">Ronda #{modState.state.wordRound}</p>
                  </div>
                  {canModerate && (
                    <div className="space-y-2 pt-1">
                      <Button size="sm" className="w-full" onClick={() => setOverlay({ kind: "roundComplete", phase: currentPhase })}>
                        Avanzar a: {phaseName(nextPhaseKey(currentPhase))}
                      </Button>
                      <Button size="sm" variant="ghost" className="w-full" disabled={generatingSummary} onClick={generatePartialSummary}>
                        {generatingSummary ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Generar resumen ahora"}
                      </Button>
                    </div>
                  )}
                  {conclusions.length > 0 && (
                    <div className="space-y-1.5 pt-1">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Conclusiones por fase</p>
                      {conclusions.map((cn) => (
                        <div key={cn.id} className="text-xs border rounded-lg p-2 bg-secondary/40">
                          <p className="font-semibold">{cn.title}</p>
                          <p className="text-muted-foreground">{cn.content}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        )}
        <Button onClick={() => setModOpen(!modOpen)} className="rounded-full shadow-lg gap-2 di-gradient text-white">
          <Sparkles className="h-4 w-4" />
          {modActive ? `Moderador: ${phaseName(currentPhase)}` : "Moderador IA"}
          {modActive && (
            <span className="text-[10px] bg-white/25 rounded-full px-2 py-0.5">{interventionsCompleted}/{interventionsRequired}</span>
          )}
        </Button>
      </div>

      {/* Anuncio grande del moderador (estilo videojuego) */}
      {overlay && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
          <Card className="max-w-lg w-full border-2 shadow-2xl">
            <div className="di-gradient px-6 py-5 text-white rounded-t-xl text-center">
              <Sparkles className="h-9 w-9 mx-auto mb-2" />
              <p className="text-[11px] uppercase tracking-[0.2em] opacity-80">Moderador IA</p>
              <h2 className="font-display text-3xl leading-tight">{overlayTitle}</h2>
            </div>
            <CardContent className="pt-5 space-y-4">
              <p className="text-center text-sm text-muted-foreground leading-relaxed">{overlayDesc}</p>
              {overlay.kind === "roundComplete" && canModerate ? (
                <div className="space-y-3">
                  <Input
                    placeholder="Titulo de la conclusion (opcional)"
                    value={conclusionTitle}
                    onChange={(e) => setConclusionTitle(e.target.value)}
                  />
                  <Textarea
                    placeholder="Conclusion de esta fase (opcional)"
                    value={conclusionContent}
                    onChange={(e) => setConclusionContent(e.target.value)}
                    rows={3}
                  />
                  <div className="flex gap-2">
                    <Button variant="outline" className="flex-1" onClick={() => setOverlay(null)}>Seguir conversando</Button>
                    <Button className="flex-1 di-gradient text-white" disabled={advancing} onClick={advancePhase}>
                      {advancing ? <Loader2 className="h-4 w-4 animate-spin" /> : `Avanzar a: ${phaseName(nextPhaseKey(overlay.phase))}`}
                    </Button>
                  </div>
                </div>
              ) : (
                <Button className="w-full di-gradient text-white" onClick={() => setOverlay(null)}>Continuar</Button>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
