import { useState, useEffect } from "react";
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
import { useAuth } from "@/hooks/useAuth";
import {
  Plus, Briefcase, Loader2, DoorOpen, ArrowRight, Search,
} from "lucide-react";

export default function Dashboard() {
  const navigate = useNavigate();
  const { isAuthenticated, isLoading: authLoading } = useAuth();

  const [mine, setMine] = useState<any[]>([]);
  const [all, setAll] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  // Form crear mesa
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [description, setDescription] = useState("");
  const [objective, setObjective] = useState("");
  const [creating, setCreating] = useState(false);

  // Form solicitar ingreso
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinWsId, setJoinWsId] = useState<number | null>(null);
  const [joinMessage, setJoinMessage] = useState("");
  const [joining, setJoining] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    fetchMine();
    fetchAll();
  }, [isAuthenticated]);

  async function fetchMine() {
    try {
      const res = await fetch("/api/rest/workspaces/mine", { credentials: "include" });
      if (res.ok) setMine(await res.json());
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function fetchAll() {
    try {
      const res = await fetch("/api/rest/workspaces", { credentials: "include" });
      if (res.ok) setAll(await res.json());
    } catch (e) { console.error(e); }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setCreating(true);
    try {
      const res = await fetch("/api/rest/workspaces", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, area, description, objective }),
        credentials: "include",
      });
      if (res.ok) {
        setOpen(false);
        setName(""); setArea(""); setDescription(""); setObjective("");
        fetchMine();
        alert("Tu solicitud de mesa fue enviada. El administrador general la revisara y aprobara.");
      } else {
        const data = await res.json();
        alert(data.error || "Error al crear mesa");
      }
    } catch { alert("Error de conexion"); }
    setCreating(false);
  }

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    if (!joinWsId) return;
    setJoining(true);
    try {
      const res = await fetch("/api/rest/workspaces/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId: joinWsId, message: joinMessage }),
        credentials: "include",
      });
      if (res.ok) {
        setJoinOpen(false);
        setJoinMessage("");
        alert("Solicitud de ingreso enviada. El administrador de la mesa la revisara.");
      } else {
        const data = await res.json();
        alert(data.error || "Error al solicitar ingreso");
      }
    } catch { alert("Error de conexion"); }
    setJoining(false);
  }

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAuthenticated) { navigate("/login"); return null; }

  const myIds = new Set(mine.map((w: any) => w.id));
  const others = all.filter((w: any) => !myIds.has(w.id));

  // Buscar mesas
  const filteredOthers = search.trim()
    ? others.filter((w: any) =>
        w.name.toLowerCase().includes(search.toLowerCase()) ||
        (w.area && w.area.toLowerCase().includes(search.toLowerCase())) ||
        (w.description && w.description.toLowerCase().includes(search.toLowerCase()))
      )
    : others;

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-6xl mx-auto w-full px-4 py-8 flex-1">
        <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
          <div>
            <h1 className="font-display text-3xl">Mesas de trabajo</h1>
            <p className="text-muted-foreground text-sm">Crea o unite a mesas para organizar tus proyectos y conversaciones.</p>
          </div>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2"><Plus className="h-4 w-4" /> Solicitar nueva mesa</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader><DialogTitle className="font-display text-xl">Solicitar creacion de mesa</DialogTitle></DialogHeader>
              <form className="space-y-4" onSubmit={handleCreate}>
                <div className="space-y-1.5"><Label>Nombre de la mesa *</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej: Noticiero de Titeres" required /></div>
                <div className="space-y-1.5"><Label>Area de trabajo</Label><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ej: Medios, Comunicacion, Periodismo" /></div>
                <div className="space-y-1.5"><Label>Descripcion</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="De que trata esta mesa..." rows={3} /></div>
                <div className="space-y-1.5"><Label>Objetivo</Label><Textarea value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="Que se busca lograr" rows={2} /></div>
                <Button type="submit" className="w-full" disabled={creating}>{creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar solicitud"}</Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Tabs defaultValue="mine">
          <TabsList>
            <TabsTrigger value="mine">Mis mesas ({mine.length})</TabsTrigger>
            <TabsTrigger value="explore">Explorar ({filteredOthers.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="mine" className="mt-4">
            {mine.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  Aun no participas en ninguna mesa. Solicita una nueva o unite desde "Explorar".
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {mine.map((ws: any) => (
                <Card key={ws.id} className="border-2 hover:shadow-lg transition-shadow cursor-pointer" onClick={() => navigate(`/workspace/${ws.id}`)}>
                  <CardHeader>
                    <CardTitle className="font-display text-lg leading-tight">{ws.name}</CardTitle>
                    {ws.area && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full w-fit">{ws.area}</span>}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2">{ws.description || "Sin descripcion"}</p>
                    <div className="flex items-center justify-between mt-3">
                      <span className="text-xs text-primary font-medium">{ws.memberRole === "admin" ? "Administrador" : "Miembro"}</span>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>

          <TabsContent value="explore" className="mt-4">
            {/* Buscador de mesas */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar mesas por nombre, area o descripcion..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-10"
              />
            </div>

            {filteredOthers.length === 0 && (
              <Card className="border-dashed">
                <CardContent className="py-10 text-center text-muted-foreground">
                  <Briefcase className="h-10 w-10 mx-auto mb-2 opacity-50" />
                  {search.trim() ? "No se encontraron mesas con ese termino." : "No hay otras mesas disponibles por ahora."}
                </CardContent>
              </Card>
            )}
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredOthers.map((ws: any) => (
                <Card key={ws.id} className="border-2">
                  <CardHeader>
                    <CardTitle className="font-display text-lg leading-tight">{ws.name}</CardTitle>
                    {ws.area && <span className="text-xs bg-secondary px-2 py-0.5 rounded-full w-fit">{ws.area}</span>}
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{ws.description || "Sin descripcion"}</p>
                    <Button size="sm" variant="outline" className="gap-1" onClick={() => { setJoinWsId(ws.id); setJoinOpen(true); }}>
                      <DoorOpen className="h-3.5 w-3.5" /> Solicitar ingreso
                    </Button>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
        </Tabs>

        {/* Dialog para solicitar ingreso con mensaje */}
        <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle className="font-display text-xl">Solicitar ingreso a la mesa</DialogTitle>
            </DialogHeader>
            <form className="space-y-4" onSubmit={handleJoin}>
              <div className="space-y-1.5">
                <Label>Por que quieres unirte a esta mesa? (opcional)</Label>
                <Textarea
                  value={joinMessage}
                  onChange={(e) => setJoinMessage(e.target.value)}
                  placeholder="Cuentalo brevemente..."
                  rows={3}
                />
              </div>
              <div className="flex gap-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setJoinOpen(false)}>Cancelar</Button>
                <Button type="submit" className="flex-1" disabled={joining}>
                  {joining ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enviar solicitud"}
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </main>
    </div>
  );
}
