import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { trpc } from "@/providers/trpc";
import { Plus, ListChecks, Loader2, UserRound } from "lucide-react";

type Member = { id: number; username: string; role: string; email?: string };

const STATUS_LABEL: Record<string, string> = { pending: "Pendiente", in_progress: "En progreso", done: "Hecha" };
const STATUS_STYLE: Record<string, string> = { pending: "bg-amber-500", in_progress: "bg-blue-600", done: "bg-green-600" };

export function TasksPanel({ workspaceId, members }: { workspaceId: number; members: Member[] }) {
  const utils = trpc.useUtils();
  const tasks = trpc.tasks.list.useQuery({ workspaceId });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("none");
  const [dueDate, setDueDate] = useState("");

  const create = trpc.tasks.create.useMutation({
    onSuccess: () => { utils.tasks.list.invalidate({ workspaceId }); setOpen(false); setTitle(""); setDescription(""); setAssigneeId("none"); setDueDate(""); },
  });
  const updateStatus = trpc.tasks.updateStatus.useMutation({
    onSuccess: () => utils.tasks.list.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">Las tareas nacen de las discusiones (la IA las detecta) y aquí se les da seguimiento.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2 shrink-0"><Plus className="h-4 w-4" /> Nueva tarea</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-xl">Crear tarea</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ workspaceId, title, description, assigneeId: assigneeId === "none" ? undefined : Number(assigneeId), dueDate: dueDate || undefined }); }}>
              <div className="space-y-1.5"><Label>Título *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Escribir libreto" required /></div>
              <div className="space-y-1.5"><Label>Descripción</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} /></div>
              <div className="space-y-1.5"><Label>Responsable</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                  <SelectContent><SelectItem value="none">Sin asignar</SelectItem>{members.map((m) => <SelectItem key={m.id} value={String(m.id)}>{m.username}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Fecha límite</Label><Input type="datetime-local" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Crear tarea"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      {tasks.data?.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><ListChecks className="h-10 w-10 mx-auto mb-2 opacity-50" />Aún no hay tareas.</CardContent></Card>}
      <div className="space-y-3">
        {(tasks.data ?? []).map((t: any) => (
          <Card key={t.id} className="border-2">
            <CardContent className="py-4 flex flex-wrap items-center gap-3">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap">
                  <h4 className="font-semibold">{t.title}</h4>
                  <Badge className={STATUS_STYLE[t.status]}>{STATUS_LABEL[t.status]}</Badge>
                </div>
                {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                  {t.assigneeName && <span className="flex items-center gap-1"><UserRound className="h-3 w-3" />{t.assigneeName}</span>}
                  {t.dueDate && <span>📅 {new Date(t.dueDate).toLocaleDateString("es-CO")}</span>}
                  {t.resultDocumentId && <span className="text-green-700">📎 Resultado vinculado</span>}
                </div>
              </div>
              <Select value={t.status} onValueChange={(v) => updateStatus.mutate({ taskId: t.id, status: v as "pending" | "in_progress" | "done" })}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="pending">Pendiente</SelectItem><SelectItem value="in_progress">En progreso</SelectItem><SelectItem value="done">Hecha</SelectItem></SelectContent>
              </Select>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
