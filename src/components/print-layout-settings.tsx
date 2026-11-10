import { useState, type ReactNode } from "react";
import { Btn, Field } from "@/components/ui-kit";
import { AppSelect } from "@/components/app-select";
import { Switch } from "@/components/ui/switch";
import { MaskedInput } from "@/components/masked-input";
import { decimalInput, parseDecimal } from "@/lib/masks";
import {
  COLUMN_OPTIONS,
  PRINT_PRESETS,
  columnsAtMost,
  imprimirCalibracao,
  layoutDefaults,
  presetOf,
  printErrorMessage,
  type FontSize,
  type PrinterConfig,
} from "@/lib/printing";

type Props = {
  config: PrinterConfig;
  update: (patch: Partial<PrinterConfig>) => void;
  disabled?: boolean;
};

const FONT_LABELS: Record<FontSize, string> = {
  pequeno: "Pequeno",
  medio: "Médio (padrão)",
  grande: "Grande",
};

function NumberInput({
  label,
  value,
  min,
  max,
  step = 1,
  hint,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  hint?: string;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    if (draft === null) return;
    const parsed = parseDecimal(draft);
    if (parsed !== null) onCommit(Math.max(min, Math.min(max, parsed)));
    setDraft(null);
  };
  return (
    <Field label={label} {...(hint ? { hint } : {})}>
      <MaskedInput
        mask="decimal"
        decimals={Number.isInteger(step) ? 0 : 1}
        max={max}
        value={draft ?? decimalInput(value)}
        onValueChange={setDraft}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") commit();
        }}
      />
    </Field>
  );
}

