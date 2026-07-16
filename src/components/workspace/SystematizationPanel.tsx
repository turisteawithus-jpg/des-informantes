import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { MarkdownView } from "@/components/MarkdownView";
import { trpc } from "@/providers/trpc";
import { Sparkles, Loader2, ScrollText, Download } from "lucide-react";

export function SystematizationPanel({ workspaceId, workspaceTitle }: { workspaceId: number; workspaceTitle: string }) {
  const utils = trpc.useUtils();
  const latest = trpc.discussions.latestSystematization.useQuery({ workspaceId });
  const generate = trpc.discussions.generateSystematization.useMutation({
    onSuccess: () => utils.discussions.latestSystematization.invalidate({ workspaceId }),
  });
  const content = generate.data?.content ?? latest.data?.content ?? null;

  function download() {
    if (!content) return;
    const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Sistematización — ${workspaceTitle}</title><style>body{font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:0 24px;color:#0a2540;line-height:1.6}h1{color:#0a2540}h2{color:#e63946;border-bottom:2px solid #e2e8f0;padding-bottom:4px}ul{margin-left:20px}</style></head><body>${content.replace(/^# (.*$)/gm, "<h1>$1</h1>").replace(/^## (.*$)/gm, "<h2>$1</h2>").replace(/^### (.*$)/gm, "<h3>$1</h3>").replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>").replace(/^- (.*$)/gm, "<li>$1</li>").replace(/\n{2,}/g, "<br><br>").replace(/\n/g, "<br>")}</body></html>`;
    const blob = new Blob([html], { type: "text/html;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `sistematizacion-${workspaceTitle.replace(/\s+/g, "-")}.html`;
    a.click(); URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <p className="text-sm text-muted-foreground max-w-xl">La sistematización compila <strong>todo el historial</strong> — relatorías, tareas y documentos — en un documento completo.</p>
        <div className="flex gap-2">
          {content && <Button variant="outline" className="gap-2" onClick={download}><Download className="h-4 w-4" /> Descargar</Button>}
          <Button className="gap-2" disabled={generate.isPending} onClick={() => generate.mutate({ workspaceId })}>
            {generate.isPending ? <><Loader2 className="h-4 w-4 animate-spin" /> La IA está sistematizando…</> : <><Sparkles className="h-4 w-4" />{content ? "Regenerar" : "Generar sistematización"}</>}
          </Button>
        </div>
      </div>
      {generate.isError && <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{generate.error.message}</p>}
      {content ? (
        <Card className="border-2">
          <div className="di-gradient px-4 py-2 text-white text-sm font-medium flex items-center gap-2 rounded-t-xl"><ScrollText className="h-4 w-4" /> Documento de sistematización {latest.data?.createdAt && !generate.data && <span className="opacity-80 ml-2">— {new Date(latest.data.createdAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</span>}</div>
          <CardContent className="pt-4"><MarkdownView content={content} /></CardContent>
        </Card>
      ) : (
        <Card className="border-dashed"><CardContent className="py-10 text-center text-muted-foreground"><Sparkles className="h-10 w-10 mx-auto mb-2 opacity-50" />Aún no se ha generado. Cierra al menos una discusión y luego genera el documento.</CardContent></Card>
      )}
    </div>
  );
}
