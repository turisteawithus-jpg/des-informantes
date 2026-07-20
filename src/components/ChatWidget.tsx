import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import {
  Menu, X, MessageCircle, Users, Search, Loader2, Send,
  ArrowLeft, UserPlus, Clock, Check,
} from "lucide-react";

/* ================================================================
   CHATS PERSONALES — ventana flotante (esquina inferior derecha)
   - Boton de menu (hamburguesa) siempre visible para quien inicio sesion.
   - Lista de conversaciones estilo WhatsApp: ultimo mensaje, hora y
     cantidad de no leidos; se actualiza sola cada 5 segundos.
   - Amigos: solicitudes de amistad (enviar/aceptar/rechazar) y buscador
     de usuarios por nombre.
   - Al abrir un chat, los mensajes llegan solos cada 4 segundos.
   - Las conversaciones solo se conservan un mes (limpieza automatica).
   ================================================================ */

type ActiveChat = { id: number; username: string };

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  return sameDay
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

function Avatar({ name, small }: { name: string; small?: boolean }) {
  return (
    <div className={`${small ? "w-8 h-8 text-xs" : "w-10 h-10 text-sm"} rounded-full di-gradient text-white flex items-center justify-center font-bold shrink-0`}>
      {(name?.[0] ?? "?").toUpperCase()}
    </div>
  );
}

