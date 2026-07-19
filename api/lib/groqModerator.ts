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
 * No opina ni participa: recoge la discusion, muestra las posturas de cada
 * participante (citandolo por su nombre de usuario) y sintetiza ideas,
 * acuerdos, diferencias y conclusiones importantes.
 */
/**
 * Extrae y organiza SOLO los temas propuestos por los usuarios en la primera ronda.
 * NUNCA inventa temas: si nadie propuso nada claro, devuelve [] (array vacio).
 * Devuelve null solo si hubo error tecnico (sin API key, fallo de red, etc).
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
  const prompt = `Eres el Moderador IA de DES Informantes. La discusion "${discussionTitle}" (mesa "${workspaceName}") esta en su primera ronda de palabras, en la que los PARTICIPANTES proponen los TEMAS que quieren tratar.

Transcripcion:
${transcript}

Tu UNICA tarea: extraer los temas que los participantes propusieron explicitamente en sus mensajes.

REGLAS ESTRICTAS:
- NO inventes temas. NO agregues nada que nadie haya mencionado.
- NO deduzcas temas a partir del titulo de la discusion.
- NO propongas temas por tu cuenta: tu solo organizas lo que los participantes pidieron.
- Redacta cada tema como un titulo corto y claro (maximo 8 palabras), fiel a lo propuesto.
- Si varios mensajes proponen lo mismo, unificalos en un solo tema.
- Maximo 8 temas, ordenados de forma logica para el desarrollo de la discusion.

Responde SOLO con la lista numerada, una linea por tema, sin texto adicional:
1. ...
2. ...

Si NADIE propuso un tema claro en la transcripcion, responde EXACTAMENTE con esta unica linea:
SIN_TEMAS`;

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
    // La IA no encontro temas propuestos por los participantes: array vacio (no es error)
    if (/^\s*SIN_TEMAS/i.test(text)) return [];
    const topics = text
      .split("\n")
      .map((line) => line.replace(/^\s*\d+[.)\-]\s*/, "").trim())
      .filter((line) => line.length > 0 && line.length <= 150 && !/^SIN_TEMAS/i.test(line))
      .slice(0, 8);
    return topics;
  } catch (e: any) {
    console.error("[groq-temas] Error:", e.message);
    return null;
  }
}

/**
 * Redacta el "puente" de moderacion: el contexto con el que el moderador abre
 * un nuevo momento (fase o tema), conectando lo avanzado con lo que viene.
 * Lenguaje humano de facilitacion, breve (maximo ~90 palabras).
 * NUNCA menciona compromisos si la conclusion previa no los tiene.
 */
export async function generatePhaseBridge(
  workspaceName: string,
  discussionTitle: string,
  topicTitle: string,
  prevPhaseName: string | null,
  nextPhaseName: string,
  nextPhaseObjective: string,
  conclusionContent: string | null,
): Promise<string | null> {
  if (!env.groqApiKey) return null;
  const prompt = `Eres el Moderador IA de DES Informantes. Vas a anunciar al grupo el siguiente momento de su discusion "${discussionTitle}" (mesa "${workspaceName}").

Tema en curso: "${topicTitle}".
${prevPhaseName ? `Momento que acaba de concluir: "${prevPhaseName}".` : "La discusion acaba de arrancar."}
Siguiente momento: "${nextPhaseName}", cuyo proposito es: ${nextPhaseObjective}.

${conclusionContent ? `Esto fue lo que concluyo el momento anterior:\n${conclusionContent}\n` : ""}
Redacta el anuncio de apertura del siguiente momento en espanol, como lo diria un moderador humano experto:
- Maximo 90 palabras, en UN solo parrafo (sin titulos, sin listas, sin Markdown).
- Conecta de forma natural lo que el grupo logro con lo que viene.
- Explica con palabras sencillas que se espera lograr en este nuevo momento y por que tiene sentido dar este paso ahora.
- Si el momento anterior NO registro compromisos, NO menciones la palabra compromisos ni sugieras que existen.
- Tono cercano y calido, con la formalidad justa de quien guia una conversacion entre conocidos: nada de tecnicismos, palabras rebuscadas ni exclamaciones exageradas.

Responde SOLO con el parrafo del anuncio, nada mas.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.5,
        max_tokens: 320,
      }),
    });
    if (!res.ok) { console.error("[groq-puente] Error HTTP:", res.status); return null; }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || "";
    return text.trim() || null;
  } catch (e: any) {
    console.error("[groq-puente] Error:", e.message);
    return null;
  }
}

/**
 * Bienvenida de reingreso: cuando un usuario vuelve a la discusion en un
 * momento posterior al inicio, la IA lo recibe POR SU NOMBRE y lo ubica:
 * en que momento va la discusion y, muy brevemente, que paso en los
 * momentos anteriores de ESTE tema. Maximo ~80 palabras, un solo parrafo.
 */
export async function generateWelcomeBack(
  username: string,
  workspaceName: string,
  discussionTitle: string,
  topicTitle: string,
  phaseName: string,
  phaseObjective: string,
  topicConclusions: { phaseName: string; title: string }[],
): Promise<string | null> {
  if (!env.groqApiKey) return null;
  const history = topicConclusions.length > 0
    ? topicConclusions.map((c) => `- ${c.phaseName}: ${c.title}`).join("\n")
    : "(Aun no hay momentos concluidos en este tema.)";
  const prompt = `Eres el Moderador IA de DES Informantes. El participante "${username}" acaba de REINGRESAR a la discusion "${discussionTitle}" (mesa "${workspaceName}").

La discusion va en el tema "${topicTitle}", en el momento "${phaseName}" (proposito: ${phaseObjective}).

Lo que ha pasado hasta ahora en ESTE tema:
${history}

Redacta en espanol el mensaje de bienvenida para ${username}:
- Saludalo por su nombre de forma calida y cercana, como un buen anfitrion (por ejemplo: "Que bueno tenerte de vuelta, ...").
- Ubicalo con palabras sencillas: en que tema y momento va la conversacion y que se busca lograr en este momento.
- Resume en UNA frase lo que ya se recorrio en este tema (sin listas).
- Maximo 80 palabras, UN solo parrafo, sin Markdown ni titulos.
- Lenguaje sencillo y calido, con la formalidad justa de quien recibe a alguien en una reunion: nada de terminos tecnicos ni palabras rebuscadas.
- No menciones compromisos salvo que la historia los muestre explicitamente.

Responde SOLO con el parrafo, nada mas.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.5,
        max_tokens: 300,
      }),
    });
    if (!res.ok) { console.error("[groq-bienvenida] Error HTTP:", res.status); return null; }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || "";
    return text.trim() || null;
  } catch (e: any) {
    console.error("[groq-bienvenida] Error:", e.message);
    return null;
  }
}

