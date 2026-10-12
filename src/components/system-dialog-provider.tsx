import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

type ConfirmOptions = {
  title: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  variant?: "default" | "danger";
};

type PromptOptions = {
  title: string;
  description?: ReactNode;
  label?: string;
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  multiline?: boolean;
  quickOptions?: string[];
  variant?: "default" | "danger";
  confirmText?: string;
  cancelText?: string;
};

type Request =
  { kind: "confirm"; options: ConfirmOptions } | { kind: "prompt"; options: PromptOptions };

type DialogContextValue = {
  confirmar: (options: ConfirmOptions) => Promise<boolean>;
  pedirTexto: (options: PromptOptions) => Promise<string | null>;
};

const DialogContext = createContext<DialogContextValue | null>(null);

export function useConfirm() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useConfirm deve ser usado dentro de SystemDialogProvider.");
  return context.confirmar;
}

export function usePrompt() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("usePrompt deve ser usado dentro de SystemDialogProvider.");
  return context.pedirTexto;
}

export function SystemDialogProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<Request | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptError, setPromptError] = useState("");
  const resolver = useRef<((result: boolean | string | null) => void) | null>(null);
  const safeButtonRef = useRef<HTMLButtonElement>(null);
  const promptInputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  const confirmar = useCallback((options: ConfirmOptions) => {
    if (resolver.current) resolver.current(false);
    setPromptError("");
    setRequest({ kind: "confirm", options });
    return new Promise<boolean>((resolve) => {
      resolver.current = (result) => resolve(result === true);
    });
  }, []);

  const pedirTexto = useCallback((options: PromptOptions) => {
    if (resolver.current) resolver.current(null);
    setPromptValue("");
    setPromptError("");
    setRequest({ kind: "prompt", options });
    return new Promise<string | null>((resolve) => {
      resolver.current = (result) => resolve(typeof result === "string" ? result : null);
    });
  }, []);

  const finish = (result: boolean | string | null) => {
    resolver.current?.(result);
    resolver.current = null;
    setRequest(null);
    setPromptError("");
    document.body.style.pointerEvents = "";
    document.body.style.overflow = "";
  };

  const submitPrompt = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (request?.kind !== "prompt") return;
    const value = promptValue.trim();
    if (request.options.required && !value) {
      setPromptError("Este campo é obrigatório.");
      promptInputRef.current?.focus();
      return;
    }
    finish(value);
  };

  const isOpen = request !== null;
  const isConfirm = request?.kind === "confirm";

  return (
    <DialogContext.Provider value={{ confirmar, pedirTexto }}>
      {children}
      <Dialog
        open={isOpen}
        onOpenChange={(open) => {
          if (!open) finish(isConfirm ? false : null);
        }}
      >
        <DialogContent
          className="max-h-[90dvh] overflow-y-auto rounded-2xl border-border bg-card text-ink sm:max-w-md"
          onKeyDown={(event) => {
            if (isConfirm && event.key === "Enter") {
              event.preventDefault();
              finish(true);
            }
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            if (isConfirm) safeButtonRef.current?.focus();
            else promptInputRef.current?.focus();
          }}
        >
          {request?.kind === "confirm" ? (
            <>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">{request.options.title}</DialogTitle>
                {request.options.description && (
                  <DialogDescription>{request.options.description}</DialogDescription>
                )}
              </DialogHeader>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  ref={safeButtonRef}
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => finish(false)}
                >
                  {request.options.cancelText ?? "Cancelar"}
                </Button>
                <Button
                  type="button"
                  variant={request.options.variant === "danger" ? "destructive" : "default"}
                  className="rounded-xl"
                  onClick={() => finish(true)}
                >
                  {request.options.confirmText ?? "Confirmar"}
                </Button>
              </DialogFooter>
            </>
          ) : request?.kind === "prompt" ? (
            <form onSubmit={submitPrompt}>
              <DialogHeader>
                <DialogTitle className="font-display text-xl">{request.options.title}</DialogTitle>
                {request.options.description && (
                  <DialogDescription>{request.options.description}</DialogDescription>
                )}
              </DialogHeader>
              <div className="my-5 space-y-2">
                {request.options.label && (
                  <label htmlFor="system-prompt-value" className="text-sm font-medium text-ink">
                    {request.options.label}
                    {request.options.required && " *"}
                  </label>
                )}
                {request.options.multiline ? (
                  <Textarea
                    id="system-prompt-value"
                    ref={promptInputRef as React.RefObject<HTMLTextAreaElement>}
                    value={promptValue}
                    maxLength={request.options.maxLength}
                    placeholder={request.options.placeholder}
                    aria-invalid={Boolean(promptError)}
                    aria-describedby={promptError ? "system-prompt-error" : undefined}
                    className="min-h-24 rounded-xl"
                    onChange={(event) => {
                      setPromptValue(event.target.value);
                      setPromptError("");
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && event.ctrlKey) {
                        event.preventDefault();
                        event.currentTarget.form?.requestSubmit();
                      }
                    }}
                  />
                ) : (
                  <Input
                    id="system-prompt-value"
                    ref={promptInputRef as React.RefObject<HTMLInputElement>}
                    value={promptValue}
                    maxLength={request.options.maxLength}
                    placeholder={request.options.placeholder}
                    aria-invalid={Boolean(promptError)}
                    aria-describedby={promptError ? "system-prompt-error" : undefined}
                    className="h-10 rounded-xl"
                    onChange={(event) => {
                      setPromptValue(event.target.value);
                      setPromptError("");
                    }}
                  />
                )}
                {request.options.quickOptions && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {request.options.quickOptions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => {
                          setPromptValue(option === "Outro" ? "" : option);
                          setPromptError("");
                          if (option === "Outro") promptInputRef.current?.focus();
                        }}
                        className={cn(
                          "min-h-9 rounded-full border px-3 text-xs font-medium transition-colors",
                          promptValue === option
                            ? "border-primary bg-primary text-primary-foreground"
                            : "bg-background text-muted-foreground hover:bg-accent hover:text-ink",
                        )}
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}
                {promptError && (
                  <p id="system-prompt-error" role="alert" className="text-sm text-destructive">
                    {promptError}
                  </p>
                )}
              </div>
              <DialogFooter className="gap-2 sm:gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="rounded-xl"
                  onClick={() => finish(null)}
                >
                  {request.options.cancelText ?? "Cancelar"}
                </Button>
                <Button
                  type="submit"
                  variant={request.options.variant === "danger" ? "destructive" : "default"}
                  className="rounded-xl"
                >
                  {request.options.confirmText ?? "Confirmar"}
                </Button>
              </DialogFooter>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </DialogContext.Provider>
  );
}