function Toggle({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (value: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex items-center gap-3 py-2 text-sm text-ink">
      <Switch checked={checked} onCheckedChange={onChange} />
      {children}
    </label>
  );
}

/** Perfil de largura (papel, área útil, colunas, ajuste fino) e calibração guiada. */
export function PrintLayoutSettings({ config, update, disabled: disabledProp }: Props) {
  const disabled = Boolean(disabledProp);
  const preset = presetOf(config);
  return (
    <div className="space-y-4">
      <Field label="Predefinição">
        <AppSelect
          className="field"
          ariaLabel="Predefinição de impressora"
          value={preset}
          disabled={disabled}
          onValueChange={(value) => {
            const chosen = PRINT_PRESETS.find((item) => item.id === value);
            if (chosen) {
              update({
                paperWidth: chosen.paperWidth,
                printableMm: chosen.printableMm,
                columns: chosen.columns,
              });
            }
          }}
          options={[
            ...PRINT_PRESETS.map((item) => ({ value: item.id, label: item.label })),
            { value: "personalizado", label: "Personalizado" },
          ]}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Papel">
          <AppSelect
            className="field"
            ariaLabel="Papel"
            value={String(config.paperWidth)}
            disabled={disabled}
            onValueChange={(value) => {
              const paperWidth = value === "58" ? 58 : 80;
              update({
                paperWidth,
                ...(layoutDefaults(paperWidth) as Pick<PrinterConfig, "printableMm" | "columns">),
              });
            }}
            options={[
              { value: "80", label: "80 mm" },
              { value: "58", label: "58 mm" },
            ]}
          />
        </Field>
        <NumberInput
          label="Área útil (mm)"
          value={config.printableMm}
          min={30}
          max={config.paperWidth}
          step={0.5}
          hint="Largura que a impressora realmente imprime."
          onCommit={(printableMm) => update({ printableMm })}
        />
        <Field label="Colunas (ESC/POS)">
          <AppSelect
            className="field"
            ariaLabel="Colunas"
            value={String(config.columns)}
            disabled={disabled}
            onValueChange={(value) =>
              update({ columns: Number(value) as PrinterConfig["columns"] })
            }
            options={COLUMN_OPTIONS.map((option) => ({
              value: String(option),
              label: `${option} colunas`,
            }))}
          />
        </Field>
        <Field label="Ajuste fino (mm)" hint="Negativo move para a esquerda.">
          <div className="flex items-center gap-2">
            <Btn
              size="sm"
              variant="outline"
              aria-label="Mover para a esquerda"
              disabled={disabled || config.offsetMm <= -5}
              onClick={() => update({ offsetMm: config.offsetMm - 0.5 })}
            >
              ←
            </Btn>
            <span className="min-w-12 text-center text-sm tabular-nums text-ink">
              {config.offsetMm > 0 ? "+" : ""}
              {config.offsetMm.toLocaleString("pt-BR")}
            </span>
            <Btn
              size="sm"
              variant="outline"
              aria-label="Mover para a direita"
              disabled={disabled || config.offsetMm >= 5}
              onClick={() => update({ offsetMm: config.offsetMm + 0.5 })}
            >
              →
            </Btn>
          </div>
        </Field>
        <Field label="Tamanho da fonte (navegador)">
          <AppSelect
            className="field"
            ariaLabel="Tamanho da fonte"
            value={config.fontSize}
            disabled={disabled}
            onValueChange={(value) => update({ fontSize: value as FontSize })}
            options={(Object.keys(FONT_LABELS) as FontSize[]).map((size) => ({
              value: size,
              label: FONT_LABELS[size],
            }))}
          />
        </Field>
        <Field label="Linhas antes do corte">
          <AppSelect
            className="field"
            ariaLabel="Linhas antes do corte"
            value={String(config.feedBeforeCut)}
            disabled={disabled}
            onValueChange={(value) => update({ feedBeforeCut: Number(value) })}
            options={[3, 4, 5, 6, 7, 8].map((lines) => ({
              value: String(lines),
              label: lines === 4 ? "4 (padrão)" : String(lines),
            }))}
          />
        </Field>
      </div>
      <Toggle checked={config.autoCut} onChange={(value) => update({ autoCut: value })}>
        Cortar o papel no final
      </Toggle>
      <Calibration config={config} update={update} disabled={disabled} />
    </div>
  );
}

type Step = "idle" | "perguntas" | "ajuste" | "pronto";

function Calibration({ config, update, disabled }: Props & { disabled: boolean }) {
  const [step, setStep] = useState<Step>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastMm, setLastMm] = useState("");
  const [lastChar, setLastChar] = useState("");
  const [arrowsOk, setArrowsOk] = useState<"sim" | "nao" | "">("");

  const print = async () => {
    setBusy(true);
    setError(null);
    try {
      await imprimirCalibracao();
      if (step === "idle" || step === "pronto") setStep("perguntas");
    } catch (cause) {
      setError(printErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const mm = parseDecimal(lastMm) ?? NaN;
    const chars = Number(lastChar);
    if (!Number.isFinite(mm) || mm < 30 || mm > config.paperWidth) {
      setError(`Informe o último número da régua em mm (entre 40 e ${config.paperWidth}).`);
      return;
    }
    if (!Number.isInteger(chars) || chars < 1) {
      setError("Informe a última posição da régua de caracteres que saiu inteira.");
      return;
    }
    if (!arrowsOk) {
      setError("Diga se as setas ESQUERDA e DIREITA saíram inteiras.");
      return;
    }
    setError(null);
    update({ printableMm: mm, columns: columnsAtMost(chars) });
    setStep(arrowsOk === "sim" ? "pronto" : "ajuste");
  };

  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Btn variant="outline" disabled={disabled || busy} onClick={() => void print()}>
          Calibrar impressora
        </Btn>
        <span className="text-xs text-muted-foreground">
          Imprime réguas para descobrir a largura real desta impressora.
        </span>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {error}
        </p>
      )}
      {step === "perguntas" && (
        <div className="mt-3 space-y-3">
          <Field label="1. Qual o último número da régua que apareceu inteiro?">
            <MaskedInput
              mask="decimal"
              decimals={1}
              max={config.paperWidth}
              placeholder="Ex.: 72"
              value={lastMm}
              onValueChange={setLastMm}
            />
          </Field>
          <Field
            label="2. Qual o último número da régua de caracteres que apareceu inteiro?"
            hint="Conte a posição usando a linha das dezenas acima da régua (ex.: 48)."
          >
            <MaskedInput
              mask="integer"
              maxDigits={3}
              placeholder="Ex.: 48"
              value={lastChar}
              onValueChange={setLastChar}
            />
          </Field>
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-ink">
              3. As setas ESQUERDA e DIREITA saíram inteiras?
            </legend>
            <div className="flex gap-4 text-sm">
              {(["sim", "nao"] as const).map((value) => (
                <label key={value} className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="setas"
                    checked={arrowsOk === value}
                    onChange={() => setArrowsOk(value)}
                  />
                  {value === "sim" ? "Sim" : "Não"}
                </label>
              ))}
            </div>
          </fieldset>
          <Btn onClick={save}>Salvar calibração</Btn>
        </div>
      )}
      {step === "ajuste" && (
        <div className="mt-3 space-y-2">
          <p className="text-sm text-ink">
            Mova o conteúdo para o lado que saiu cortado e imprima de novo até as duas setas saírem
            inteiras.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Btn
              size="sm"
              variant="outline"
              disabled={config.offsetMm <= -5}
              onClick={() => update({ offsetMm: config.offsetMm - 0.5 })}
            >
              ← mover
            </Btn>
            <span className="min-w-16 text-center text-sm tabular-nums">
              {config.offsetMm > 0 ? "+" : ""}
              {config.offsetMm.toLocaleString("pt-BR")} mm
            </span>
            <Btn
              size="sm"
              variant="outline"
              disabled={config.offsetMm >= 5}
              onClick={() => update({ offsetMm: config.offsetMm + 0.5 })}
            >
              mover →
            </Btn>
            <Btn size="sm" disabled={busy} onClick={() => void print()}>
              Imprimir de novo
            </Btn>
            <Btn size="sm" variant="success" onClick={() => setStep("pronto")}>
              Saiu certo
            </Btn>
          </div>
        </div>
      )}
      {step === "pronto" && (
        <p role="status" className="mt-3 text-sm font-semibold text-free">
          Impressora calibrada: área útil {config.printableMm.toLocaleString("pt-BR")} mm,{" "}
          {config.columns} colunas, ajuste {config.offsetMm.toLocaleString("pt-BR")} mm.
        </p>
      )}
    </div>
  );
}
