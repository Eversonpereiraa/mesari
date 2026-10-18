/**
 * Tabelas de página de código usadas pelas impressoras térmicas ESC/POS.
 * Cada string tem exatamente 128 caracteres: o índice i corresponde ao byte 0x80 + i.
 * Fonte: tabelas oficiais IBM CP860 (português) e CP850 (multilíngue).
 */
export type CharacterTable = "CP860" | "CP850" | "WPC1252";

const CP860_HIGH =
  "ÇüéâãàÁçêÊèÍÔìÃÂ" +
  "ÉÀÈôõòÚùÌÕÜ¢£Ù₧Ó" +
  "áíóúñÑªº¿Ò¬½¼¡«»" +
  "░▒▓│┤╡╢╖╕╣║╗╝╜╛┐" +
  "└┴┬├─┼╞╟╚╔╩╦╠═╬╧" +
  "╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀" +
  "αßΓπΣσµτΦΘΩδ∞φε∩" +
  "≡±≥≤⌠⌡÷≈°∙·√ⁿ²■\u00a0";

const CP850_HIGH =
  "ÇüéâäàåçêëèïîìÄÅ" +
  "ÉæÆôöòûùÿÖÜø£Ø×ƒ" +
  "áíóúñÑªº¿®¬½¼¡«»" +
  "░▒▓│┤ÁÂÀ©╣║╗╝¢¥┐" +
  "└┴┬├─┼ãÃ╚╔╩╦╠═╬¤" +
  "ðÐÊËÈıÍÎÏ┘┌█▄¦Ì▀" +
  "ÓßÔÒõÕµþÞÚÛÙýÝ¯´" +
  "\u00ad±‗¾¶§÷¸°¨·¹³²■\u00a0";

// Windows-1252: 0xA0–0xFF é igual ao Latin-1; 0x80–0x9F tem estes extras.
const WPC1252_80_9F: (string | null)[] = [
  "€",
  null,
  "‚",
  "ƒ",
  "„",
  "…",
  "†",
  "‡",
  "ˆ",
  "‰",
  "Š",
  "‹",
  "Œ",
  null,
  "Ž",
  null,
  null,
  "‘",
  "’",
  "“",
  "”",
  "•",
  "–",
  "—",
  "˜",
  "™",
  "š",
  "›",
  "œ",
  null,
  "ž",
  "Ÿ",
];

export const CODE_PAGE_TABLES = {
  CP860: Array.from(CP860_HIGH),
  CP850: Array.from(CP850_HIGH),
  WPC1252: Array.from({ length: 128 }, (_, index) =>
    index < 32 ? (WPC1252_80_9F[index] ?? null) : String.fromCharCode(0x80 + index),
  ),
} satisfies Record<CharacterTable, (string | null)[]>;

/** Número enviado em ESC t n para selecionar a tabela (padrão Epson). */
export const codePageSelector: Record<CharacterTable, number> = {
  CP860: 3,
  CP850: 2,
  WPC1252: 16,
};

export function tableFromSelector(selector: number): CharacterTable | null {
  const entry = Object.entries(codePageSelector).find(([, value]) => value === selector);
  return entry ? (entry[0] as CharacterTable) : null;
}

const encoders = new Map<CharacterTable, Map<string, number>>();
function encoderFor(table: CharacterTable) {
  let map = encoders.get(table);
  if (!map) {
    map = new Map();
    for (const [index, character] of CODE_PAGE_TABLES[table].entries()) {
      if (character !== null && !map.has(character)) map.set(character, 0x80 + index);
    }
    encoders.set(table, map);
  }
  return map;
}

/** Converte texto em bytes da tabela; sem equivalente, tira o acento; sem saída, vira "?". */
export function encodeText(text: string, table: CharacterTable = "CP860") {
  const map = encoderFor(table);
  return Array.from(text, (character) => {
    const code = character.codePointAt(0) ?? 63;
    if (code <= 0x7f) return code;
    const mapped = map.get(character);
    if (mapped !== undefined) return mapped;
    const plain = character.normalize("NFD").replace(/[̀-ͯ]/g, "");
    const plainCode = plain.codePointAt(0) ?? 63;
    if (plainCode <= 0x7f) return plainCode;
    return map.get(plain) ?? 63;
  });
}

/** Caractere que a impressora mostraria para o byte, ou "?" se a tabela não define. */
export function decodeByte(byte: number, table: CharacterTable) {
  if (byte < 0x80) return String.fromCharCode(byte);
  return CODE_PAGE_TABLES[table][byte - 0x80] ?? "?";
}
