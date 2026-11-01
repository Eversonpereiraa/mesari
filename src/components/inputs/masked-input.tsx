import {
  useId,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type InputHTMLAttributes,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";

/** Props comuns dos campos: o erro só aparece depois de sair do campo ou ao tentar salvar. */
export type ValidationProps = {
  /** Erro extra vindo da tela (ex.: mesa repetida); tem prioridade sobre o da máscara. */
  error?: string | null | undefined;
  /** true depois de uma tentativa de salvar: mostra o erro mesmo sem ter saído do campo. */
  showError?: boolean | undefined;
};

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange" | "type">;

export function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <span id={id} role="alert" className="mt-1 block text-xs font-medium text-destructive">
      {message}
    </span>
  );
}

/** Controla "tocado" (saiu do campo) e liga o erro ao input por aria-describedby. */
export function useFieldError(message: string | null, showError = false) {
  const id = useId();
  const [touched, setTouched] = useState(false);
  const visible = (touched || showError) && message ? message : null;
  return {
    errorId: `${id}-erro`,
    visible,
    markTouched: () => setTouched(true),
    inputProps: {
      "aria-invalid": visible ? true : undefined,
      "aria-describedby": visible ? `${id}-erro` : undefined,
    } as const,
  };
}

/**
 * Descreve uma máscara: como limpar o texto digitado, como formatar o valor
 * limpo e onde o cursor deve ficar depois de reformatar.
 */
export type MaskSpec = {
  /** Texto digitado/colado → valor limpo, ou null para recusar a alteração (ex.: passou do máximo). */
  clean: (raw: string) => string | null;
  format: (clean: string) => string;
  caret: (raw: string, caret: number, formatted: string) => number;
  /** Caracteres que fazem parte do valor (os demais são separadores da máscara). */
  significant: RegExp;
};

/**
 * Input com máscara. Mantém o cursor no lugar ao apagar ou digitar no meio,
 * aceita colar e, se o usuário apagar só um separador (ex.: o hífen), apaga
 * também o caractere ao lado para o campo não "travar".
 */
export function MaskedInput({
  value,
  onValueChange,
  mask,
  type = "text",
  className,
  message,
  showError,
  onBlur,
  onPaste,
  prefix,
  suffix,
  wrapperClassName,
  ...props
}: NativeProps & {
  value: string;
  onValueChange: (clean: string) => void;
  mask: MaskSpec;
  type?: "text" | "tel" | "password" | undefined;
  /** Erro já calculado (máscara + tela). */
  message: string | null;
  showError?: boolean | undefined;
  prefix?: ReactNode;
  suffix?: ReactNode;
  wrapperClassName?: string | undefined;
  onPaste?: ((event: ClipboardEvent<HTMLInputElement>) => void) | undefined;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const pendingCaret = useRef<number | null>(null);
  const [, rerender] = useReducer((count: number) => count + 1, 0);
  const display = mask.format(value);
  const { errorId, visible, markTouched, inputProps } = useFieldError(message, showError);

  useLayoutEffect(() => {
    const input = ref.current;
    const caret = pendingCaret.current;
    pendingCaret.current = null;
    if (input && caret !== null && document.activeElement === input) {
      const position = Math.max(0, Math.min(caret, input.value.length));
      input.setSelectionRange(position, position);
    }
  });

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    let raw = event.target.value;
    let caret = event.target.selectionStart ?? raw.length;
    const inputType = (event.nativeEvent as InputEvent).inputType ?? "";
    // Apagou só um separador: apaga também o caractere de verdade ao lado.
    if (
      inputType.startsWith("delete") &&
      raw.length < display.length &&
      mask.clean(raw) === value
    ) {
      const backward = inputType === "deleteContentBackward";
      let index = backward ? caret - 1 : caret;
      while (index >= 0 && index < raw.length && !mask.significant.test(raw.charAt(index))) {
        index += backward ? -1 : 1;
      }
      if (index >= 0 && index < raw.length) {
        raw = raw.slice(0, index) + raw.slice(index + 1);
        caret = backward ? index : caret;
      }
    }
    const next = mask.clean(raw);
    if (next === null) {
      // Recusado: volta o texto anterior com o cursor onde estava.
      pendingCaret.current = Math.max(0, caret - (raw.length - display.length));
      rerender();
      return;
    }
    pendingCaret.current = mask.caret(raw, caret, mask.format(next));
    if (next === value) rerender();
    else onValueChange(next);
  };

  const input = (
    <input
      {...props}
      {...inputProps}
      ref={ref}
      type={type}
      className={cn("field", prefix && "pl-10", suffix && "pr-10", className)}
      value={display}
      onChange={handleChange}
      onPaste={onPaste}
      onBlur={(event) => {
        markTouched();
        onBlur?.(event);
      }}
    />
  );

  return (
    <>
      {prefix || suffix ? (
        <span className={cn("relative block", wrapperClassName)}>
          {prefix && (
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {prefix}
            </span>
          )}
          {input}
          {suffix && (
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
              {suffix}
            </span>
          )}
        </span>
      ) : (
        input
      )}
      <FieldError id={errorId} message={visible} />
    </>
  );
}
