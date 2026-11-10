import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type Ref,
} from "react";
import {
  cleanName,
  formatCep,
  formatCpfCnpj,
  formatDecimal,
  formatInstagram,
  formatInteger,
  formatIp,
  formatMoneyInput,
  formatPercent,
  formatPhone,
  formatPort,
  formatRestaurantCode,
  formatUsername,
  maskError,
  moneyFromDigits,
  onlyDigits,
  parseInteger,
  parseMoney,
  phoneDigits,
} from "@/lib/masks";

/**
 * Máscara do campo. Nas de dígitos (telefone, CPF/CNPJ, CEP, código) o valor que entra e sai
 * é só dígitos — o que vai para o banco — e o campo mostra formatado.
 */
export type Mask =
  | "phone"
  | "cpfCnpj"
  | "cep"
  | "restaurantCode"
  | "integer"
  | "decimal"
  | "percent"
  | "ip"
  | "port"
  | "username"
  | "instagram"
  | "name";

type BaseProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "min" | "max"> & {
  ref?: Ref<HTMLInputElement>;
};

export type MaskedInputProps = BaseProps & {
  mask: Mask;
  value: string;
  onValueChange: (value: string) => void;
  /** integer/decimal: limites. O máximo vale enquanto digita; o mínimo, ao sair do campo. */
  min?: number;
  max?: number;
  /** decimal: casas depois da vírgula (padrão 2). */
  decimals?: number;
  /** integer: quantidade máxima de dígitos. */
  maxDigits?: number;
  /** Erro vindo de fora (ex.: número de mesa repetido). Tem prioridade sobre o da máscara. */
  error?: string;
  /** false desliga a mensagem de validação da máscara (telefone, CPF/CNPJ, CEP, IP, porta). */
  validate?: boolean;
};

type Spec = {
  /** Texto do campo (digitado/colado) → valor guardado. */
  toValue: (text: string, props: MaskedInputProps) => string;
  /** Valor guardado → texto mostrado. */
  display: (value: string) => string;
  /** Caracteres que o usuário digitou de fato (o resto a máscara põe e tira). */
  meaningful: RegExp;
  validation?: "phone" | "cpfCnpj" | "cep" | "ip" | "port";
  attrs: InputHTMLAttributes<HTMLInputElement>;
};

const DIGIT = /\d/;
const same = (value: string) => value;
const numeric = { inputMode: "numeric", autoComplete: "off" } as const;
const noSpell = { autoCapitalize: "none", autoCorrect: "off", spellCheck: false } as const;

const SPECS: Record<Mask, Spec> = {
  phone: {
    toValue: (text) => phoneDigits(text),
    display: formatPhone,
    meaningful: DIGIT,
    validation: "phone",
    attrs: { type: "tel", inputMode: "tel", autoComplete: "tel", placeholder: "(81) 99999-9999" },
  },
  cpfCnpj: {
    toValue: (text) => onlyDigits(text).slice(0, 14),
    display: formatCpfCnpj,
    meaningful: DIGIT,
    validation: "cpfCnpj",
    attrs: { ...numeric, placeholder: "00.000.000/0000-00" },
  },
  cep: {
    toValue: (text) => onlyDigits(text).slice(0, 8),
    display: formatCep,
    meaningful: DIGIT,
    validation: "cep",
    attrs: { inputMode: "numeric", autoComplete: "postal-code", placeholder: "00000-000" },
  },
  restaurantCode: {
    toValue: formatRestaurantCode,
    display: formatRestaurantCode,
    meaningful: DIGIT,
    attrs: { ...numeric, placeholder: "6 números" },
  },
  integer: {
    toValue: (text, p) => formatInteger(text, { max: p.max, maxDigits: p.maxDigits }),
    display: same,
    meaningful: DIGIT,
    attrs: numeric,
  },
  decimal: {
    toValue: (text, p) => formatDecimal(text, { decimals: p.decimals ?? 2, max: p.max }),
    display: same,
    meaningful: /[\d,.]/,
    attrs: { inputMode: "decimal", autoComplete: "off" },
  },
  percent: {
    toValue: formatPercent,
    display: same,
    meaningful: /[\d,.]/,
    attrs: { inputMode: "decimal", autoComplete: "off" },
  },
  ip: {
    toValue: formatIp,
    display: same,
    meaningful: DIGIT,
    validation: "ip",
    attrs: { inputMode: "decimal", autoComplete: "off", ...noSpell, placeholder: "192.168.0.50" },
  },
  port: {
    toValue: formatPort,
    display: same,
    meaningful: DIGIT,
    validation: "port",
    attrs: { ...numeric, placeholder: "9100" },
  },
  username: {
    toValue: formatUsername,
    display: same,
    meaningful: /\S/,
    attrs: { autoComplete: "username", ...noSpell },
  },
  instagram: {
    toValue: formatInstagram,
    display: same,
    meaningful: /[^\s@]/,
    attrs: { autoComplete: "off", ...noSpell, placeholder: "@restaurante" },
  },
  name: {
    toValue: same,
    display: same,
    meaningful: /[\s\S]/,
    attrs: { maxLength: 80 },
  },
};

