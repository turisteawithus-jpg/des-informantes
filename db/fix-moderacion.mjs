// Migracion de base de datos: moderacion de mensajes + tablas del moderador IA.
// Es SEGURO ejecutarlo varias veces: solo aplica lo que falte.
import mysql from "mysql2/promise";
import "dotenv/config";

const PHASES = [
  "apertura", "contextualizacion", "comprension", "sintesis_parcial",
  "profundizacion", "coincidencias_diferencias", "alternativas",
  "evaluacion", "acuerdo", "conclusion", "compromisos",
];
const phaseEnum = PHASES.map((p) => `'${p}'`).join(",");

const conn = await mysql.createConnection(process.env.DATABASE_URL);

async function ensureColumn(table, column, definition) {
  const [cols] = await conn.query(`SHOW COLUMNS FROM \`${table}\``);
  if (cols.some((col) => col.Field === column)) {
    console.log(`OK (ya existe): ${table}.${column}`);
    return;
  }
  await conn.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
  console.log(`AGREGADA: ${table}.${column}`);
}

// 1. Columna pinned en TODAS las tablas que el schema declara
const pinnedDef = "tinyint(1) NOT NULL DEFAULT 0";
for (const table of [
  "discussion_messages",
  "global_chat_messages",
  "workspace_timeline_items",
  "summaries",
  "private_messages",
  "tasks",
  "documents",
  "workspace_join_requests",
]) {
  await ensureColumn(table, "pinned", pinnedDef);
}

// 2. Tabla de estados del moderador IA
await conn.query(`
  CREATE TABLE IF NOT EXISTS discussion_moderation_states (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discussion_id bigint unsigned NOT NULL,
    current_phase enum(${phaseEnum}) NOT NULL DEFAULT 'apertura',
    topics text,
    current_topic_index int NOT NULL DEFAULT 0,
    word_round int NOT NULL DEFAULT 1,
    interventions_required int NOT NULL DEFAULT 5,
    interventions_completed int NOT NULL DEFAULT 0,
    active tinyint(1) NOT NULL DEFAULT 0,
    activated_by bigint unsigned,
    activated_at timestamp NULL,
    pinned tinyint(1) NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY discussion_moderation_states_discussion_id_unique (discussion_id)
  )
`);
console.log("OK: tabla discussion_moderation_states lista");

// 2b. Columna bridge_text: contexto que la IA redacta para abrir cada nuevo momento
await ensureColumn("discussion_moderation_states", "bridge_text", "text");

// 2c. Columna hands_raised: manos levantadas (JSON con ids de usuario) durante la pausa de decision
await ensureColumn("discussion_moderation_states", "hands_raised", "text");

// 2d. Columna conclusion_id en documents: ancla el documento al recuadro (momento) del que nace
await ensureColumn("documents", "conclusion_id", "bigint unsigned NULL");

// 3. Tabla de conclusiones por fase
await conn.query(`
  CREATE TABLE IF NOT EXISTS moderation_conclusions (
    id bigint unsigned NOT NULL AUTO_INCREMENT PRIMARY KEY,
    discussion_id bigint unsigned NOT NULL,
    phase enum(${phaseEnum}) NOT NULL,
    topic_index int NOT NULL DEFAULT 0,
    title varchar(255) NOT NULL,
    content text NOT NULL,
    pinned tinyint(1) NOT NULL DEFAULT 0,
    created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);
console.log("OK: tabla moderation_conclusions lista");

console.log("MIGRACION_COMPLETA");
await conn.end();
