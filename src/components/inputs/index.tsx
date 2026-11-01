import { useEffect, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MONEY_MAX_CENTS,
  SERVICE_CHARGE_MAX,
  caretByDigits,
  centsFromTyping,
  cleanCpfCnpj,
  cleanInstagram,
  cleanPhone,
  cleanUsername,
  cpfCnpjError,
  formatCents,
  formatCpfCnpj,
  formatPercent,
  formatPhone,
  instagramError,
  integerError,
  integerFromTyping,
  moneyError,
  parseMoneyToCents,
  parsePercent,
  passwordError,
  percentError,
  percentFromTyping,
  phoneError,
  typingText,
  usernameError,
} from "@/lib/masks";
import {
  FieldError,
  MaskedInput,
  useFieldError,
  type MaskSpec,
  type ValidationProps,
} from "@/components/inputs/masked-input";

export { FieldError, type ValidationProps } from "@/components/inputs/masked-input";

type NativeProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "value" | "onChange" | "type" | "min" | "max" | "prefix"
>;

const pick = (screenError: string | null | undefined, maskError: string | null) =>
  screenError || maskError;

/* ---------------------------------------------------------------- dinheiro */

/**
 * Dinheiro com máscara de centavos: digitar 1250 mostra "12,50". O valor é em
 * centavos (null = vazio). Colar "R$ 1.234,56" ou "12.5" também funciona.
 */
export function MoneyInput({
  value,
  onChange,
  max = MONEY_MAX_CENTS,
  min = 0,
  required = false,
  error,
  showError,
  className,
  wrapperClassName,
  ...props
}: NativeProps &
  ValidationProps & {
    value: number | null;
    onChange: (cents: number | null) => void;
    max?: number | undefined;
    min?: number | undefined;
    required?: boolean | undefined;
    wrapperClassName?: string | undefined;
  }) {
  const mask: MaskSpec = {
    clean: (raw) => {
      const cents = centsFromTyping(raw);
      if (cents === null) return "";
      return cents > max ? null : String(cents);
    },
    format: (clean) => (clean === "" ? "" : formatCents(Number(clean))),
    caret: (raw, caret, formatted) => caretByDigits(raw, caret, formatted, "right"),
    significant: /\d/,
  };
  return (
    <MaskedInput
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="next"
      placeholder="0,00"
      {...props}
      aria-required={required || undefined}
      className={cn("num", className)}
      wrapperClassName={wrapperClassName}
      prefix="R$"
      mask={mask}
      value={value === null ? "" : String(value)}
      onValueChange={(clean) => onChange(clean === "" ? null : Number(clean))}
      onPaste={(event) => {
        const cents = parseMoneyToCents(event.clipboardData.getData("text"));
        if (cents === null) return;
        event.preventDefault();
        onChange(Math.min(cents, max));
      }}
      message={pick(error, moneyError(value, { required, max, min }))}
      showError={showError}
    />
  );
}

/* ---------------------------------------------------------------- telefone */

const phoneMask: MaskSpec = {
  clean: cleanPhone,
  format: formatPhone,
  caret: (raw, caret, formatted) => caretByDigits(raw, caret, formatted),
  significant: /\d/,
};

/** Telefone com DDD; o valor é só dígitos (10 fixo, 11 celular). */
export function PhoneInput({
  value,
  onChange,
  required = false,
  error,
  showError,
  ...props
}: NativeProps &
  ValidationProps & {
    value: string;
    onChange: (digits: string) => void;
    required?: boolean | undefined;
  }) {
  return (
    <MaskedInput
      inputMode="tel"
      autoComplete="tel-national"
      enterKeyHint="next"
      placeholder="(81) 9 9999-9999"
      {...props}
      aria-required={required || undefined}
      type="tel"
      mask={phoneMask}
      value={cleanPhone(value)}
      onValueChange={onChange}
      message={pick(error, phoneError(value, { required }))}
      showError={showError}
    />
  );
}

/* --------------------------------------------------------------- CPF/CNPJ */

const cpfCnpjMask: MaskSpec = {
  clean: cleanCpfCnpj,
  format: formatCpfCnpj,
  caret: (raw, caret, formatted) => caretByDigits(raw, caret, formatted),
  significant: /\d/,
};

