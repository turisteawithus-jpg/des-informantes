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
} from "lucide-react";

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
      }
    } catch (e) { console.error(e); }
    setSending(false);
  }

    useEffect(() => {
    if (!isAuthenticated || !discussionId) return;
    async function load() {
      await Promise.all([fetchDiscussion(), fetchMessages()]);
      setLoading(false);
    }
    load();
    const interval = setInterval(() => { fetchMessages(); fetchDiscussion(); }, 3000);
    return () => clearInterval(interval);
  }, [isAuthenticated, discussionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusion no encontrada.</main></div>;

  const isOpen = discussion.status === "open";

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
                <Button variant="outline" size="sm" onClick={async () => { if (!confirm("Cerrar la discusion? Se generara la relatoria con IA.")) return; try { const res = await fetch(`/api/rest/workspaces/discussion/${discussionId}/close`, { method: "POST", credentials: "include" }); if (res.ok) { alert("Discusion cerrada. Relatoria generada."); fetchDiscussion(); } } catch (e) { console.error(e); } }}>
                  <Lock className="h-3.5 w-3.5 mr-1" /> Cerrar y generar relatoria
                </Button>
              </>
            ) : <Badge variant="secondary">Cerrada</Badge>}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-4 flex flex-col min-h-[60vh]">
        {/* Mensajes */}
        <div className="flex-1 space-y-3 overflow-y-auto pb-4">
          {messages.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-50" />La discusion esta lista. Escribe un mensaje.</CardContent></Card>}
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
          <div className="border-t pt-3">
            <form className="flex items-center gap-2" onSubmit={sendMessage}>
              <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje..." className="flex-1" />
              <Button type="submit" size="icon" disabled={sending || !text.trim()}><Send className="h-4 w-4" /></Button>
            </form>
          </div>
        ) : <div className="border-t pt-3 text-center text-sm text-muted-foreground">La discusion esta cerrada.</div>}
      </div>
    </div>
  );
}
