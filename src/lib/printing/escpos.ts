/**
 * Gerador de bytes ESC/POS. Não conhece transporte nem regra de negócio: recebe texto e
 * comandos e devolve um Uint8Array pronto para a impressora.
 */

export type Codepage = "CP850" | "CP860" | "CP437" | "WPC1252";
export type PaperWidth = 58 | 80;
export type Align = "left" | "center" | "right";

export const CODEPAGES: Codepage[] = ["CP850", "CP860", "CP437", "WPC1252"];

/** Colunas padrão (fonte A, 12 pontos) em cada largura de papel. */
export function columnsFor(width: PaperWidth) {
  return width === 58 ? 32 : 48;
}

/** Número da tabela no comando ESC t n (padrão Epson, o mesmo da Elgin/Bematech i9). */
export const CODEPAGE_SELECTOR: Record<Codepage, number> = {
  CP437: 0,
  CP850: 2,
  CP860: 3,
  WPC1252: 16,
};

// Bytes 0x80–0xFF de cada tabela, na ordem.
const BOX = "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ";
const UPPER: Record<Exclude<Codepage, "WPC1252">, string> = {
  CP437: "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»" + BOX,
  CP860: "ÇüéâãàÁçêÊèÍÔìÃÂÉÀÈôõòÚùÌÕÜ¢£Ù₧ÓáíóúñÑªº¿Ò¬½¼¡«»" + BOX,
  CP850:
    "ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜø£Ø×ƒáíóúñÑªº¿®¬½¼¡«»░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐└┴┬├─┼ãÃ╚╔╩╦╠═╬¤ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀ÓßÔÒõÕµþÞÚÛÙýÝ¯´­±‗¾¶§÷¸°¨·¹³²■ ",
};
const WPC1252_EXTRA = "€\u0081‚ƒ„…†‡ˆ‰Š‹Œ\u008dŽ\u008f\u0090‘’“”•–—˜™š›œ\u009džŸ";

const tables = new Map<Codepage, Map<string, number>>();

function table(codepage: Codepage) {
  let map = tables.get(codepage);
  if (map) return map;
  map = new Map();
  if (codepage === "WPC1252") {
    Array.from(WPC1252_EXTRA).forEach((char, index) => map!.set(char, 0x80 + index));
    for (let code = 0xa0; code <= 0xff; code += 1) map.set(String.fromCharCode(code), code);
  } else {
    Array.from(UPPER[codepage]).forEach((char, index) => {
      if (!map!.has(char)) map!.set(char, 0x80 + index);
    });
  }
  tables.set(codepage, map);
  return map;
}

/** Tabelas expostas para teste. */
export function codepageCharacters(codepage: Codepage) {
  return codepage === "WPC1252"
    ? WPC1252_EXTRA + Array.from({ length: 96 }, (_, i) => String.fromCharCode(0xa0 + i)).join("")
    : UPPER[codepage];
}

const TYPOGRAPHIC: Record<string, string> = {
  "“": '"',
  "”": '"',
  "‘": "'",
  "’": "'",
  "–": "-",
  "—": "-",
  "…": "...",
  "•": "*",
  " ": " ",
};

/**
 * Texto como ele vai sair na impressora: um caractere por byte da codepage. Aspas tipográficas,
 * reticências etc. viram ASCII e o que não existe na tabela perde o acento ou vira "?".
 * A largura das linhas é sempre contada sobre este texto (depois da conversão).
 */
export function printableText(text: string, codepage: Codepage): string {
  const map = table(codepage);
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    if (code === 0x0a) out += "\n";
    else if (code < 0x20) continue;
    else if (TYPOGRAPHIC[char] !== undefined) out += TYPOGRAPHIC[char];
    else if (code < 0x7f || map.has(char)) out += char;
    else {
      const plain = char.normalize("NFD").replace(/[̀-ͯ]/g, "");
      const plainCode = plain.codePointAt(0) ?? 63;
      out += plain.length > 0 && plainCode < 0x7f ? plain : "?";
    }
  }
  return out;
}

