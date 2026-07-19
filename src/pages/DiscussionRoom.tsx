import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AudioRecorder } from "@/components/AudioRecorder";
import { MarkdownView } from "@/components/MarkdownView";
import { useAuth } from "@/hooks/useAuth";
import { uploadAudio } from "@/lib/upload";
import {
  Send, Loader2, Mic, MessageSquareText, Sparkles, ScrollText,
  ArrowLeft, Lock, Volume2, Pin, PinOff, Trash2, Pencil,
} from "lucide-react";

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

  async function loadAll() {
    setLoading(true);
    await Promise.all([fetchDiscussion(), fetchMessages(), fetchSummaries(), fetchRelatoria()]);
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
    }, 4000);
    return () => clearInterval(iv);
  }, [isAuthenticated, isOpen, discussionId]);

  useEffect(() => {
    if (discussion?.status === "closed") fetchRelatoria();
  }, [discussion?.status]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

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
  }

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusion no encontrada.</main></div>;

  const pinnedMessages = messages.filter((m) => m.pinned);
  const normalMessages = messages.filter((m) => !m.pinned);

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
                      <div className="space-y-2">
                        <Input value={editText} onChange={(e) => setEditText(e.target.value)} className="text-sm" autoFocus />
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
    </div>
  );
}
