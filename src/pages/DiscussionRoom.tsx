import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import {
  Send, Loader2, MessageSquareText, ArrowLeft, Lock,
  FileText, Play, ChevronDown, ChevronUp, Sparkles,
  CheckCircle2, Users,
} from "lucide-react";

const PHASE_LABELS: Record<string, string> = {
  apertura: "Apertura del tema",
  contextualizacion: "Contextualizacion",
  comprension: "Comprension del problema",
  sintesis_parcial: "Sintesis parcial",
  profundizacion: "Profundizacion",
  coincidencias_diferencias: "Coincidencias y diferencias",
  alternativas: "Generacion de alternativas",
  evaluacion: "Evaluacion",
  acuerdo: "Construccion del acuerdo",
  conclusion: "Conclusion",
  compromisos: "Compromisos",
};

export default function DiscussionRoom() {
  const { id } = useParams<{ id: string }>();
  const discussionId = Number(id);
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();

  const [discussion, setDiscussion] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Moderacion
  const [modState, setModState] = useState<any>(null);
  const [conclusions, setConclusions] = useState<any[]>([]);
  const [isWsAdmin, setIsWsAdmin] = useState(false);
  const [activating, setActivating] = useState(false);
  const [advancing, setAdvancing] = useState(false);
  const [conclusionTitle, setConclusionTitle] = useState("");
  const [conclusionContent, setConclusionContent] = useState("");
  const [showConclusionForm, setShowConclusionForm] = useState(false);
  const [expandedConclusions, setExpandedConclusions] = useState<Set<number>>(new Set());

  async function fetchDiscussion() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}`, { credentials: "include" });
      if (res.ok) setDiscussion(await res.json());
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

  async function fetchModerationState() {
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/moderation-state`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setModState(data.state);
        setConclusions(data.conclusions || []);
      }
    } catch (e) { /* silencioso - la moderacion puede no estar activada */ }
  }

  async function checkAdmin() {
    if (!user || !discussion) return;
    try {
      const res = await fetch(`/api/rest/workspaces/${discussion.workspaceId}/members`, { credentials: "include" });
      if (res.ok) {
        const list = await res.json();
        const me = list.find((m: any) => m.id === user.userId);
        setIsWsAdmin(me?.role === "admin" || user.role === "admin");
      }
    } catch (e) { console.error(e); }
  }

  async function activateModerator() {
    if (!confirm("Activar el moderador de IA para esta discusion?")) return;
    setActivating(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/activate-moderator`, {
        method: "POST",
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Moderador activado. Se requieren ${data.interventionsRequired} intervenciones por ronda.`);
        fetchModerationState();
      }
    } catch (e) { console.error(e); }
    setActivating(false);
  }

  async function nextPhase() {
    if (!conclusionTitle.trim() || !conclusionContent.trim()) {
      alert("Escribe un titulo y contenido de conclusion antes de avanzar.");
      return;
    }
    setAdvancing(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/next-phase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conclusionTitle, conclusionContent }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setConclusionTitle("");
        setConclusionContent("");
        setShowConclusionForm(false);
        fetchModerationState();
        if (data.isLast) alert("Has llegado a la etapa final: Compromisos.");
      }
    } catch (e) { console.error(e); }
    setAdvancing(false);
  }

  async function registerIntervention() {
    try {
      await fetch(`/api/rest/workspaces/discussion/${discussionId}/intervention`, {
        method: "POST",
        credentials: "include",
      });
      fetchModerationState();
    } catch (e) { console.error(e); }
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        setText("");
        fetchMessages();
        if (modState?.active) registerIntervention();
      }
    } catch (e) { console.error(e); }
    setSending(false);
  }

  useEffect(() => {
    if (!isAuthenticated || !discussionId) return;
    async function load() {
      await Promise.all([fetchDiscussion(), fetchMessages(), fetchModerationState()]);
      setLoading(false);
    }
    load();
    const interval = setInterval(() => { fetchMessages(); fetchModerationState(); }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, discussionId]);

  useEffect(() => {
    if (discussion) checkAdmin();
  }, [discussion, user]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusion no encontrada.</main></div>;

  const isOpen = discussion.status === "open";

  const toggleConclusion = (id: number) => {
    const next = new Set(expandedConclusions);
    if (next.has(id)) next.delete(id); else next.add(id);
    setExpandedConclusions(next);
  };

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
            {isOpen ? <Badge className="bg-green-600">En curso</Badge> : <Badge variant="secondary">Cerrada</Badge>}
          </div>
        </div>
      </div>
             {/* Panel de moderacion */}
        {isOpen && isWsAdmin && !modState?.active && (
          <Card className="border-2 border-amber-400 bg-amber-50/50">
            <CardContent className="pt-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Sparkles className="h-5 w-5 text-amber-600" />
                <div>
                  <p className="font-medium text-sm">Moderador de IA disponible</p>
                  <p className="text-xs text-muted-foreground">Activa el moderador para estructurar la discusion en 11 etapas con rondas de palabras.</p>
                </div>
              </div>
              <Button size="sm" onClick={activateModerator} disabled={activating} className="gap-1">
                {activating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />} Activar
              </Button>
            </CardContent>
          </Card>
        )}

        {modState?.active && (
          <Card className="border-2 border-primary/30 bg-primary/5">
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <div>
                    <p className="font-medium text-sm flex items-center gap-2">
                      Moderador activo — 
                      <span className="text-primary">{PHASE_LABELS[modState.currentPhase] || modState.currentPhase}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Ronda {modState.wordRound} — {modState.interventionsCompleted} de {modState.interventionsRequired} intervenciones
                    </p>
                  </div>
                </div>
                {isWsAdmin && (
                  <div className="flex items-center gap-2">
                    {modState.interventionsCompleted >= modState.interventionsRequired && (
                      <Badge className="bg-amber-500 text-white animate-pulse">Ronda completa</Badge>
                    )}
                    <Button size="sm" variant="outline" onClick={() => setShowConclusionForm(!showConclusionForm)}>
                      <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> {showConclusionForm ? "Cancelar" : "Concluir etapa"}
                    </Button>
                  </div>
                )}
              </div>

              {/* Barra de progreso */}
              <div className="w-full bg-muted rounded-full h-2">
                <div 
                  className="bg-primary h-2 rounded-full transition-all"
                  style={{ width: `${Math.min((modState.interventionsCompleted / modState.interventionsRequired) * 100, 100)}%` }}
                />
              </div>

              {/* Formulario de conclusion */}
              {showConclusionForm && isWsAdmin && (
                <div className="space-y-2 border-t pt-3">
                  <Input 
                    placeholder="Titulo de la conclusion..." 
                    value={conclusionTitle} 
                    onChange={(e) => setConclusionTitle(e.target.value)} 
                  />
                  <textarea 
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[80px]"
                    placeholder="Describe la conclusion de esta etapa..."
                    value={conclusionContent}
                    onChange={(e) => setConclusionContent(e.target.value)}
                  />
                  <Button size="sm" onClick={nextPhase} disabled={advancing} className="w-full">
                    {advancing ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                    Guardar conclusion y avanzar
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* Chat de mensajes */}
        <div className="flex-1 flex flex-col min-h-[40vh] border rounded-xl overflow-hidden">
          <div className="flex-1 space-y-3 overflow-y-auto p-4 bg-secondary/20">
            {messages.length === 0 && (
              <div className="text-center py-10 text-muted-foreground">
                <MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-50" />
                <p className="text-sm">La discusion esta lista. Escribe un mensaje.</p>
                {modState?.active && <p className="text-xs mt-1">El moderador esta activo. Tus mensajes cuentan como intervenciones.</p>}
              </div>
            )}
            {messages.map((m: any) => {
              const mine = m.userId === user?.userId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "di-gradient text-white" : "bg-card border-2"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold opacity-90">{m.username}</span>
                      <span className="text-[10px] opacity-60">{new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {m.content && <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.content}</p>}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>

          {isOpen ? (
            <div className="border-t p-3 bg-card">
              <form className="flex items-center gap-2" onSubmit={sendMessage}>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1" />
                <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : (
            <div className="border-t p-3 text-center text-sm text-muted-foreground bg-card">La discusion esta cerrada.</div>
          )}
        </div>

        {/* Linea de tiempo con conclusiones */}
        {conclusions.length > 0 && (
          <div className="space-y-2">
            <h3 className="font-display text-lg flex items-center gap-2">
              <FileText className="h-5 w-5 text-primary" /> Linea de trabajo — {discussion.title}
            </h3>
            <div className="space-y-2">
              {conclusions.map((c: any, idx: number) => (
                <Card key={c.id} className={`border-2 ${expandedConclusions.has(c.id) ? 'border-primary/50' : 'border-muted'}`}>
                  <CardContent className="p-3">
                    <button 
                      className="w-full flex items-center justify-between text-left"
                      onClick={() => toggleConclusion(c.id)}
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-xs font-bold text-primary">
                          {idx + 1}
                        </div>
                        <div>
                          <p className="font-medium text-sm">{c.title}</p>
                          <p className="text-[10px] text-muted-foreground">{PHASE_LABELS[c.phase] || c.phase}</p>
                        </div>
                      </div>
                      {expandedConclusions.has(c.id) ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                    </button>
                    {expandedConclusions.has(c.id) && (
                      <div className="mt-3 pt-3 border-t text-sm text-muted-foreground whitespace-pre-wrap pl-11">
                        {c.content}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}

        {/* Boton cerrar discusion */}
        {isOpen && isWsAdmin && (
          <div className="text-center pt-2 pb-4">
            <Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" onClick={async () => { if (!confirm("Cerrar la discusion permanentemente? Se generara la relatoria final con IA.")) return; try { const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/close`, { method: "POST", credentials: "include" }); if (res.ok) { alert("Discusion cerrada. Relatoria final generada."); fetchDiscussion(); } } catch (e) { console.error(e); } }}>
              <Lock className="h-3.5 w-3.5 mr-1" /> Cerrar discusion y generar relatoria final
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}      
      <div className="max-w-6xl mx-auto w-full px-4 py-4 space-y-4 flex-1">
