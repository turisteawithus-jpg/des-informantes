import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import {
  ShieldCheck,
  MessageSquareText,
  Sparkles,
  FileText,
  Map as MapIcon,
  ListChecks,
  Globe,
  Users,
  Send,
  ArrowRight,
  Newspaper,
  Loader2,
  Pin,
  PinOff,
  Pencil,
  Trash2,
  Smile,
  SmilePlus,
  MessagesSquare,
} from "lucide-react";

// Emojis disponibles para reaccionar y para el mensaje
const EMOJIS = ["👍", "❤️", "😂", "😮", "😢", "🙏", "🔥", "👏"];

const features = [
  { icon: Globe, title: "Ecosistema digital", desc: "Un espacio online donde los equipos conversan, documentan y sistematizan su trabajo en mesas organizadas." },
  { icon: MessagesSquare, title: "Comunicacion directa y acertada", desc: "Mas que un escenario de conversacion, los chats de discusion son un espacio para comunicarse con precision: entre mas contexto, preguntas y respuestas plantees en una sola intervencion, mucho mejor." },
  { icon: ShieldCheck, title: "Contra la desinformacion", desc: "Este espacio fue creado para aportar a la organizacion en su trabajo contra la desinformacion politica y cultural." },
  { icon: Sparkles, title: "Moderacion inteligente", desc: "La IA guia cada discusion por temas y momentos, y redacta la conclusion de cada paso con lo que el grupo construyo." },
  { icon: FileText, title: "Relatorias automaticas", desc: "Al cerrar una discusion, la relatoria oficial de todo el proceso queda lista para descargar en Word." },
  { icon: MapIcon, title: "Mapa de documentos", desc: "Cada documento se conecta por temas. El proceso del proyecto se ve de un vistazo." },
  { icon: ListChecks, title: "Tareas con seguimiento", desc: "Los compromisos nacen de la conversacion, con responsable y fecha, y la plataforma los recuerda." },
  { icon: Users, title: "Mesas de trabajo", desc: "Crea o unete a mesas aprobadas. Cada mesa tiene su administrador y su estructura propia." },
];

