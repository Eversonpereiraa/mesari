// Máscaras e validação dos formulários: funções puras de limpar, formatar e
// validar. O que aparece na tela é formatado; o que vai para o estado e para o
// banco é o valor limpo (só dígitos, número em centavos ou texto já aparado).
// Mensagens de erro em português, prontas para exibir embaixo do campo.

const onlyDigits = (value: string) => value.replace(/\D/g, "");

/* ------------------------------------------------------------------ cursor */

/**
 * Posição do cursor depois de reformatar: mantém a mesma quantidade de dígitos
 * à esquerda (telefone, documento, inteiros) ou à direita (dinheiro, que cresce
 * pela direita) que havia no texto digitado.
 */
export function caretByDigits(
  raw: string,
  caret: number,
  formatted: string,
  anchor: "left" | "right" = "left",
): number {
  if (anchor === "right") {
    let remaining = onlyDigits(raw.slice(caret)).length;
    let position = formatted.length;
    while (position > 0 && remaining > 0) {
      position -= 1;
      if (/\d/.test(formatted.charAt(position))) remaining -= 1;
    }
    return position;
  }
  let remaining = onlyDigits(raw.slice(0, caret)).length;
  if (remaining === 0) {
    const firstDigit = formatted.search(/\d/);
    return firstDigit === -1 ? formatted.length : Math.min(firstDigit, formatted.length);
  }
  let position = 0;
  while (position < formatted.length && remaining > 0) {
    if (/\d/.test(formatted.charAt(position))) remaining -= 1;
    position += 1;
  }
  return position;
}

/* ---------------------------------------------------------------- dinheiro */

/** Teto geral dos campos de dinheiro: R$ 99.999,99. */
export const MONEY_MAX_CENTS = 9_999_999;
/** Teto da taxa de entrega aceito pelo banco: R$ 500,00. */
export const DELIVERY_FEE_MAX_CENTS = 50_000;

