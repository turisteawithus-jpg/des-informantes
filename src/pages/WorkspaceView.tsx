import { useState } from "react";
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
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { DocumentsPanel } from "@/components/workspace/DocumentsPanel";
import { TasksPanel } from "@/components/workspace/TasksPanel";
import { SystematizationPanel } from "@/components/workspace/SystematizationPanel";
import { TimelinePanel } from "@/components/workspace/TimelinePanel";
import {
  Plus, Loader2, MessageSquare, ArrowLeft, Users, CircleDot, CircleCheck,
  CheckCircle, XCircle, DoorOpen, UserCheck,
} from "lucide-react";

export default function WorkspaceView() {
  const { id } = useParams<{ id: string }>();
  const workspaceId = Number(id);
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const ws = trpc.workspaces.get.useQuery({ workspaceId }, { enabled: isAuthenticated });
  const discussions = trpc.discussions.list.useQuery({ workspaceId }, { enabled: isAuthenticated });
  const members = trpc.workspaces.members.useQuery({ workspaceId }, { enabled: isAuthenticated });
  const joinRequests = trpc.workspaces.listJoinRequests.useQuery(
    { workspaceId },
    { enabled: isAuthenticated && (ws.data?.memberRole === "admin" || false) },
  );

  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const createDiscussion = trpc.discussions.create.useMutation({
    onSuccess: (data) => {
      utils.discussions.list.invalidate({ workspaceId });
      setOpen(false); setTitle(""); setDescription("");
      navigate(`/discussion/${data.discussionId}`);
    },
  });

  const respondJoin = trpc.workspaces.respondJoinRequest.useMutation({
    onSuccess: () => {
      utils.workspaces.listJoinRequests.invalidate({ workspaceId });
      utils.workspaces.members.invalidate({ workspaceId });
    },
  });

  if (authLoading || ws.isLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }
  if (!ws.data) return <div className="min-h-screen flex flex-col"><AppHeader /><main className="flex-1 flex items-center justify-center text-muted-foreground">Mesa no encontrada.</main></div>;

  const isMember = !!ws.data.memberRole;
  const isWsAdmin = ws.data.memberRole === "admin";

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-6xl mx-auto w-full px-4 py-6 flex-1">
        <Button variant="ghost" size="sm" className="mb-3 gap-1" onClick={() => navigate("/dashboard")}><ArrowLeft className="h-4 w-4" /> Mis mesas</Button>

        {/* Header */}
        <div className="di-gradient rounded-2xl p-6 text-white shadow-lg mb-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex-1 min-w-0">
              <h1 className="font-display text-3xl mb-1">{ws.data.name}</h1>
              {ws.data.area && <span className="text-xs bg-white/20 px-2 py-0.5 rounded-full">{ws.data.area}</span>}
              <p className="text-sm opacity-90 mt-2 max-w-2xl">{ws.data.description || "Sin descripción"}</p>
              {ws.data.objective && <p className="text-sm opacity-75 mt-1"><strong>Objetivo:</strong> {ws.data.objective}</p>}
            </div>
            <div className="flex items-center gap-2 text-sm bg-white/15 rounded-lg px-3 py-1.5"><Users className="h-4 w-4" />{members.data?.length ?? 0} miembros</div>
          </div>
          {!isMember && (
            <Button className="mt-4 bg-white text-[#0a2540] hover:bg-gray-100 gap-2" onClick={() => alert("Solicitud enviada.")}>
              <DoorOpen className="h-4 w-4" /> Solicitar unirme
            </Button>
          )}
        </div>

        {/* Solicitudes de ingreso pendientes */}
        {isWsAdmin && joinRequests.data && joinRequests.data.length > 0 && (
          <Card className="border-2 border-amber-400 mb-4">
            <CardHeader><CardTitle className="font-display text-base flex items-center gap-2"><UserCheck className="h-4 w-4" /> Solicitudes de ingreso pendientes ({joinRequests.data.length})</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              {joinRequests.data.map((req: any) => (
                <div key={req.id} className="flex items-center justify-between border rounded-lg px-3 py-2">
                  <div><p className="font-medium text-sm">{req.username}</p><p className="text-xs text-muted-foreground">{req.email}</p></div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => respondJoin.mutate({ requestId: req.id, action: "approve" })}><CheckCircle className="h-3.5 w-3.5" /> Aprobar</Button>
                    <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => respondJoin.mutate({ requestId: req.id, action: "reject" })}><XCircle className="h-3.5 w-3.5" /> Rechazar</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {isMember ? (
          <Tabs defaultValue="discussions">
            <TabsList className="flex-wrap h-auto">
              <TabsTrigger value="discussions">💬 Discusiones</TabsTrigger>
              <TabsTrigger value="tasks">✅ Tareas</TabsTrigger>
              <TabsTrigger value="docs">📁 Documentos y mapa</TabsTrigger>
              <TabsTrigger value="timeline">📅 Línea de trabajo</TabsTrigger>
              <TabsTrigger value="system">📜 Sistematización</TabsTrigger>
            </TabsList>

            <TabsContent value="discussions" className="mt-4 space-y-4">
              <div className="flex justify-end">
                <Dialog open={open} onOpenChange={setOpen}>
                  <DialogTrigger asChild><Button className="gap-2"><Plus className="h-4 w-4" /> Nueva discusión</Button></DialogTrigger>
                  <DialogContent>
                    <DialogHeader><DialogTitle className="font-display text-xl">Abrir una discusión</DialogTitle></DialogHeader>
                    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); createDiscussion.mutate({ workspaceId, title, description }); }}>
                      <div className="space-y-1.5"><Label>Título *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Definir notas del noticiero" required /></div>
                      <div className="space-y-1.5"><Label>Agenda</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
                      <Button type="submit" className="w-full" disabled={createDiscussion.isPending}>{createDiscussion.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Abrir discusión"}</Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </div>
              {discussions.data?.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><MessageSquare className="h-10 w-10 mx-auto mb-2 opacity-50" />Aún no hay discusiones. Abre la primera.</CardContent></Card>}
              <div className="grid md:grid-cols-2 gap-4">
                {(discussions.data ?? []).map((d: any) => (
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

            <TabsContent value="tasks" className="mt-4"><TasksPanel workspaceId={workspaceId} members={members.data ?? []} /></TabsContent>
            <TabsContent value="docs" className="mt-4"><DocumentsPanel workspaceId={workspaceId} /></TabsContent>
            <TabsContent value="timeline" className="mt-4"><TimelinePanel workspaceId={workspaceId} /></TabsContent>
            <TabsContent value="system" className="mt-4"><SystematizationPanel workspaceId={workspaceId} workspaceTitle={ws.data.name} /></TabsContent>
          </Tabs>
        ) : (
          <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground">Únete a esta mesa para ver las discusiones, tareas y documentos.</CardContent></Card>
        )}
      </main>
    </div>
  );
}
