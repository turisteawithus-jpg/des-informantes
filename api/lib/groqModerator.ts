import { env } from "./env";

export type ModeratorMessage = { username: string; type: string; content: string };

export const PHASE_ORDER_SERVER = [
  "apertura", "contextualizacion", "comprension", "sintesis_parcial",
  "profundizacion", "coincidencias_diferencias", "alternativas",
  "evaluacion", "acuerdo", "conclusion", "compromisos",
] as const;

export const PHASE_INFO_SERVER: Record<string, { name: string; objective: string }> = {
  apertura: { name: "Apertura", objective: "presentar el tema central y las reglas del dialogo; ubicar a cada participante frente al tema" },
  contextualizacion: { name: "Contextualizacion", objective: "ubicar el tema en su contexto: antecedentes, datos y situacion actual" },
  comprension: { name: "Comprension", objective: "lograr que cada participante exprese su entendimiento del tema y aclarar dudas" },
  sintesis_parcial: { name: "Sintesis parcial", objective: "resumir lo dicho hasta ahora y verificar que todos esten en la misma pagina" },
  profundizacion: { name: "Profundizacion", objective: "explorar en detalle los puntos mas importantes o que generan mas debate" },
  coincidencias_diferencias: { name: "Coincidencias y diferencias", objective: "identificar abiertamente los acuerdos y desacuerdos entre participantes" },
  alternativas: { name: "Alternativas", objective: "proponer opciones y soluciones para cada punto de discusion" },
  evaluacion: { name: "Evaluacion", objective: "valorar las alternativas propuestas: ventajas, desventajas y viabilidad" },
  acuerdo: { name: "Acuerdo", objective: "construir consenso alrededor de las mejores alternativas" },
  conclusion: { name: "Conclusion", objective: "formular las conclusiones finales de la discusion" },
  compromisos: { name: "Compromisos", objective: "definir compromisos concretos, responsables y proximos pasos" },
};

export function nextPhaseKeyServer(key: string): string {
  const idx = PHASE_ORDER_SERVER.indexOf(key as any);
  return PHASE_ORDER_SERVER[Math.min(idx + 1, PHASE_ORDER_SERVER.length - 1)];
}

/**
 * El Moderador IA genera la conclusion objetiva de una fase.
 * No opina ni participa: sintetiza ideas, acuerdos, diferencias y recomendaciones.
 */
/**
 * Extrae y organiza los temas propuestos por los usuarios en la primera ronda.
 */
export async function generateTopicList(
  workspaceName: string,
  discussionTitle: string,
  messages: ModeratorMessage[],
): Promise<string[] | null> {
  if (!env.groqApiKey) return null;
  const recent = messages.slice(-60);
  const transcript = recent
    .map((m) => `${m.username}${m.type === "audio" ? " (audio)" : ""}: ${m.content}`)
    .join("\n");
  const prompt = `Eres el Moderador IA de DES Informantes. La discusion "${discussionTitle}" (mesa "${workspaceName}") tuvo su primera ronda de palabras, en la que los participantes propusieron los TEMAS que quieren tratar.

Transcripcion:
${transcript}

Tu tarea: extrae y organiza la lista de temas propuestos por los participantes. Redacta cada tema como un titulo corto y claro (maximo 8 palabras). Maximo 8 temas. Ordenalos de forma logica para el desarrollo de la discusion.

Responde SOLO con la lista numerada, una linea por tema, sin texto adicional:
1. ...
2. ...

Si no se propusieron temas claros, responde con UN solo tema general derivado del titulo de la discusion.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.3,
        max_tokens: 512,
      }),
    });
    if (!res.ok) { console.error("[groq-temas] Error HTTP:", res.status); return null; }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || "";
    if (!text) return null;
    const topics = text
      .split("\n")
      .map((line) => line.replace(/^\s*\d+[.)\-]\s*/, "").trim())
      .filter((line) => line.length > 0 && line.length <= 150)
      .slice(0, 8);
    return topics.length > 0 ? topics : null;
  } catch (e: any) {
    console.error("[groq-temas] Error:", e.message);
    return null;
  }
}

export async function generateModeratorConclusion(
  workspaceName: string,
  discussionTitle: string,
  phaseKey: string,
  topicTitle: string,
  messages: ModeratorMessage[],
): Promise<{ title: string; content: string } | null> {
  if (!env.groqApiKey) return null;
  const phase = PHASE_INFO_SERVER[phaseKey] ?? { name: phaseKey, objective: phaseKey };
  const recent = messages.slice(-80);
  const transcript = recent
    .map((m) => `${m.username}${m.type === "audio" ? " (audio)" : ""}: ${m.content}`)
    .join("\n");
  const prompt = `Eres el Moderador IA de DES Informantes. NO participas en el debate ni expresas opiniones propias: tu funcion es ordenar la conversacion, sintetizar las ideas y generar conclusiones objetivas.

La discusion "${discussionTitle}" (mesa "${workspaceName}") acaba de completar una ronda de intervenciones en la fase "${phase.name}", cuyo objetivo era: ${phase.objective}.

Tema actual que se esta tratando: "${topicTitle}".

Transcripcion de la discusion:
${transcript}

Redacta en espanol la CONCLUSION de esta fase. En la PRIMERA linea escribe un titulo corto (maximo 8 palabras) con este formato exacto:
TITULO: <titulo>

Luego el cuerpo de la conclusion en Markdown con EXACTAMENTE estas cuatro secciones:
## Ideas principales
## Acuerdos alcanzados
## Diferencias pendientes
## Recomendaciones para el siguiente momento

Si alguna seccion no aplica, escribe "Sin elementos registrados" en ella. Tono profesional, objetivo y conciso.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        max_tokens: 2048,
      }),
    });
    if (!res.ok) { console.error("[groq-moderador] Error HTTP:", res.status); return null; }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || "";
    if (!text) return null;
    let title = `Conclusion de la fase ${phase.name}`;
    let content = text.trim();
    const titleMatch = content.match(/^TITULO:\s*(.+?)(?:\n|$)/);
    if (titleMatch) {
      title = titleMatch[1].trim().slice(0, 120);
      content = content.slice(titleMatch[0].length).trim();
    }
    return { title, content };
  } catch (e: any) {
    console.error("[groq-moderador] Error:", e.message);
    return null;
  }
}
