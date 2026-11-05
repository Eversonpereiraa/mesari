import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";
import { toast } from "sonner";
import {
  actions,
  errorMessage,
  useStore,
  type AreaKind,
  type ElementKind,
  type FloorArea,
  type FloorElement,
  type TableShape,
} from "@/lib/store";
import { AppShell, Btn } from "@/components/ui-kit";
import { useConfirm } from "@/components/system-dialog-provider";
import { MapCard, SalaoMap, type Selection } from "@/components/salao/SalaoMap";
import {
  AddElementMenu,
  AreaPanel,
  EditEmptyPanel,
  EditTablePanel,
  ElementPanel,
  PanelCard,
} from "@/components/salao/TablePanel";
import { useSalaoData } from "@/components/salao/useSalao";
import {
  ELEMENT_DEFAULT_SIZE,
  ELEMENT_LABEL,
  areaProblem,
  elementFits,
  findElementSpot,
  findSpot,
  fitWallElements,
  isWallElement,
  nearestFreeSpot,
  newAreaPosition,
  obstaclesOf,
  snapInArea,
  wallSpot,
} from "@/components/salao/areas";
import {
  MAX_SEATS,
  MIN_SEATS,
  clampSeats,
  collides,
  dims,
  seatsLabel,
  tableNumber,
  type Mesa,
} from "@/components/salao/iso";

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

const SAVE_DELAY = 500;

/** Alterações locais ainda não confirmadas pelo banco, por id. */
type Pending = {
  tables: Record<string, Mesa>;
  areas: Record<string, FloorArea>;
  elements: Record<string, FloorElement>;
};
const emptyPending: Pending = { tables: {}, areas: {}, elements: {} };
const byId = <T extends { id: string }>(list: T[]) =>
  Object.fromEntries(list.map((item) => [item.id, item]));
const without = <T,>(record: Record<string, T>, ids: Iterable<string>) => {
  const next = { ...record };
  for (const id of ids) delete next[id];
  return next;
};

