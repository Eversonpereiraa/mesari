/**
 * Lista de linhas com estilo (o "documento") e a montagem em linhas físicas de `colunas`
 * caracteres. Quebra, recuo, alinhamento e valores à direita são resolvidos aqui, uma vez só;
 * os renderizadores ESC/POS e HTML só desenham as linhas prontas, então saem idênticos.
 */
import type { PrintLogo } from "./logo";

/** normal; tall = altura dupla; big = altura e largura duplas (só "MESA 05"). */
export type Size = "normal" | "tall" | "big";
export type Align = "left" | "center" | "right";

type Style = { bold?: boolean; size?: Size };

export type DocLine =
  /** Parágrafo quebrado por palavra e alinhado. */
  | ({ kind: "text"; text: string; align?: Align } & Style)
  /**
   * Texto com prefixo na primeira linha ("2x ", "   obs: ", "   ") e continuações alinhadas
   * depois do prefixo. Com `value`, o valor fica colado na última coluna da última linha.
   */
  | ({ kind: "entry"; prefix?: string; text: string; value?: string } & Style)
  /** Texto como está, sem quebra (régua da página de teste). */
  | { kind: "raw"; text: string }
  | { kind: "rule"; char: "=" | "-" }
  | { kind: "blank" }
  | { kind: "image"; logo: PrintLogo };

export type PrintDoc = { title: string; lines: DocLine[] };

export type PhysicalLine =
  { kind: "text"; text: string; bold: boolean; size: Size } | { kind: "image"; logo: PrintLogo };

const TYPOGRAPHIC: Record<string, string> = {
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "–": "-",
  "—": "-",
  "…": "...",
  "•": "*",
  "\t": " ",
};

/** Texto pronto para contar colunas: NFC, sem controle, pontuação tipográfica em ASCII. */
export function clean(text: string) {
  let out = "";
  for (const char of text.normalize("NFC")) {
    if (char === "\n") out += "\n";
    else if (TYPOGRAPHIC[char] !== undefined) out += TYPOGRAPHIC[char];
    else if ((char.codePointAt(0) ?? 0) >= 0x20) out += char === " " ? " " : char;
  }
  return out;
}

/** Espaço que não quebra: "R$" e o número ficam juntos. */
const GLUE = "\u0001";
const glue = (text: string) => text.replace(/R\$ (?=-?\d)/g, `R$${GLUE}`);
const unglue = (text: string) => text.split(GLUE).join(" ");

/** Largura útil de uma linha no tamanho dado. */
export function widthFor(columns: number, size: Size = "normal") {
  return size === "big" ? Math.floor(columns / 2) : columns;
}

/**
 * Quebra por palavra. A primeira linha começa com `prefix` e as seguintes com espaços do mesmo
 * tamanho. Palavra maior que a linha é partida (nada é cortado). Nenhuma linha passa de `width`.
 */
export function wrap(text: string, width: number, prefix = ""): string[] {
  const total = Math.max(1, width);
  const maxIndent = Math.floor(total / 2);
  const first = prefix.length > maxIndent ? prefix.slice(0, maxIndent) : prefix;
  const next = " ".repeat(Math.min(prefix.length, maxIndent));
  const lines: string[] = [];
  const paragraphs = glue(clean(text)).split("\n");
  paragraphs.forEach((paragraph, index) => {
    let current = index === 0 ? first : next;
    let hasWord = false;
    for (const word of paragraph.split(" ").filter(Boolean)) {
      let rest = word;
      if (hasWord && current.length + 1 + rest.length <= total) {
        current += ` ${rest}`;
        continue;
      }
      if (hasWord) {
        lines.push(current);
        current = next;
      }
      while (current.length + rest.length > total) {
        const room = Math.max(1, total - current.length);
        lines.push(current + rest.slice(0, room));
        rest = rest.slice(room);
        current = next;
      }
      current += rest;
      hasWord = true;
    }
    if (hasWord || current.trim() === "") lines.push(hasWord ? current : current.trimEnd());
  });
  return lines.map((line) => unglue(line).trimEnd());
}

function aligned(line: string, width: number, align: Align = "left") {
  if (align === "left") return line;
  const free = Math.max(0, width - line.length);
  return " ".repeat(align === "center" ? Math.floor(free / 2) : free) + line;
}

/** Linhas de um item/rótulo com o valor na última coluna da última linha. */
export function entryLines(text: string, width: number, prefix = "", value = "") {
  const right = clean(value);
  if (!right) return wrap(text, width, prefix);
  if (right.length >= width) return [...wrap(text, width, prefix), right.slice(-width)];
  let lines = wrap(text, width, prefix);
  if (lines[lines.length - 1]!.length + 1 + right.length > width) {
    const narrow = width - right.length - 1;
    const longest = Math.max(
      0,
      ...clean(text)
        .split(/\s+/)
        .map((word) => word.length),
    );
    // Quebra mais cedo para o valor caber na última linha; se nem a maior palavra cabe ao
    // lado do valor, o valor desce sozinho.
    const indent = Math.min(prefix.length, Math.floor(narrow / 2));
    if (narrow - indent >= Math.min(longest, 10)) {
      lines = wrap(text, narrow, prefix);
    } else lines.push("");
  }
  const last = lines.pop() ?? "";
  lines.push(last + " ".repeat(width - last.length - right.length) + right);
  return lines;
}

/** Monta o documento em linhas físicas para `columns` colunas. */
export function layoutDoc(doc: PrintDoc, columns: number): PhysicalLine[] {
  const out: PhysicalLine[] = [];
  for (const line of doc.lines) {
    if (line.kind === "image") {
      out.push(line);
      continue;
    }
    const size: Size = "size" in line && line.size ? line.size : "normal";
    const bold = "bold" in line && Boolean(line.bold);
    const width = widthFor(columns, size);
    const push = (text: string) => out.push({ kind: "text", text, bold, size });
    if (line.kind === "text") {
      for (const part of wrap(line.text, width)) push(aligned(part, width, line.align));
    } else if (line.kind === "entry") {
      for (const part of entryLines(line.text, width, line.prefix ?? "", line.value ?? "")) {
        push(part);
      }
    } else if (line.kind === "raw") push(clean(line.text).slice(0, width));
    else if (line.kind === "rule") push(line.char.repeat(columns));
    else push("");
  }
  return out;
}

/** O documento como texto (uma linha por linha impressa). A logo aparece como "[LOGO]". */
export function renderText(doc: PrintDoc, columns: number) {
  return layoutDoc(doc, columns)
    .map((line) =>
      line.kind === "image" ? aligned("[LOGO]", columns, "center") : line.text.trimEnd(),
    )
    .join("\n");
}
