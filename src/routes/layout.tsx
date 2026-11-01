import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import { cn } from "@/lib/utils";
import { actions, useStore, type Table } from "@/lib/store";
import { AppShell, Btn, Field } from "@/components/ui-kit";
import { IntegerInput } from "@/components/inputs";
import { integerError } from "@/lib/masks";

const TABLE_NUMBER = { min: 1, max: 999 };
const TABLE_SEATS = { min: 1, max: 50 };

/** Problemas de uma mesa: número/capacidade fora do limite ou número repetido. */
function tableProblems(table: Table, all: Table[]) {
  const number = integerError(table.number || null, TABLE_NUMBER);
  const duplicate =
    !number && all.some((other) => other.id !== table.id && other.number === table.number)
      ? `Já existe a mesa ${String(table.number).padStart(2, "0")}.`
      : null;
  return {
    number: number ?? duplicate,
    seats: integerError(table.seats || null, TABLE_SEATS),
  };
}

export const Route = createFileRoute("/layout")({
  head: () => ({
    meta: [
      { title: "Layout das mesas | Mesari" },
      { name: "description", content: "Monte o mapa do salão arrastando as mesas." },
      { property: "og:title", content: "Layout das mesas | Mesari" },
      { property: "og:description", content: "Monte o mapa do salão arrastando as mesas." },
    ],
  }),
  component: LayoutPage,
});

const size = (t: Table) => (t.seats > 4 ? { w: 140, h: 80 } : { w: 110, h: 80 });

function LayoutPage() {
  const saved = useStore((s) => s.tables);
  const nav = useNavigate();
  const [tables, setTables] = useState<Table[]>(saved);
  const [sel, setSel] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [saveError, setSaveError] = useState("");
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => setTables(saved), [saved]);

  const cur = tables.find((t) => t.id === sel);
  const patch = (p: Partial<Table>) =>
    setTables((ts) => ts.map((t) => (t.id === sel ? { ...t, ...p } : t)));

  const down = (e: PointerEvent, t: Table) => {
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const r = area.current!.getBoundingClientRect();
    drag.current = { id: t.id, dx: e.clientX - r.left - t.x, dy: e.clientY - r.top - t.y };
    setSel(t.id);
  };
  const move = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const r = area.current!.getBoundingClientRect();
    const snap = (v: number) => Math.max(0, Math.round(v / 10) * 10);
    setTables((ts) =>
      ts.map((t) =>
        t.id === d.id
          ? { ...t, x: snap(e.clientX - r.left - d.dx), y: snap(e.clientY - r.top - d.dy) }
          : t,
      ),
    );
  };

  const add = () => {
    const n = Math.max(0, ...tables.map((t) => t.number)) + 1;
    const t: Table = { id: actions.newId(), number: n, seats: 4, x: 20, y: 20, active: true };
    setTables([...tables, t]);
    setSel(t.id);
  };

  return (
    <AppShell
      center="Configurar Layout das Mesas"
      right={
        <>
          <Btn variant="outline" size="sm" onClick={add}>
            Adicionar Mesa
          </Btn>
          <Btn
            variant="success"
            size="sm"
            onClick={async () => {
              const invalid = tables.find((table) => {
                const problems = tableProblems(table, tables);
                return problems.number || problems.seats;
              });
              if (invalid) {
                setSel(invalid.id);
                setSaveError("Corrija a mesa destacada antes de salvar.");
                return;
              }
              setSaveError("");
              await actions.saveTables(tables);
              setMsg("Layout salvo.");
              setTimeout(() => setMsg(""), 2000);
            }}
          >
            Salvar Layout
          </Btn>
          <Btn
            variant="neutral"
            size="sm"
            onClick={() => {
              setTables(saved);
              nav({ to: "/caixa" });
            }}
          >
            Cancelar
          </Btn>
        </>
      }
    >
      <div className="grid h-[calc(100vh-3.5rem)] grid-cols-[7fr_3fr]">
        <div className="overflow-auto p-5">
          <div
            ref={area}
            onPointerMove={move}
            onPointerUp={() => (drag.current = null)}
            onPointerDown={() => setSel(null)}
            className="floor-grid relative h-[900px] min-w-[800px] rounded-lg border"
          >
            {tables.map((t) => {
              const { w, h } = size(t);
              return (
                <div
                  key={t.id}
                  onPointerDown={(e) => down(e, t)}
                  style={{ left: t.x, top: t.y, width: w, height: h }}
                  className={cn(
                    "absolute flex cursor-grab touch-none select-none flex-col items-center justify-center border-2 bg-card active:cursor-grabbing",
                    sel === t.id ? "border-primary" : "border-neutral/40",
                  )}
                >
                  <span className="num text-xl font-bold text-ink">
                    {String(t.number).padStart(2, "0")}
                  </span>
                  <span className="text-xs text-muted-foreground">{t.seats} lugares</span>
                </div>
              );
            })}
          </div>
        </div>
        <aside className="border-l bg-card p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Propriedades
          </h2>
          {msg && <p className="mb-4 rounded-md bg-free-bg px-3 py-2 text-sm text-free">{msg}</p>}
          {saveError && (
            <p
              role="alert"
              className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive"
            >
              {saveError}
            </p>
          )}
          {!cur ? (
            <p className="text-sm text-muted-foreground">Selecione uma mesa</p>
          ) : (
            <div className="space-y-4">
              <Field label="Número da mesa">
                <IntegerInput
                  key={`numero-${cur.id}`}
                  {...TABLE_NUMBER}
                  value={cur.number || null}
                  onChange={(number) => patch({ number: number ?? 0 })}
                  error={tableProblems(cur, tables).number}
                  showError={Boolean(saveError)}
                />
              </Field>
              <Field label="Capacidade (lugares)">
                <IntegerInput
                  key={`lugares-${cur.id}`}
                  {...TABLE_SEATS}
                  enterKeyHint="done"
                  value={cur.seats || null}
                  onChange={(seats) => patch({ seats: seats ?? 0 })}
                  showError={Boolean(saveError)}
                />
              </Field>
              <Btn
                variant="danger"
                className="w-full"
                onClick={() => {
                  setTables(tables.filter((t) => t.id !== sel));
                  setSel(null);
                }}
              >
                Excluir Mesa
              </Btn>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}