/** CPF (11 dígitos) ou CNPJ (14), detectado pelo tamanho; o valor é só dígitos. */
export function CnpjCpfInput({
  value,
  onChange,
  required = false,
  error,
  showError,
  ...props
}: NativeProps &
  ValidationProps & {
    value: string;
    onChange: (digits: string) => void;
    required?: boolean | undefined;
  }) {
  return (
    <MaskedInput
      inputMode="numeric"
      autoComplete="off"
      enterKeyHint="next"
      placeholder="00.000.000/0000-00"
      {...props}
      aria-required={required || undefined}
      mask={cpfCnpjMask}
      value={cleanCpfCnpj(value)}
      onValueChange={onChange}
      message={pick(error, cpfCnpjError(value, { required }))}
      showError={showError}
    />
  );
}

/* ---------------------------------------------------------------- inteiros */

/** Número inteiro só com dígitos, entre min e max (null = vazio). */
export function IntegerInput({
  value,
  onChange,
  min,
  max,
  required = true,
  error,
  showError,
  className,
  ...props
}: NativeProps &
  ValidationProps & {
    value: number | null;
    onChange: (value: number | null) => void;
    min: number;
    max: number;
    required?: boolean | undefined;
  }) {
  const mask: MaskSpec = {
    clean: (raw) => {
      const number = integerFromTyping(raw, max);
      return number === null ? "" : String(number);
    },
    format: (clean) => clean,
    caret: (raw, caret, formatted) => caretByDigits(raw, caret, formatted),
    significant: /\d/,
  };
  return (
    <MaskedInput
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="off"
      enterKeyHint="next"
      {...props}
      aria-required={required || undefined}
      className={cn("num", className)}
      mask={mask}
      value={value === null ? "" : String(value)}
      onValueChange={(clean) => onChange(clean === "" ? null : Number(clean))}
      message={pick(error, integerError(value, { min, max, required }))}
      showError={showError}
    />
  );
}

/* -------------------------------------------------------------- percentual */

/** Percentual com vírgula e uma casa decimal, sufixo "%". */
export function PercentInput({
  value,
  onChange,
  min = 0,
  max = SERVICE_CHARGE_MAX,
  error,
  showError,
  disabled,
  ...props
}: NativeProps &
  ValidationProps & {
    value: number | null;
    onChange: (value: number | null) => void;
    min?: number | undefined;
    max?: number | undefined;
  }) {
  // Texto local para permitir estados intermediários como "10,".
  const [text, setText] = useState(value === null ? "" : formatPercent(value));
  useEffect(() => {
    setText((current) =>
      parsePercent(current) === value ? current : value === null ? "" : formatPercent(value),
    );
  }, [value]);
  const mask: MaskSpec = {
    clean: (raw) => percentFromTyping(raw),
    format: (clean) => clean,
    caret: (raw, caret) => percentFromTyping(raw.slice(0, caret)).length,
    significant: /[\d,]/,
  };
  return (
    <MaskedInput
      inputMode="decimal"
      autoComplete="off"
      enterKeyHint="next"
      {...props}
      disabled={disabled}
      suffix="%"
      mask={mask}
      value={text}
      onValueChange={(clean) => {
        setText(clean);
        onChange(parsePercent(clean));
      }}
      message={disabled ? null : pick(error, percentError(value, { min, max }))}
      showError={showError}
    />
  );
}

/* ----------------------------------------------------------------- usuário */

/**
 * Usuário. No cadastro ("new"): minúsculo, sem acento e sem espaço, só
 * a-z 0-9 . _ - (3 a 30). No login: só minúsculo, para não barrar usuários antigos.
 */
export function UsernameInput({
  value,
  onChange,
  mode = "new",
  error,
  showError,
  ...props
}: NativeProps &
  ValidationProps & {
    value: string;
    onChange: (value: string) => void;
    mode?: "new" | "login" | undefined;
  }) {
  const clean = mode === "login" ? (raw: string) => raw.toLowerCase().trimStart() : cleanUsername;
  const mask: MaskSpec = {
    clean,
    format: (text) => text,
    caret: (raw, caret) => clean(raw.slice(0, caret)).length,
    significant: /./,
  };
  return (
    <MaskedInput
      autoComplete="username"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="next"
      maxLength={mode === "login" ? 60 : 30}
      {...props}
      mask={mask}
      value={value}
      onValueChange={onChange}
      message={pick(error, mode === "login" ? null : usernameError(value))}
      showError={showError}
    />
  );
}

