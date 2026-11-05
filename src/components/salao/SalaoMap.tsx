import {
  memo,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { Maximize2, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { brl, type FloorArea, type FloorElement } from "@/lib/store";
import {
  MIN_AREA_SIZE,
  areaAtPoint,
  areaEdges,
  areaProblem,
  elementFits,
  isWallElement,
  obstaclesOf,
  snapElementInArea,
  snapHalf,
  snapInArea,
  sortAreasBackToFront,
  wallSpot,
} from "./areas";
import {
  CHAIR_COLORS,
  CHAIR_H,
  COLLISION_GAP,
  COLORS,
  SELECTED_STROKE,
  TABLE_H,
  chairs,
  collides,
  dims,
  iso,
  seatsLabel,
  tableNumber,
  toWorld,
  type Mesa,
} from "./iso";
import { labelLevel, labelScale, layoutLabels, type LabelSpec } from "./labels";
import {
  AreaFloor,
  AreaName,
  AreaWalls,
  Box,
  FloorElementShape,
  TableBody,
  TableLabel,
  WallElementShape,
  type SalaoMode,
} from "./scene";
import { LONG_OPEN_MINUTES, formatDuration, minutesSince, type LiveInfo } from "./useSalao";
import {
  REF_SCALE,
  fitViewport,
  layoutBounds,
  lerpViewport,
  minZoomFor,
  panPixels,
  viewBoxOf,
  zoomAround,
  type Size,
  type Viewport,
} from "./viewport";

export type { SalaoMode } from "./scene";
export type Selection = { kind: "table" | "area" | "element"; id: string };
type Corner = "nw" | "ne" | "se" | "sw";

type Props = {
  mode: SalaoMode;
  tables: Mesa[];
  areas: FloorArea[];
  elements: FloorElement[];
  live?: Record<string, LiveInfo>;
  now?: number;
  selection: Selection | null;
  onSelect: (selection: Selection | null) => void;
  /** Caixa: área filtrada (o mapa dá zoom nela e esmaece as outras). */
  focusAreaId?: string | null;
  /** Muda de valor para pedir "Ajustar" (ex.: depois de criar uma área). */
  fitSignal?: number;
  /** Edição: mesa arrastada para (x, y), já encaixada, dentro da área e sem colisão. */
  onTableMove?: (id: string, x: number, y: number, areaId: string) => void;
  onElementMove?: (id: string, change: Partial<FloorElement>) => void;
  /** Edição: área movida ou redimensionada (já validada). */
  onAreaChange?: (next: FloorArea) => void;
  /** Edição: soltou depois de arrastar alguma coisa. */
  onDragEnd?: () => void;
};

const DEFAULT_SIZE: Size = { w: 960, h: 600 };
const TAP_SLOP = 6;
const DOUBLE_TAP_MS = 320;
const ALERT_MINUTES = 60;
const BUTTON_ZOOM = 1.25;

type Hit = {
  tableId: string | null;
  elementId: string | null;
  areaId: string | null;
  handle: Corner | "move" | null;
};
type Gesture =
  | {
      kind: "pan";
      pointerId: number;
      startX: number;
      startY: number;
      lastX: number;
      lastY: number;
      moved: boolean;
      hit: Hit;
    }
  | { kind: "pinch"; dist: number; midX: number; midY: number }
  | {
      kind: "table";
      pointerId: number;
      id: string;
      dx: number;
      dy: number;
      moved: boolean;
    }
  | {
      kind: "element";
      pointerId: number;
      id: string;
      dx: number;
      dy: number;
      moved: boolean;
    }
  | { kind: "area-move"; pointerId: number; id: string; dx: number; dy: number; moved: boolean }
  | { kind: "area-resize"; pointerId: number; id: string; corner: Corner; moved: boolean };

function hitTest(target: EventTarget | null): Hit {
  const el = target instanceof Element ? target : null;
  const attr = (name: string) => el?.closest(`[${name}]`)?.getAttribute(name) ?? null;
  const handle = attr("data-handle");
  return {
    tableId: attr("data-table-id"),
    elementId: attr("data-element-id"),
    areaId: attr("data-area-id"),
    handle:
      handle === "nw" || handle === "ne" || handle === "se" || handle === "sw" || handle === "move"
        ? handle
        : null,
  };
}

const sameView = (a: Viewport, b: Viewport) =>
  Math.abs(a.cx - b.cx) < 1e-6 && Math.abs(a.cy - b.cy) < 1e-6 && Math.abs(a.zoom - b.zoom) < 1e-6;

export const SalaoMap = memo(function SalaoMap({
  mode,
  tables,
  areas,
  elements,
  live,
  now = 0,
  selection,
  onSelect,
  focusAreaId = null,
  fitSignal = 0,
  onTableMove,
  onElementMove,
  onAreaChange,
  onDragEnd,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const filterId = `salao-soft-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const [size, setSize] = useState<Size>(DEFAULT_SIZE);
  const bounds = useMemo(() => layoutBounds(areas), [areas]);
  const focusArea = focusAreaId ? areas.find((a) => a.id === focusAreaId) : undefined;
  const focusBounds = useMemo(
    () => (focusArea ? layoutBounds([focusArea]) : bounds),
    [focusArea, bounds],
  );
  const [view, setView] = useState<Viewport>(() => fitViewport(focusBounds, DEFAULT_SIZE));
  const [hovered, setHovered] = useState<string | null>(null);
  const minZoom = minZoomFor(bounds, size);
  const obstacles = useMemo(() => obstaclesOf(elements), [elements]);

  // "Ajustar" vale até o usuário mexer no zoom/posição; ao trocar de tela, volta a valer.
  const fitted = useRef(true);
  const anim = useRef<number | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<Gesture | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const latest = useRef({ tables, areas, elements, obstacles, size, view, minZoom });
  useLayoutEffect(() => {
    latest.current = { tables, areas, elements, obstacles, size, view, minZoom };
  });

  /* ---------- tamanho do container ---------- */
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      setSize((s) => (s.w === r.width && s.h === r.height ? s : { w: r.width, h: r.height }));
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const stopAnimation = useCallback(() => {
    if (anim.current) cancelAnimationFrame(anim.current);
    anim.current = null;
  }, []);

  /** Transição de 200ms (ou direta, se o sistema pede menos movimento). */
  const animateTo = useCallback(
    (target: Viewport) => {
      stopAnimation();
      const from = latest.current.view;
      if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        setView(target);
        return;
      }
      const start = performance.now();
      const step = (time: number) => {
        const t = Math.min(1, (time - start) / 200);
        setView(lerpViewport(from, target, 1 - Math.pow(1 - t, 3)));
        anim.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      anim.current = requestAnimationFrame(step);
    },
    [stopAnimation],
  );

  useEffect(() => stopAnimation, [stopAnimation]);

  // Filtro de área (caixa): zoom suave na área escolhida, ou de volta em todas.
  const lastFocus = useRef(focusAreaId);
  useEffect(() => {
    if (lastFocus.current === focusAreaId) return;
    lastFocus.current = focusAreaId;
    fitted.current = true;
    animateTo(fitViewport(focusBounds, latest.current.size));
  }, [focusAreaId, focusBounds, animateTo]);

  // "Ajustar" pedido pela tela (ex.: área nova fora da visão).
  const lastFitSignal = useRef(fitSignal);
  useEffect(() => {
    if (lastFitSignal.current === fitSignal) return;
    lastFitSignal.current = fitSignal;
    fitted.current = true;
    animateTo(fitViewport(focusBounds, latest.current.size));
  }, [fitSignal, focusBounds, animateTo]);

  // Enquanto estiver "ajustado", acompanha o tamanho da tela e mudanças no layout.
  useEffect(() => {
    if (!fitted.current || anim.current) return;
    const next = fitViewport(focusBounds, size);
    setView((v) => (sameView(v, next) ? v : next));
  }, [size, focusBounds]);

  const userMoved = () => {
    fitted.current = false;
    stopAnimation();
  };

  /* ---------- roda do mouse / touchpad ---------- */
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      fitted.current = false;
      if (anim.current) cancelAnimationFrame(anim.current);
      anim.current = null;
      const rect = svg.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      const { size: s, minZoom: min } = latest.current;
      // Pinça no touchpad chega como roda + Ctrl. Roda de mouse: passos grandes e inteiros.
      const mouseWheel =
        e.deltaMode !== 0 ||
        (e.deltaX === 0 && Math.abs(e.deltaY) >= 50 && Number.isInteger(e.deltaY));
      if (e.ctrlKey || mouseWheel) {
        const delta = e.deltaY * (e.deltaMode === 1 ? 33 : 1);
        const factor = Math.exp(-delta * (e.ctrlKey ? 0.01 : 0.0015));
        setView((v) => zoomAround(v, s, factor, px, py, min));
      } else {
        // Dois dedos no touchpad: move a visão.
        setView((v) => panPixels(v, -e.deltaX, -e.deltaY));
      }
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, []);

  /* ---------- toque, mouse e caneta ---------- */
  const localPoint = (clientX: number, clientY: number) => {
    const rect = svgRef.current?.getBoundingClientRect();
    return rect ? { x: clientX - rect.left, y: clientY - rect.top } : { x: 0, y: 0 };
  };

  const finishGesture = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g && g.kind !== "pan" && g.kind !== "pinch" && g.moved) onDragEnd?.();
  };

  const startPinch = () => {
    finishGesture();
    const [a, b] = [...pointers.current.values()];
    if (!a || !b) return;
    userMoved();
    const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
    gesture.current = {
      kind: "pinch",
      dist: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      midX: mid.x,
      midY: mid.y,
    };
  };

  const zoomToArea = (areaId: string) => {
    const area = latest.current.areas.find((a) => a.id === areaId);
    if (!area) return;
    fitted.current = false;
    animateTo(fitViewport(layoutBounds([area]), latest.current.size));
  };

  const handleTap = (hit: Hit, clientX: number, clientY: number) => {
    const time = performance.now();
    const prev = lastTap.current;
    const double =
      prev !== null &&
      time - prev.time < DOUBLE_TAP_MS &&
      Math.hypot(clientX - prev.x, clientY - prev.y) < 24;
    lastTap.current = double ? null : { time, x: clientX, y: clientY };
    if (double && hit.areaId) {
      zoomToArea(hit.areaId);
      return;
    }
    if (mode === "live") onSelect(hit.tableId ? { kind: "table", id: hit.tableId } : null);
    else onSelect(hit.areaId ? { kind: "area", id: hit.areaId } : null);
  };

  const handlePointerDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    stopAnimation();
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 2) {
      startPinch();
      return;
    }
    if (pointers.current.size > 2) return;

    const hit = hitTest(e.target);
    const world = svgRef.current && toWorld(svgRef.current, e.clientX, e.clientY);
    const { tables: ts, elements: els, areas: as } = latest.current;
    if (mode === "edit" && world) {
      const [wx, wy] = world;
      if (hit.handle && selection?.kind === "area") {
        const area = as.find((a) => a.id === selection.id);
        if (area) {
          userMoved();
          gesture.current =
            hit.handle === "move"
              ? {
                  kind: "area-move",
                  pointerId: e.pointerId,
                  id: area.id,
                  dx: wx - area.x,
                  dy: wy - area.y,
                  moved: false,
                }
              : {
                  kind: "area-resize",
                  pointerId: e.pointerId,
                  id: area.id,
                  corner: hit.handle,
                  moved: false,
                };
          return;
        }
      }
      const table = hit.tableId ? ts.find((t) => t.id === hit.tableId) : undefined;
      if (table) {
        onSelect({ kind: "table", id: table.id });
        userMoved();
        gesture.current = {
          kind: "table",
          pointerId: e.pointerId,
          id: table.id,
          dx: wx - table.x,
          dy: wy - table.y,
          moved: false,
        };
        return;
      }
      const element = hit.elementId ? els.find((el) => el.id === hit.elementId) : undefined;
      if (element) {
        onSelect({ kind: "element", id: element.id });
        userMoved();
        gesture.current = {
          kind: "element",
          pointerId: e.pointerId,
          id: element.id,
          dx: wx - element.x,
          dy: wy - element.y,
          moved: false,
        };
        return;
      }
    }
    gesture.current = {
      kind: "pan",
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      hit,
    };
  };

  const dragTable = (id: string, wx: number, wy: number) => {
    const { tables: ts, areas: as, obstacles: obs } = latest.current;
    const t = ts.find((entry) => entry.id === id);
    if (!t) return false;
    const area = areaAtPoint(as, wx, wy);
    if (!area) return false; // mesa nunca fica fora de uma área
    const { w, d } = dims(t);
    const [nx, ny] = snapInArea(area, w, d, wx, wy);
    if (nx === t.x && ny === t.y && area.id === t.areaId) return false;
    if (collides(t, nx, ny, ts, COLLISION_GAP, obs)) return false;
    onTableMove?.(t.id, nx, ny, area.id);
    return true;
  };

  const dragElement = (id: string, wx: number, wy: number, rawX: number, rawY: number) => {
    const { tables: ts, areas: as, elements: els } = latest.current;
    const el = els.find((entry) => entry.id === id);
    if (!el) return false;
    if (isWallElement(el.kind)) {
      const spot = wallSpot(el.width, as, rawX, rawY);
      if (!spot || (spot.x === el.x && spot.y === el.y && spot.rotation === el.rotation))
        return false;
      onElementMove?.(el.id, spot);
      return true;
    }
    const area = areaAtPoint(as, wx, wy);
    if (!area) return false;
    const [nx, ny] = snapElementInArea(area, el, wx, wy);
    const candidate = { ...el, x: nx, y: ny, areaId: area.id };
    if (nx === el.x && ny === el.y) return false;
    if (!elementFits(candidate, area, ts, els)) return false;
    onElementMove?.(el.id, { x: nx, y: ny, areaId: area.id });
    return true;
  };

  const dragArea = (
    g: Extract<Gesture, { kind: "area-move" | "area-resize" }>,
    wx: number,
    wy: number,
  ) => {
    const { tables: ts, areas: as, elements: els } = latest.current;
    const area = as.find((a) => a.id === g.id);
    if (!area) return false;
    let next: FloorArea;
    if (g.kind === "area-move") {
      next = { ...area, x: snapHalf(wx - g.dx), y: snapHalf(wy - g.dy) };
      if (next.x === area.x && next.y === area.y) return false;
      if (areaProblem(next, as, ts, els, false)) return false;
    } else {
      let { x0, y0, x1, y1 } = areaEdges(area);
      const sx = snapHalf(wx);
      const sy = snapHalf(wy);
      if (g.corner.includes("w")) x0 = Math.min(sx, x1 - MIN_AREA_SIZE);
      if (g.corner.includes("e")) x1 = Math.max(sx, x0 + MIN_AREA_SIZE);
      if (g.corner.includes("n")) y0 = Math.min(sy, y1 - MIN_AREA_SIZE);
      if (g.corner.includes("s")) y1 = Math.max(sy, y0 + MIN_AREA_SIZE);
      next = { ...area, x: x0, y: y0, width: x1 - x0, depth: y1 - y0 };
      if (
        next.x === area.x &&
        next.y === area.y &&
        next.width === area.width &&
        next.depth === area.depth
      ) {
        return false;
      }
      if (areaProblem(next, as, ts, els, true)) return false;
    }
    onAreaChange?.(next);
    return true;
  };

  const handlePointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) {
      if (e.pointerType === "mouse") {
        const id = hitTest(e.target).tableId;
        setHovered((current) => (current === id ? current : id));
      }
      return;
    }
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;

    if (g.kind === "pinch") {
      const [a, b] = [...pointers.current.values()];
      if (!a || !b) return;
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const mid = localPoint((a.x + b.x) / 2, (a.y + b.y) / 2);
      const { size: s, minZoom: min } = latest.current;
      const factor = dist / g.dist;
      const dx = mid.x - g.midX;
      const dy = mid.y - g.midY;
      setView((v) => panPixels(zoomAround(v, s, factor, mid.x, mid.y, min), dx, dy));
      g.dist = dist;
      g.midX = mid.x;
      g.midY = mid.y;
      return;
    }
    if (g.pointerId !== e.pointerId) return;

    if (g.kind === "pan") {
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) > TAP_SLOP) {
        g.moved = true;
        userMoved();
      }
      if (g.moved) {
        const dx = e.clientX - g.lastX;
        const dy = e.clientY - g.lastY;
        setView((v) => panPixels(v, dx, dy));
      }
      g.lastX = e.clientX;
      g.lastY = e.clientY;
      return;
    }

    const world = svgRef.current && toWorld(svgRef.current, e.clientX, e.clientY);
    if (!world) return;
    const [wx, wy] = world;
    let moved = false;
    if (g.kind === "table") moved = dragTable(g.id, wx - g.dx, wy - g.dy);
    else if (g.kind === "element") moved = dragElement(g.id, wx - g.dx, wy - g.dy, wx, wy);
    else moved = dragArea(g, wx, wy);
    if (moved) g.moved = true;
  };

  const handlePointerUp = (e: PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pinch") {
      // Tirou um dos dedos: encerra a pinça sem virar arraste (evita "pulo" da visão).
      if (pointers.current.size < 2) gesture.current = null;
      return;
    }
    if (g.pointerId !== e.pointerId) return;
    if (g.kind === "pan" && !g.moved && e.type === "pointerup")
      handleTap(g.hit, e.clientX, e.clientY);
    finishGesture();
  };

  const handleKeyDown = (e: KeyboardEvent<SVGSVGElement>) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const id = hitTest(e.target).tableId;
    if (!id) return;
    e.preventDefault();
    onSelect({ kind: "table", id });
  };

  /* ---------- botões de zoom ---------- */
  const zoomButton = (factor: number) => {
    fitted.current = false;
    const { size: s, minZoom: min } = latest.current;
    animateTo(zoomAround(latest.current.view, s, factor, s.w / 2, s.h / 2, min));
  };
  const fitAll = () => {
    fitted.current = true;
    animateTo(fitViewport(focusBounds, latest.current.size));
  };

  /* ---------- desenho ---------- */
  const sortedAreas = useMemo(() => sortAreasBackToFront(areas), [areas]);
  const selectedTable = selection?.kind === "table" ? selection.id : null;
  const selectedElement = selection?.kind === "element" ? selection.id : null;
  const selectedArea = selection?.kind === "area" ? selection.id : null;
  const dimmed = useCallback(
    (areaId: string | null) => mode === "live" && focusAreaId !== null && areaId !== focusAreaId,
    [mode, focusAreaId],
  );

  const scene = useMemo(() => {
    const byArea = new Map<string, { key: string; depth: number; node: ReactNode }[]>();
    const push = (areaId: string, item: { key: string; depth: number; node: ReactNode }) => {
      const list = byArea.get(areaId);
      if (list) list.push(item);
      else byArea.set(areaId, [item]);
    };
    const editable = mode === "edit";
    for (const el of elements) {
      if (isWallElement(el.kind)) continue;
      push(el.areaId, {
        key: el.id,
        depth: el.x + el.y,
        node: (
          <FloorElementShape
            element={el}
            selected={selectedElement === el.id}
            editable={editable}
          />
        ),
      });
    }
    const chairColors = CHAIR_COLORS[mode];
    for (const t of tables) {
      const areaId = t.areaId ?? "";
      const info = live?.[t.id];
      const status = info?.status ?? t.status ?? "livre";
      const palette = mode === "edit" ? COLORS.edit : COLORS[status];
      const minutes = info ? minutesSince(info.since, now) : 0;
      const open = mode === "live" && status !== "livre";
      const longOpen = open && minutes >= LONG_OPEN_MINUTES;
      chairs(t).forEach(([cx, cy], i) =>
        push(areaId, {
          key: `${t.id}:c${i}`,
          depth: cx + cy - 0.01,
          node: (
            <Box
              x0={cx - 0.17}
              y0={cy - 0.17}
              x1={cx + 0.17}
              y1={cy + 0.17}
              h={CHAIR_H}
              c={chairColors}
            />
          ),
        }),
      );
      const label =
        mode === "edit"
          ? `Mesa ${tableNumber(t.number)}, ${seatsLabel(t.seats)}`
          : `Mesa ${tableNumber(t.number)}, ${COLORS[status].label}${longOpen ? ", aberta há muito tempo" : ""}`;
      push(areaId, {
        key: t.id,
        depth: t.x + t.y,
        node: (
          <TableBody
            t={t}
            palette={palette}
            selected={selectedTable === t.id}
            alert={longOpen ? "long" : open && minutes >= ALERT_MINUTES ? "hour" : "none"}
            mode={mode}
            filterId={filterId}
            label={label}
          />
        ),
      });
    }
    return sortedAreas.map((area) => {
      const items = (byArea.get(area.id) ?? []).sort((a, b) => a.depth - b.depth);
      const walls = elements.filter((el) => el.areaId === area.id && isWallElement(el.kind));
      return (
        <g key={area.id} data-area-id={area.id} opacity={dimmed(area.id) ? 0.35 : undefined}>
          <AreaFloor area={area} mode={mode} selected={selectedArea === area.id} />
          {area.kind === "interna" && <AreaWalls area={area} />}
          {walls.map((el) => (
            <WallElementShape
              key={el.id}
              element={el}
              selected={selectedElement === el.id}
              editable={mode === "edit"}
            />
          ))}
          {items.map((item) => (
            <g key={item.key}>{item.node}</g>
          ))}
        </g>
      );
    });
  }, [
    sortedAreas,
    elements,
    tables,
    live,
    now,
    mode,
    selectedTable,
    selectedElement,
    selectedArea,
    filterId,
    dimmed,
  ]);

  const scale = labelScale(view.zoom);
  // Nomes das áreas: legíveis com zoom baixo, sem crescer além de 1,3x com zoom alto.
  const nameScale = view.zoom < 1 ? 1 / view.zoom : view.zoom > 1.3 ? 1.3 / view.zoom : 1;
  const names = useMemo(
    () =>
      sortedAreas.map((area) => (
        <AreaName key={area.id} area={area} scale={nameScale} dim={dimmed(area.id)} />
      )),
    [sortedAreas, nameScale, dimmed],
  );
  const labels = useMemo(() => {
    const specs: (LabelSpec & { t: Mesa; dot: string; warn: boolean })[] = tables.map((t) => {
      const info = live?.[t.id];
      const status = info?.status ?? t.status ?? "livre";
      const minutes = info ? minutesSince(info.since, now) : 0;
      const emphasized = selectedTable === t.id || hovered === t.id;
      const level = labelLevel(view.zoom, mode, status, emphasized);
      const line2 =
        mode === "edit"
          ? seatsLabel(t.seats)
          : status !== "livre" && info
            ? `${brl(info.total)} · ${formatDuration(minutes)}`
            : "";
      const [ax, ay] = iso(t.x, t.y, TABLE_H);
      return {
        id: t.id,
        level,
        line2: level === "full" ? line2 : "",
        ax,
        ay,
        // Selecionada/hover primeiro; depois as da frente (mais perto de quem olha).
        priority: (emphasized ? 1e6 : 0) + t.x + t.y,
        t,
        dot: mode === "edit" ? COLORS.edit.stroke : COLORS[status].stroke,
        warn: mode === "live" && status !== "livre" && minutes >= LONG_OPEN_MINUTES,
      };
    });
    const placed = layoutLabels(specs, scale);
    return specs
      .sort((a, b) => a.priority - b.priority)
      .map((spec) => {
        const p = placed.get(spec.id) ?? { level: spec.level, lift: 0 };
        return (
          <TableLabel
            key={spec.id}
            t={spec.t}
            level={p.level}
            line2={spec.line2}
            dot={spec.dot}
            selected={selectedTable === spec.id}
            scale={scale}
            lift={p.lift}
            dim={dimmed(spec.t.areaId)}
            warn={spec.warn}
          />
        );
      });
  }, [tables, live, now, mode, selectedTable, hovered, view.zoom, scale, dimmed]);

  // Alças da área selecionada (editor): tamanho constante na tela, qualquer zoom.
  const handles = useMemo(() => {
    if (mode !== "edit" || !selectedArea) return null;
    const area = areas.find((a) => a.id === selectedArea);
    if (!area) return null;
    const u = 1 / (view.zoom * REF_SCALE);
    const e = areaEdges(area);
    const corners: [Corner, number, number, string][] = [
      ["nw", e.x0, e.y0, "ns-resize"],
      ["ne", e.x1, e.y0, "ew-resize"],
      ["se", e.x1, e.y1, "ns-resize"],
      ["sw", e.x0, e.y1, "ew-resize"],
    ];
    const [mx, my] = iso(e.x0 + area.width / 2, e.y1);
    return (
      <g>
        {corners.map(([corner, x, y, cursor]) => {
          const [sx, sy] = iso(x, y);
          return (
            <g key={corner} data-handle={corner} style={{ cursor }}>
              <circle cx={sx} cy={sy} r={20 * u} fill="transparent" />
              <circle
                cx={sx}
                cy={sy}
                r={8 * u}
                fill="#FFFFFF"
                stroke={SELECTED_STROKE}
                strokeWidth={2.5 * u}
              />
            </g>
          );
        })}
        <g
          data-handle="move"
          style={{ cursor: "move" }}
          transform={`translate(${mx} ${my + 26 * u})`}
        >
          <rect
            x={-38 * u}
            y={-13 * u}
            width={76 * u}
            height={26 * u}
            rx={13 * u}
            fill={SELECTED_STROKE}
          />
          <text
            y={4.5 * u}
            textAnchor="middle"
            fontSize={12.5 * u}
            fontWeight={700}
            fill="#FFFFFF"
            pointerEvents="none"
          >
            ✥ Mover
          </text>
        </g>
      </g>
    );
  }, [mode, selectedArea, areas, view.zoom]);

  const vb = viewBoxOf(view, size);

  return (
    <div
      ref={containerRef}
      className="relative h-[62vh] max-h-[760px] min-h-[340px] w-full overflow-hidden bg-card"
    >
      <svg
        ref={svgRef}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        role="group"
        aria-label={mode === "edit" ? "Editor do layout do salão" : "Mapa do salão ao vivo"}
        className="absolute inset-0 block h-full w-full cursor-grab select-none active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onPointerLeave={(e) => {
          if (e.pointerType === "mouse") setHovered(null);
        }}
        onKeyDown={handleKeyDown}
      >
        <defs>
          <filter id={filterId} x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation={5} />
          </filter>
        </defs>
        <g>{scene}</g>
        <g pointerEvents="none">{names}</g>
        <g pointerEvents="none">{labels}</g>
        {handles}
      </svg>
      <div className="absolute bottom-3 right-3 flex items-center gap-0.5 rounded-xl border bg-card/95 p-1 shadow-sm">
        <button
          type="button"
          aria-label="Diminuir zoom"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-muted disabled:opacity-40"
          disabled={view.zoom <= minZoom + 1e-3}
          onClick={() => zoomButton(1 / BUTTON_ZOOM)}
        >
          <Minus className="h-4 w-4" />
        </button>
        <span
          className="min-w-12 text-center text-xs font-semibold tabular-nums text-muted-foreground"
          aria-live="polite"
        >
          {Math.round(view.zoom * 100)}%
        </span>
        <button
          type="button"
          aria-label="Aumentar zoom"
          className="grid h-9 w-9 place-items-center rounded-lg text-ink hover:bg-muted disabled:opacity-40"
          disabled={view.zoom >= 3 - 1e-3}
          onClick={() => zoomButton(BUTTON_ZOOM)}
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="ml-0.5 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-ink hover:bg-muted"
          onClick={fitAll}
        >
          <Maximize2 className="h-3.5 w-3.5" />
          Ajustar
        </button>
      </div>
    </div>
  );
});

/** Cartão do mapa: barra com filtro/legenda/ações em cima e o mapa embaixo. */
export function MapCard({
  legend,
  actions,
  toolbar,
  children,
}: {
  legend: ReactNode;
  actions?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="min-w-0 overflow-hidden rounded-[14px] border bg-card shadow-sm">
      {toolbar && <div className="border-b px-4 py-2.5">{toolbar}</div>}
      <div className="flex flex-wrap items-center justify-between gap-2.5 border-b px-4 py-3">
        <div className="flex flex-wrap gap-x-3.5 gap-y-1 text-[13px] text-muted-foreground">
          {legend}
        </div>
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

export function StatusLegend() {
  return (
    <>
      {(["livre", "ocupada", "conta"] as const).map((status) => (
        <span key={status} className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full" style={{ background: COLORS[status].stroke }} />
          {COLORS[status].label}
        </span>
      ))}
    </>
  );
}

/** Filtro do caixa: "Todas" + uma opção por área. */
export function AreaFilter({
  areas,
  counts,
  value,
  onChange,
}: {
  areas: FloorArea[];
  counts: Record<string, number>;
  value: string | null;
  onChange: (areaId: string | null) => void;
}) {
  const options: [string | null, string, number][] = [
    [null, "Todas", Object.values(counts).reduce((sum, n) => sum + n, 0)],
    ...areas.map((a): [string, string, number] => [a.id, a.name, counts[a.id] ?? 0]),
  ];
  return (
    <div role="radiogroup" aria-label="Filtrar por área" className="flex gap-1.5 overflow-x-auto">
      {options.map(([id, name, count]) => (
        <button
          key={id ?? "todas"}
          type="button"
          role="radio"
          aria-checked={value === id}
          onClick={() => onChange(id)}
          className={cn(
            "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition-colors",
            value === id
              ? "border-sidebar bg-sidebar text-white"
              : "border-transparent text-muted-foreground hover:border-border hover:text-ink",
          )}
        >
          {name}
          <span
            className={cn(
              "rounded-full px-1.5 py-0.5 text-[10px]",
              value === id ? "bg-white/20" : "bg-muted",
            )}
          >
            {count}
          </span>
        </button>
      ))}
    </div>
  );
}
