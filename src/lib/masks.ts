/**
 * Máscaras e formatos brasileiros dos campos de digitação. Funções puras: recebem o texto do
 * campo (digitado ou colado, formatado ou não) e devolvem o texto já formatado. As funções
 * "unmask"/"parse" devolvem o que vai para o banco: só dígitos ou número.
 */
import { amount, money, phone } from "./printing/format";

/** Para mostrar na tela e no impresso: "1.234,56", "R$ 1.234,56" e "(81) 99999-9999". */
export { amount as formatAmount, money as formatMoney, phone as displayPhone };

/** Só os dígitos do texto (para salvar no banco e enviar à API). */
export const onlyDigits = (value: string | null | undefined) => (value ?? "").replace(/\D/g, "");

/* ------------------------------------------------------------------ telefone */

export const PHONE_MAX_DIGITS = 11;

/**
 * Dígitos do telefone sem o +55 de quem cola o número internacional ("+55 81 9..." ou os 13
 * dígitos "5581999999999"). DDD 55 existe (RS), então só tira o 55 nesses dois casos.
 */
export function phoneDigits(value: string) {
  let digits = onlyDigits(value);
  if (digits.startsWith("55") && (/^\s*\+\s*55/.test(value) || digits.length === 13)) {
    digits = digits.slice(2);
  }
  return digits.slice(0, PHONE_MAX_DIGITS);
}

/**
 * "(81) 99999-9999" (celular, 11 dígitos) ou "(81) 3333-3333" (fixo, 10 dígitos). Enquanto
 * digita, formata o que já tem: "(81) 3333-3", "(81) 99999-9".
 */
