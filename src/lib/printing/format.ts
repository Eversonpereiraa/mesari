/** Formatos usados nos impressos: valores, data, hora, telefone e endereço. */

/** "1.234,56" (sem "R$"), sempre com 2 casas. */
export function amount(value: number) {
  const cents = Math.round(Math.abs(value) * 100);
  const whole = Math.floor(cents / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const sign = value < 0 && cents > 0 ? "-" : "";
  return `${sign}${whole},${String(cents % 100).padStart(2, "0")}`;
}

/** "R$ 1.234,56"; negativo vira "-R$ 5,00". */
export function money(value: number) {
  const text = `R$ ${amount(Math.abs(value))}`;
  return value < 0 && Math.round(Math.abs(value) * 100) > 0 ? `-${text}` : text;
}

const two = (value: number) => String(value).padStart(2, "0");

/** DD/MM/AAAA no fuso do aparelho. */
export function date(at: number) {
  const d = new Date(at);
  return `${two(d.getDate())}/${two(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** HH:MM (24 h) no fuso do aparelho. */
export function time(at: number) {
  const d = new Date(at);
  return `${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** "(81) 99634-1234" / "(81) 3634-1234". O que não for telefone brasileiro passa como veio. */
export function phone(value: string) {
  const raw = value.trim();
  let digits = raw.replace(/\D/g, "");
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith("55")) {
    digits = digits.slice(2);
  }
  if (digits.length === 11)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  if (digits.length === 10)
    return `(${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  return raw;
}

/** "10%" / "12,5%". */
export function percent(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return `${String(rounded).replace(".", ",")}%`;
}

const REFERENCE = /(?:^|[\s,;–—-]+)(?:ponto\s+de\s+)?ref(?:er[êe]ncia|\.)?\s*:\s*/i;

/**
 * Endereço em linhas: quebras de linha do texto são respeitadas; numa linha só, o primeiro
 * " - " (ou " – ") separa "Rua, número, complemento" de "Bairro - Cidade/UF". Um trecho
 * "Ref.: ..." (ou "Referência: ...") vira o ponto de referência.
 */
export function splitAddress(value: string): { lines: string[]; reference: string } {
  let text = value.replace(/\r/g, "").trim();
  let reference = "";
  const match = REFERENCE.exec(text);
  if (match) {
    reference = text.slice(match.index + match[0].length).trim();
    text = text.slice(0, match.index).replace(/[\s.,;–—-]+$/, "");
  }
  let lines = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length === 1) {
    const separator = / [–—-] /.exec(lines[0]!);
    if (separator) {
      lines = [
        lines[0]!.slice(0, separator.index).trim(),
        lines[0]!.slice(separator.index + separator[0].length).trim(),
      ].filter(Boolean);
    }
  }
  return { lines, reference: reference.replace(/\s*\n\s*/g, " ") };
}
