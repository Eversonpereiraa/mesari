import { useState, useSyncExternalStore } from "react";
import { CheckCircle2, Printer, X } from "lucide-react";
import { Btn } from "@/components/ui-kit";
import { DesktopPrinterConnection } from "@/components/desktop-printer-connection";
import { useStore } from "@/lib/store";
import {
  getPrinterStatus,
  imprimirTeste,
  loadConfig,
  printErrorMessage,
  subscribeConfig,
  subscribePrinterStatus,
  updateConfig,
  verificarImpressora,
} from "@/lib/printing";

/** Uma vez por computador: "concluido" (saiu certinho) ou "adiado" (Agora não). */
export const WIZARD_KEY = "mesari-assistente-impressora";

function readChoice() {
  try {
    return localStorage.getItem(WIZARD_KEY);
  } catch {
    return null;
  }
}

function saveChoice(value: "concluido" | "adiado") {
  try {
    localStorage.setItem(WIZARD_KEY, value);
  } catch {
    // Sem armazenamento: o assistente volta na próxima abertura, sem prejuízo.
  }
}

type Step = "escolher" | "testar" | "confirmar" | "pronto";

/**
 * App desktop, caixa, sem impressora configurada ou funcionando: guia em 3 passos (escolher,
 * imprimir teste, confirmar). Só fica concluído quando o usuário diz que a folha saiu certa.
 */
export function PrinterSetupWizard() {
  const restaurantName = useStore((s) => s.restaurant.name);
  const printer = useSyncExternalStore(subscribePrinterStatus, getPrinterStatus, getPrinterStatus);
  const config = useSyncExternalStore(subscribeConfig, loadConfig, loadConfig);
  const [choice, setChoice] = useState(readChoice);
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>("escolher");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Abre sozinho só depois da verificação real dizer que não há impressora funcionando.
  const needed = printer.verified && !printer.connected;
  if (!open && (choice !== null || !needed)) return null;

  const close = (value: "concluido" | "adiado") => {
    saveChoice(value);
    setChoice(value);
    setOpen(false);
  };
  if (!open) setOpen(true);

  const run = async (action: () => Promise<string | void>) => {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(printErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const testPrint = () =>
    run(async () => {
      const status = await verificarImpressora();
      if (!status.reachable) throw new Error(status.error ?? "A impressora não respondeu.");
      await imprimirTeste(restaurantName || "Mesari");
      setStep("confirmar");
    });

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
      role="presentation"
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="assistente-impressora-titulo"
        className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border bg-card shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b p-5">
          <div>
            <h2
              id="assistente-impressora-titulo"
              className="flex items-center gap-2 font-display text-lg font-bold text-ink"
            >
              <Printer className="h-5 w-5 text-primary" aria-hidden />
              Configurar a impressora
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {step === "escolher" && "Passo 1 de 3 · Escolha a impressora deste computador."}
              {step === "testar" && "Passo 2 de 3 · Imprima uma folha de teste."}
              {step === "confirmar" && "Passo 3 de 3 · Confira a folha."}
              {step === "pronto" && "Tudo certo!"}
            </p>
          </div>
          {step !== "pronto" && (
            <button
              type="button"
              aria-label="Agora não"
              className="rounded-lg p-2 text-muted-foreground hover:bg-muted"
              onClick={() => close("adiado")}
            >
              <X className="h-5 w-5" />
            </button>
          )}
        </header>

        <div className="space-y-4 overflow-y-auto p-5">
          {step === "escolher" && (
            <>
              <DesktopPrinterConnection
                config={config}
                update={updateConfig}
                busy={busy}
                run={run}
              />
              {printer.error && (
                <p className="text-sm text-destructive">Situação atual: {printer.error}</p>
              )}
            </>
          )}
          {step === "testar" && (
            <p className="text-sm text-ink">
              Vamos mandar uma folha curta para a impressora escolhida. Confira se ela está ligada e
              com papel.
            </p>
          )}
          {step === "confirmar" && (
            <p className="text-base font-semibold text-ink">
              Saiu certinho? O texto ficou inteiro, sem cortar nas bordas e sem caracteres
              estranhos?
            </p>
          )}
          {step === "pronto" && (
            <p className="flex items-center gap-2 text-sm text-ink">
              <CheckCircle2 className="h-5 w-5 text-free" aria-hidden />A impressora está pronta. As
              comandas vão sair sozinhas por aqui.
            </p>
          )}
          {error && (
            <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
              {error}
            </p>
          )}
        </div>

        <footer className="flex flex-wrap justify-end gap-2 border-t p-4">
          {step === "escolher" && (
            <>
              <Btn variant="outline" onClick={() => close("adiado")}>
                Agora não
              </Btn>
              <Btn disabled={busy} onClick={() => setStep("testar")}>
                Continuar
              </Btn>
            </>
          )}
          {step === "testar" && (
            <>
              <Btn variant="outline" disabled={busy} onClick={() => setStep("escolher")}>
                Voltar
              </Btn>
              <Btn disabled={busy} onClick={() => void testPrint()}>
                {busy ? "Imprimindo..." : "Imprimir teste"}
              </Btn>
            </>
          )}
          {step === "confirmar" && (
            <>
              <Btn
                variant="outline"
                onClick={() => {
                  setError(
                    "Escolha outra impressora ou forma de conexão e tente de novo. Se cortou nas bordas, ajuste a largura em Impressão depois.",
                  );
                  setStep("escolher");
                }}
              >
                Não
              </Btn>
              <Btn
                variant="success"
                onClick={() => {
                  saveChoice("concluido");
                  setStep("pronto");
                }}
              >
                Sim, saiu certinho
              </Btn>
            </>
          )}
          {step === "pronto" && (
            <Btn variant="success" onClick={() => close("concluido")}>
              Fechar
            </Btn>
          )}
        </footer>
      </section>
    </div>
  );
}