/** Converte texto Unicode para os bytes da codepage. Sem equivalente: tira o acento ou usa "?". */
export function encodeText(text: string, codepage: Codepage): number[] {
  const map = table(codepage);
  return Array.from(printableText(text, codepage), (char) => {
    const code = char.charCodeAt(0);
    return code < 0x80 ? code : (map.get(char) ?? 63);
  });
}

/**
 * Quebra por palavras sem passar da largura e sem perder nenhum caractere. O recuo inicial
 * (ex.: "   obs: ...") vale para o parágrafo e as linhas de continuação ganham mais `hang`
 * espaços. Palavras maiores que a linha continuam na linha seguinte.
 */
export function wrapText(text: string, width: number, hang = 2): string[] {
  const lines: string[] = [];
  const total = Math.max(2, width);
  const maxIndent = Math.floor(total / 2);
  for (const paragraph of text.split("\n")) {
    const leading = (paragraph.match(/^ */)?.[0] ?? "").length;
    const indent = " ".repeat(Math.min(leading, maxIndent));
    const continuation = " ".repeat(Math.min(leading + hang, maxIndent));
    const words = paragraph.split(/\s+/).filter(Boolean);
    let prefix = indent;
    let current = "";
    const room = () => total - prefix.length;
    const flush = () => {
      lines.push(prefix + current);
      prefix = continuation;
      current = "";
    };
    for (const word of words) {
      let rest = word;
      if (current && current.length + 1 + rest.length <= room()) {
        current += ` ${rest}`;
        continue;
      }
      if (current) flush();
      while (rest.length > room()) {
        current = rest.slice(0, room());
        rest = rest.slice(current.length);
        flush();
      }
      current = rest;
    }
    if (current || words.length === 0) lines.push(prefix + current);
  }
  return lines;
}

/**
 * Rótulo à esquerda e valor colado na margem direita, na última linha do rótulo. Se o rótulo
 * não couber ao lado do valor, ele quebra (com recuo) e o valor fica na última linha. Todas as
 * linhas têm no máximo `width` caracteres; nada é cortado.
 */
export function pairLines(left: string, right: string, width: number): string[] {
  if (!right) return wrapText(left, width);
  const room = width - right.length - 1;
  const longestWord = Math.max(0, ...left.split(/\s+/).map((word) => word.length));
  // Sem espaço ao lado do valor (nem para a maior palavra do rótulo): o valor desce sozinho.
  if (room < 4 || longestWord + 2 > room) {
    return [...wrapText(left, width), " ".repeat(Math.max(0, width - right.length)) + right];
  }
  const lines = wrapText(left, room);
  const last = lines.pop() ?? "";
  lines.push(last + " ".repeat(width - last.length - right.length) + right);
  return lines;
}

const ESC = 0x1b;
const GS = 0x1d;
/** Pontos por milímetro das cabeças térmicas de 203 dpi (a grande maioria). */
export const DOTS_PER_MM = 8;
export const FONT_A_DOTS = 12;
export const FONT_B_DOTS = 9;

export type EscPosLayout = {
  /** Colunas de texto na fonte normal. */
  columns: number;
  /** Largura imprimível real, em mm. */
  printableMm: number;
};

/** Fonte A (12 pontos) quando as colunas cabem na área útil; senão, fonte B (9 pontos). */
export function fontFor(layout: EscPosLayout): "A" | "B" {
  return layout.columns * FONT_A_DOTS <= Math.round(layout.printableMm * DOTS_PER_MM) ? "A" : "B";
}

export class EscPosBuilder {
  private bytes: number[] = [];
  readonly columns: number;
  readonly printableMm: number;

  constructor(
    readonly codepage: Codepage = "CP850",
    layout: EscPosLayout = { columns: 48, printableMm: 72 },
  ) {
    this.columns = Math.max(16, Math.round(layout.columns));
    this.printableMm = layout.printableMm;
  }

  /**
   * ESC @, codepage (ESC t), margem esquerda 0 (GS L 0 0), área de impressão (GS W) igual à
   * área útil e a fonte que faz caber as colunas (ESC M).
   */
  init(areaMm = this.printableMm) {
    const dots = Math.round(areaMm * DOTS_PER_MM);
    this.bytes.push(ESC, 0x40, ESC, 0x74, CODEPAGE_SELECTOR[this.codepage]);
    this.bytes.push(GS, 0x4c, 0, 0);
    this.bytes.push(GS, 0x57, dots & 0xff, (dots >> 8) & 0xff);
    const font = fontFor({ columns: this.columns, printableMm: this.printableMm });
    this.bytes.push(ESC, 0x4d, font === "A" ? 0 : 1);
    return this;
  }

