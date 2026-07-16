import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { Plus, Loader2, CalendarDays, FileText, CheckSquare, MessageSquare, Link2, Trash2 } from "lucide-react";

const LINK_ICONS: Record<string, any> = { document: FileText, task: CheckSquare, discussion: MessageSquare, none: Link2 };

export function TimelinePanel({ workspaceId }: { workspaceId: number }) {
  const utils = trpc.useUtils();
  const items = trpc.timeline.list.useQuery({ workspaceId });
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [itemDate, setItemDate] = useState("");
  const create = trpc.timeline.create.useMutation({
    onSuccess: () => { utils.timeline.list.invalidate({ workspaceId }); setOpen(false); setTitle(""); setDescription(""); setItemDate(""); },
  });
  const remove = trpc.timeline.remove.useMutation({
    onSuccess: () => utils.timeline.list.invalidate({ workspaceId }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground max-w-xl">Línea de trabajo con hitos, fechas y vínculos a documentos, tareas o discusiones. Muestra el resumen de lo que hay y lo proyectado.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2 shrink-0"><Plus className="h-4 w-4" /> Agregar hito</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-xl">Nuevo hito en la línea</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); create.mutate({ workspaceId, title, description, itemDate: itemDate || undefined }); }}>
              <div className="space-y-1.5"><Label>Título *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Entrega del primer borrador" required /></div>
              <div className="space-y-1.5"><Label>Descripción</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
              <div className="space-y-1.5"><Label>Fecha</Label><Input type="date" value={itemDate} onChange={(e) => setItemDate(e.target.value)} /></div>
              <Button type="submit" className="w-full" disabled={create.isPending}>{create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Agregar hito"}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {items.data?.length === 0 && <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><CalendarDays className="h-10 w-10 mx-auto mb-2 opacity-50" />Aún no hay hitos en la línea de trabajo.</CardContent></Card>}

      <div className="relative pl-6 border-l-2 border-primary/20 space-y-4">
        {(items.data ?? []).map((item: any) => {
          const Icon = LINK_ICONS[item.linkType || "none"] || Link2;
          return (
            <div key={item.id} className="relative">
              <div className="absolute -left-[31px] top-1 w-5 h-5 rounded-full bg-primary/20 flex items-center justify-center"><Icon className="h-3 w-3 text-primary" /></div>
              <Card className="border hover:shadow-md transition-shadow">
                <CardContent className="py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="font-semibold text-sm">{item.title}</h4>
                      {item.description && <p className="text-xs text-muted-foreground mt-0.5">{item.description}</p>}
                      {item.itemDate && <p className="text-xs text-primary mt-1 flex items-center gap-1"><CalendarDays className="h-3 w-3" />{new Date(item.itemDate).toLocaleDateString("es-CO", { dateStyle: "long" })}</p>}
                    </div>
                    <Button variant="ghost" size="icon" className="shrink-0" onClick={() => { if (confirm("¿Eliminar este hito?")) remove.mutate({ itemId: item.id }); }}><Trash2 className="h-3.5 w-3.5 text-destructive" /></Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          );
        })}
      </div>
    </div>
  );
}
