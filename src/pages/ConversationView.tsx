import { useState, useEffect, useRef } from "react";
import { useParams, useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Loader2, Send, ArrowLeft } from "lucide-react";

export default function ConversationView() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [messages, setMessages] = useState<any[]>([]);
  const [otherUser, setOtherUser] = useState<any>(null);
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (id) fetchMessages(); }, [id]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  async function fetchMessages() {
    setLoading(true);
    try {
      const res = await fetch(`/api/rest/workspaces/conversations/${id}/messages`, { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        setMessages(Array.isArray(data) ? data : []);
        if (data.length > 0) {
          const firstMsg = data[0];
          setOtherUser({ username: firstMsg.senderName });
        }
      }
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function sendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim() || !id) return;
    setSending(true);
    try {
      const res = await fetch(`/api/rest/workspaces/conversations/${id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: content.trim() }),
        credentials: "include",
      });
      if (res.ok) { setContent(""); fetchMessages(); }
    } catch (e) { console.error(e); }
    setSending(false);
  }

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-4xl mx-auto w-full px-4 py-4 flex-1 flex flex-col">
        <div className="flex items-center gap-3 mb-4">
          <Button variant="ghost" size="sm" onClick={() => navigate("/conversations")} className="gap-1">
            <ArrowLeft className="h-4 w-4" /> Volver
          </Button>
          <div>
            <h1 className="font-display text-xl">{otherUser?.username || `Chat #${id}`}</h1>
            <p className="text-xs text-muted-foreground">Chat privado</p>
          </div>
        </div>

        <Card className="border-2 flex-1 flex flex-col min-h-[400px]">
          <CardContent className="flex-1 flex flex-col p-4">
            <div className="flex-1 overflow-y-auto space-y-3 mb-4">
              {loading && <div className="text-center py-8"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}
              {!loading && messages.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-8">No hay mensajes. Inicia la conversacion.</p>
              )}
              {messages.map((msg: any) => (
                <div key={msg.id} className="flex justify-start">
                  <div className="max-w-[70%] rounded-lg px-3 py-2 bg-muted">
                    <p className="text-xs font-medium mb-0.5">{msg.senderName}</p>
                    <p className="text-sm">{msg.content}</p>
                    <p className="text-[10px] opacity-70 mt-0.5">{new Date(msg.createdAt).toLocaleTimeString()}</p>
                  </div>
                </div>
              ))}
              <div ref={bottomRef} />
            </div>

            <form onSubmit={sendMessage} className="flex gap-2 mt-auto">
              <Input placeholder="Escribe un mensaje..." value={content} onChange={(e) => setContent(e.target.value)} disabled={sending} className="flex-1" />
              <Button type="submit" disabled={sending || !content.trim()} className="gap-1">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