  /** ESC M n: fonte A (12 pontos) ou B (9 pontos). */
  font(value: "A" | "B") {
    this.bytes.push(ESC, 0x4d, value === "A" ? 0 : 1);
    return this;
  }

  /** GS L nL nH: margem esquerda em pontos. */
  leftMargin(dots: number) {
    const value = Math.max(0, Math.min(0xffff, Math.round(dots)));
    this.bytes.push(GS, 0x4c, value & 0xff, value >> 8);
    return this;
  }

  align(value: Align) {
    this.bytes.push(ESC, 0x61, value === "center" ? 1 : value === "right" ? 2 : 0);
    return this;
  }

  bold(on: boolean) {
    this.bytes.push(ESC, 0x45, on ? 1 : 0);
    return this;
  }

  /** GS ! n: largura e altura em dobro. */
  double(on: boolean) {
    this.bytes.push(GS, 0x21, on ? 0x11 : 0x00);
    return this;
  }

  /** Escreve o texto como está (sem quebrar nem cortar). */
  raw(text: string) {
    this.bytes.push(...encodeText(text, this.codepage));
    return this;
  }

  private widthFor(double?: boolean) {
    return double ? Math.floor(this.columns / 2) : this.columns;
  }

  /** Texto com quebra por palavra na largura atual. */
  line(text = "", options: { align?: Align; bold?: boolean; double?: boolean } = {}) {
    this.align(options.align ?? "left")
      .bold(Boolean(options.bold))
      .double(Boolean(options.double));
    const hang = options.align && options.align !== "left" ? 0 : 2;
    const content = printableText(text, this.codepage);
    for (const part of wrapText(content, this.widthFor(options.double), hang)) {
      this.raw(part).newline();
    }
    if (options.bold) this.bold(false);
    if (options.double) this.double(false);
    return this;
  }

  pair(left: string, right: string, options: { bold?: boolean; double?: boolean } = {}) {
    this.align("left").bold(Boolean(options.bold)).double(Boolean(options.double));
    const lines = pairLines(
      printableText(left, this.codepage),
      printableText(right, this.codepage),
      this.widthFor(options.double),
    );
    for (const part of lines) this.raw(part).newline();
    if (options.bold) this.bold(false);
    if (options.double) this.double(false);
    return this;
  }

  /** Linha tracejada com exatamente `columns` caracteres. */
  dashed(char = "-") {
    return this.align("left").raw(char.repeat(this.columns)).newline();
  }

  newline() {
    this.bytes.push(0x0a);
    return this;
  }

  /** ESC d n: avança n linhas. */
  feed(lines = 1) {
    this.bytes.push(ESC, 0x64, Math.max(0, Math.min(255, lines)));
    return this;
  }

  /** GS V 66 0: corte parcial sem avanço extra (o avanço é o de `feed`). */
  cut() {
    this.bytes.push(GS, 0x56, 66, 0);
    return this;
  }

  /** ESC p m t1 t2: pulso no pino 2 da gaveta. */
  openDrawer() {
    this.bytes.push(ESC, 0x70, 0, 25, 250);
    return this;
  }

  /** GS v 0: imagem raster de 1 bit (true = ponto preto). */
  raster(width: number, height: number, isBlack: (x: number, y: number) => boolean) {
    const rowBytes = Math.ceil(width / 8);
    this.bytes.push(GS, 0x76, 0x30, 0, rowBytes & 0xff, rowBytes >> 8, height & 0xff, height >> 8);
    for (let y = 0; y < height; y += 1) {
      for (let byte = 0; byte < rowBytes; byte += 1) {
        let value = 0;
        for (let bit = 0; bit < 8; bit += 1) {
          const x = byte * 8 + bit;
          if (x < width && isBlack(x, y)) value |= 0x80 >> bit;
        }
        this.bytes.push(value);
      }
    }
    return this;
  }

  build() {
    return new Uint8Array(this.bytes);
  }
}
