import { useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Banknote,
  Minus,
  Plus,
  Printer,
  ReceiptText,
  RotateCw,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MaskedInput } from "@/components/masked-input";
import {
  brl,
  type AreaKind,
  type ElementKind,
  type FloorArea,
  type FloorElement,
  type OrderLine,
  type TableShape,
} from "@/lib/store";
import { Btn } from "@/components/ui-kit";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ELEMENT_LABEL, MIN_AREA_SIZE, isWallElement } from "./areas";

const ELEMENT_KINDS: ElementKind[] = ["balcao", "porta", "janela", "caixa", "cozinha"];
import { COLORS, MAX_SEATS, MIN_SEATS, tableNumber, type Mesa, type StatusMesa } from "./iso";
import { LONG_OPEN_MINUTES, formatDuration, minutesSince, type LiveInfo } from "./useSalao";

export function PanelCard({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <aside
      className={cn(
        "flex min-w-0 flex-col gap-4 rounded-[14px] border bg-card p-5 shadow-sm",
        className,
      )}
    >
      {children}
    </aside>
  );
}

export function StatusPill({ status }: { status: StatusMesa }) {
  const c = COLORS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold"
      style={{ background: c.top, color: c.stroke }}
    >
      <span className="h-2 w-2 rounded-full" style={{ background: c.stroke }} />
      {c.label}
    </span>
  );
}

function PanelHeader({
  title,
  aside,
  onClose,
}: {
  title: string;
  aside?: ReactNode;
  onClose?: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2.5">
        <h2 className="font-display text-xl font-extrabold text-ink">{title}</h2>
        {aside}
      </div>
      {onClose && (
        <Btn variant="ghost" size="sm" aria-label="Fechar painel" onClick={onClose}>
          <X className="h-4 w-4" />
        </Btn>
      )}
    </div>
  );
}

const Row = ({ label, value }: { label: string; value: ReactNode }) => (
  <div className="flex justify-between gap-3 text-sm">
    <span className="text-muted-foreground">{label}</span>
    <b className="num text-ink">{value}</b>
  </div>
);

export function LiveEmptyPanel() {
  return (
    <PanelCard>
      <h2 className="font-display text-xl font-extrabold text-ink">Toque numa mesa</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        O mapa mostra o salão em tempo real. Toque numa mesa para ver o pedido, o tempo de ocupação
        e o valor em aberto.
      </p>
    </PanelCard>
  );
}