/**
 * Block de notas del recuadro principal de un tema CONCLUIDO: resume en
 * que quedo el tema a partir de los titulos de las conclusiones de sus
 * momentos. ~60 palabras. (Mientras el tema esta en curso o pendiente,
 * el recuadro principal solo muestra el nombre del tema.)
 */
export async function generateTopicInfo(
  workspaceName: string,
  discussionTitle: string,
  topicTitle: string,
  conclusionTitles: string[],
): Promise<string | null> {
  if (!env.groqApiKey) return null;
  const history = conclusionTitles.length > 0
    ? conclusionTitles.map((t) => `- ${t}`).join("\n")
    : "(sin conclusiones registradas)";
  const prompt = `Eres el Moderador IA de DES Informantes. En la discusion "${discussionTitle}" (mesa "${workspaceName}") el grupo ya CONCLUYO el tema: "${topicTitle}".

Estas fueron las conclusiones de sus momentos:
${history}

Redacta en espanol una nota breve (maximo 60 palabras, UN solo parrafo, sin Markdown) que describa en que quedo este tema: de que se hablo y a que se llego. Tono claro y profesional. No menciones compromisos salvo que los titulos los evidencien. Responde SOLO con el parrafo.`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: { "Authorization": `Bearer ${env.groqApiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: prompt }],
        model: "llama-3.3-70b-versatile",
        temperature: 0.4,
        max_tokens: 220,
      }),
    });
    if (!res.ok) { console.error("[groq-tema-info] Error HTTP:", res.status); return null; }
    const data = await res.json();
    const text: string = data.choices?.[0]?.message?.content || "";
    return text.trim() || null;
  } catch (e: any) {
    console.error("[groq-tema-info] Error:", e.message);
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

Luego el cuerpo de la conclusion en Markdown con EXACTAMENTE estas cuatro secciones fijas:
## Ideas principales
## Acuerdos alcanzados
## Diferencias pendientes
## Conclusiones importantes

COMO REDACTAR EL CUERPO:
- Recoge la discusion tal como ocurrio: que se dijo, que posturas aparecieron y quien las sostuvo.
- Atribuye las posturas e ideas a los participantes POR SU NOMBRE DE USUARIO, de forma natural. Ejemplos: "Maria propuso que...", "Para Carlos lo central es...", "Luis y Ana coincidieron en que...", "Frente a la postura de Pedro, Diana senalo que...".
- Resume las posiciones de manera breve y fiel: NO inventes posturas que nadie expreso ni atribuyas algo a quien no lo dijo.
- Si alguna de las cuatro secciones no aplica, escribe "Sin elementos registrados" en ella.

REGLA ESPECIAL DE COMPROMISOS: solo si los participantes asumieron compromisos CONCRETOS en esta fase (accion definida, idealmente con responsable), agrega al final una quinta seccion:
## Compromisos asumidos
Cada compromiso se escribe en su propia linea con EXACTAMENTE este formato (para que la plataforma pueda leerlo):
- <texto del compromiso> | Responsable: <nombre del participante o "Por definir"> | Fecha: <fecha acordada o "Sin fecha">
Si NO hubo compromisos reales, OMITE esa seccion por completo: no la menciones, no escribas "sin compromisos" ni nada parecido. La mayoria de las fases no tienen compromisos.

Tono profesional y objetivo, pero con lenguaje sencillo y cercano, sin tecnicismos.`;

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