/* ------------------ Ventana de conversacion ------------------ */
function ChatWindow({ chat, onBack }: { chat: ActiveChat; onBack: () => void }) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<any[]>([]);
  const [content, setContent] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  async function fetchMessages() {
    try {
      const res = await fetch(`/api/rest/workspaces/conversations/${chat.id}/messages`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data?.messages) ? data.messages : []);
      }
    } catch { /* reintenta en el siguiente ciclo */ }
  }

  useEffect(() => {
    setMessages([]);
    fetchMessages();
    const iv = setInterval(fetchMessages, 4000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rest/workspaces/conversations/${chat.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
        credentials: "include",
      });
      if (res.ok) {
        setContent("");
        fetchMessages();
      }
    } catch { /* el usuario reintenta */ }
    setSending(false);
  }

  return (
    <>
      <div className="di-gradient text-white px-3 py-2.5 flex items-center gap-2">
        <button onClick={onBack} className="text-white/85 hover:text-white" title="Volver a la lista">
          <ArrowLeft className="h-4 w-4" />
        </button>
        <Avatar name={chat.username} small />
        <p className="font-medium text-sm truncate">{chat.username}</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-2 bg-secondary/30">
        {messages.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-6">
            Aun no hay mensajes. Saluda a {chat.username}.
          </p>
        )}
        {messages.map((m: any) => {
          const mine = m.senderId === user?.userId;
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[78%] rounded-lg px-3 py-1.5 text-sm ${mine ? "di-gradient text-white" : "bg-card border"}`}>
                <p>{m.content}</p>
                <p className={`text-[9px] mt-0.5 ${mine ? "text-white/70 text-right" : "text-muted-foreground"}`}>
                  {timeLabel(m.createdAt)}
                </p>
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="p-2 border-t flex gap-1.5">
        <Input
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 h-9 text-sm"
          disabled={sending}
        />
        <Button type="submit" size="icon" className="h-9 w-9" disabled={sending || !content.trim()}>
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        </Button>
      </form>
    </>
  );
}

/* ------------------ Widget principal ------------------ */
export function ChatWidget() {
  const { user, isAuthenticated } = useAuth();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"chats" | "amigos">("chats");
  const [convs, setConvs] = useState<any[]>([]);
  const [friends, setFriends] = useState<any[]>([]);
  const [requests, setRequests] = useState<{ incoming: any[]; outgoing: any[] }>({ incoming: [], outgoing: [] });
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [activeChat, setActiveChat] = useState<ActiveChat | null>(null);
  const [hint, setHint] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const unreadTotal = convs.reduce((acc, cv) => acc + (cv.unreadCount || 0), 0);
  const pendingCount = requests.incoming.length;
  const badge = unreadTotal + pendingCount;

  async function fetchConvs() {
    try {
      const res = await fetch("/api/rest/workspaces/conversations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setConvs(Array.isArray(data) ? data : []);
      }
    } catch { /* reintenta en el siguiente ciclo */ }
  }

  async function fetchFriendsData() {
    try {
      const [f, r] = await Promise.all([
        fetch("/api/rest/workspaces/friends", { credentials: "include" }),
        fetch("/api/rest/workspaces/friends/requests", { credentials: "include" }),
      ]);
      if (f.ok) setFriends(await f.json());
      if (r.ok) setRequests(await r.json());
    } catch { /* reintenta en el siguiente ciclo */ }
  }

  // Actualizacion automatica de la bandeja (cada 5 segundos)
  useEffect(() => {
    if (!isAuthenticated) return;
    fetchConvs();
    fetchFriendsData();
    const iv = setInterval(() => { fetchConvs(); fetchFriendsData(); }, 5000);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Busqueda con pausa (deja de escribir 350ms y busca)
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = search.trim();
    if (q.length < 2) { setResults([]); setSearching(false); return; }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rest/workspaces/users/search?q=${encodeURIComponent(q)}`, { credentials: "include" });
        if (res.ok) setResults(await res.json());
      } catch { /* sin resultados */ }
      setSearching(false);
    }, 350);
    return () => { if (searchTimer.current) clearTimeout(searchTimer.current); };
  }, [search]);

  async function startChat(userId: number, username: string) {
    setHint("");
    try {
      const res = await fetch("/api/rest/workspaces/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setActiveChat({ id: data.conversationId, username });
        setSearch("");
        setResults([]);
      } else {
        const data = await res.json().catch(() => null);
        setHint(data?.error ?? "No se pudo abrir el chat");
      }
    } catch { setHint("No se pudo abrir el chat"); }
  }

  async function sendRequest(userId: number) {
    try {
      await fetch("/api/rest/workspaces/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      // Refrescar estados de la busqueda
      setSearch((s) => s);
      fetchFriendsData();
      const res = await fetch(`/api/rest/workspaces/users/search?q=${encodeURIComponent(search.trim())}`, { credentials: "include" });
      if (res.ok) setResults(await res.json());
    } catch { /* el usuario reintenta */ }
  }

  async function answerRequest(friendshipId: number, accept: boolean) {
    try {
      await fetch(`/api/rest/workspaces/friends/${friendshipId}/${accept ? "accept" : "decline"}`, {
        method: "POST",
        credentials: "include",
      });
      fetchFriendsData();
    } catch { /* el usuario reintenta */ }
  }

  if (!isAuthenticated) return null;

  const filteredConvs = search.trim().length >= 2 && tab === "chats"
    ? convs.filter((cv) => cv.otherUser?.username?.toLowerCase().includes(search.trim().toLowerCase()))
    : convs;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 print:hidden">
      {open && (
        <div className="w-[330px] max-w-[calc(100vw-2rem)] h-[470px] max-h-[72vh] bg-card border-2 rounded-xl shadow-2xl flex flex-col overflow-hidden">
          {activeChat ? (
            <ChatWindow chat={activeChat} onBack={() => { setActiveChat(null); fetchConvs(); }} />
          ) : (
            <>
              <div className="di-gradient text-white px-3 py-2.5 flex items-center justify-between">
                <p className="font-display text-base">Chats personales</p>
                <button onClick={() => setOpen(false)} className="text-white/85 hover:text-white" title="Cerrar">
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex border-b">
                <button
                  onClick={() => { setTab("chats"); setSearch(""); setResults([]); setHint(""); }}
                  className={`flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 ${tab === "chats" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                >
                  <MessageCircle className="h-3.5 w-3.5" /> Chats
                  {unreadTotal > 0 && <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">{unreadTotal}</span>}
                </button>
                <button
                  onClick={() => { setTab("amigos"); setSearch(""); setResults([]); setHint(""); }}
                  className={`flex-1 py-2 text-xs font-medium flex items-center justify-center gap-1.5 ${tab === "amigos" ? "text-primary border-b-2 border-primary" : "text-muted-foreground"}`}
                >
                  <Users className="h-3.5 w-3.5" /> Amigos
                  {pendingCount > 0 && <span className="bg-red-500 text-white text-[9px] font-bold rounded-full min-w-[16px] h-4 flex items-center justify-center px-1">{pendingCount}</span>}
                </button>
              </div>

              <div className="p-2 border-b">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder={tab === "chats" ? "Buscar en tus conversaciones..." : "Buscar usuarios por nombre..."}
                    className="pl-8 h-8 text-xs"
                  />
                </div>
                {hint && <p className="text-[11px] text-amber-600 mt-1.5 px-1">{hint}</p>}
              </div>

              <div className="flex-1 overflow-y-auto">
                {tab === "chats" && (
                  <>
                    {filteredConvs.length === 0 && (
                      <p className="text-xs text-muted-foreground text-center py-8 px-4">
                        {convs.length === 0
                          ? "Aun no tienes conversaciones. En la pestana Amigos puedes encontrar a otros usuarios."
                          : "Ninguna conversacion coincide con la busqueda."}
                      </p>
                    )}
                    {filteredConvs.map((cv: any) => (
                      <button
                        key={cv.id}
                        onClick={() => cv.otherUser && setActiveChat({ id: cv.id, username: cv.otherUser.username })}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-muted/70 text-left border-b last:border-b-0"
                      >
                        <Avatar name={cv.otherUser?.username ?? "?"} />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-sm font-medium truncate">{cv.otherUser?.username ?? "Usuario"}</p>
                            <span className="text-[9px] text-muted-foreground shrink-0">{timeLabel(cv.lastMessage?.createdAt)}</span>
                          </div>
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-xs text-muted-foreground truncate">
                              {cv.lastMessage
                                ? `${cv.lastMessage.senderId === user?.userId ? "Tu: " : ""}${cv.lastMessage.content}`
                                : "Empieza la conversacion"}
                            </p>
                            {cv.unreadCount > 0 && (
                              <span className="bg-primary text-white text-[9px] font-bold rounded-full min-w-[17px] h-[17px] flex items-center justify-center px-1 shrink-0">
                                {cv.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}
                    <p className="text-[9px] text-muted-foreground text-center py-2">
                      Las conversaciones se conservan durante un mes.
                    </p>
                  </>
                )}

                {tab === "amigos" && (
                  <>
                    {requests.incoming.length > 0 && (
                      <div className="border-b">
                        <p className="text-[10px] font-semibold text-primary px-3 pt-2 pb-1 uppercase tracking-wide">Solicitudes recibidas</p>
                        {requests.incoming.map((r: any) => (
                          <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                            <Avatar name={r.user.username} small />
                            <p className="text-sm flex-1 truncate">{r.user.username}</p>
                            <Button size="sm" className="h-7 text-xs px-2" onClick={() => answerRequest(r.id, true)}>Aceptar</Button>
                            <Button size="sm" variant="ghost" className="h-7 text-xs px-2" onClick={() => answerRequest(r.id, false)}>Rechazar</Button>
                          </div>
                        ))}
                      </div>
                    )}

                    {search.trim().length >= 2 ? (
                      <>
                        {searching && <div className="text-center py-4"><Loader2 className="h-4 w-4 animate-spin mx-auto text-muted-foreground" /></div>}
                        {!searching && results.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-6">No hay usuarios con ese nombre.</p>
                        )}
                        {results.map((u: any) => (
                          <div key={u.id} className="flex items-center gap-2.5 px-3 py-2 border-b last:border-b-0">
                            <Avatar name={u.username} small />
                            <p className="text-sm flex-1 truncate">{u.username}</p>
                            {u.status === "friends" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={() => startChat(u.id, u.username)}>
                                <MessageCircle className="h-3 w-3" /> Chat
                              </Button>
                            )}
                            {u.status === "none" && (
                              <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={() => sendRequest(u.id)}>
                                <UserPlus className="h-3 w-3" /> Agregar
                              </Button>
                            )}
                            {u.status === "pending_out" && (
                              <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Enviada</span>
                            )}
                            {u.status === "pending_in" && (
                              <Button size="sm" className="h-7 text-xs px-2 gap-1" onClick={() => answerRequest(u.friendshipId, true)}>
                                <Check className="h-3 w-3" /> Aceptar
                              </Button>
                            )}
                          </div>
                        ))}
                      </>
                    ) : (
                      <>
                        {requests.outgoing.length > 0 && (
                          <div className="border-b">
                            <p className="text-[10px] font-semibold text-muted-foreground px-3 pt-2 pb-1 uppercase tracking-wide">Solicitudes enviadas</p>
                            {requests.outgoing.map((r: any) => (
                              <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                                <Avatar name={r.user.username} small />
                                <p className="text-sm flex-1 truncate">{r.user.username}</p>
                                <span className="text-[10px] text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Esperando</span>
                              </div>
                            ))}
                          </div>
                        )}
                        <p className="text-[10px] font-semibold text-muted-foreground px-3 pt-2 pb-1 uppercase tracking-wide">Tus amigos</p>
                        {friends.length === 0 && (
                          <p className="text-xs text-muted-foreground text-center py-6 px-4">
                            Aun no tienes amigos. Usa el buscador de arriba para encontrar usuarios y enviarles una solicitud.
                          </p>
                        )}
                        {friends.map((f: any) => (
                          <div key={f.id} className="flex items-center gap-2.5 px-3 py-2 border-b last:border-b-0">
                            <Avatar name={f.username} small />
                            <p className="text-sm flex-1 truncate">{f.username}</p>
                            <Button size="sm" variant="outline" className="h-7 text-xs px-2 gap-1" onClick={() => startChat(f.id, f.username)}>
                              <MessageCircle className="h-3 w-3" /> Chat
                            </Button>
                          </div>
                        ))}
                      </>
                    )}
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => { setOpen(!open); if (open) setActiveChat(null); }}
        className="h-12 w-12 rounded-full di-gradient text-white shadow-xl flex items-center justify-center relative hover:scale-105 transition-transform"
        title="Chats personales"
      >
        <Menu className="h-5 w-5" />
        {badge > 0 && (
          <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 border-2 border-background">
            {badge > 99 ? "99+" : badge}
          </span>
        )}
      </button>
    </div>
  );
}
