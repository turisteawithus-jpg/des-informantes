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

      <div className="max-w-6xl mx-auto w-full px-4 py-4 space-y-4 flex-1">
