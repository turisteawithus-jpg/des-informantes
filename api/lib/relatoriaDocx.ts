import { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } from "docx";

/* ================================================================ */
/*   RELATORIA OFICIAL EN .docx                                     */
/*   Sistematizacion completa del proceso de la mesa de trabajo:    */
/*   portada, relatoria redactada por la IA, desarrollo tema por    */
/*   tema (cada momento con su conclusion) y compromisos.           */
/* ================================================================ */

type ConclusionInput = {
  phaseName: string;
  topicIndex: number;
  title: string;
  content: string;
};

export type RelatoriaDocxInput = {
  workspaceName: string;
  discussionTitle: string;
  discussionDesc?: string | null;
  participants: string[];
  closedAt: Date;
  relatoriaText: string | null;
  topics: string[];
  conclusions: ConclusionInput[];
};

/* Convierte **negrita** en TextRuns */
function runs(text: string, opts: { bold?: boolean; italics?: boolean } = {}): TextRun[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((p) => p.length > 0);
  return parts.map(
    (p) =>
      new TextRun({
        text: p.replace(/\*\*/g, ""),
        bold: opts.bold || p.startsWith("**"),
        italics: opts.italics,
      }),
  );
}

/* Markdown sencillo -> parrafos: ## / ### titulos, - vinetas, texto plano */
function markdownToParagraphs(md: string): Paragraph[] {
  const out: Paragraph[] = [];
  for (const raw of md.split("\n")) {
    const line = raw.trimEnd();
    const t = line.trim();
    if (!t) continue;
    if (t.startsWith("### ")) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_3, children: runs(t.slice(4), { bold: true }) }));
    } else if (t.startsWith("## ")) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_2, children: runs(t.slice(3), { bold: true }) }));
    } else if (t.startsWith("# ")) {
      out.push(new Paragraph({ heading: HeadingLevel.HEADING_1, children: runs(t.slice(2), { bold: true }) }));
    } else if (t.startsWith("- ") || t.startsWith("* ")) {
      out.push(new Paragraph({ bullet: { level: 0 }, children: runs(t.slice(2)) }));
    } else if (/^\d+[.)]\s/.test(t)) {
      out.push(new Paragraph({ children: runs(t), indent: { left: 360 } }));
    } else {
      out.push(new Paragraph({ children: runs(t), spacing: { after: 120 } }));
    }
  }
  return out;
}

function label(text: string): Paragraph {
  return new Paragraph({
    children: [new TextRun({ text, bold: true, color: "0A2540" })],
    spacing: { before: 240, after: 80 },
  });
}

export async function buildRelatoriaDocx(input: RelatoriaDocxInput): Promise<Buffer> {
  const children: Paragraph[] = [];

  // Portada
  children.push(
    new Paragraph({
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: "Relatoria oficial", bold: true })],
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ text: input.discussionTitle, bold: true, size: 32 })],
      spacing: { after: 120 },
    }),
    new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new TextRun({
          text: `Mesa de trabajo: ${input.workspaceName} · ${input.closedAt.toLocaleDateString("es-CO", { year: "numeric", month: "long", day: "numeric" })}`,
          italics: true,
        }),
      ],
      spacing: { after: 360 },
    }),
  );

  if (input.discussionDesc) {
    children.push(label("Agenda de la discusion"), ...markdownToParagraphs(input.discussionDesc));
  }
  if (input.participants.length > 0) {
    children.push(
      label("Participantes"),
      new Paragraph({ children: [new TextRun({ text: input.participants.join(", ") })], spacing: { after: 240 } }),
    );
  }

  // Relatoria redactada por la IA (sistematizacion narrativa del proceso)
  if (input.relatoriaText) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "Sistematizacion del proceso", bold: true })],
        spacing: { before: 240, after: 120 },
      }),
      ...markdownToParagraphs(input.relatoriaText),
    );
  }

  // Desarrollo tema por tema: cada momento con su conclusion
  if (input.topics.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "Desarrollo por temas y momentos", bold: true })],
        spacing: { before: 360, after: 120 },
      }),
    );
    input.topics.forEach((topic, ti) => {
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_2,
          children: [new TextRun({ text: `Tema ${ti + 1}: ${topic}`, bold: true })],
          spacing: { before: 240, after: 100 },
        }),
      );
      const ofTopic = input.conclusions.filter((cn) => cn.topicIndex === ti);
      if (ofTopic.length === 0) {
        children.push(new Paragraph({ children: [new TextRun({ text: "Sin momentos concluidos registrados.", italics: true })] }));
      }
      for (const cn of ofTopic) {
        children.push(
          new Paragraph({
            heading: HeadingLevel.HEADING_3,
            children: [new TextRun({ text: `${cn.phaseName} — ${cn.title}`, bold: true })],
            spacing: { before: 160, after: 80 },
          }),
          ...markdownToParagraphs(cn.content),
        );
      }
    });
  }

  // Compromisos consolidados (los que la IA registro en cada momento)
  const commitments: string[] = [];
  for (const cn of input.conclusions) {
    const m = cn.content.match(/## Compromisos asumidos\n([\s\S]*?)(?=\n## |\s*$)/);
    if (m) {
      for (const line of m[1].split("\n")) {
        const t = line.trim();
        if (t.startsWith("- ")) commitments.push(t.slice(2));
      }
    }
  }
  if (commitments.length > 0) {
    children.push(
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [new TextRun({ text: "Compromisos consolidados", bold: true })],
        spacing: { before: 360, after: 120 },
      }),
      ...commitments.map((cm) => new Paragraph({ bullet: { level: 0 }, children: runs(cm) })),
    );
  }

  const doc = new Document({
    creator: "DES Informantes",
    title: `Relatoria - ${input.discussionTitle}`,
    sections: [{ children }],
  });
  return Packer.toBuffer(doc);
}
