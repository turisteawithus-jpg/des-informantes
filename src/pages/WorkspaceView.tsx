import { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Loader2, MessageSquare, ArrowLeft, Users, CircleDot, CircleCheck,
  CheckCircle, XCircle, DoorOpen, UserCheck,
} from "lucide-react";

export default function WorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = Number(id);
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [ws, setWs] = useState<any>(null);
  const [discussions, setDiscussions] = useState<any[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [joinRequests, setJoinRequests] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // Crear discusion
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!isAuthenticated || !workspaceId) return;
    fetchAll();
  }, [isAuthenticated, workspaceId]);

  async function fetchAll() {
    setLoading(true);
    await Promise.all([fetchWorkspace(), fetchDiscussions(), fetchMembers(), fetchJoinRequests()]);
    setLoading(false);
  }

  async function fetchWorkspace() {
    try {
      const res = await fetch(`/api/rest/workspaces/${workspaceId}`, { credentials: "include" });
      if (res.ok) setWs(await res.json());
    } catch (e) { console.error(e); }
  }

  async function fetchDiscussions() {
    try {
      const res = await fetch(`/api/rest/workspaces/${workspaceId}/discussions`, { credentials: "include" });
      if (res.ok) setDiscussions(await res.json());
    } catch (e) { console.error(e); }
  }

  async function fetchMembers() {
    try {
      const res = await fetch(`/api/rest/workspaces/${workspaceId}/members`, { credentials: "include" });
      if (res.ok) setMembers(await res.json());
    } catch (e) { console.error(e); }
  }

  async function fetchJoinRequests() {
    try {
      const res = await fetch(`/api/rest/workspaces/${workspaceId}/join-requests`, { credentials: "include" });
      if (res.ok) setJoinRequests(await res.json());
    } catch (e) { console.error(e); }
  }

  async function createDiscussion(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch(`/api/rest/workspaces/${workspaceId}/discussions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
        credentials: "include",
      });
      if (res.ok) {
        const data = await res.json();
        setOpen(false); setTitle(""); setDescription("");
        fetchDiscussions();
        navigate(`/discussion/${data.discussionId}`);
      }
    } catch (e) { console.error(e); }
    setCreating(false);
  }

  async function respondJoin(requestId: number, action: "approve" | "reject") {
    try {
      const res = await fetch(`/api/rest/workspaces/join-requests/${requestId}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
        credentials: "include",
      });
      if (res.ok) { fetchJoinRequests(); fetchMembers(); }
    } catch (e) { console.error(e); }
  }

  async function requestJoin() {
    try {
      const res = await fetch("/api/rest/workspaces/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId }),
        credentials: "include",
      });
      if (res.ok) {
        alert("Solicitud de ingreso enviada. El administrador de la mesa la revisara.");
      } else {
        const data = await res.json();
        alert(data.error || "Error al solicitar ingreso");
      }
    } catch { alert("Error de conexion"); }
  }

  if (authLoading || loading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!ws) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Mesa no encontrada.</main></div>;

  const isMember = !!ws.memberRole;
  const isWsAdmin = ws.memberRole === "admin";

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-6xl mx-auto w-full px-4 py-6 flex-1">
        <Button variant="ghost" size="sm" className="mb-3 gap-1" onClick={() => navigate("/dashboard")}><ArrowLeft className="h-4 w-4" /> Mis mesas</Button>

        {/* Header */}
        <div className="di-gradient rounded-2xl p-6 text-white shadow-lg mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-3xl mb-1">{ws.name}</h1>
              {ws.area && <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{ws.area}</span>}
              <p className="text-sm opacity-90 mt-2 max-w-2xl">{ws.description || "Sin descripcion"}</p>
              {ws.objective && <p className="text-sm opacity-75 mt-1"><strong>Objetivo:</strong> {ws.objective}</p>}
            </div>
            <div className="flex items-center gap-2 text-sm bg-white/15 rounded-lg px-3 py-1.5"><Users className="h-4 w-4" />{members.length} miembros</div>
          </div>
          {!isMember && (
            <Button className="mt-4 bg-white text-[#0a2540] hover:bg-gray-100 gap-2" onClick={requestJoin}>
              <DoorOpen className="h-4 w-4" /> Solicitar unirme
            </Button>
          )}
        </div>

        {/* Solicitudes de ingreso */}
        {isWsAdmin && joinRequests.length > 0 && (
          <Card className="border-2 border-amber-400 mb-4">
            <CardHeader><CardTitle className="font-display text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> Solicitudes de ingreso ({joinRequests.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {joinRequests.map((req: any) => (
                <div key={req.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                  <div>
                    <p className="font-medium text-sm">{req.username}</p>
                    <p className="text-xs text-muted-foreground">{req.email}</p>
                    {req.message && <p className="text-xs text-muted-foreground italic">"{req.message}"</p>}
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => respondJoin(req.id, "approve")}><CheckCircle className="h-3.5 w-3.5" /> Aprobar</Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => respondJoin(req.id, "reject")}><XCircle className="h-3.5 w-3.5" /> Rechazar</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isMember ? (
          <Tabs defaultValue="discussions">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="discussions">Discusiones</TabsTrigger>
              <TabsTrigger value="members">Miembros</TabsTrigger>
            </TabsList>

            <TabsContent value="discussions" className="mt-4 space-y-4">
              <div className="flex justify-end">
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" /> Nueva discusion</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="font-display text-xl">Abrir una discusion</DialogTitle></DialogHeader>
                    <form className="space-y-4" onSubmit={createDiscussion}>
                      <div className="space-y-1.5"><Label>Titulo *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Definir notas del noticiero" required /></div>
                      <div className="space-y-1.5"><Label>Agenda</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
                      <Button type="submit" className="w-full" disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abrir discusion"}</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              {discussions.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />Aun no hay discusiones. Abre la primera.</CardContent></Card>}
              <div className="grid md:grid-cols-2 gap-4">
                {discussions.map((d: any) => (
                  <Card key={d.id} className="border-2 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(`/discussion/${d.id}`)}>
                    <CardHeader className="pb-2">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="font-display text-lg leading-tight">{d.title}</CardTitle>
                        {d.status === "open" ? <Badge className="bg-green-600 gap-1 shrink-0"><CircleDot className="h-3 w-3" /> Abierta</Badge> : <Badge variant="secondary" className="gap-1 shrink-0"><CircleCheck className="h-3 w-3" /> Cerrada</Badge>}
                      </div>
                    </CardHeader>
                    <CardContent>
                      <p className="text-sm text-muted-foreground line-clamp-2">{d.description || "Sin agenda"}</p>
                      <p className="text-xs text-muted-foreground mt-2">{new Date(d.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </TabsContent>

            <TabsContent value="members" className="mt-4">
              <Card className="border-2">
                <CardHeader><CardTitle className="font-display">Miembros de la mesa</CardTitle></CardHeader>
                <CardContent className="space-y-2">
                  {members.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                      <div>
                        <p className="font-medium text-sm">{m.username}</p>
                        <p className="text-xs text-muted-foreground">{m.email}</p>
                      </div>
                      <Badge className={m.role === "admin" ? "di-gradient text-white" : ""}>{m.role === "admin" ? "Admin" : "Miembro"}</Badge>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        ) : (
          <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground">Unete a esta mesa para ver las discusiones y participar.</CardContent></Card>
        )}
      </main>
    </div>
  );
}
