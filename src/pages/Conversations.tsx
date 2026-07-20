import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { Loader2, MessageCircle, Plus, Search, UserPlus, Clock, Check } from "lucide-react";

function timeLabel(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
}

export default function Conversations() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [conversations, setConversations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);
  const [hint, setHint] = useState("");
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    fetchConversations();
    const iv = setInterval(fetchConversations, 5000);
    return () => clearInterval(iv);
  }, []);

  async function fetchConversations() {
    try {
      const res = await fetch("/api/rest/workspaces/conversations", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setConversations(Array.isArray(data) ? data : []);
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  // Busca usuarios por nombre (disponible para todos los usuarios)
  function searchUsers(query: string) {
    setSearch(query);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (query.trim().length < 2) { setUsers([]); return; }
    searchTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/rest/workspaces/users/search?q=${encodeURIComponent(query.trim())}`, { credentials: "include" });
        if (res.ok) setUsers(await res.json());
      } catch (e) { console.error(e); }
    }, 350);
  }

  async function startConversation(userId: number) {
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
        navigate(`/conversation/${data.conversationId}`);
      } else {
        const data = await res.json().catch(() => null);
        setHint(data?.error ?? "No se pudo abrir el chat");
      }
    } catch (e) { console.error(e); }
  }

  async function sendRequest(userId: number) {
    try {
      await fetch("/api/rest/workspaces/friends/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      searchUsers(search);
    } catch (e) { console.error(e); }
  }

  async function acceptRequest(friendshipId: number) {
    try {
      await fetch(`/api/rest/workspaces/friends/${friendshipId}/accept`, {
        method: "POST",
        credentials: "include",
      });
      searchUsers(search);
    } catch (e) { console.error(e); }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-4xl mx-auto w-full px-4 py-8 flex-1">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl di-gradient flex items-center justify-center">
              <MessageCircle className="h-6 w-6 text-white" />
            </div>
            <div>
              <h1 className="font-display text-3xl">Chats privados</h1>
              <p className="text-sm text-muted-foreground">Conversaciones con otros usuarios</p>
            </div>
          </div>
          <Button onClick={() => setShowSearch(!showSearch)} className="gap-2">
            <Plus className="h-4 w-4" /> Nuevo chat
          </Button>
        </div>

        {showSearch && (
          <Card className="border-2 mb-6">
            <CardContent className="pt-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input placeholder="Buscar usuario por nombre..." value={search} onChange={(e) => searchUsers(e.target.value)} className="pl-10" />
              </div>
              {hint && <p className="text-xs text-amber-600 mt-2 px-1">{hint}</p>}
              {users.length > 0 && (
                <div className="mt-2 space-y-1">
                  {users.map((u: any) => (
                    <div key={u.id} className="w-full px-3 py-2 rounded hover:bg-muted flex items-center justify-between">
                      <span className="text-sm">{u.username}</span>
                      {u.status === "friends" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => startConversation(u.id)}>
                          <MessageCircle className="h-3.5 w-3.5" /> Chat
                        </Button>
                      )}
                      {u.status === "none" && (
                        <Button size="sm" variant="outline" className="h-7 text-xs gap-1" onClick={() => sendRequest(u.id)}>
                          <UserPlus className="h-3.5 w-3.5" /> Agregar
                        </Button>
                      )}
                      {u.status === "pending_out" && (
                        <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> Solicitud enviada</span>
                      )}
                      {u.status === "pending_in" && (
                        <Button size="sm" className="h-7 text-xs gap-1" onClick={() => acceptRequest(u.friendshipId)}>
                          <Check className="h-3.5 w-3.5" /> Aceptar
                        </Button>
                      )}
                    </div>
                  ))}
                  <p className="text-[11px] text-muted-foreground pt-1 px-1">
                    Para chatear con alguien primero deben ser amigos: enviale una solicitud y podran escribirse cuando la acepte.
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card className="border-2">
          <CardHeader><CardTitle className="font-display">Tus conversaciones</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {loading && <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}
            {!loading && conversations.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-8">No tienes conversaciones privadas.</p>
            )}
            {conversations.map((conv: any) => (
              <div key={conv.id} onClick={() => navigate(`/conversation/${conv.id}`)}
                className="flex items-center gap-3 p-3 rounded-lg border hover:bg-muted cursor-pointer transition-colors">
                <div className="w-10 h-10 rounded-full di-gradient text-white flex items-center justify-center font-bold shrink-0">
                  {(conv.otherUser?.username?.[0] ?? "?").toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-medium truncate">{conv.otherUser?.username || "Usuario"}</p>
                    <span className="text-[10px] text-muted-foreground shrink-0">{timeLabel(conv.lastMessage?.createdAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground truncate">
                      {conv.lastMessage
                        ? `${conv.lastMessage.senderId === user?.userId ? "Tu: " : ""}${conv.lastMessage.content}`
                        : "Empieza la conversacion"}
                    </p>
                    {conv.unreadCount > 0 && (
                      <span className="bg-primary text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 shrink-0">
                        {conv.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
            {conversations.length > 0 && (
              <p className="text-[10px] text-muted-foreground text-center pt-2">
                Las conversaciones se conservan durante un mes.
              </p>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
