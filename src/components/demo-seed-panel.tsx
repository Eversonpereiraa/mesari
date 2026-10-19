import { useState } from "react";
import { Sparkles } from "lucide-react";
import { Btn } from "@/components/ui-kit";
import { usePrompt } from "@/components/system-dialog-provider";
import { demoSeedAvailability, seedDemoRestaurant } from "@/lib/demo-seed";
import { errorMessage, refreshData } from "@/lib/store";

const CONFIRM_WORD = "mesari-teste";

/**
 * Botão do modo demonstração (?demo=1, só caixa): monta o "Restaurante Sabor do
 * Agreste" para prints e vendas. Só libera no projeto mesari-teste e pede para
 * digitar o nome do projeto antes de apagar o salão e o cardápio atuais.
 */
export function DemoSeedPanel() {
  const pedirTexto = usePrompt();
  const availability = demoSeedAvailability();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ ok: boolean; text: string; warnings?: string[] } | null>(
    null,
  );

  const run = async () => {
    const answer = await pedirTexto({
      title: "Montar restaurante de demonstração?",
      description: (
        <span>
          Isto <strong>apaga o salão, o cardápio e o delivery em aberto</strong> deste projeto e
          cria o Restaurante Sabor do Agreste com 17 mesas, vendas do dia e pedidos de delivery.
          Digite <strong>{CONFIRM_WORD}</strong> para confirmar.
        </span>
      ),
      label: "Nome do projeto",
      placeholder: CONFIRM_WORD,
      required: true,
      maxLength: 40,
      confirmText: "Montar demonstração",
      variant: "danger",
    });
    if (answer === null) return;
    if (answer.trim().toLowerCase() !== CONFIRM_WORD) {
      setResult({ ok: false, text: `Nada foi alterado: era preciso digitar "${CONFIRM_WORD}".` });
      return;
    }
    setRunning(true);
    setResult(null);
    try {
      const { warnings } = await seedDemoRestaurant(setProgress);
      await refreshData();
      setResult({ ok: true, text: "Demonstração pronta.", warnings });
    } catch (cause) {
      setResult({ ok: false, text: `Parou em: ${errorMessage(cause)}` });
    } finally {
      setRunning(false);
      setProgress("");
    }
  };

  return (
    <section className="mt-5 space-y-3 rounded-lg border border-dashed bg-card p-6">
      <div>
        <h2 className="font-display text-lg font-bold text-ink">Restaurante de demonstração</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Monta o Restaurante Sabor do Agreste (Surubim-PE) para prints e apresentações. Garçons de
          demonstração: demo.joao, demo.maria e demo.severino.
        </p>
      </div>
      {!availability.ok && (
        <p role="alert" className="text-sm text-destructive">
          {availability.reason}
        </p>
      )}
      <Btn
        type="button"
        variant="outline"
        disabled={!availability.ok || running}
        onClick={() => void run()}
      >
        <Sparkles className="h-4 w-4" />
        {running ? `Montando... ${progress}` : "Montar demonstração"}
      </Btn>
      {result && (
        <div
          role={result.ok ? "status" : "alert"}
          className={`text-sm ${result.ok ? "text-free" : "text-destructive"}`}
        >
          {result.text}
          {result.warnings?.map((warning) => (
            <p key={warning} className="mt-1 text-muted-foreground">
              {warning}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
