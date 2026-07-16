import { useState } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Briefcase, Loader2, DoorOpen, ArrowRight,
} from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const utils = trpc.useUtils();

  const mine = trpc.workspaces.myWorkspaces.useQuery(undefined, { enabled: isAuthenticated });
  const all = trpc.workspaces.list.useQuery(undefined, { enabled: isAuthenticated });
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");

  const create = trpc.workspaces.create.useMutation({
    onSuccess: () => {
      utils.workspaces.myWorkspaces.invalidate();
      setOpen(false);
      setName(""); setArea(""); setDescription(""); setObjective("");
      alert("Tu solicitud de mesa de trabajo fue enviada. El administrador general la revisará y aprobará.");
    },
  });

  const join = trpc.workspaces.requestJoin.useMutation({
    onSuccess: () => { utils.workspaces.myWorkspaces.invalidate(); alert("Solicitud de ingreso enviada. El administrador de la mesa la revisará."); },
  });

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }

  const myIds = new Set((mine.data ?? []).map((w: any) => w.id));
  const others = (all.data ?? []).filter((w: any) => !myIds.has(w.id));

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-6xl mx-auto w-full px-4 py-8 flex-1">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl">Mesas de trabajo</h1>
            <p className="text-muted-foreground text-sm">Crea o únete a mesas para organizar tus proyectos y conversaciones.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Solicitar nueva mesa</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-xl">Solicitar creación de mesa</DialogTitle></DialogHeader>
              <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ name, area, description, objective }); }}>
                <div className="space-y-1.5"><Label>Nombre de la mesa *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Noticiero de Títeres" required /></div>
                <div className="space-y-1.5"><Label>Área de trabajo</Label><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej: Medios, Comunicación, Periodismo" /></div>
                <div className="space-y-1.5"><Label>Descripción</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="De qué trata esta mesa…" rows={3} /></div>
                <div className="space-y-1.5"><Label>Objetivo</Label><Textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Qué se busca lograr…" rows={2} /></div>
                <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar solicitud"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">Mis mesas ({mine.data?.length ?? 0})</TabsTrigger>
            <TabsTrigger value="explore">Explorar ({others.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4">
            {mine.data?.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  Aún no participas en ninguna mesa. Solicita una nueva o únete desde "Explorar".
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {(mine.data ?? []).map((ws: any) => (
                <Card key={ws.id} className="border-2 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(`/workspace/${ws.id}`)}>
                  <CardHeader>
                    <CardTitle className="font-display text-lg leading-tight">{ws.name}</CardTitle>
                    {ws.area && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full w-fit">{ws.area}</span>}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{ws.description || "Sin descripción"}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-primary font-medium">{ws.memberRole === "admin" ? "👑 Administrador" : "Miembro"}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="explore" className="mt-4">
            {others.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  No hay otras mesas disponibles por ahora.
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {others.map((ws: any) => (
                <Card key={ws.id} className="border-2">
                  <CardHeader>
                    <CardTitle className="font-display text-lg leading-tight">{ws.name}</CardTitle>
                    {ws.area && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full w-fit">{ws.area}</span>}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ws.description || "Sin descripción"}</p>
                    <Button size="sm" variant="outline" className="gap-1" disabled={join.isPending} onClick={() => join.mutate({ workspaceId: ws.id })}>
                      <DoorOpen className="h-3.5 w-3.5" /> Solicitar ingreso
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
