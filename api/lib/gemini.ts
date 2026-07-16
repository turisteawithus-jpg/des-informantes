import { env } from "./env";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

type GeminiPart =
  | { text: string }
  | { inline_data: { mime_type: string; data: string } };

async function callGemini(parts: GeminiPart[]): Promise<string | null> {
  if (!env.geminiApiKey) return null;

  const url = `${GEMINI_BASE}/${env.geminiModel}:generateContent?key=${env.geminiApiKey}`;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 2048 },
      }),
    });
    if (!resp.ok) {
      console.error(`[gemini] Error ${resp.status}: ${await resp.text()}`);
      return null;
    }
    const data = (await resp.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data.candidates?.[0]?.content?.parts
      ?.map((p) => p.text ?? "")
      .join("")
      .trim();
    return text || null;
  } catch (err) {
    console.error("[gemini] Fallo en la petición:", err);
    return null;
  }
}

export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
): Promise<string | null> {
  return callGemini([
    {
      text: "Transcribe literalmente el siguiente audio en español. " +
        "Escribe únicamente la transcripción, sin comentarios ni etiquetas. " +
        "Si hay varias personas hablando, separa las intervenciones con guiones.",
    },
    { inline_data: { mime_type: mimeType, data: base64Audio } },
  ]);
}

export type DiscussionMessage = {
  username: string;
  type: "text" | "audio" | "system";
  content: string;
};

export async function summarizeDiscussion(
  workspaceName: string,
  discussionTitle: string,
  messages: DiscussionMessage[],
): Promise<string | null> {
  const transcript = messages
    .map((m) => `${m.username}${m.type === "audio" ? " (audio)" : ""}: ${m.content}`)
    .join("\n");

  return callGemini([
    {
      text:
        `Eres la IA moderadora de DES Informantes, el espacio de trabajo digital. ` +
        `Analiza el siguiente fragmento de la discusión "${discussionTitle}" ` +
        `del tablero "${workspaceName}" y produce una síntesis MUY breve en español:\n\n` +
        `### Resumen del momento\n` +
        `(2 a 4 frases con las conclusiones o acuerdos más importantes)\n\n` +
        `### Tareas detectadas\n` +
        `(lista con guiones de las tareas que se mencionaron; si no hay, escribe "Ninguna por ahora")\n\n` +
        `### Ambiente de la discusión\n` +
        `(una frase: tono, acuerdos/desacuerdos)\n\n` +
        `Fragmento:\n${transcript}`,
    },
  ]);
}

export async function generateRelatoria(
  workspaceName: string,
  discussionTitle: string,
  messages: DiscussionMessage[],
  partialSummaries: string[],
): Promise<string | null> {
  const transcript = messages
    .map((m) => `${m.username}${m.type === "audio" ? " (audio)" : ""}: ${m.content}`)
    .join("\n");

  return callGemini([
    {
      text:
        `Eres la relatora de DES Informantes. Redacta la RELATORÍA OFICIAL en español de la ` +
        `discusión "${discussionTitle}" del tablero "${workspaceName}". ` +
        `Usa este formato en Markdown:\n\n` +
        `# Relatoría: ${discussionTitle}\n\n` +
        `## 1. Temas tratados\n## 2. Discusión y puntos de vista\n` +
        `## 3. Conclusiones y acuerdos\n## 4. Tareas asignadas (con responsable si se menciona)\n` +
        `## 5. Insumos y notas generales\n` +
        `## 6. Pendientes para la próxima sesión\n\n` +
        `Sé fiel a lo discutido, no inventes datos. Lenguaje claro y profesional.\n\n` +
        (partialSummaries.length
          ? `Resúmenes parciales:\n${partialSummaries.join("\n---\n")}\n\n`
          : "") +
        `Transcripción completa:\n${transcript}`,
    },
  ]);
}

export async function generateSystematization(input: {
  workspaceTitle: string;
  workspaceDescription: string;
  discussions: { title: string; relatoria: string | null }[];
  tasks: { title: string; status: string; assignee: string | null }[];
  documents: { title: string; topic: string | null }[];
}): Promise<string | null> {
  const discussionsText = input.discussions
    .map((d) => `### ${d.title}\n${d.relatoria ?? "(sin relatoría)"}`)
    .join("\n\n");
  const tasksText = input.tasks
    .map((t) => `- [${t.status === "done" ? "x" : " "}] ${t.title}${t.assignee ? ` — ${t.assignee}` : ""} (${t.status})`)
    .join("\n");
  const docsText = input.documents
    .map((d) => `- ${d.title}${d.topic ? ` (tema: ${d.topic})` : ""}`)
    .join("\n");

  return callGemini([
    {
      text:
        `Eres la sistematizadora de DES Informantes. Construye el DOCUMENTO DE SISTEMATIZACIÓN ` +
        `del tablero "${input.workspaceTitle}" (${input.workspaceDescription}). ` +
        `Organiza en Markdown:\n\n` +
        `# Sistematización: ${input.workspaceTitle}\n\n` +
        `## 1. Arquitectura del trabajo\n` +
        `(cómo se organizan los temas, secciones, y cómo se conectan)\n` +
        `## 2. Conclusiones principales\n## 3. Tareas y su estado\n` +
        `## 4. Documentos e insumos producidos\n` +
        `## 5. Lo que falta / próximos pasos\n\n` +
        `Discusiones:\n${discussionsText}\n\n` +
        `Tareas:\n${tasksText || "(sin tareas)"}\n\n` +
        `Documentos:\n${docsText || "(sin documentos)"}`,
    },
  ]);
}