function LayoutPage() {
  const role = useStore((s) => s.user?.role);
  const orders = useStore((s) => s.orders);
  const confirmar = useConfirm();
  const [pending, setPending] = useState<Pending>(emptyPending);
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set());
  const overrides = useMemo(() => ({ ...pending, removed }), [pending, removed]);
  const salao = useSalaoData(overrides);
  const { tables, areas, elements, areasAvailable } = salao;

  const [selection, setSelection] = useState<Selection | null>(null);
  const [numberDraft, setNumberDraft] = useState("");
  const [numberError, setNumberError] = useState("");
  const [seatsDraft, setSeatsDraft] = useState("");
  const [seatsError, setSeatsError] = useState("");
  const [areaName, setAreaName] = useState("");
  const [panelError, setPanelError] = useState("");
  const [busy, setBusy] = useState(false);
  const [fitSignal, setFitSignal] = useState(0);

  const pendingRef = useRef(pending);
  const salaoRef = useRef(salao);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    pendingRef.current = pending;
    salaoRef.current = salao;
  }, [pending, salao]);

  /* ---------- salvar ---------- */
  const flush = useCallback(async () => {
    timer.current = null;
    const snapshot = pendingRef.current;
    const change = {
      tables: Object.values(snapshot.tables),
      areas: Object.values(snapshot.areas),
      elements: Object.values(snapshot.elements),
    };
    if (!change.tables.length && !change.areas.length && !change.elements.length) return;
    try {
      await actions.saveSalaoLayout(change);
      // Só descarta o que não mudou de novo enquanto salvava.
      setPending((current) => {
        const keep = <T,>(now: Record<string, T>, saved: Record<string, T>) =>
          Object.fromEntries(Object.entries(now).filter(([id, value]) => saved[id] !== value));
        const next = {
          tables: keep(current.tables, snapshot.tables),
          areas: keep(current.areas, snapshot.areas),
          elements: keep(current.elements, snapshot.elements),
        };
        pendingRef.current = next;
        return next;
      });
      toast.success("Layout salvo", { id: "layout-salvo", duration: 1500 });
    } catch (cause) {
      toast.error(errorMessage(cause));
    }
  }, []);

  const scheduleSave = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void flush(), SAVE_DELAY);
  }, [flush]);

  // Saiu da tela com algo pendente: grava na hora.
  useEffect(
    () => () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  const put = useCallback(
    (change: { tables?: Mesa[]; areas?: FloorArea[]; elements?: FloorElement[] }) => {
      const current = pendingRef.current;
      const next: Pending = {
        tables: change.tables ? { ...current.tables, ...byId(change.tables) } : current.tables,
        areas: change.areas ? { ...current.areas, ...byId(change.areas) } : current.areas,
        elements: change.elements
          ? { ...current.elements, ...byId(change.elements) }
          : current.elements,
      };
      pendingRef.current = next;
      setPending(next);
    },
    [],
  );

  const forget = (ids: string[]) => {
    const current = pendingRef.current;
    const next = {
      tables: without(current.tables, ids),
      areas: without(current.areas, ids),
      elements: without(current.elements, ids),
    };
    pendingRef.current = next;
    setPending(next);
    setRemoved((set) => new Set([...set, ...ids]));
  };
  const unforget = (ids: string[]) =>
    setRemoved((set) => new Set([...set].filter((id) => !ids.includes(id))));

  /* ---------- seleção ---------- */
  const select = useCallback((next: Selection | null) => {
    setSelection(next);
    setPanelError("");
    setNumberError("");
    setSeatsError("");
    const { tables: ts, areas: as } = salaoRef.current;
    if (next?.kind === "table") {
      const t = ts.find((entry) => entry.id === next.id);
      setNumberDraft(t ? String(t.number) : "");
      setSeatsDraft(t ? String(t.seats) : "");
    }
    if (next?.kind === "area") setAreaName(as.find((a) => a.id === next.id)?.name ?? "");
  }, []);

  const preferredAreaId = () => {
    const { tables: ts, elements: els } = salaoRef.current;
    if (selection?.kind === "area") return selection.id;
    if (selection?.kind === "table") return ts.find((t) => t.id === selection.id)?.areaId ?? null;
    if (selection?.kind === "element") {
      return els.find((e) => e.id === selection.id)?.areaId ?? null;
    }
    return null;
  };

  /* ---------- arrastes no mapa ---------- */
  const moveTable = useCallback(
    (id: string, x: number, y: number, areaId: string) => {
      const base = salaoRef.current.tables.find((t) => t.id === id);
      if (base) put({ tables: [{ ...base, x, y, areaId }] });
    },
    [put],
  );

  const moveElement = useCallback(
    (id: string, change: Partial<FloorElement>) => {
      const base = salaoRef.current.elements.find((e) => e.id === id);
      if (base) put({ elements: [{ ...base, ...change }] });
    },
    [put],
  );

  /** Área movida (mesas e elementos vão junto) ou redimensionada (porta/janela acompanham). */
  const changeArea = useCallback(
    (next: FloorArea) => {
      const { areas: as, tables: ts, elements: els } = salaoRef.current;
      const prev = as.find((a) => a.id === next.id);
      if (!prev) return;
      const moved =
        prev.width === next.width &&
        prev.depth === next.depth &&
        (prev.x !== next.x || prev.y !== next.y);
      if (moved) {
        const dx = next.x - prev.x;
        const dy = next.y - prev.y;
        put({
          areas: [next],
          tables: ts
            .filter((t) => t.areaId === next.id)
            .map((t) => ({ ...t, x: t.x + dx, y: t.y + dy })),
          elements: els
            .filter((e) => e.areaId === next.id)
            .map((e) => ({ ...e, x: e.x + dx, y: e.y + dy })),
        });
      } else {
        put({ areas: [next], elements: fitWallElements(next, els) });
      }
    },
    [put],
  );

  /* ---------- mesa ---------- */
  /**
   * Mudou o tamanho da mesa (lugares, formato, rotação): mantém o centro na área e, se o novo
   * tamanho encostar em outra mesa ou elemento, leva para a vaga livre mais próxima.
   */
  const patchShape = (t: Mesa, change: Partial<Mesa>) => {
    const area = areas.find((a) => a.id === t.areaId) ?? areas[0];
    if (!area) return;
    const next = { ...t, ...change };
    const { w, d } = dims(next);
    let [x, y] = snapInArea(area, w, d, next.x, next.y);
    const obstacles = obstaclesOf(elements);
    if (collides(next, x, y, tables, undefined, obstacles)) {
      const spot = nearestFreeSpot({ ...next, x, y }, tables, area, obstacles);
      if (spot) {
        [x, y] = spot;
        toast.info(`Mesa ${tableNumber(t.number)} mudou de lugar para não encostar em outra.`, {
          id: "mesa-movida",
        });
      } else {
        toast.warning(`Não há espaço livre em ${area.name} para esse tamanho de mesa.`, {
          id: "mesa-sem-espaco",
        });
      }
    }
    put({ tables: [{ ...next, x, y }] });
    scheduleSave();
  };

  const setSeats = (t: Mesa, seats: number) => {
    const value = clampSeats(seats);
    setSeatsDraft(String(value));
    setSeatsError("");
    if (value !== t.seats) patchShape(t, { seats: value });
  };

  const changeSeats = (t: Mesa, value: string) => {
    setSeatsDraft(value);
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < MIN_SEATS || n > MAX_SEATS) {
      setSeatsError(`Informe de ${MIN_SEATS} a ${MAX_SEATS} lugares.`);
      return;
    }
    setSeatsError("");
    if (n !== t.seats) patchShape(t, { seats: n });
  };

  const changeNumber = (t: Mesa, value: string) => {
    setNumberDraft(value);
    const n = Number(value);
    if (!value.trim() || !Number.isInteger(n) || n < 1) {
      setNumberError("Informe um número inteiro maior que zero.");
      return;
    }
    if (tables.some((other) => other.id !== t.id && other.number === n)) {
      setNumberError(`Já existe a mesa ${tableNumber(n)}.`);
      return;
    }
    setNumberError("");
    put({ tables: [{ ...t, number: n }] });
    scheduleSave();
  };

  const addTable = async () => {
    setBusy(true);
    try {
      const number = await actions.nextTableNumber();
      const base = {
        id: actions.newId(),
        number,
        seats: 4,
        shape: "square" as const,
        rotation: 0 as const,
        active: true,
        areaId: null,
      };
      const spot = findSpot(
        base,
        tables,
        { areas, obstacles: obstaclesOf(elements) },
        preferredAreaId(),
      );
      const mesa: Mesa = { ...base, ...spot, status: "livre" };
      await actions.saveTableLayout([mesa]);
      select({ kind: "table", id: mesa.id });
      setNumberDraft(String(number));
      setSeatsDraft(String(mesa.seats));
      toast.success(`Mesa ${tableNumber(number)} adicionada`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const removeTable = async (t: Mesa) => {
    const label = tableNumber(t.number);
    if (orders[t.id]?.length) {
      toast.error(`A mesa ${label} tem pedido em aberto. Feche a conta antes de excluir.`);
      return;
    }
    const ok = await confirmar({
      title: `Excluir a mesa ${label}?`,
      description:
        "Ela sai do mapa, da tela Mesas e do app do garçom. As vendas já fechadas continuam no histórico.",
      confirmText: "Excluir mesa",
      variant: "danger",
    });
    if (!ok) return;
    // Descarta alteração pendente para o salvamento automático não reativar a mesa.
    forget([t.id]);
    try {
      await actions.deactivateTable(t.id);
      select(null);
      toast.success(`Mesa ${label} excluída`);
    } catch (cause) {
      unforget([t.id]);
      toast.error(errorMessage(cause));
    }
  };

  /* ---------- área ---------- */
  const addArea = async () => {
    setBusy(true);
    try {
      const [x, y] = newAreaPosition(areas);
      const area: FloorArea = {
        id: actions.newId(),
        name: "Nova área",
        kind: "externa",
        x,
        y,
        width: 6,
        depth: 4,
        order: Math.max(0, ...areas.map((a) => a.order)) + 1,
      };
      await actions.saveSalaoLayout({ tables: [], areas: [area], elements: [] });
      select({ kind: "area", id: area.id });
      setAreaName(area.name);
      setFitSignal((n) => n + 1);
      toast.success("Área criada. Dê um nome e arraste para o lugar certo.");
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const tryArea = (next: FloorArea) => {
    const problem = areaProblem(next, areas, tables, elements);
    if (problem) {
      setPanelError(problem);
      return;
    }
    setPanelError("");
    changeArea(next);
    scheduleSave();
  };

  const renameArea = (area: FloorArea, value: string) => {
    setAreaName(value);
    if (!value.trim()) {
      setPanelError("Dê um nome para a área.");
      return;
    }
    setPanelError("");
    put({ areas: [{ ...area, name: value.trim() }] });
    scheduleSave();
  };

  const removeArea = async (area: FloorArea) => {
    const inside = tables.filter((t) => t.areaId === area.id).length;
    if (inside) {
      toast.error(
        `A área ${area.name} tem ${inside} ${inside === 1 ? "mesa" : "mesas"}. Mova as mesas para outra área antes de excluir.`,
      );
      return;
    }
    if (areas.length <= 1) {
      toast.error("O salão precisa ter pelo menos uma área.");
      return;
    }
    const own = elements.filter((e) => e.areaId === area.id);
    const ok = await confirmar({
      title: `Excluir a área ${area.name}?`,
      description: own.length
        ? `Os elementos dentro dela (${own.map((e) => ELEMENT_LABEL[e.kind].toLowerCase()).join(", ")}) também serão removidos.`
        : "A área sai do mapa do salão.",
      confirmText: "Excluir área",
      variant: "danger",
    });
    if (!ok) return;
    const ids = [area.id, ...own.map((e) => e.id)];
    forget(ids);
    try {
      await actions.deleteArea(area.id);
      select(null);
      setFitSignal((n) => n + 1);
      toast.success(`Área ${area.name} excluída`);
    } catch (cause) {
      unforget(ids);
      toast.error(errorMessage(cause));
    }
  };

  /* ---------- elementos ---------- */
  const addElement = async (kind: ElementKind) => {
    const base: FloorElement = {
      id: actions.newId(),
      areaId: "",
      kind,
      x: 0,
      y: 0,
      ...ELEMENT_DEFAULT_SIZE[kind],
      rotation: 0,
    };
    let element: FloorElement | null;
    if (isWallElement(kind)) {
      const preferred = preferredAreaId();
      const area = areas
        .filter((a) => a.kind === "interna")
        .sort((a, b) => (a.id === preferred ? -1 : b.id === preferred ? 1 : a.order - b.order))[0];
      const spot = area && wallSpot(base.width, [area], area.x + area.width / 2, area.y);
      if (!spot) {
        toast.error(
          "Porta e janela ficam na parede de uma área interna. Crie uma área interna ou mude o tipo de uma área.",
        );
        return;
      }
      element = { ...base, ...spot };
    } else {
      element = findElementSpot(base, areas, tables, elements, preferredAreaId());
      if (!element) {
        toast.error(
          `Não há espaço livre para ${ELEMENT_LABEL[kind].toLowerCase()}. Aumente uma área.`,
        );
        return;
      }
    }
    setBusy(true);
    try {
      await actions.saveSalaoLayout({ tables: [], areas: [], elements: [element] });
      select({ kind: "element", id: element.id });
      toast.success(`${ELEMENT_LABEL[kind]} adicionado. Arraste para o lugar certo.`);
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setBusy(false);
    }
  };

  const resizeElement = (el: FloorElement, width: number, depth: number) => {
    const area = areas.find((a) => a.id === el.areaId);
    if (!area) return;
    if (isWallElement(el.kind)) {
      if (width > (el.rotation ? area.depth : area.width)) {
        setPanelError("Não cabe nessa parede.");
        return;
      }
      const [fitted] = fitWallElements(area, [{ ...el, width }]);
      if (fitted) put({ elements: [fitted] });
    } else {
      const next = { ...el, width, depth };
      if (!elementFits(next, area, tables, elements)) {
        setPanelError("Não cabe aí: encostaria numa mesa, em outro elemento ou na borda da área.");
        return;
      }
      put({ elements: [next] });
    }
    setPanelError("");
    scheduleSave();
  };

  const rotateElement = (el: FloorElement) => {
    const area = areas.find((a) => a.id === el.areaId);
    if (!area) return;
    const turned = { ...el, width: el.depth, depth: el.width };
    const next = elementFits(turned, area, tables, elements)
      ? turned
      : findElementSpot(turned, [area], tables, elements, area.id);
    if (!next) {
      setPanelError("Não há espaço para girar aqui. Afaste as mesas ou aumente a área.");
      return;
    }
    setPanelError("");
    put({ elements: [next] });
    scheduleSave();
  };

  const removeElement = async (el: FloorElement) => {
    const ok = await confirmar({
      title: `Excluir ${ELEMENT_LABEL[el.kind].toLowerCase()}?`,
      description: "Ele sai do mapa do salão.",
      confirmText: "Excluir",
      variant: "danger",
    });
    if (!ok) return;
    forget([el.id]);
    try {
      await actions.deleteElement(el.id);
      select(null);
    } catch (cause) {
      unforget([el.id]);
      toast.error(errorMessage(cause));
    }
  };

  /* ---------- tela ---------- */
  const currentTable =
    selection?.kind === "table" ? tables.find((t) => t.id === selection.id) : undefined;
  const currentArea =
    selection?.kind === "area" ? areas.find((a) => a.id === selection.id) : undefined;
  const currentElement =
    selection?.kind === "element" ? elements.find((e) => e.id === selection.id) : undefined;
  const seatsTotal = tables.reduce((sum, t) => sum + t.seats, 0);

  let panel;
  if (currentTable) {
    const t = currentTable;
    panel = (
      <EditTablePanel
        table={t}
        numberDraft={numberDraft}
        numberError={numberError}
        onNumberChange={(value) => changeNumber(t, value)}
        seatsDraft={seatsDraft}
        seatsError={seatsError}
        onSeatsChange={(value) => changeSeats(t, value)}
        onSeatsStep={(delta) => setSeats(t, t.seats + delta)}
        // Trocar o formato mantém os lugares que já estavam.
        onShape={(shape: TableShape) => {
          if (shape !== t.shape) patchShape(t, { shape });
        }}
        onRotate={() => patchShape(t, { rotation: t.rotation ? 0 : 1 })}
        onDelete={() => void removeTable(t)}
        onClose={() => select(null)}
      />
    );
  } else if (currentArea) {
    const area = currentArea;
    panel = (
      <AreaPanel
        area={area}
        nameDraft={areaName}
        tableCount={tables.filter((t) => t.areaId === area.id).length}
        error={panelError}
        onNameChange={(value) => renameArea(area, value)}
        onKind={(kind: AreaKind) => {
          if (kind !== area.kind) tryArea({ ...area, kind });
        }}
        onSize={(width, depth) => tryArea({ ...area, width, depth })}
        onDelete={() => void removeArea(area)}
        onClose={() => select(null)}
      />
    );
  } else if (currentElement) {
    const el = currentElement;
    panel = (
      <ElementPanel
        element={el}
        error={panelError}
        onSize={(width, depth) => resizeElement(el, width, depth)}
        onRotate={() => rotateElement(el)}
        onDelete={() => void removeElement(el)}
        onClose={() => select(null)}
      />
    );
  } else {
    panel = (
      <EditEmptyPanel
        onAddTable={() => void addTable()}
        onAddArea={() => void addArea()}
        onAddElement={(kind) => void addElement(kind)}
        busy={busy}
        areasAvailable={areasAvailable}
      />
    );
  }

  return (
    <AppShell center="Configurar Layout das Mesas">
      <div className="min-w-0 p-4 md:p-6">
        {role && role !== "caixa" ? (
          <PanelCard className="mx-auto max-w-lg">
            <h2 className="font-display text-xl font-extrabold text-ink">Layout do salão</h2>
            <p className="text-sm text-muted-foreground">
              Somente o caixa pode alterar o layout do salão.
            </p>
          </PanelCard>
        ) : (
          <div className="grid items-start gap-4 min-[981px]:grid-cols-[minmax(0,1fr)_340px]">
            <MapCard
              legend={
                <span>
                  {tables.length} {tables.length === 1 ? "mesa" : "mesas"} ·{" "}
                  {seatsLabel(seatsTotal)} · {areas.length} {areas.length === 1 ? "área" : "áreas"}
                </span>
              }
              actions={
                <>
                  <Btn size="sm" onClick={() => void addTable()} disabled={busy}>
                    <Plus className="h-4 w-4" />
                    Mesa
                  </Btn>
                  <Btn
                    size="sm"
                    variant="outline"
                    onClick={() => void addArea()}
                    disabled={busy || !areasAvailable}
                  >
                    <Plus className="h-4 w-4" />
                    Área
                  </Btn>
                  <AddElementMenu
                    onAdd={(kind) => void addElement(kind)}
                    disabled={busy || !areasAvailable}
                  />
                </>
              }
            >
              <SalaoMap
                mode="edit"
                tables={tables}
                areas={areas}
                elements={elements}
                selection={selection}
                onSelect={select}
                fitSignal={fitSignal}
                onTableMove={moveTable}
                onElementMove={moveElement}
                onAreaChange={changeArea}
                onDragEnd={scheduleSave}
              />
            </MapCard>
            <div className="min-w-0 min-[981px]:sticky min-[981px]:top-20">{panel}</div>
          </div>
        )}
      </div>
    </AppShell>
  );
}
