import { decodeByte, tableFromSelector, type CharacterTable } from "@/lib/escpos-codepages";

export type Alinhamento = "esquerda" | "centro" | "direita";

export type LinhaPreview =
  | {
      tipo: "texto";
      texto: string;
      alinhamento: Alinhamento;
      negrito: boolean;
      tamanhoDuplo: boolean;
      /** Colunas que a linha ocupa no papel (dobra quando o tamanho é duplo). */
      colunas: number;
      /** true quando a linha passa da largura configurada e a impressora quebraria sozinha. */
      estoura: boolean;
    }
  | { tipo: "corte"; parcial: boolean }
  | { tipo: "gaveta" };

export type PreviewEscPos = {
  linhas: LinhaPreview[];
  tabela: CharacterTable;
  /** Comandos que o decodificador não conhece (para depuração). */
  desconhecidos: string[];
};

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/**
 * Lê os bytes ESC/POS gerados pelo Mesari e devolve as linhas como sairiam no papel.
 * Suporta: ESC @, ESC t, ESC a, ESC E, ESC d, ESC p, GS !, GS V e LF.
 */
export function decodeEscPos(
  bytes: Uint8Array | number[],
  options: { columns: number; table?: CharacterTable },
): PreviewEscPos {
  const data = Array.from(bytes);
  const linhas: LinhaPreview[] = [];
  const desconhecidos: string[] = [];
  let tabela: CharacterTable = options.table ?? "CP860";
  let alinhamento: Alinhamento = "esquerda";
  let negrito = false;
  let tamanhoDuplo = false;
  let atual = "";
  let linhaTemConteudo = false;

  const reset = () => {
    alinhamento = "esquerda";
    negrito = false;
    tamanhoDuplo = false;
  };
  const fecharLinha = () => {
    const colunas = Array.from(atual).length * (tamanhoDuplo ? 2 : 1);
    linhas.push({
      tipo: "texto",
      texto: atual,
      alinhamento,
      negrito,
      tamanhoDuplo,
      colunas,
      estoura: colunas > options.columns,
    });
    atual = "";
    linhaTemConteudo = false;
  };
  const byteAt = (index: number) => {
    const value = data[index];
    if (value === undefined) throw new Error(`Comando ESC/POS incompleto no byte ${index}.`);
    return value;
  };

  for (let index = 0; index < data.length; index += 1) {
    const byte = byteAt(index);
    if (byte === ESC) {
      const command = byteAt(index + 1);
      if (command === 0x40) {
        reset();
        index += 1;
      } else if (command === 0x74) {
        const selector = byteAt(index + 2);
        tabela = tableFromSelector(selector) ?? tabela;
        if (!tableFromSelector(selector)) desconhecidos.push(`ESC t ${selector}`);
        index += 2;
      } else if (command === 0x61) {
        const value = byteAt(index + 2);
        alinhamento =
          value === 1 || value === 0x31
            ? "centro"
            : value === 2 || value === 0x32
              ? "direita"
              : "esquerda";
        index += 2;
      } else if (command === 0x45) {
        negrito = (byteAt(index + 2) & 1) === 1;
        index += 2;
      } else if (command === 0x64) {
        if (linhaTemConteudo) fecharLinha();
        const feed = byteAt(index + 2);
        for (let line = 0; line < feed; line += 1) fecharLinha();
        index += 2;
      } else if (command === 0x70) {
        linhas.push({ tipo: "gaveta" });
        index += 4;
      } else {
        desconhecidos.push(`ESC 0x${command.toString(16)}`);
        index += 1;
      }
    } else if (byte === GS) {
      const command = byteAt(index + 1);
      if (command === 0x21) {
        const size = byteAt(index + 2);
        tamanhoDuplo = (size & 0x0f) > 0 || (size & 0xf0) > 0;
        index += 2;
      } else if (command === 0x56) {
        if (linhaTemConteudo) fecharLinha();
        const mode = byteAt(index + 2);
        // GS V m (0/1/48/49) ou GS V m n (65/66): 1, 49 e 66 são corte parcial.
        linhas.push({ tipo: "corte", parcial: mode === 1 || mode === 49 || mode === 66 });
        index += mode === 65 || mode === 66 ? 3 : 2;
      } else {
        desconhecidos.push(`GS 0x${command.toString(16)}`);
        index += 1;
      }
    } else if (byte === LF) {
      fecharLinha();
    } else if (byte === 0x0d) {
      // CR: ignorado, a impressora avança só no LF.
    } else {
      atual += decodeByte(byte, tabela);
      linhaTemConteudo = true;
    }
  }
  if (linhaTemConteudo) fecharLinha();
  return { linhas, tabela, desconhecidos };
}

/** Texto puro do preview, para baixar como .txt. */
export function previewToText(preview: PreviewEscPos, columns: number) {
  return preview.linhas
    .map((linha) => {
      if (linha.tipo === "corte") return `${"✂ ".repeat(Math.floor(columns / 2))}`.trimEnd();
      if (linha.tipo === "gaveta") return "[abre gaveta]";
      const largura = linha.tamanhoDuplo ? Math.floor(columns / 2) : columns;
      const texto = linha.texto;
      const sobra = Math.max(0, largura - Array.from(texto).length);
      if (linha.alinhamento === "centro") return " ".repeat(Math.floor(sobra / 2)) + texto;
      if (linha.alinhamento === "direita") return " ".repeat(sobra) + texto;
      return texto;
    })
    .join("\n");
}
