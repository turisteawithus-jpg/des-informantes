import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { trpc } from "@/providers/trpc";
import { uploadDocument } from "@/lib/upload";
import { Plus, Loader2, FileText, FileUp, ImageIcon, Download, Trash2 } from "lucide-react";

const TOPIC_COLORS = ["#0a2540", "#e63946", "#15803d", "#1d4ed8", "#7c3aed", "#db2777", "#0891b2", "#65a30d", "#c2410c", "#4f46e5"];
function colorFor(topic: string): string { let h = 0; for (let i = 0; i < topic.length; i++) h = (h * 31 + topic.charCodeAt(i)) % 997; return TOPIC_COLORS[h % TOPIC_COLORS.length]; }
function fileIcon(mime: string | null) { if (mime?.startsWith("image/")) return <ImageIcon className="h-4 w-4" />; return <FileText className="h-4 w-4" />; }

function DocumentMap({ docs }: { docs: { id: number; title: string; topic: string | null; createdAt: Date }[] }) {
  if (docs.length === 0) return null;
  const groups = new Map<string, typeof docs>();
  for (const d of docs) { const key = d.topic?.trim() || "Sin tema"; if (!groups.has(key)) groups.set(key, []); groups.get(key)!.push(d); }
  const topics = [...groups.keys()];
  const W = 800, H = 420, cx = W / 2, cy = H / 2, R = 150;
  return (
    <Card className="border-2 overflow-hidden">
      <CardContent className="p-0">
        <div className="di-gradient px-4 py-2 text-white text-sm font-medium">🗺️ Mapa del proceso — temas conectados al centro del proyecto</div>
        <div className="overflow-x-auto di-gradient-soft">
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full min-w-[640px] h-auto">
            {topics.map((t, i) => { const angle = (2 * Math.PI * i) / topics.length - Math.PI / 2; const x = cx + R * Math.cos(angle); const y = cy + R * Math.sin(angle) * 0.75; return <line key={`l-${t}`} x1={cx} y1={cy} x2={x} y2={y} stroke={colorFor(t)} strokeWidth={2.5} strokeDasharray="6 4" opacity={0.6} />; })}
            {topics.map((t, i) => { const angle = (2 * Math.PI * i) / topics.length - Math.PI / 2; const x = cx + R * Math.cos(angle); const y = cy + R * Math.sin(angle) * 0.75; const count = groups.get(t)!.length; return <g key={`n-${t}`}><circle cx={x} cy={y} r={34} fill={colorFor(t)} opacity={0.95} /><text x={x} y={y - 2} textAnchor="middle" fill="#fff" fontSize={10} fontWeight="bold">{t.length > 12 ? t.slice(0, 11) + "…" : t}</text><text x={x} y={y + 12} textAnchor="middle" fill="#fff" fontSize={9}>{count} doc{count !== 1 ? "s" : ""}</text></g>; })}
            <circle cx={cx} cy={cy} r={44} fill="#0a2540" /><text x={cx} y={cy - 4} textAnchor="middle" fill="#fff" fontSize={11} fontWeight="bold">PROYECTO</text><text x={cx} y={cy + 10} textAnchor="middle" fill="#fff" fontSize={9}>{docs.length} documentos</text>
          </svg>
        </div>
      </CardContent>
    </Card>
  );
}

export function DocumentsPanel({ workspaceId }: { workspaceId: number }) {
  const utils = trpc.useUtils();
  const docs = trpc.documents.list.useQuery({ workspaceId });
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [topic, setTopic] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const remove = trpc.documents.remove.useMutation({ onSuccess: () => utils.documents.list.invalidate({ workspaceId }) });

  async function handleUpload(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Selecciona un archivo."); return; }
    setError(""); setUploading(true);
    try {
      const res = await uploadDocument({ workspaceId, title, topic, file });
      if (!res.ok) throw new Error(res.error || "Error al subir");
      utils.documents.list.invalidate({ workspaceId }); setOpen(false); setTitle(""); setTopic(""); if (fileRef.current) fileRef.current.value = "";
    } catch (err) { setError(err instanceof Error ? err.message : "Error"); } finally { setUploading(false); }
  }

  const sorted = [...(docs.data ?? [])].sort((a: any, b: any) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground max-w-xl">Sube los resultados del trabajo. Cada documento lleva un <strong>tema</strong> para el mapa.</p>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="gap-2 shrink-0"><Plus className="h-4 w-4" /> Subir documento</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle className="font-display text-xl">Subir documento</DialogTitle></DialogHeader>
            <form className="space-y-4" onSubmit={handleUpload}>
              <div className="space-y-1.5"><Label>Título *</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ej: Libreto nota deportiva" required /></div>
              <div className="space-y-1.5"><Label>Tema (para el mapa)</Label><Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="Ej: Deportes, Política…" /></div>
              <div className="space-y-1.5"><Label>Archivo *</Label><Input ref={fileRef} type="file" required /></div>
              {error && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>}
              <Button type="submit" className="w-full" disabled={uploading}>{uploading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Subiendo…</> : <><FileUp className="h-4 w-4 mr-2" />Subir</>}</Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>
      <DocumentMap docs={sorted} />
      {sorted.length === 0 ? <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><FileText className="h-10 w-10 mx-auto mb-2 opacity-50" />Aún no hay documentos.</CardContent></Card> : (
        <div className="space-y-2">
          <h3 className="font-display text-lg">Línea de tiempo de documentos</h3>
          {sorted.map((d: any, i: number) => (
            <Card key={d.id} className="border-l-4" style={{ borderLeftColor: colorFor(d.topic?.trim() || "Sin tema") }}>
              <CardContent className="py-3 flex items-center gap-3">
                <span className="text-xs font-bold text-muted-foreground w-6 shrink-0">#{i + 1}</span>
                <span className="text-primary shrink-0">{fileIcon(d.mimeType)}</span>
                <div className="flex-1 min-w-0"><p className="font-medium truncate">{d.title}</p><p className="text-xs text-muted-foreground">{d.topic ? `Tema: ${d.topic} · ` : ""}subido por {d.uploadedByName} · {new Date(d.createdAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</p></div>
                <a href={d.fileUrl} target="_blank" rel="noreferrer"><Button variant="ghost" size="icon" title="Abrir"><Download className="h-4 w-4" /></Button></a>
                <Button variant="ghost" size="icon" title="Eliminar" onClick={() => { if (confirm("¿Eliminar?")) remove.mutate({ documentId: d.id }); }}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