export function formatPhone(value: string) {
  const d = phoneDigits(value);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  const split = d.length === 11 ? 5 : 4;
  if (rest.length <= split) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, split)}-${rest.slice(split)}`;
}

/** Telefone completo: fixo com 10 dígitos ou celular com 11 começando com 9. */
export function isValidPhone(value: string) {
  const d = phoneDigits(value);
  if (d.length === 10) return d[2] !== "9" && d[2] !== "0";
  if (d.length === 11) return d[2] === "9";
  return false;
}

/* ---------------------------------------------------------------- CPF / CNPJ */

export function formatCpf(value: string) {
  const d = onlyDigits(value).slice(0, 11);
  return d
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
}

export function formatCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{2})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3/$4")
    .replace(/\/(\d{4})(\d{1,2})$/, "/$1-$2");
}

/** CPF até 11 dígitos; a partir do 12º vira CNPJ. */
export function formatCpfCnpj(value: string) {
  const d = onlyDigits(value).slice(0, 14);
  return d.length <= 11 ? formatCpf(d) : formatCnpj(d);
}

const allSame = (digits: string) => /^(\d)\1+$/.test(digits);

export function isValidCpf(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 11 || allSame(d)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(d[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(d[9]) && check(10) === Number(d[10]);
}

export function isValidCnpj(value: string) {
  const d = onlyDigits(value);
  if (d.length !== 14 || allSame(d)) return false;
  const check = (length: number) => {
    const weights = length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const sum = weights.reduce((total, weight, i) => total + Number(d[i]) * weight, 0);
    const rest = sum % 11;
    return rest < 2 ? 0 : 11 - rest;
  };
  return check(12) === Number(d[12]) && check(13) === Number(d[13]);
}

export function isValidCpfCnpj(value: string) {
  const d = onlyDigits(value);
  return d.length === 11 ? isValidCpf(d) : d.length === 14 ? isValidCnpj(d) : false;
}

/** CPF ou CNPJ salvo (só dígitos) para mostrar na tela e na impressão. Outro texto passa como veio. */
export function displayCpfCnpj(value: string) {
  const d = onlyDigits(value);
  return d.length === 11 || d.length === 14 ? formatCpfCnpj(d) : value.trim();
}

/** "CPF" para 11 dígitos, "CNPJ" para o resto. */
export const cpfCnpjLabel = (value: string) => (onlyDigits(value).length === 11 ? "CPF" : "CNPJ");

/* ----------------------------------------------------------------------- CEP */

export function formatCep(value: string) {
  return onlyDigits(value)
    .slice(0, 8)
    .replace(/^(\d{5})(\d)/, "$1-$2");
}

export const isValidCep = (value: string) => onlyDigits(value).length === 8;

/* ------------------------------------------------------------------ dinheiro */

/** Até R$ 9.999.999,99. */
export const MONEY_MAX_DIGITS = 9;

/**
 * Estilo caixa de banco: cada dígito entra pela direita ("5" → 0,05; "1234" → 12,34).
 * Sem dígitos devolve null (campo vazio).
 */
export function moneyFromDigits(value: string): number | null {
  const d = onlyDigits(value).replace(/^0+(?=\d)/, "").slice(-MONEY_MAX_DIGITS);
  if (!d) return null;
  return Number(d) / 100;
}

/**
 * Valor colado ou vindo de outro lugar: entende "R$ 1.234,56", "1.234,56", "1234,5", "1234.56",
 * "1,234.56" e "50" (reais inteiros). Devolve null se não houver número.
 */
export function parseMoney(value: string): number | null {
  const text = value.replace(/[^\d.,-]/g, "");
  if (!/\d/.test(text)) return null;
  const lastComma = text.lastIndexOf(",");
  const lastDot = text.lastIndexOf(".");
  const sepIndex = Math.max(lastComma, lastDot);
  let whole = text;
  let fraction = "";
  if (sepIndex >= 0) {
    const after = text.slice(sepIndex + 1).replace(/\D/g, "");
    const sep = text[sepIndex];
    const sepCount = text.split(sep!).length - 1;
    // "1.234" ou "1.234.567" sem outro separador: ponto de milhar. Vírgula sozinha é sempre decimal.
    const thousands = sep === "." && lastComma < 0 && after.length === 3;
    const decimal = !thousands && (after.length <= 2 || (sepCount === 1 && sep === ","));
    if (decimal) {
      whole = text.slice(0, sepIndex);
      fraction = after.slice(0, 2);
    }
  }
  const integer = whole.replace(/\D/g, "") || "0";
  const cents = Number(integer) * 100 + Number(fraction.padEnd(2, "0") || 0);
  if (!Number.isFinite(cents)) return null;
  return Math.min(cents, 10 ** MONEY_MAX_DIGITS - 1) / 100;
}

/** Número (reais) para a máscara do campo: "R$ 1.234,56" ou, sem prefixo, "1.234,56". */
export function formatMoneyInput(value: number | null | undefined, prefix = true) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  return prefix ? money(value) : amount(value);
}

/** Reais com 2 casas, sem erro de ponto flutuante (para salvar). */
export const roundMoney = (value: number) => Math.round(value * 100) / 100;

/* ------------------------------------------------------------------- números */

/** Só dígitos, sem zeros à esquerda; acima do máximo vira o máximo. */
export function formatInteger(value: string, options: { max?: number | undefined; maxDigits?: number | undefined } = {}) {
  let d = onlyDigits(value).replace(/^0+(?=\d)/, "");
  if (options.maxDigits) d = d.slice(0, options.maxDigits);
  if (d && options.max !== undefined && Number(d) > options.max) d = String(options.max);
  return d;
}

/** Inteiro dentro dos limites (ao sair do campo). Vazio ou inválido devolve null. */
export function parseInteger(value: string, options: { min?: number | undefined; max?: number | undefined } = {}) {
  const d = onlyDigits(value);
  if (!d) return null;
  let n = Number(d);
  if (options.min !== undefined) n = Math.max(options.min, n);
  if (options.max !== undefined) n = Math.min(options.max, n);
  return n;
}

/**
 * Número com vírgula decimal enquanto digita: só dígitos e uma vírgula (ponto vira vírgula),
 * no máximo `decimals` casas e até `max`.
 */
export function formatDecimal(value: string, options: { decimals?: number | undefined; max?: number | undefined } = {}) {
  const decimals = options.decimals ?? 2;
  const text = value.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const comma = text.indexOf(",");
  let whole = comma < 0 ? text : text.slice(0, comma);
  let fraction = comma < 0 ? "" : text.slice(comma + 1).replace(/,/g, "");
  whole = whole.replace(/^0+(?=\d)/, "");
  fraction = fraction.slice(0, decimals);
  if (comma >= 0 && !whole) whole = "0";
  let result = comma >= 0 && decimals > 0 ? `${whole},${fraction}` : whole;
  if (options.max !== undefined && parseDecimal(result)! > options.max) {
    result = String(options.max).replace(".", ",");
  }
  return result;
}

/** "12,5" → 12.5; vazio → null. */
export function parseDecimal(value: string): number | null {
  const text = value.trim().replace(/\./g, "").replace(",", ".");
  if (!/\d/.test(text)) return null;
  const n = Number(text.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Número para o campo decimal: 12.5 → "12,5". */
export const decimalInput = (value: number | null | undefined) =>
  value === null || value === undefined || !Number.isFinite(value)
    ? ""
    : String(value).replace(".", ",");

/** Porcentagem de 0 a 100 com vírgula decimal (até 2 casas). */
export const formatPercent = (value: string) => formatDecimal(value, { decimals: 2, max: 100 });

/* ----------------------------------------------------------- impressora (rede) */

/** Só dígitos e pontos, 4 grupos de até 3 dígitos; o ponto entra sozinho após 3 dígitos. */
export function formatIp(value: string) {
  const groups: string[] = [""];
  for (const char of value.replace(/,/g, ".").replace(/[^\d.]/g, "")) {
    const current = groups.length - 1;
    if (char === ".") {
      if (groups[current] && groups.length < 4) groups.push("");
      continue;
    }
    if (groups[current]!.length === 3) {
      if (groups.length === 4) continue;
      groups.push("");
    }
    groups[groups.length - 1] += char;
  }
  return groups.join(".");
}

export function isValidIp(value: string) {
  const parts = value.split(".");
  return (
    parts.length === 4 &&
    parts.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255 && !/^0\d/.test(part))
  );
}

export const formatPort = (value: string) => formatInteger(value, { max: 65535, maxDigits: 5 });

export function isValidPort(value: string) {
  const n = Number(value);
  return /^\d+$/.test(value) && n >= 1 && n <= 65535;
}

/* ------------------------------------------------------------------- textos */

export const RESTAURANT_CODE_LENGTH = 6;
export const formatRestaurantCode = (value: string) =>
  onlyDigits(value).slice(0, RESTAURANT_CODE_LENGTH);

const stripAccents = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "");

/** Usuário de login (ou e-mail): minúsculas, sem espaço e sem acento. */
export const formatUsername = (value: string) => stripAccents(value).toLowerCase().replace(/\s+/g, "");

/** "@restaurante": sem espaço, sempre com um @ na frente; aceita colar o link do perfil. */
export function formatInstagram(value: string) {
  let text = value.trim();
  const link = /instagram\.com\/([^/?#\s]+)/i.exec(text);
  if (link) text = link[1]!;
  text = text.replace(/\s+/g, "").replace(/@/g, "");
  return text ? `@${text}` : "";
}

/** Nome de pessoa ou produto: sem espaços duplos nem nas pontas (ao sair do campo). */
export const cleanName = (value: string) => value.replace(/\s+/g, " ").trim();

/* ---------------------------------------------------------------- validação */

/** Mensagem de erro do campo, ou "" se estiver vazio ou válido. */
export function maskError(
  kind: "phone" | "cpfCnpj" | "cep" | "ip" | "port",
  value: string,
): string {
  if (!value.trim()) return "";
  switch (kind) {
    case "phone": {
      if (isValidPhone(value)) return "";
      const d = phoneDigits(value);
      return d.length === 10 && d[2] === "9"
        ? "Celular precisa ter 11 dígitos: (81) 99999-9999."
        : "Telefone incompleto. Use (81) 99999-9999 ou (81) 3333-3333.";
    }
    case "cpfCnpj": {
      const d = onlyDigits(value);
      if (d.length === 11) return isValidCpf(d) ? "" : "CPF inválido. Confira os números.";
      if (d.length === 14) return isValidCnpj(d) ? "" : "CNPJ inválido. Confira os números.";
      return "CPF (11 dígitos) ou CNPJ (14 dígitos) incompleto.";
    }
    case "cep":
      return isValidCep(value) ? "" : "CEP incompleto. Use 00000-000.";
    case "ip":
      return isValidIp(value) ? "" : "IP inválido. Ex.: 192.168.0.50.";
    case "port":
      return isValidPort(value) ? "" : "A porta vai de 1 a 65535.";
  }
}