/* --------------------------------------------------------------- Instagram */

/** "@usuario" do Instagram; colar o link do perfil extrai o usuário. */
export function InstagramInput({
  value,
  onChange,
  error,
  showError,
  ...props
}: NativeProps & ValidationProps & { value: string; onChange: (value: string) => void }) {
  const mask: MaskSpec = {
    clean: cleanInstagram,
    format: (text) => text,
    caret: (raw, caret) => cleanInstagram(raw.slice(0, caret)).length,
    significant: /[a-z0-9._]/,
  };
  return (
    <MaskedInput
      autoComplete="off"
      autoCapitalize="none"
      autoCorrect="off"
      spellCheck={false}
      enterKeyHint="next"
      placeholder="@restaurante"
      {...props}
      mask={mask}
      value={cleanInstagram(value)}
      onValueChange={onChange}
      message={pick(error, instagramError(value))}
      showError={showError}
    />
  );
}

/* ------------------------------------------------------------------- senha */

/**
 * Senha com botão mostrar/ocultar. "new" exige o mínimo do banco (6) e usa
 * autoComplete new-password; "current" (login) só usa current-password.
 */
export function PasswordInput({
  value,
  onChange,
  mode = "new",
  error,
  showError,
  className,
  onBlur,
  ...props
}: NativeProps &
  ValidationProps & {
    value: string;
    onChange: (value: string) => void;
    mode?: "new" | "current" | undefined;
  }) {
  const [visible, setVisible] = useState(false);
  const message = pick(error, mode === "new" ? passwordError(value) : null);
  const field = useFieldError(message, showError);
  return (
    <>
      <span className="relative block">
        <input
          autoComplete={mode === "new" ? "new-password" : "current-password"}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint={mode === "new" ? "next" : "go"}
          {...props}
          {...field.inputProps}
          type={visible ? "text" : "password"}
          className={cn("field pr-11", className)}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          onBlur={(event) => {
            field.markTouched();
            onBlur?.(event);
          }}
        />
        <button
          type="button"
          aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
          aria-pressed={visible}
          onClick={() => setVisible((current) => !current)}
          className="absolute right-1 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-ink"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </span>
      <FieldError id={field.errorId} message={field.visible} />
    </>
  );
}

/* ------------------------------------------------------------- texto livre */

/**
 * Texto livre sem máscara: sem espaço no começo, espaços repetidos juntados e
 * limite de caracteres. Com `counterFrom`, mostra "120/140" depois desse tamanho.
 * Quem salva ainda passa o texto por cleanText (aparar o fim).
 */
export function TextInput({
  value,
  onChange,
  maxLength,
  counterFrom,
  multiline = false,
  error,
  showError,
  className,
  onBlur,
  rows,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "maxLength"> &
  ValidationProps & {
    value: string;
    onChange: (value: string) => void;
    maxLength: number;
    counterFrom?: number | undefined;
    multiline?: boolean | undefined;
    rows?: number | undefined;
  }) {
  const field = useFieldError(error ?? null, showError);
  const common = {
    ...field.inputProps,
    maxLength,
    value,
    onBlur: (event: React.FocusEvent<HTMLInputElement & HTMLTextAreaElement>) => {
      field.markTouched();
      onBlur?.(event);
    },
    onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      onChange(typingText(event.target.value, maxLength, { multiline })),
  };
  const counter =
    counterFrom !== undefined && value.length > counterFrom ? (
      <span
        aria-live="polite"
        className={cn(
          "mt-1 block text-right text-xs",
          value.length >= maxLength ? "font-semibold text-destructive" : "text-muted-foreground",
        )}
      >
        {value.length}/{maxLength}
      </span>
    ) : null;
  return (
    <>
      {multiline ? (
        <textarea
          {...(props as React.TextareaHTMLAttributes<HTMLTextAreaElement>)}
          {...common}
          rows={rows}
          className={cn("field py-2", className)}
        />
      ) : (
        <input {...props} {...common} type="text" className={cn("field", className)} />
      )}
      {counter}
      <FieldError id={field.errorId} message={field.visible} />
    </>
  );
}
