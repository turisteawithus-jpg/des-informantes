import { useState, useEffect } from "react";
import { useNavigate } from "react-router";
import { AppHeader } from "@/components/AppHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/useAuth";
import {
  Users, Briefcase, Loader2, Shield, Clock, CheckCircle, XCircle,
  Crown,
} from "lucide-react";

export default function Admin() {
  const navigate = useNavigate();
  const { isAdmin, isLoading: authLoading } = useAuth();

  const [stats, setStats] = useState<any>(null);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [pendingWs, setPendingWs] = useState<any[]>([]);
  const [approvedWs, setApprovedWs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAdmin) return;
    fetchAll();
  }, [isAdmin]);

  async function fetchAll() {
    setLoading(true);
    try {
      const [s, p, a, u] = await Promise.all([
        fetch("/api/rest/workspaces/admin/stats", { credentials: "include" }).then(r => r.ok ? r.json() : null),
        fetch("/api/rest/workspaces/admin/pending", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/rest/workspaces/admin/approved", { credentials: "include" }).then(r => r.ok ? r.json() : []),
        fetch("/api/rest/workspaces/admin/users", { credentials: "include" }).then(r => r.ok ? r.json() : []),
      ]);
      setStats(s);
      setPendingWs(Array.isArray(p) ? p : []);
      setApprovedWs(Array.isArray(a) ? a : []);
      setUsersList(Array.isArray(u) ? u : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  }

  async function approveWs(id: number) {
    await fetch(`/api/rest/workspaces/admin/approve/${id}`, { method: "POST", credentials: "include" });
    fetchAll();
  }

  async function rejectWs(id: number) {
    await fetch(`/api/rest/workspaces/admin/reject/${id}`, { method: "POST", credentials: "include" });
    fetchAll();
  }

  async function toggleRole(userId: number, currentRole: string) {
    const newRole = currentRole === "admin" ? "member" : "admin";
    await fetch(`/api/rest/workspaces/admin/users/${userId}/role`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: newRole }), credentials: "include",
    });
    fetchAll();
  }

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>;
  if (!isAdmin) { navigate("/dashboard"); return null; }

  const statCards = [
    { icon: Users, label: "Usuarios", value: stats?.users },
    { icon: Briefcase, label: "Mesas", value: stats?.workspaces },
    { icon: Clock, label: "Pendientes", value: stats?.pendingWorkspaces },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <AppHeader />
      <main className="max-w-6xl mx-auto w-full px-4 py-8 flex-1">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-12 h-12 rounded-xl di-gradient flex items-center justify-center"><Shield className="h-6 w-6 text-white" /></div>
          <div><h1 className="font-display text-3xl">Panel de administrador general</h1><p className="text-sm text-muted-foreground">Gestión completa de DES Informantes</p></div>
        </div>

        {loading && <div className="text-center py-4"><Loader2 className="h-6 w-6 animate-spin mx-auto" /></div>}

        {stats && stats.pendingWorkspaces > 0 && (
          <Card className="border-2 border-amber-400 mb-6">
            <CardContent className="py-4 flex items-center gap-3">
              <Clock className="h-5 w-5 text-amber-600" />
              <p className="text-sm"><strong>{stats.pendingWorkspaces} mesa(s)</strong> pendiente(s) de aprobación.</p>
            </CardContent>
          </Card>
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-8">
          {statCards.map((s) => <Card key={s.label} className="border-2"><CardContent className="pt-4 text-center"><s.icon className="h-5 w-5 mx-auto mb-1 text-primary" /><p className="font-display text-2xl">{s.value ?? "…"}</p><p className="text-xs text-muted-foreground">{s.label}</p></CardContent></Card>)}
        </div>

        <Tabs defaultValue="pending">
          <TabsList>
            <TabsTrigger value="pending">Mesas pendientes ({pendingWs.length})</TabsTrigger>
            <TabsTrigger value="approved">Mesas aprobadas ({approvedWs.length})</TabsTrigger>
            <TabsTrigger value="users">Usuarios ({usersList.length})</TabsTrigger>
          </TabsList>

          <TabsContent value="pending" className="mt-4">
            <Card className="border-2">
              <CardHeader><CardTitle className="font-display flex items-center gap-2"><Clock className="h-5 w-5" /> Mesas pendientes de aprobación</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                {pendingWs.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No hay mesas pendientes.</p>}
                {pendingWs.map((ws: any) => (
                  <div key={ws.id} className="border rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-2">
                      <div><p className="font-medium">{ws.name}</p><p className="text-xs text-muted-foreground">{ws.area || "Sin área"} · {ws.description?.slice(0, 100)}{ws.description && ws.description.length > 100 ? "…" : ""}</p></div>
                      <div className="flex gap-2">
                        <Button size="sm" className="gap-1" onClick={() => approveWs(ws.id)}><CheckCircle className="h-3.5 w-3.5" /> Aprobar</Button>
                        <Button size="sm" variant="ghost" className="gap-1 text-destructive" onClick={() => rejectWs(ws.id)}><XCircle className="h-3.5 w-3.5" /> Rechazar</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="approved" className="mt-4">
            <Card className="border-2">
              <CardHeader><CardTitle className="font-display flex items-center gap-2"><Briefcase className="h-5 w-5" /> Mesas aprobadas y sus administradores</CardTitle></CardHeader>
              <CardContent className="space-y-4">
                {approvedWs.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No hay mesas aprobadas.</p>}
                {approvedWs.map((ws: any) => (
                  <div key={ws.id} className="border rounded-lg px-4 py-3">
                    <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                      <p className="font-medium">{ws.name}</p>
                      <Badge variant="outline" className="gap-1"><Crown className="h-3 w-3" />{ws.adminName || "Sin admin"}</Badge>
                    </div>
                    <div className="space-y-1">
                      {ws.members?.map((m: any) => (
                        <div key={m.id} className="flex items-center justify-between text-sm">
                          <span>{m.username} {m.role === "admin" && <span className="text-amber-600 text-xs">(admin)</span>}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="users" className="mt-4">
            <Card className="border-2">
              <CardHeader><CardTitle className="font-display">Usuarios registrados</CardTitle></CardHeader>
              <CardContent className="space-y-2">
                {usersList.length === 0 && <p className="text-sm text-muted-foreground py-4 text-center">No hay usuarios.</p>}
                {usersList.map((u: any) => (
                  <div key={u.id} className="flex items-center gap-3 flex-wrap border rounded-lg px-3 py-2">
                    <div className="flex-1 min-w-[180px]"><p className="font-medium">{u.username}</p><p className="text-xs text-muted-foreground">{u.email}</p></div>
                    {u.emailVerified ? <Badge variant="secondary" className="text-green-700">✓ Verificado</Badge> : <Badge variant="secondary" className="text-amber-700">Sin verificar</Badge>}
                    <Badge className={u.role === "admin" ? "di-gradient text-white" : ""}>{u.role === "admin" ? "Administrador" : "Miembro"}</Badge>
                    <Button size="sm" variant="outline" onClick={() => toggleRole(u.id, u.role)}>{u.role === "admin" ? "Quitar admin" : "Hacer admin"}</Button>
                  </div>
                ))}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
