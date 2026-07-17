  import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, MessageCircle, Plus, Search } from "lucide-react";

export default function Conversations() {
  const navigate = useNavigate();
  const [conversations, setConversations] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [showSearch, setShowSearch] = useState(false);

  useEffect(() => { fetchConversations(); }, []);

  async function fetchConversations() {
    try {
      const res = await fetch("/api/rest/workspaces/conversations", { credentials: "include" });
      if (res.ok) { const data = await res.json(); setConversations(Array.isArray(data) ? data : []); }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function searchUsers(query: string) {
    setSearch(query);
    if (query.length < 2) { setUsers([]); return; }
    try {
      const res = await fetch("/api/rest/workspaces/admin/users", { credentials: "include" });
      if (res.ok) {
        const allUsers = await res.json();
        const filtered = allUsers.filter((u: any) =>
          u.username.toLowerCase().includes(query.toLowerCase()) ||
          u.email.toLowerCase().includes(query.toLowerCase())
        );
        setUsers(filtered.slice(0, 10));
      }
    } catch (e) { console.error(e); }
  }

  async function startConversation(userId: number) {
    try {
      const res = await fetch("/api/rest/workspaces/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId }),
        credentials: "include",
      });
      if (res.ok) { const data = await res.json(); navigate(`/conversation/${data.conversationId}`); }
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
                <Input placeholder="Buscar usuario..." value={search} onChange={(e) => searchUsers(e.target.value)} className="pl-10" />
              </div>
              {users.length > 0 && (
                <div className="mt-2 space-y-1">
                  {users.map((u: any) => (
                    <button key={u.id} onClick={() => startConversation(u.id)}
                      className="w-full text-left px-3 py-2 rounded hover:bg-muted flex items-center justify-between">
                      <span>{u.username} <span className="text-xs text-muted-foreground">({u.email})</span></span>
                      <MessageCircle className="h-4 w-4 text-primary" />
                    </button>
                  ))}
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
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <MessageCircle className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{conv.otherUser?.username || "Usuario"}</p>
                  <p className="text-xs text-muted-foreground">{conv.otherUser?.email || ""}</p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
