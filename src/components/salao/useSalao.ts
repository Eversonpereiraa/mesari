import { useEffect, useMemo, useRef, useState } from "react";
import {
  actions,
  billTotals,
  useStore,
  type FloorArea,
  type FloorElement,
  type OrderLine,
  type Status,
} from "@/lib/store";
import { DEFAULT_AREA, DEFAULT_ELEMENTS, obstaclesOf, placeTables } from "./areas";
import type { Mesa } from "./iso";

export type LiveInfo = {
  status: Status;
  /** Total em aberto com taxa de serviço (o mesmo valor no mapa, no painel e na nota). */
  total: number;
  /** Horário do primeiro item lançado (a mesa ficou ocupada nesse momento). */
  since: number | null;
  lines: OrderLine[];
};

export type SalaoOverrides = {
  tables?: Record<string, Mesa>;
  areas?: Record<string, FloorArea>;
  elements?: Record<string, FloorElement>;
  /** Ids excluídos localmente, ainda não confirmados pelo banco. */
  removed?: ReadonlySet<string>;
};

export type SalaoData = {
  tables: Mesa[];
  areas: FloorArea[];
  elements: FloorElement[];
  /** false = migration de áreas ainda não aplicada (área provisória "Salão"). */
  areasAvailable: boolean;
};

const noLines: OrderLine[] = [];

function merge<T extends { id: string }>(
  stored: T[],
  overrides: Record<string, T> | undefined,
  removed: ReadonlySet<string> | undefined,
) {
  if (!overrides && !removed?.size) return stored;
  const ids = new Set(stored.map((item) => item.id));
  const merged = stored.map((item) => overrides?.[item.id] ?? item);
  for (const item of Object.values(overrides ?? {})) if (!ids.has(item.id)) merged.push(item);
  return removed?.size ? merged.filter((item) => !removed.has(item.id)) : merged;
}

/**
 * Salão completo: áreas, elementos e mesas sempre posicionadas dentro de uma área. O store já
 * assina o Supabase Realtime (mesas, itens_pedido e layout), então tudo chega sem recarregar.
 * Mesas sem posição/área válida ganham uma vaga e, para o caixa, isso é gravado no banco.
 * `overrides` são alterações do editor ainda não salvas.
 */
export function useSalaoData(overrides?: SalaoOverrides): SalaoData {
  const storedTables = useStore((s) => s.tables);
  const storedAreas = useStore((s) => s.areas);
  const storedElements = useStore((s) => s.elements);
  const areasAvailable = useStore((s) => s.areasAvailable);
  const role = useStore((s) => s.user?.role);

  const data = useMemo(() => {
    const baseAreas = areasAvailable && storedAreas.length ? storedAreas : [DEFAULT_AREA];
    const baseElements = areasAvailable ? storedElements : DEFAULT_ELEMENTS;
    const areas = merge(baseAreas, overrides?.areas, overrides?.removed).sort(
      (a, b) => a.order - b.order,
    );
    const elements = merge(baseElements, overrides?.elements, overrides?.removed);
    const tables = merge(storedTables, overrides?.tables, overrides?.removed);
    const placement = placeTables(tables, { areas, obstacles: obstaclesOf(elements) });
    // Antes da migration a área é provisória: só posição nova vale gravar.
    const before = new Map(tables.map((t) => [t.id, t]));
    const changed = placement.changed.filter((t) => {
      const old = before.get(t.id);
      return areasAvailable || old?.x !== t.x || old?.y !== t.y;
    });
    return { tables: placement.placed, areas, elements, changed };
  }, [storedTables, storedAreas, storedElements, areasAvailable, overrides]);

  const attempted = useRef(new Set<string>());
  const { changed } = data;
  useEffect(() => {
    if (role !== "caixa") return;
    const pending = changed.filter(
      (t) => !attempted.current.has(t.id) && !overrides?.tables?.[t.id],
    );
    if (!pending.length) return;
    for (const t of pending) attempted.current.add(t.id);
    // Falha (ex.: migration ainda não aplicada) aparece no aviso de erro do sistema.
    void actions.saveTableLayout(pending).catch(() => undefined);
  }, [changed, role, overrides]);

  return useMemo(
    () => ({
      tables: data.tables,
      areas: data.areas,
      elements: data.elements,
      areasAvailable,
    }),
    [data, areasAvailable],
  );
}

export function useLiveInfo(tables: Mesa[]): Record<string, LiveInfo> {
  const orders = useStore((s) => s.orders);
  const restaurant = useStore((s) => s.restaurant);
  return useMemo(() => {
    const info: Record<string, LiveInfo> = {};
    for (const t of tables) {
      const lines = orders[t.id] ?? noLines;
      const status = t.status ?? "livre";
      info[t.id] = {
        status,
        total: billTotals(lines, restaurant).totalCents / 100,
        since: lines.length ? Math.min(...lines.map((line) => line.at)) : null,
        lines,
      };
    }
    return info;
  }, [tables, orders, restaurant]);
}

/** Relógio que só muda na virada de cada minuto ("há X min" sem re-render a cada segundo). */
export function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(
      () => {
        setNow(Date.now());
        interval = setInterval(() => setNow(Date.now()), 60_000);
      },
      60_000 - (Date.now() % 60_000),
    );
    return () => {
      clearTimeout(timeout);
      if (interval) clearInterval(interval);
    };
  }, []);
  return now;
}

export const minutesSince = (since: number | null, now: number) =>
  since == null ? 0 : Math.max(0, Math.floor((now - since) / 60_000));

/** Mesa aberta há mais de 12 horas: provavelmente esqueceram de fechar a conta. */
export const LONG_OPEN_MINUTES = 12 * 60;

/** "45 min", "2 h 10 min", "4 d 15 h". */
export function formatDuration(minutes: number) {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const rest = m % 60;
    return rest ? `${Math.floor(m / 60)} h ${rest} min` : `${Math.floor(m / 60)} h`;
  }
  const hours = Math.floor((m % (24 * 60)) / 60);
  const days = Math.floor(m / (24 * 60));
  return hours ? `${days} d ${hours} h` : `${days} d`;
}
