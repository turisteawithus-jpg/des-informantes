import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { AudioRecorder } from "@/components/AudioRecorder";
import { MarkdownView } from "@/components/MarkdownView";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { uploadAudio } from "@/lib/upload";
import {
  Send, Loader2, Mic, MessageSquareText, Sparkles, ScrollText,
  ArrowLeft, Lock, Volume2,
} from "lucide-react";

export default function DiscussionRoom() {
  const { id } = useParams<{ id: string }>();
  const discussionId = Number(id);
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const discussion = trpc.discussions.get.useQuery({ discussionId }, { enabled: isAuthenticated, refetchInterval: 5000 });
  const messages = trpc.discussions.messages.useQuery({ discussionId }, { enabled: isAuthenticated, refetchInterval: 3000 });
  const summaries = trpc.discussions.summaries.useQuery({ discussionId }, { enabled: isAuthenticated, refetchInterval: 8000 });
  const relatoria = trpc.discussions.relatoria.useQuery({ discussionId }, { enabled: isAuthenticated && discussion.data?.status === "closed" });

  const [text, setText] = useState("");
  const [audioError, setAudioError] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  const sendText = trpc.discussions.sendText.useMutation({
    onSuccess: () => { utils.discussions.messages.invalidate({ discussionId }); setText(""); },
  });

  const closeDiscussion = trpc.discussions.close.useMutation({
    onSuccess: () => { utils.discussions.get.invalidate({ discussionId }); utils.discussions.relatoria.invalidate({ discussionId }); },
  });

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages.data?.length]);

  if (authLoading || discussion.isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!discussion.data) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Discusión no encontrada.</main></div>;

  const isOpen = discussion.data.status === "open";

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <AppHeader />
      <div className="border-b bg-card">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 min-w-0">
            <Button variant="ghost" size="icon" onClick={() => navigate(`/workspace/${discussion.data!.workspaceId}`)}><ArrowLeft className="h-4 w-4" /></Button>
            <div className="min-w-0">
              <h1 className="font-display text-xl truncate">{discussion.data.title}</h1>
              {discussion.data.description && <p className="text-xs text-muted-foreground truncate">{discussion.data.description}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isOpen ? (
              <>
                <Badge className="bg-green-600">En curso</Badge>
                <Button variant="outline" size="sm" className="gap-1" disabled={closeDiscussion.isPending}
                  onClick={() => { if (confirm("¿Cerrar la discusión? Se generará la relatoría con IA.")) closeDiscussion.mutate({ discussionId }); }}>
                  {closeDiscussion.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Lock className="h-3.5 w-3.5" />}Cerrar y generar relatoría
                </Button>
              </>
            ) : <Badge variant="secondary">Cerrada</Badge>}
          </div>
        </div>
      </div>

      <div className="flex-1 max-w-6xl mx-auto w-full px-4 py-4 grid lg:grid-cols-[1fr_340px] gap-4">
        {/* Mensajes */}
        <div className="flex flex-col min-h-[60vh]">
          <div className="flex-1 space-y-3 overflow-y-auto pb-4">
            {messages.data?.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><MessageSquareText className="h-10 w-10 mx-auto mb-2 opacity-50" />La discusión está lista. Escribe o graba un audio.</CardContent></Card>}
            {(messages.data ?? []).map((m: any) => {
              const mine = m.userId === user?.userId;
              return (
                <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 shadow-sm ${mine ? "di-gradient text-white" : "bg-card border-2"}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs font-semibold opacity-90">{m.username}</span>
                      {m.type === "audio" ? <Mic className="h-3 w-3 opacity-70" /> : <MessageSquareText className="h-3 w-3 opacity-70" />}
                      <span className="text-[10px] opacity-60">{new Date(m.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    {m.type === "audio" && m.audioUrl && <div className="flex items-center gap-2 mb-1.5"><Volume2 className="h-4 w-4 shrink-0 opacity-80" /><audio controls src={m.audioUrl} className="h-8 max-w-full" /></div>}
                    {m.transcriptionStatus === "pending" && <p className="text-xs italic opacity-80 flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />Transcribiendo…</p>}
                    {m.content && <p className="text-sm whitespace-pre-wrap leading-relaxed">{m.type === "audio" && <span className="text-[10px] uppercase opacity-60 block mb-0.5">Transcripción</span>}{m.content}</p>}
                  </div>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
          {isOpen ? (
            <div className="border-t pt-3 space-y-2">
              {audioError && <p className="text-xs text-destructive">{audioError}</p>}
              <form className="flex items-center gap-2" onSubmit={(e) => { e.preventDefault(); if (text.trim()) sendText.mutate({ discussionId, content: text.trim() }); }}>
                <AudioRecorder onRecorded={async (blob) => { setAudioError(""); const res = await uploadAudio(discussionId, blob); if (!res.ok) setAudioError(res.error ?? "Error"); utils.discussions.messages.invalidate({ discussionId }); }} />
                <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Escribe un mensaje…" className="flex-1" />
                <Button type="submit" size="icon" disabled={sendText.isPending || !text.trim()}><Send className="h-4 w-4" /></Button>
              </form>
            </div>
          ) : <div className="border-t pt-3 text-center text-sm text-muted-foreground">🔒 La discusión está cerrada. Revisa la relatoría.</div>}
        </div>

        {/* Panel IA */}
        <aside className="space-y-4">
          <Card className="border-2">
            <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl"><Sparkles className="h-4 w-4" /> Moderación IA</div>
            <CardContent className="pt-3 space-y-3 max-h-[40vh] overflow-y-auto">
              {!summaries.data?.length && <p className="text-xs text-muted-foreground">Cada 5 mensajes, la IA resume: conclusiones, tareas y ambiente.</p>}
              {(summaries.data ?? []).map((s: any) => (
                <div key={s.id} className="border rounded-lg p-2.5 bg-secondary/40">
                  <p className="text-[10px] text-muted-foreground mb-1">Resumen tras {s.messageCount} mensajes · {new Date(s.createdAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" })}</p>
                  <MarkdownView content={s.content} />
                </div>
              ))}
            </CardContent>
          </Card>
          {relatoria.data && (
            <Card className="border-2 border-primary">
              <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl"><ScrollText className="h-4 w-4" /> Relatoría oficial</div>
              <CardContent className="pt-3 max-h-[50vh] overflow-y-auto"><MarkdownView content={relatoria.data.content} /></CardContent>
            </Card>
          )}
          {closeDiscussion.isPending && <Card className="border-2"><CardContent className="py-6 text-center text-sm text-muted-foreground"><Loader2 className="h-6 w-6 animate-spin mx-auto mb-2 text-primary" />La IA está redactando la relatoría…</CardContent></Card>}
        </aside>
      </div>
    </div>
  );
}