export default function Home() {
  const navigate = useNavigate();
  const { user, isAuthenticated, isAdmin } = useAuth();
  const [text, setText] = useState("");
  const [messages, setMessages] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editText, setEditText] = useState("");
  const [openThread, setOpenThread] = useState<number | null>(null);
  const [replies, setReplies] = useState<any[]>([]);
  const [replyText, setReplyText] = useState("");
  const [sendingReply, setSendingReply] = useState(false);
  const [reactPickerFor, setReactPickerFor] = useState<number | null>(null);
  const [emojiInputOpen, setEmojiInputOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function fetchMessages() {
    try {
      const res = await fetch("/api/rest/global-chat");
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim()) return;
    setSending(true);
    try {
      const res = await fetch("/api/rest/global-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: text.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        setText("");
        fetchMessages();
      }
    } catch (e) { console.error(e); }
    setSending(false);
  }

  async function togglePin(msgId: number) {
    const msg = messages.find((m) => m.id === msgId);
    if (!msg) return;
    const endpoint = msg.pinned
      ? `/api/rest/global-chat/${msgId}/unpin`
      : `/api/rest/global-chat/${msgId}/pin`;
    try {
      const res = await fetch(endpoint, { method: "POST", credentials: "include" });
      if (res.ok) fetchMessages();
    } catch (e) { console.error(e); }
  }

  async function deleteMsg(msgId: number) {
    if (!confirm("Eliminar este mensaje del chat general?")) return;
    try {
      const res = await fetch(`/api/rest/global-chat/${msgId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (res.ok) fetchMessages();
    } catch (e) { console.error(e); }
  }

  async function editMsg(msgId: number) {
    if (!editText.trim()) return;
    try {
      const res = await fetch(`/api/rest/global-chat/${msgId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editText.trim() }),
        credentials: "include",
      });
      if (res.ok) { setEditingId(null); setEditText(""); fetchMessages(); }
    } catch (e) { console.error(e); }
  }

  /* ---------------- Subdiscusiones y reacciones ---------------- */

  async function fetchReplies(msgId: number) {
    try {
      const res = await fetch(`/api/rest/global-chat/${msgId}/replies`);
      if (res.ok) setReplies(await res.json());
    } catch { /* reintenta en el siguiente ciclo */ }
  }

  function toggleThread(msgId: number) {
    if (openThread === msgId) { setOpenThread(null); return; }
    setOpenThread(msgId);
    setReplyText("");
    fetchReplies(msgId);
  }

  async function sendReply(parentId: number) {
    if (!replyText.trim()) return;
    setSendingReply(true);
    try {
      const res = await fetch("/api/rest/global-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: replyText.trim(), parentId }),
        credentials: "include",
      });
      if (res.ok) {
        setReplyText("");
        fetchReplies(parentId);
        fetchMessages();
      }
    } catch { /* el usuario reintenta */ }
    setSendingReply(false);
  }

  async function toggleReaction(msgId: number, emoji: string) {
    setReactPickerFor(null);
    try {
      await fetch(`/api/rest/global-chat/${msgId}/react`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emoji }),
        credentials: "include",
      });
      fetchMessages();
    } catch { /* el usuario reintenta */ }
  }

  function reactionGroups(m: any): { emoji: string; count: number; mine: boolean }[] {
    const byEmoji = new Map<string, { count: number; mine: boolean }>();
    for (const r of m.reactions ?? []) {
      const g = byEmoji.get(r.emoji) ?? { count: 0, mine: false };
      g.count++;
      if (r.userId === user?.userId) g.mine = true;
      byEmoji.set(r.emoji, g);
    }
    return EMOJIS.filter((e) => byEmoji.has(e)).map((e) => ({ emoji: e, ...byEmoji.get(e)! }));
  }

  useEffect(() => {
    fetchMessages();
    const interval = setInterval(() => {
      fetchMessages();
      if (openThread) fetchReplies(openThread);
    }, 4000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openThread]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const pinnedMessages = messages.filter((m) => m.pinned);
  const normalMessages = [...messages].reverse().filter((m) => !m.pinned);

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />

      {/* Hero */}
      <section className="di-gradient text-white">
        <div className="max-w-6xl mx-auto px-4 py-16 md:py-20 text-center">
          <h1 className="font-display text-4xl md:text-6xl mb-4 drop-shadow">Mas alla del relato,<br />estan los hechos.</h1>
          <p className="text-lg md:text-xl max-w-3xl mx-auto opacity-90 mb-4">
            DES Informantes es un <strong>ecosistema de trabajo digital online</strong>, creado para aportar a la organizacion que trabaja <strong>contra la desinformacion politica y cultural</strong>. Mas que un escenario de conversacion, sus chats de discusion son un <strong>espacio de comunicacion directa y acertada</strong>: entre mas contexto, preguntas y respuestas plantees en una sola intervencion, mucho mejor.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center mb-10">
            {isAuthenticated ? (
              <Button size="lg" className="bg-white text-[#0a2540] hover:bg-gray-100 font-semibold text-base gap-2" onClick={() => navigate("/dashboard")}>
                Ir a mis mesas <ArrowRight className="h-4 w-4" />
              </Button>
            ) : (
              <>
                <Button size="lg" className="bg-white text-[#0a2540] hover:bg-gray-100 font-semibold text-base" onClick={() => navigate("/register")}>Crear cuenta</Button>
                <Button size="lg" variant="outline" className="border-white text-white hover:bg-white/15 text-base" onClick={() => navigate("/login")}>Ya tengo cuenta</Button>
              </>
            )}
          </div>
        </div>
      </section>

      {/* Chat global publico */}
      <section className="max-w-4xl mx-auto w-full px-4 -mt-6 relative z-10">
        <Card className="border-2 shadow-xl">
          <div className="bg-primary text-white px-4 py-2.5 rounded-t-lg flex items-center gap-2">
            <MessageSquareText className="h-4 w-4" />
            <span className="text-sm font-medium">Chat general de DES Informantes — conversacion abierta para toda la comunidad</span>
          </div>
          <CardContent className="p-0">
            <div className="h-[320px] overflow-y-auto p-4 space-y-2 bg-secondary/30">
              {loading && (
                <div className="text-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                </div>
              )}
              {!loading && messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">Se el primero en escribir en el chat general.</p>
              )}
              {pinnedMessages.length > 0 && (
                <div className="space-y-2 pb-2 border-b border-amber-200">
                  <p className="text-[10px] font-medium text-amber-600 flex items-center gap-1"><Pin className="h-3 w-3" /> FIJADOS POR EL ADMINISTRADOR</p>
                  {pinnedMessages.map((m: any) => (
                    <div key={`pinned-${m.id}`} className="flex gap-2">
                      <div className="w-7 h-7 rounded-full bg-amber-200 flex items-center justify-center shrink-0 text-xs font-bold text-amber-700">
                        {m.username?.[0]?.toUpperCase() || "?"}
                      </div>
                      <div className="bg-amber-50 border border-amber-300 rounded-lg px-3 py-1.5 text-sm max-w-[85%] relative group">
                        {isAdmin && (
                          <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                            <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-amber-100" title="Desfijar" onClick={() => togglePin(m.id)}>
                              <PinOff className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-blue-100 text-blue-500" title="Editar" onClick={() => { setEditingId(m.id); setEditText(m.content || ""); }}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-red-100 text-red-500" title="Eliminar" onClick={() => deleteMsg(m.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        )}
                        <span className="font-semibold text-xs text-amber-700">{m.username || "Usuario"}</span>
                        {editingId === m.id ? (
                          <div className="space-y-2 min-w-[260px] py-1">
                            <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="text-sm" autoFocus />
                            <div className="flex gap-2">
                              <Button size="sm" className="h-7 text-xs" onClick={() => editMsg(m.id)}>Guardar</Button>
                              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancelar</Button>
                            </div>
                          </div>
                        ) : (
                          <p className="text-foreground/90">{m.content}</p>
                        )}
                        <span className="text-[10px] text-muted-foreground">
                          {m.createdAt ? new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : ""}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {normalMessages.map((m: any) => (
                <div key={m.id} className="flex gap-2">
                  <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center shrink-0 text-xs font-bold text-primary">
                    {m.username?.[0]?.toUpperCase() || "?"}
                  </div>
                  <div className="bg-card border rounded-lg px-3 py-1.5 text-sm max-w-[85%] relative group">
                    {isAdmin && (
                      <div className="absolute -top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-amber-100" title="Fijar" onClick={() => togglePin(m.id)}>
                          <Pin className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-blue-100 text-blue-500" title="Editar" onClick={() => { setEditingId(m.id); setEditText(m.content || ""); }}>
                          <Pencil className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 bg-background/90 hover:bg-red-100 text-red-500" title="Eliminar" onClick={() => deleteMsg(m.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                    <span className="font-semibold text-xs text-primary">{m.username || "Usuario"}</span>
                    {editingId === m.id ? (
                      <div className="space-y-2 min-w-[260px] py-1">
                        <Textarea value={editText} onChange={(e) => setEditText(e.target.value)} rows={3} className="text-sm" autoFocus />
                        <div className="flex gap-2">
                          <Button size="sm" className="h-7 text-xs" onClick={() => editMsg(m.id)}>Guardar</Button>
                          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditingId(null)}>Cancelar</Button>
                        </div>
                      </div>
                    ) : (
                      <p className="text-foreground/90">{m.content}</p>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {m.createdAt ? new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>

                    {/* Reacciones y subdiscusion */}
                    <div className="flex items-center gap-1 mt-1 flex-wrap">
                      {reactionGroups(m).map((g) => (
                        <button
                          key={g.emoji}
                          onClick={() => isAuthenticated && toggleReaction(m.id, g.emoji)}
                          className={`text-xs rounded-full px-1.5 py-0.5 border ${g.mine ? "bg-primary/15 border-primary/50" : "bg-secondary/60 border-transparent"} ${isAuthenticated ? "hover:border-primary/50" : "cursor-default"}`}
                          title={isAuthenticated ? "Quitar/poner tu reaccion" : undefined}
                        >
                          {g.emoji} {g.count}
                        </button>
                      ))}
                      {isAuthenticated && (
                        <span className="relative">
                          <button
                            onClick={() => setReactPickerFor(reactPickerFor === m.id ? null : m.id)}
                            className="text-muted-foreground hover:text-primary p-0.5"
                            title="Reaccionar"
                          >
                            <SmilePlus className="h-3.5 w-3.5" />
                          </button>
                          {reactPickerFor === m.id && (
                            <div className="absolute bottom-6 left-0 z-20 bg-card border rounded-lg shadow-lg p-1 flex gap-0.5">
                              {EMOJIS.map((e) => (
                                <button key={e} onClick={() => toggleReaction(m.id, e)} className="text-base hover:scale-125 transition-transform px-0.5">{e}</button>
                              ))}
                            </div>
                          )}
                        </span>
                      )}
                      <button
                        onClick={() => toggleThread(m.id)}
                        className={`flex items-center gap-1 text-[10px] ${openThread === m.id ? "text-primary font-semibold" : "text-muted-foreground hover:text-primary"}`}
                      >
                        <MessagesSquare className="h-3.5 w-3.5" />
                        {m.replyCount > 0 ? `${m.replyCount} respuesta${m.replyCount !== 1 ? "s" : ""}` : isAuthenticated ? "Responder" : "Ver respuestas"}
                      </button>
                    </div>

                    {/* Panel de la subdiscusion */}
                    {openThread === m.id && (
                      <div className="mt-2 pl-2 border-l-2 border-primary/30 space-y-1.5 min-w-[240px]">
                        {replies.length === 0 && (
                          <p className="text-[11px] text-muted-foreground py-1">Aun no hay respuestas. Empieza la subdiscusion.</p>
                        )}
                        {replies.map((r: any) => (
                          <div key={r.id} className="bg-secondary/50 rounded-md px-2.5 py-1.5">
                            <span className="font-semibold text-[11px] text-primary">{r.username || "Usuario"}</span>
                            <p className="text-xs text-foreground/90">{r.content}</p>
                            <span className="text-[9px] text-muted-foreground">
                              {r.createdAt ? new Date(r.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }) : ""}
                            </span>
                          </div>
                        ))}
                        {isAuthenticated ? (
                          <div className="flex gap-1.5 pt-1">
                            <Input
                              value={replyText}
                              onChange={(e) => setReplyText(e.target.value)}
                              placeholder="Responde aqui..."
                              className="h-8 text-xs flex-1"
                              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); sendReply(m.id); } }}
                            />
                            <Button size="sm" className="h-8 px-2" disabled={sendingReply || !replyText.trim()} onClick={() => sendReply(m.id)}>
                              {sendingReply ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                            </Button>
                          </div>
                        ) : (
                          <p className="text-[10px] text-muted-foreground pt-1">
                            <Button variant="link" className="p-0 h-auto text-[10px]" onClick={() => navigate("/login")}>Inicia sesion</Button> para responder.
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>
            {isAuthenticated ? (
              <form className="p-3 border-t flex gap-2" onSubmit={sendMessage}>
                <div className="relative">
                  <Button type="button" variant="ghost" size="icon" onClick={() => setEmojiInputOpen(!emojiInputOpen)} title="Agregar emoji">
                    <Smile className="h-4 w-4" />
                  </Button>
                  {emojiInputOpen && (
                    <div className="absolute bottom-11 left-0 z-20 bg-card border rounded-lg shadow-lg p-2 grid grid-cols-4 gap-1 w-40">
                      {EMOJIS.map((e) => (
                        <button
                          key={e}
                          type="button"
                          onClick={() => { setText((t) => t + e); setEmojiInputOpen(false); }}
                          className="text-xl hover:scale-125 transition-transform"
                        >
                          {e}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe algo en el chat general..." className="flex-1" />
                <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            ) : (
              <div className="p-3 border-t text-center text-sm text-muted-foreground">
                <Button variant="link" className="p-0 h-auto" onClick={() => navigate("/login")}>Inicia sesion</Button> para participar en el chat general.
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Features */}
      <section className="max-w-6xl mx-auto px-4 py-16">
        <h2 className="font-display text-3xl text-center mb-2">Un ecosistema completo para trabajar</h2>
        <p className="text-center text-muted-foreground mb-10">Crea mesas de trabajo, conversa, documenta y deja que la IA organice todo.</p>
        <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-5">
          {features.map((f) => (
            <Card key={f.title} className="border-2 hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="w-10 h-10 rounded-lg di-gradient flex items-center justify-center mb-3">
                  <f.icon className="h-5 w-5 text-white" />
                </div>
                <h3 className="font-display text-base mb-1">{f.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{f.desc}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      {/* Como funciona */}
      <section className="di-gradient-soft border-y">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <h2 className="font-display text-3xl text-center mb-10">Asi funciona</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              { n: "1", t: "Registrate", d: "Crea tu cuenta con correo y contrasena, verifica tu correo y entra al ecosistema." },
              { n: "2", t: "Crea o unete a una mesa", d: "Solicita crear una mesa de trabajo o unete a una existente. Cada mesa reune a su equipo y sus discusiones." },
              { n: "3", t: "Propongan temas y conversen", d: "En cada discusion el grupo propone sus temas por el chat. La IA los organiza y guia el trabajo momento a momento, con la precision que da una buena intervencion." },
              { n: "4", t: "Concluyan y descarguen", d: "Cada momento cierra con una conclusion de la IA. Al final, la relatoria oficial del proceso queda lista para descargar en Word." },
            ].map((s) => (
              <div key={s.n} className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full di-gradient text-white font-display text-2xl flex items-center justify-center mb-3 shadow">{s.n}</div>
                <h3 className="font-display text-lg mb-1">{s.t}</h3>
                <p className="text-sm text-muted-foreground">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="mt-auto py-6 text-center text-sm text-muted-foreground">
        <div className="flex items-center justify-center gap-2">
          <Newspaper className="h-4 w-4" />
          DES Informantes — ecosistema de trabajo digital online.
        </div>
      </footer>
    </div>
  );
}