/** Posição no texto formatado logo depois do n-ésimo caractere digitado de fato. */
function caretAfter(text: string, count: number, meaningful: RegExp) {
  if (count <= 0) return 0;
  let seen = 0;
  for (let i = 0; i < text.length; i++) {
    if (meaningful.test(text[i]!)) seen++;
    if (seen === count) return i + 1;
  }
  return text.length;
}

function countMeaningful(text: string, meaningful: RegExp) {
  let n = 0;
  for (const char of text) if (meaningful.test(char)) n++;
  return n;
}

/** Guarda onde o cursor deve ficar depois que o React redesenha o campo formatado. */
function useCaret() {
  const ref = useRef<HTMLInputElement | null>(null);
  const pending = useRef<number | null>(null);
  useLayoutEffect(() => {
    const input = ref.current;
    const position = pending.current;
    pending.current = null;
    if (input && position !== null && input.ownerDocument.activeElement === input) {
      input.setSelectionRange(position, position);
    }
  });
  return { ref, pending };
}

function setRefs(node: HTMLInputElement | null, own: { current: HTMLInputElement | null }, ref?: Ref<HTMLInputElement>) {
  own.current = node;
  if (typeof ref === "function") ref(node);
  else if (ref) (ref as { current: HTMLInputElement | null }).current = node;
}

function ErrorText({ id, children }: { id: string; children: string }) {
  return (
    <span id={id} role="alert" className="mt-1 block text-xs text-destructive">
      {children}
    </span>
  );
}

/**
 * Campo com máscara brasileira: formata enquanto digita, mantém o cursor no lugar, aceita colar
 * texto formatado ou não e mostra o erro de validação ao sair do campo.
 */