export function LiveTablePanel({
  table,
  info,
  now,
  amountDue,
  serviceCharge,
  billFailed,
  billOutdated,
  reprinting,
  onClose,
  onAddItem,
  onRequestBill,
  onReprint,
  onReceivePayment,
  onRemoveLine,
}: {
  table: Mesa;
  info: LiveInfo;
  now: number;
  amountDue: number;
  serviceCharge: number;
  /** A nota de consumo não saiu na impressora deste caixa. */
  billFailed: boolean;
  /** Entraram itens depois da última nota impressa. */
  billOutdated: boolean;
  reprinting: boolean;
  onClose: () => void;
  onAddItem: () => void;
  onRequestBill: () => void;
  onReprint: () => void;
  onReceivePayment: () => void;
  onRemoveLine: (line: OrderLine) => void;
}) {
  const { status, lines } = info;
  const minutes = minutesSince(info.since, now);
  const longOpen = status !== "livre" && minutes >= LONG_OPEN_MINUTES;
  return (
    <PanelCard>
      <PanelHeader
        title={`Mesa ${tableNumber(table.number)}`}
        aside={<StatusPill status={status} />}
        onClose={onClose}
      />
      {longOpen && (
        <Notice tone="danger">
          <strong>Aberta há muito tempo</strong> ({formatDuration(minutes)}). Confira se a conta
          não ficou esquecida.
        </Notice>
      )}
      {status === "conta" && billFailed && (
        <Notice tone="danger">
          <strong>Nota não impressa.</strong> Verifique a impressora e toque em “Reimprimir
          nota”.
        </Notice>
      )}
      {billOutdated && (
        <Notice tone="warning">
          <strong>Nota desatualizada:</strong> entraram itens depois da nota impressa. Peça a
          conta de novo para imprimir a nota certa.
        </Notice>
      )}
      <div className="flex flex-col gap-2">
        <Row label="Lugares" value={table.seats} />
        <Row label="Ocupada há" value={status === "livre" ? "—" : formatDuration(minutes)} />
        <Row label="Total em aberto" value={brl(amountDue)} />
        {serviceCharge > 0 && (
          <div className="-mt-1 flex justify-between text-xs text-muted-foreground">
            <span>Inclui taxa de serviço</span>
            <span>{brl(serviceCharge)}</span>
          </div>
        )}
      </div>
      {lines.length ? (
        <ul className="flex max-h-[42vh] flex-col gap-2 overflow-y-auto border-t border-dashed pt-3 text-sm">
          {lines.map((line) => (
            <li key={line.id}>
              <div className="flex justify-between gap-2">
                <span className="text-ink">
                  {line.qty}× {line.name}
                </span>
                <span className="num whitespace-nowrap font-medium text-ink">
                  {brl(line.qty * line.price)}
                </span>
              </div>
              {line.note && (
                <div className="pl-3.5 text-xs text-muted-foreground">obs: {line.note}</div>
              )}
              <button
                aria-label={`Remover ${line.qty}x ${line.name}`}
                className="mt-0.5 inline-flex min-h-8 items-center gap-1 rounded-md px-2 text-xs font-semibold text-destructive hover:bg-destructive/10"
                onClick={() => onRemoveLine(line)}
              >
                <Trash2 className="h-3 w-3" /> Remover
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Utensils className="h-4 w-4 text-primary" />
          Nenhum pedido lançado.
        </p>
      )}
      <div className="grid gap-2">
        {status === "livre" && (
          <Btn size="lg" className="w-full" onClick={onAddItem}>
            <Plus className="h-5 w-5" />
            Lançar pedido
          </Btn>
        )}
        {status === "ocupada" && (
          <>
            <Btn size="lg" className="w-full" onClick={onAddItem}>
              <Plus className="h-5 w-5" />
              Adicionar item
            </Btn>
            <Btn
              size="lg"
              variant="outline"
              className="w-full"
              disabled={!lines.length}
              onClick={onRequestBill}
            >
              <ReceiptText className="h-5 w-5" />
              Pedir conta
            </Btn>
          </>
        )}
        {status === "conta" && (
          <>
            <Btn
              size="lg"
              variant="outline"
              className="w-full"
              disabled={reprinting}
              onClick={onReprint}
            >
              <Printer className="h-5 w-5" />
              {reprinting ? "Reimprimindo..." : "Reimprimir nota"}
            </Btn>
            <Btn size="lg" variant="outline" className="w-full" onClick={onAddItem}>
              <Plus className="h-5 w-5" />
              Adicionar item
            </Btn>
          </>
        )}
        {status !== "livre" && (
          <Btn
            size="lg"
            variant="success"
            className="w-full"
            disabled={!lines.length}
            onClick={onReceivePayment}
          >
            <Banknote className="h-5 w-5" />
            Receber pagamento
          </Btn>
        )}
      </div>
      {status === "ocupada" && lines.length > 0 && (
        <p className="-mt-1 text-xs text-muted-foreground">
          “Pedir conta” imprime a nota de consumo no caixa.
        </p>
      )}
    </PanelCard>
  );
}

function Notice({ tone, children }: { tone: "danger" | "warning"; children: ReactNode }) {
  return (
    <div
      role="status"
      className={cn(
        "flex gap-2 rounded-lg px-3 py-2.5 text-xs leading-relaxed",
        tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-bill-bg text-ink",
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

export function AddElementMenu({
  onAdd,
  disabled,
  className,
}: {
  onAdd: (kind: ElementKind) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild disabled={disabled}>
        <Btn size="sm" variant="outline" className={className}>
          <Plus className="h-4 w-4" />
          Elemento
        </Btn>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {ELEMENT_KINDS.map((kind) => (
          <DropdownMenuItem key={kind} onSelect={() => onAdd(kind)}>
            {ELEMENT_LABEL[kind]}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function EditEmptyPanel({
  onAddTable,
  onAddArea,
  onAddElement,
  busy,
  areasAvailable,
}: {
  onAddTable: () => void;
  onAddArea: () => void;
  onAddElement: (kind: ElementKind) => void;
  busy: boolean;
  areasAvailable: boolean;
}) {
  return (
    <PanelCard>
      <h2 className="font-display text-xl font-extrabold text-ink">Layout do salão</h2>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Monte o espaço do jeito real do restaurante: crie áreas (salão, varanda, calçada, área
        externa...), arraste as mesas para dentro delas e posicione balcão, porta, caixa e cozinha.
      </p>
      <div className="grid gap-2">
        <Btn className="w-full" onClick={onAddTable} disabled={busy}>
          <Plus className="h-4 w-4" />
          Adicionar mesa
        </Btn>
        <div className="grid grid-cols-2 gap-2">
          <Btn variant="outline" onClick={onAddArea} disabled={busy || !areasAvailable}>
            <Plus className="h-4 w-4" />
            Área
          </Btn>
          <AddElementMenu
            onAdd={onAddElement}
            disabled={busy || !areasAvailable}
            className="h-10"
          />
        </div>
      </div>
      {!areasAvailable && (
        <p role="status" className="rounded-md bg-bill-bg px-3 py-2 text-xs text-ink">
          Para criar áreas e elementos, aplique a migration 202611030002_salao_areas.sql no
          Supabase.
        </p>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground">
        Toque numa área para editar ou redimensionar. Arraste o fundo para mover a visão; use a
        pinça ou a roda do mouse para o zoom. Tudo é salvo automaticamente.
      </p>
    </PanelCard>
  );
}

/** Campo numérico com − e +; aceita vírgula e só confirma no Enter ou ao sair do campo. */
function NumberStepper({
  id,
  label,
  value,
  step,
  min,
  max,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  step: number;
  min: number;
  max: number;
  onCommit: (value: number) => void;
}) {
  const format = (n: number) => String(n).replace(".", ",");
  const [draft, setDraft] = useState(format(value));
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(format(value));
  }
  const commit = (raw: string) => {
    const n = Number(raw.replace(",", "."));
    if (!raw.trim() || !Number.isFinite(n)) {
      setDraft(format(value));
      return;
    }
    const snapped = Math.min(max, Math.max(min, Math.round(n / step) * step));
    if (snapped !== value) onCommit(snapped);
    else setDraft(format(value));
  };
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <Btn
          variant="outline"
          className="h-10 w-10 shrink-0 px-0"
          aria-label={`Diminuir ${label.toLowerCase()}`}
          disabled={value <= min}
          onClick={() => onCommit(Math.max(min, value - step))}
        >
          <Minus className="h-4 w-4" />
        </Btn>
        <MaskedInput
          mask="decimal"
          id={id}
          className="field num w-20 text-center"
          decimals={Number.isInteger(step) ? 0 : 1}
          max={max}
          value={draft}
          onValueChange={setDraft}
          onBlur={() => commit(draft)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit(draft);
          }}
        />
        <Btn
          variant="outline"
          className="h-10 w-10 shrink-0 px-0"
          aria-label={`Aumentar ${label.toLowerCase()}`}
          disabled={value >= max}
          onClick={() => onCommit(Math.min(max, value + step))}
        >
          <Plus className="h-4 w-4" />
        </Btn>
      </div>
    </div>
  );
}

const areaKinds: [AreaKind, string][] = [
  ["interna", "Interna"],
  ["externa", "Externa"],
];

export function AreaPanel({
  area,
  nameDraft,
  tableCount,
  error,
  onNameChange,
  onKind,
  onSize,
  onDelete,
  onClose,
}: {
  area: FloorArea;
  nameDraft: string;
  tableCount: number;
  error: string;
  onNameChange: (value: string) => void;
  onKind: (kind: AreaKind) => void;
  onSize: (width: number, depth: number) => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <PanelCard>
      <PanelHeader
        title={area.name || "Área"}
        aside={
          <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold text-muted-foreground">
            {tableCount} {tableCount === 1 ? "mesa" : "mesas"}
          </span>
        }
        onClose={onClose}
      />
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Nome</span>
        <MaskedInput
          mask="name"
          autoComplete="off"
          value={nameDraft}
          maxLength={40}
          placeholder="Ex.: Varanda, Calçada, Piscina"
          onValueChange={onNameChange}
        />
      </label>
      <Seg label="Tipo" options={areaKinds} value={area.kind} onChange={onKind} />
      <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 min-[981px]:grid-cols-1 xl:grid-cols-2">
        <NumberStepper
          id="salao-area-largura"
          label="Largura"
          value={area.width}
          step={0.5}
          min={MIN_AREA_SIZE}
          max={60}
          onCommit={(width) => onSize(width, area.depth)}
        />
        <NumberStepper
          id="salao-area-profundidade"
          label="Profundidade"
          value={area.depth}
          step={0.5}
          min={MIN_AREA_SIZE}
          max={60}
          onCommit={(depth) => onSize(area.width, depth)}
        />
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <Btn variant="outline" className="w-fit text-destructive" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
        Excluir área
      </Btn>
      <p className="text-xs leading-relaxed text-muted-foreground">
        No mapa, puxe as bolinhas dos cantos para mudar o tamanho e use “Mover” para mudar a área de
        lugar (as mesas vão junto).
      </p>
    </PanelCard>
  );
}

export function ElementPanel({
  element,
  error,
  onSize,
  onRotate,
  onDelete,
  onClose,
}: {
  element: FloorElement;
  error: string;
  onSize: (width: number, depth: number) => void;
  onRotate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const wall = isWallElement(element.kind);
  return (
    <PanelCard>
      <PanelHeader title={ELEMENT_LABEL[element.kind]} onClose={onClose} />
      {wall ? (
        <NumberStepper
          id="salao-elemento-comprimento"
          label="Comprimento"
          value={element.width}
          step={0.5}
          min={0.5}
          max={20}
          onCommit={(width) => onSize(width, element.depth)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2 min-[981px]:grid-cols-1 xl:grid-cols-2">
          <NumberStepper
            id="salao-elemento-largura"
            label="Largura"
            value={element.width}
            step={0.5}
            min={0.5}
            max={20}
            onCommit={(width) => onSize(width, element.depth)}
          />
          <NumberStepper
            id="salao-elemento-profundidade"
            label="Profundidade"
            value={element.depth}
            step={0.5}
            min={0.5}
            max={20}
            onCommit={(depth) => onSize(element.width, depth)}
          />
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!wall && (
          <Btn variant="outline" onClick={onRotate}>
            <RotateCw className="h-4 w-4" />
            Girar
          </Btn>
        )}
        <Btn variant="outline" className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Excluir
        </Btn>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        {wall
          ? "Arraste no mapa: ela desliza pelas paredes do fundo das áreas internas."
          : "Arraste no mapa para mudar de lugar, dentro de qualquer área."}
      </p>
    </PanelCard>
  );
}

const shapes: [TableShape, string][] = [
  ["round", "Redonda"],
  ["square", "Quadrada"],
  ["rect", "Retangular"],
];

function Seg<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: [T, string][];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-sm font-medium text-ink">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map(([v, l]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={value === v}
            onClick={() => onChange(v)}
            className={cn(
              "min-h-10 rounded-md border px-3 text-sm font-semibold transition-colors",
              value === v
                ? "border-sidebar bg-sidebar text-white"
                : "border-input bg-card text-ink hover:bg-muted",
            )}
          >
            {l}
          </button>
        ))}
      </div>
    </div>
  );
}

export function EditTablePanel({
  table,
  numberDraft,
  numberError,
  onNumberChange,
  seatsDraft,
  seatsError,
  onSeatsChange,
  onSeatsStep,
  onShape,
  onRotate,
  onDelete,
  onClose,
}: {
  table: Mesa;
  numberDraft: string;
  numberError: string;
  onNumberChange: (value: string) => void;
  seatsDraft: string;
  seatsError: string;
  onSeatsChange: (value: string) => void;
  onSeatsStep: (delta: -1 | 1) => void;
  onShape: (shape: TableShape) => void;
  onRotate: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <PanelCard>
      <PanelHeader title={`Mesa ${tableNumber(table.number)}`} onClose={onClose} />
      <label className="flex flex-col gap-2">
        <span className="text-sm font-medium text-ink">Número da mesa</span>
        <MaskedInput
          mask="integer"
          className="field num"
          min={1}
          max={999}
          value={numberDraft}
          aria-invalid={Boolean(numberError)}
          onValueChange={onNumberChange}
        />
        {numberError && (
          <span role="alert" className="text-xs text-destructive">
            {numberError}
          </span>
        )}
      </label>
      <Seg label="Formato" options={shapes} value={table.shape} onChange={onShape} />
      <div className="flex flex-col gap-2">
        <label htmlFor="salao-lugares" className="text-sm font-medium text-ink">
          Lugares
        </label>
        <div className="flex items-center gap-2">
          <Btn
            variant="outline"
            className="h-10 w-10 shrink-0 px-0"
            aria-label="Menos um lugar"
            disabled={table.seats <= MIN_SEATS}
            onClick={() => onSeatsStep(-1)}
          >
            <Minus className="h-4 w-4" />
          </Btn>
          <MaskedInput
            mask="integer"
            id="salao-lugares"
            className="field num w-20 text-center"
            min={MIN_SEATS}
            max={MAX_SEATS}
            value={seatsDraft}
            aria-invalid={Boolean(seatsError)}
            onValueChange={onSeatsChange}
          />
          <Btn
            variant="outline"
            className="h-10 w-10 shrink-0 px-0"
            aria-label="Mais um lugar"
            disabled={table.seats >= MAX_SEATS}
            onClick={() => onSeatsStep(1)}
          >
            <Plus className="h-4 w-4" />
          </Btn>
        </div>
        {seatsError ? (
          <span role="alert" className="text-xs text-destructive">
            {seatsError}
          </span>
        ) : (
          table.shape === "square" &&
          table.seats > 8 && (
            <span className="text-xs text-muted-foreground">
              Com mais de 8 lugares, a mesa retangular costuma ficar melhor.
            </span>
          )
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        {table.shape === "rect" && (
          <Btn variant="outline" onClick={onRotate}>
            <RotateCw className="h-4 w-4" />
            Girar
          </Btn>
        )}
        <Btn variant="outline" className="text-destructive" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
          Excluir mesa
        </Btn>
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Arraste a mesa no mapa para mudar de lugar. Ela encaixa na grade de meio em meio quadrado.
      </p>
    </PanelCard>
  );
}