/** Centavos → "1.234,56" (sem o "R$"). */
export function formatCents(cents: number): string {
  const safe = Math.max(0, Math.round(cents));
  const reais = Math.floor(safe / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${reais},${String(safe % 100).padStart(2, "0")}`;
}

/**
 * Máscara de centavos durante a digitação: só os dígitos contam e entram pela
 * direita ("1250" → 1250 centavos → "12,50"). Vazio → null.
 */
export function centsFromTyping(raw: string): number | null {
  const digits = onlyDigits(raw).replace(/^0+(?=\d)/, "");
  return digits ? Number(digits) : null;
}

/**
 * Valor de dinheiro colado ou salvo antigo, em qualquer formato comum:
 * "R$ 1.234,56", "1234,5", "12.5", "1.234", "50". Retorna centavos, ou null
 * quando não dá para entender (ou é negativo).
 */
export function parseMoneyToCents(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null;
  }
  const text = value.trim();
  if (!text || text.includes("-")) return null;
  const normalized = text.replace(/[^\d.,]/g, "");
  if (!normalized || !/\d/.test(normalized)) return null;
  let whole: string;
  let fraction = "";
  if (normalized.includes(",")) {
    const comma = normalized.lastIndexOf(",");
    whole = normalized.slice(0, comma);
    fraction = normalized.slice(comma + 1);
    if (!/^(?:\d*|\d{1,3}(?:\.\d{3})+)$/.test(whole) || !/^\d{0,2}$/.test(fraction)) return null;
    whole = whole.replace(/\./g, "");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    whole = normalized.replace(/\./g, "");
  } else if (/^\d*\.\d{1,2}$/.test(normalized)) {
    [whole = "", fraction = ""] = normalized.split(".");
  } else if (/^\d+$/.test(normalized)) {
    whole = normalized;
  } else {
    return null;
  }
  return Number(whole || "0") * 100 + Number(fraction.padEnd(2, "0"));
}

export function moneyError(
  cents: number | null,
  {
    required = false,
    max = MONEY_MAX_CENTS,
    min = 0,
  }: { required?: boolean; max?: number; min?: number } = {},
): string | null {
  if (cents === null) return required ? "Informe o valor." : null;
  if (cents < 0) return "O valor não pode ser negativo.";
  if (cents < min) return `O valor mínimo é R$ ${formatCents(min)}.`;
  if (cents > max) return `O valor máximo é R$ ${formatCents(max)}.`;
  return null;
}

/* ---------------------------------------------------------------- telefone */

/**
 * Só os dígitos do telefone, com DDD. Tira o +55 e o 0 de longa distância
 * quando vierem colados, e corta em 11 dígitos.
 */
export function cleanPhone(value: string | null | undefined): string {
  let digits = onlyDigits(value ?? "");
  if (digits.length > 11 && digits.startsWith("55")) digits = digits.slice(2);
  if (digits.length > 10 && digits.startsWith("0")) digits = digits.slice(1);
  return digits.slice(0, 11);
}

/** "(81) 9 9999-9999" (celular, 11 dígitos) ou "(81) 3333-3333" (fixo, 10). */
export function formatPhone(digits: string): string {
  const d = cleanPhone(digits);
  if (!d) return "";
  if (d.length <= 2) return `(${d}`;
  const ddd = d.slice(0, 2);
  const rest = d.slice(2);
  if (d.length === 11) return `(${ddd}) ${rest.slice(0, 1)} ${rest.slice(1, 5)}-${rest.slice(5)}`;
  if (rest.length <= 4) return `(${ddd}) ${rest}`;
  return `(${ddd}) ${rest.slice(0, 4)}-${rest.slice(4)}`;
}

export function isValidPhone(digits: string): boolean {
  const d = cleanPhone(digits);
  if (!/^[1-9]{2}/.test(d)) return false;
  if (d.length === 11) return d.charAt(2) === "9";
  if (d.length === 10) return /[2-5]/.test(d.charAt(2));
  return false;
}

export function phoneError(digits: string, { required = false } = {}): string | null {
  const d = cleanPhone(digits);
  if (!d) return required ? "Informe o telefone." : null;
  if (d.length < 10) return "Informe o telefone com DDD, ex.: (81) 9 9999-9999.";
  if (!isValidPhone(d)) return "Telefone inválido. Confira o DDD e o número.";
  return null;
}

/** Telefone salvo (limpo ou antigo) para exibir/imprimir. */
export function displayPhone(value: string | null | undefined): string {
  const d = cleanPhone(value);
  return d.length === 10 || d.length === 11 ? formatPhone(d) : (value ?? "").trim();
}

/* --------------------------------------------------------------- CPF/CNPJ */

export function cleanCpfCnpj(value: string | null | undefined): string {
  return onlyDigits(value ?? "").slice(0, 14);
}

/** Até 11 dígitos formata como CPF; acima disso, como CNPJ. */
export function formatCpfCnpj(digits: string): string {
  const d = cleanCpfCnpj(digits);
  if (d.length <= 11) {
    return d
      .replace(/^(\d{3})(\d)/, "$1.$2")
      .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
      .replace(/\.(\d{3})(\d{1,2})$/, ".$1-$2");
  }
  return d
    .replace(/^(\d{2})(\d)/, "$1.$2")
    .replace(/^(\d{2})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/\.(\d{3})(\d)/, ".$1/$2")
    .replace(/(\d{4})(\d{1,2})$/, "$1-$2");
}

const checkDigit = (digits: string, weights: number[]) => {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
};

export function isValidCpf(value: string): boolean {
  const d = cleanCpfCnpj(value);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const first = checkDigit(d, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[9]) && second === Number(d[10]);
}

export function isValidCnpj(value: string): boolean {
  const d = cleanCpfCnpj(value);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const first = checkDigit(d, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(d, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return first === Number(d[12]) && second === Number(d[13]);
}

export function cpfCnpjError(value: string, { required = false } = {}): string | null {
  const d = cleanCpfCnpj(value);
  if (!d) return required ? "Informe o CPF ou CNPJ." : null;
  if (d.length === 11) return isValidCpf(d) ? null : "CPF inválido. Confira os números.";
  if (d.length === 14) return isValidCnpj(d) ? null : "CNPJ inválido. Confira os números.";
  return "Informe um CPF (11 dígitos) ou CNPJ (14 dígitos) completo.";
}

/** "CPF" ou "CNPJ", conforme o tamanho do documento salvo. */
export function cpfCnpjLabel(value: string | null | undefined): "CPF" | "CNPJ" {
  return cleanCpfCnpj(value).length === 11 ? "CPF" : "CNPJ";
}

/** Documento salvo (limpo ou antigo) para exibir/imprimir. */
export function displayCpfCnpj(value: string | null | undefined): string {
  const d = cleanCpfCnpj(value);
  return d.length === 11 || d.length === 14 ? formatCpfCnpj(d) : (value ?? "").trim();
}

/* --------------------------------------------------------------- Instagram */

export const INSTAGRAM_MAX = 30;

/**
 * "@usuario": minúsculo, só letras, números, ponto e _, até 30 caracteres.
 * Aceita link colado (instagram.com/usuario). Vazio → "".
 */
export function cleanInstagram(value: string | null | undefined): string {
  let text = (value ?? "").trim();
  const link = /instagram\.com\/+([^/?#\s]+)/i.exec(text);
  if (link?.[1]) text = link[1];
  const handle = text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._]/g, "")
    .slice(0, INSTAGRAM_MAX);
  return handle ? `@${handle}` : "";
}

export function instagramError(value: string): string | null {
  const handle = cleanInstagram(value).slice(1);
  if (!handle) return null;
  if (handle.startsWith(".") || handle.endsWith(".") || handle.includes("..")) {
    return "O usuário do Instagram não pode começar/terminar com ponto nem ter dois pontos seguidos.";
  }
  return null;
}

/* ----------------------------------------------------------------- usuário */

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 30;

/** Cadastro: minúsculo, sem acento e sem espaço, só a-z 0-9 . _ - (até 30). */
export function cleanUsername(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, USERNAME_MAX);
}

/** Login: só minúsculo e sem espaços nas pontas, para não barrar usuários antigos. */
export function loginUsername(value: string): string {
  return value.toLowerCase().trim();
}

export function usernameError(value: string): string | null {
  if (!value) return "Informe o usuário.";
  if (!/^[a-z0-9._-]+$/.test(value)) return "Use só letras minúsculas, números, ponto, _ ou -.";
  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return `O usuário deve ter de ${USERNAME_MIN} a ${USERNAME_MAX} caracteres.`;
  }
  return null;
}

/* ------------------------------------------------------------------- senha */

export const PASSWORD_MIN = 6;

export function passwordError(value: string, { isNew = true } = {}): string | null {
  if (!value) return "Informe a senha.";
  if (isNew && value.length < PASSWORD_MIN) {
    return `A senha deve ter no mínimo ${PASSWORD_MIN} caracteres.`;
  }
  return null;
}

/* ---------------------------------------------------------------- inteiros */

/** Só dígitos, sem zeros à esquerda, cortando no tamanho do máximo. Vazio → null. */
export function integerFromTyping(raw: string, max: number): number | null {
  const digits = onlyDigits(raw)
    .replace(/^0+(?=\d)/, "")
    .slice(0, String(max).length);
  return digits ? Number(digits) : null;
}

export function integerError(
  value: number | null,
  { min, max, required = true }: { min: number; max: number; required?: boolean },
): string | null {
  if (value === null) return required ? `Informe um número de ${min} a ${max}.` : null;
  if (!Number.isInteger(value) || value < min || value > max) {
    return `Informe um número de ${min} a ${max}.`;
  }
  return null;
}

/* -------------------------------------------------------------- percentual */

export const SERVICE_CHARGE_MAX = 30;

/**
 * Texto do percentual durante a digitação: dígitos e uma vírgula (o ponto vira
 * vírgula), no máximo uma casa decimal. "10.55" → "10,5".
 */
export function percentFromTyping(raw: string): string {
  const text = raw.replace(/\./g, ",").replace(/[^\d,]/g, "");
  const [integer = "", ...rest] = text.split(",");
  const whole = integer.replace(/^0+(?=\d)/, "").slice(0, 3);
  if (!text.includes(",")) return whole;
  return `${whole || "0"},${rest.join("").slice(0, 1)}`;
}

export function parsePercent(text: string): number | null {
  const normalized = percentFromTyping(text).replace(",", ".");
  if (!normalized || normalized === ".") return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
}

export function formatPercent(value: number): string {
  return String(Math.round(value * 10) / 10).replace(".", ",");
}

export function percentError(
  value: number | null,
  { min = 0, max = SERVICE_CHARGE_MAX, required = true } = {},
): string | null {
  if (value === null) return required ? "Informe o percentual." : null;
  if (value < min || value > max) return `Informe um percentual de ${min} a ${max}%.`;
  return null;
}

/* ------------------------------------------------------------- texto livre */

export const TEXT_LIMITS = {
  name: 60,
  restaurantName: 80,
  address: 150,
  note: 140,
  description: 200,
} as const;

/** Durante a digitação: sem espaço no começo, espaços repetidos viram um, corta no limite. */
export function typingText(value: string, max: number, { multiline = false } = {}): string {
  const collapsed = multiline ? value.replace(/[^\S\n]+/g, " ") : value.replace(/\s+/g, " ");
  return collapsed.replace(/^\s+/, "").slice(0, max);
}

/** Ao salvar: aparado e com espaços repetidos juntados. */
export function cleanText(value: string | null | undefined, max: number): string {
  return (value ?? "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim()
    .slice(0, max);
}

export function requiredTextError(value: string, message: string): string | null {
  return value.trim() ? null : message;
}