export function MaskedInput(props: MaskedInputProps) {
  const {
    mask,
    value,
    onValueChange,
    min,
    max,
    decimals: _decimals,
    maxDigits: _maxDigits,
    error,
    validate = true,
    ref,
    onBlur,
    className = "field",
    ...rest
  } = props;
  const spec = SPECS[mask];
  const errorId = useId();
  const [touched, setTouched] = useState(false);
  const { ref: own, pending } = useCaret();
  const shown = spec.display(value);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const typed = input.value;
    const caret = input.selectionStart ?? typed.length;
    const next = spec.toValue(typed, props);
    const nextShown = spec.display(next);
    let position: number;
    if (caret >= typed.length) {
      position = nextShown.length;
    } else {
      position = caretAfter(nextShown, countMeaningful(typed.slice(0, caret), spec.meaningful), spec.meaningful);
      // Digitou um separador (ex.: "." do IP): o cursor passa por cima dele.
      if (caret > 0 && !spec.meaningful.test(typed[caret - 1]!)) {
        while (position < nextShown.length && !spec.meaningful.test(nextShown[position]!)) position++;
      }
    }
    if (nextShown === shown) {
      // Nada mudou (ex.: letra no telefone): o React não redesenha, então volta o texto aqui.
      input.value = shown;
      input.setSelectionRange(Math.min(position, shown.length), Math.min(position, shown.length));
      return;
    }
    pending.current = position;
    onValueChange(next);
  };

  const validationMessage =
    validate && spec.validation && touched ? maskError(spec.validation, shown) : "";
  const message = error || validationMessage;

  return (
    <>
      <input
        {...spec.attrs}
        {...rest}
        ref={(node) => setRefs(node, own, ref)}
        className={className}
        value={shown}
        aria-invalid={Boolean(message) || rest["aria-invalid"] === true || undefined}
        aria-describedby={message ? errorId : rest["aria-describedby"]}
        onChange={onChange}
        onBlur={(event) => {
          setTouched(true);
          if (mask === "name") {
            const cleaned = cleanName(value);
            if (cleaned !== value) onValueChange(cleaned);
          } else if (mask === "integer" && min !== undefined && value) {
            const clamped = String(parseInteger(value, { min, max }));
            if (clamped !== value) onValueChange(clamped);
          }
          onBlur?.(event);
        }}
      />
      {message && <ErrorText id={errorId}>{message}</ErrorText>}
    </>
  );
}

export type MoneyInputProps = BaseProps & {
  /** Valor em reais (número), null = vazio. */
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** false mostra "1.234,56" sem o "R$" (quando o R$ já está do lado do campo). */
  currency?: boolean;
  error?: string;
};

/**
 * Dinheiro estilo caixa de banco: o usuário só digita números e cada dígito entra pela direita
 * (R$ 0,01 → R$ 0,12 → R$ 1,23). Colar "R$ 1.234,56", "1234.56" ou "50" também funciona.
 */
export function MoneyInput({
  value,
  onValueChange,
  currency = true,
  error,
  ref,
  className = "field",
  onPaste,
  ...rest
}: MoneyInputProps) {
  const errorId = useId();
  const { ref: own, pending } = useCaret();
  const shown = formatMoneyInput(value, currency);

  const onChange = (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const native = event.nativeEvent as InputEvent;
    const deleting = typeof native.inputType === "string" && native.inputType.startsWith("delete");
    let next = moneyFromDigits(input.value);
    // Apagando até zerar: o campo fica vazio (senão "R$ 0,00" nunca some).
    if (deleting && next === 0) next = null;
    const nextShown = formatMoneyInput(next, currency);
    if (nextShown === shown) {
      input.value = shown;
      input.setSelectionRange(shown.length, shown.length);
      return;
    }
    pending.current = nextShown.length;
    onValueChange(next);
  };

  const paste = (event: ClipboardEvent<HTMLInputElement>) => {
    onPaste?.(event);
    if (event.defaultPrevented) return;
    const text = event.clipboardData.getData("text");
    const parsed = parseMoney(text);
    if (parsed === null) return;
    event.preventDefault();
    pending.current = formatMoneyInput(parsed, currency).length;
    onValueChange(parsed);
  };

  return (
    <>
      <input
        inputMode="numeric"
        autoComplete="off"
        placeholder={currency ? "R$ 0,00" : "0,00"}
        {...rest}
        ref={(node) => setRefs(node, own, ref)}
        className={className}
        value={shown}
        aria-invalid={Boolean(error) || rest["aria-invalid"] === true || undefined}
        aria-describedby={error ? errorId : rest["aria-describedby"]}
        onChange={onChange}
        onPaste={paste}
        onFocus={(event) => {
          rest.onFocus?.(event);
          const input = event.currentTarget;
          // Os dígitos entram pela direita: o cursor começa no fim.
          requestAnimationFrame(() => {
            if (input.ownerDocument.activeElement === input && input.selectionStart === input.selectionEnd)
              input.setSelectionRange(input.value.length, input.value.length);
          });
        }}
      />
      {error && <ErrorText id={errorId}>{error}</ErrorText>}
    </>
  );
}
