import type { AreaKind, ElementKind, FloorArea, FloorElement, Table } from "@/lib/store";
import {
  COLLISION_GAP,
  OBSTACLE_GAP,
  WALL_GAP,
  collides,
  dims,
  rectsCollide,
  tableRect,
  type Footprint,
  type Mesa,
  type Pt,
  type Rect,
} from "./iso";

/** Área provisória usada antes da migration de áreas — mesmo salão 12 x 9 de antes. */
export const DEFAULT_AREA_ID = "salao-padrao";
export const DEFAULT_AREA: FloorArea = {
  id: DEFAULT_AREA_ID,
  name: "Salão",
  kind: "interna",
  x: 0,
  y: 0,
  width: 12,
  depth: 9,
  order: 0,
};
export const DEFAULT_ELEMENTS: FloorElement[] = [
  {
    id: "padrao-balcao",
    areaId: DEFAULT_AREA_ID,
    kind: "balcao",
    x: 11.375,
    y: 1.675,
    width: 0.95,
    depth: 3.05,
    rotation: 0,
  },
  {
    id: "padrao-porta",
    areaId: DEFAULT_AREA_ID,
    kind: "porta",
    x: 0,
    y: 4.8,
    width: 1.2,
    depth: 0.2,
    rotation: 1,
  },
  {
    id: "padrao-janela",
    areaId: DEFAULT_AREA_ID,
    kind: "janela",
    x: 6,
    y: 0,
    width: 6,
    depth: 0.2,
    rotation: 0,
  },
];

export const MIN_AREA_SIZE = 2;
/** Distância mínima da mesa até a borda da área (interna tem parede). */
export const AREA_PAD: Record<AreaKind, number> = { interna: WALL_GAP, externa: 0.3 };
const ELEMENT_PAD = 0.1;

export const ELEMENT_LABEL: Record<ElementKind, string> = {
  balcao: "Balcão",
  porta: "Porta",
  janela: "Janela",
  caixa: "Caixa",
  cozinha: "Cozinha",
};
export const ELEMENT_DEFAULT_SIZE: Record<ElementKind, { width: number; depth: number }> = {
  balcao: { width: 0.95, depth: 3 },
  porta: { width: 1.2, depth: 0.2 },
  janela: { width: 3, depth: 0.2 },
  caixa: { width: 1.2, depth: 0.8 },
  cozinha: { width: 3, depth: 2.5 },
};
export const isWallElement = (kind: ElementKind) => kind === "porta" || kind === "janela";

export const snapHalf = (v: number) => Math.round(v * 2) / 2;

export type Edges = { x0: number; y0: number; x1: number; y1: number };
export const areaEdges = (a: Pick<FloorArea, "x" | "y" | "width" | "depth">): Edges => ({
  x0: a.x,
  y0: a.y,
  x1: a.x + a.width,
  y1: a.y + a.depth,
});

export function areaAtPoint(areas: FloorArea[], x: number, y: number) {
  return areas.find((a) => {
    const e = areaEdges(a);
    return x >= e.x0 && x <= e.x1 && y >= e.y0 && y <= e.y1;
  });
}

/**
 * Área da mesa para contar e filtrar: a gravada (se ainda existir), senão a área onde ela está
 * desenhada, senão a primeira área. Assim nenhuma mesa fica fora das abas.
 */
export function tableAreaOf(
  table: { areaId?: string | null; x?: number | null; y?: number | null },
  areas: FloorArea[],
): string | null {
  if (table.areaId && areas.some((area) => area.id === table.areaId)) return table.areaId;
  const byPoint =
    table.x != null && table.y != null && Number.isFinite(table.x) && Number.isFinite(table.y)
      ? areaAtPoint(areas, table.x, table.y)
      : undefined;
  return (byPoint ?? areas[0])?.id ?? null;
}

/** Quantas mesas em cada área (abas do caixa), pela mesma regra do filtro do mapa. */
export function countTablesByArea(
  tables: { areaId?: string | null; x?: number | null; y?: number | null }[],
  areas: FloorArea[],
) {
  const counts: Record<string, number> = {};
  for (const table of tables) {
    const id = tableAreaOf(table, areas);
    if (id) counts[id] = (counts[id] ?? 0) + 1;
  }
  return counts;
}

export function fitsInArea(area: FloorArea, r: Rect, pad = AREA_PAD[area.kind]) {
  const e = areaEdges(area);
  const eps = 1e-6;
  return (
    r.x - r.w / 2 >= e.x0 + pad - eps &&
    r.x + r.w / 2 <= e.x1 - pad + eps &&
    r.y - r.d / 2 >= e.y0 + pad - eps &&
    r.y + r.d / 2 <= e.y1 - pad + eps
  );
}

/** Centro encaixado na grade de 0,5 e mantido dentro da área (com a margem da borda). */
export function snapInArea(
  area: FloorArea,
  w: number,
  d: number,
  x: number,
  y: number,
  pad = AREA_PAD[area.kind],
): Pt {
  const e = areaEdges(area);
  const clamp = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v));
  return [
    clamp(snapHalf(x), e.x0 + pad + w / 2, e.x1 - pad - w / 2),
    clamp(snapHalf(y), e.y0 + pad + d / 2, e.y1 - pad - d / 2),
  ];
}

export const elementRect = (e: FloorElement): Rect => ({ x: e.x, y: e.y, w: e.width, d: e.depth });
/** Elementos de chão (balcão, caixa, cozinha) — mesas não podem ficar em cima deles. */
export const obstaclesOf = (elements: FloorElement[]) =>
  elements.filter((e) => !isWallElement(e.kind)).map(elementRect);

export type SalaoLayout = { areas: FloorArea[]; obstacles: Rect[] };

export function areasOverlap(
  a: Pick<FloorArea, "x" | "y" | "width" | "depth">,
  b: Pick<FloorArea, "x" | "y" | "width" | "depth">,
) {
  const eps = 1e-6;
  return (
    a.x < b.x + b.width - eps &&
    b.x < a.x + a.width - eps &&
    a.y < b.y + b.depth - eps &&
    b.y < a.y + a.depth - eps
  );
}

/** Ordem de pintura: área de trás antes da da frente (só importa quando uma pode tapar a outra). */
export function sortAreasBackToFront(areas: FloorArea[]) {
  const behind = (a: FloorArea, b: FloorArea) => {
    const ea = areaEdges(a);
    const eb = areaEdges(b);
    const overlapX = ea.x0 < eb.x1 && eb.x0 < ea.x1;
    const overlapY = ea.y0 < eb.y1 && eb.y0 < ea.y1;
    return (ea.x1 <= eb.x0 && overlapY) || (ea.y1 <= eb.y0 && overlapX);
  };
  const depth = (a: FloorArea) => a.x + a.y + (a.width + a.depth) / 2;
  const remaining = [...areas].sort((a, b) => depth(a) - depth(b));
  const out: FloorArea[] = [];
  while (remaining.length) {
    const index = remaining.findIndex((a) => !remaining.some((b) => b !== a && behind(b, a)));
    out.push(...remaining.splice(index < 0 ? 0 : index, 1));
  }
  return out;
}

const orderedAreas = (areas: FloorArea[], preferredId?: string | null) =>
  [...areas].sort((a, b) =>
    a.id === preferredId ? -1 : b.id === preferredId ? 1 : a.order - b.order,
  );

/** A mesa cabe em (x, y) dentro da área, sem encostar em outra mesa nem em elemento? */
export function tableFits(
  t: Footprint & { id: string },
  x: number,
  y: number,
  area: FloorArea,
  placed: Mesa[],
  obstacles: Rect[],
  gap = COLLISION_GAP,
) {
  return fitsInArea(area, { x, y, ...dims(t) }) && !collides(t, x, y, placed, gap, obstacles);
}

/**
 * Primeira vaga livre, como findSpot() da referência, agora área por área (a preferida
 * primeiro). Se lotar, procura de 0,5 em 0,5 e, por último, aceita mesas encostadas.
 */
export function findSpot(
  t: Pick<Table, "id" | "shape" | "seats" | "rotation">,
  placed: Mesa[],
  layout: SalaoLayout,
  preferredAreaId?: string | null,
): { x: number; y: number; areaId: string } {
  const areas = orderedAreas(layout.areas, preferredAreaId);
  const { w, d } = dims({ ...t, x: 0, y: 0 });
  for (const area of areas) {
    const e = areaEdges(area);
    for (let y = e.y0 + 1.5; y < e.y1 - 0.5; y += 1.5) {
      for (let x = e.x0 + 1.5; x < e.x1 - 1.5; x += 1.5) {
        const [sx, sy] = snapInArea(area, w, d, x, y);
        if (
          placed.every((o) => Math.hypot(o.x - sx, o.y - sy) > 2) &&
          tableFits({ ...t, x: sx, y: sy }, sx, sy, area, placed, layout.obstacles)
        ) {
          return { x: sx, y: sy, areaId: area.id };
        }
      }
    }
  }
  for (const gap of [COLLISION_GAP, 0]) {
    for (const area of areas) {
      const e = areaEdges(area);
      for (let y = e.y0 + 0.5; y < e.y1; y += 0.5) {
        for (let x = e.x0 + 0.5; x < e.x1; x += 0.5) {
          const [sx, sy] = snapInArea(area, w, d, x, y);
          if (tableFits({ ...t, x: sx, y: sy }, sx, sy, area, placed, layout.obstacles, gap)) {
            return { x: sx, y: sy, areaId: area.id };
          }
        }
      }
    }
  }
  const first = areas[0] ?? DEFAULT_AREA;
  return { x: first.x + first.width / 2, y: first.y + first.depth / 2, areaId: first.id };
}

/** Vaga livre mais perto da posição atual, na mesma área (mesa que cresceu ou girou). */
export function nearestFreeSpot(
  t: Footprint & { id: string },
  others: Mesa[],
  area: FloorArea,
  obstacles: Rect[],
): Pt | null {
  const { w, d } = dims(t);
  const e = areaEdges(area);
  let best: Pt | null = null;
  let bestDistance = Infinity;
  for (let y = e.y0 + 0.5; y < e.y1; y += 0.5) {
    for (let x = e.x0 + 0.5; x < e.x1; x += 0.5) {
      const [sx, sy] = snapInArea(area, w, d, x, y);
      const distance = Math.hypot(sx - t.x, sy - t.y);
      if (distance < bestDistance && tableFits(t, sx, sy, area, others, obstacles)) {
        best = [sx, sy];
        bestDistance = distance;
      }
    }
  }
  return best;
}

/**
 * Garante posição e área para todas as mesas. Fica onde está a mesa cujo centro cai numa área
 * e não está em cima de outra; as demais ganham a primeira vaga livre. `changed` traz as que
 * mudaram de posição ou de área (para gravar).
 */
export function placeTables(tables: Table[], layout: SalaoLayout) {
  const sorted = [...tables].sort((a, b) => a.number - b.number);
  const placed: Mesa[] = [];
  const unplaced: Table[] = [];
  const changed: Mesa[] = [];
  for (const t of sorted) {
    const area =
      t.x != null && t.y != null && Number.isFinite(t.x) && Number.isFinite(t.y)
        ? areaAtPoint(layout.areas, t.x, t.y)
        : undefined;
    const mesa: Mesa | null =
      area && t.x != null && t.y != null ? { ...t, x: t.x, y: t.y, areaId: area.id } : null;
    if (area && mesa && !collides(mesa, mesa.x, mesa.y, placed, 0, layout.obstacles)) {
      placed.push(mesa);
      if (t.areaId !== area.id) changed.push(mesa);
    } else {
      unplaced.push(t);
    }
  }
  for (const t of unplaced) {
    const spot = findSpot(t, placed, layout, t.areaId);
    const mesa: Mesa = { ...t, ...spot };
    placed.push(mesa);
    changed.push(mesa);
  }
  placed.sort((a, b) => a.number - b.number);
  return { placed, changed };
}

/* ---------- elementos ---------- */

/** Ponto na parede (fundo ou esquerda) de área interna mais próximo de (wx, wy). */
export function wallSpot(
  length: number,
  areas: FloorArea[],
  wx: number,
  wy: number,
): { x: number; y: number; rotation: 0 | 1; areaId: string } | null {
  let best: { x: number; y: number; rotation: 0 | 1; areaId: string } | null = null;
  let bestDistance = Infinity;
  const clampAlong = (v: number, lo: number, hi: number) =>
    lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, snapHalf(v)));
  for (const area of areas) {
    if (area.kind !== "interna") continue;
    const e = areaEdges(area);
    const candidates: { x: number; y: number; rotation: 0 | 1 }[] = [];
    if (area.width >= length) {
      candidates.push({
        x: clampAlong(wx, e.x0 + length / 2, e.x1 - length / 2),
        y: e.y0,
        rotation: 0,
      });
    }
    if (area.depth >= length) {
      candidates.push({
        x: e.x0,
        y: clampAlong(wy, e.y0 + length / 2, e.y1 - length / 2),
        rotation: 1,
      });
    }
    for (const c of candidates) {
      const distance = Math.hypot(c.x - wx, c.y - wy);
      if (distance < bestDistance) {
        best = { ...c, areaId: area.id };
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** O elemento de chão cabe em (x, y) na área, sem ficar em cima de mesa ou de outro elemento? */
export function elementFits(
  element: FloorElement,
  area: FloorArea,
  tables: Mesa[],
  elements: FloorElement[],
) {
  const r = elementRect(element);
  return (
    fitsInArea(area, r, ELEMENT_PAD) &&
    !tables.some((t) => rectsCollide(r, tableRect(t), OBSTACLE_GAP)) &&
    !elements.some(
      (o) => o.id !== element.id && !isWallElement(o.kind) && rectsCollide(r, elementRect(o), 0),
    )
  );
}

export function snapElementInArea(area: FloorArea, element: FloorElement, x: number, y: number) {
  return snapInArea(area, element.width, element.depth, x, y, ELEMENT_PAD);
}

/** Primeira vaga para um elemento de chão novo. */
export function findElementSpot(
  element: FloorElement,
  areas: FloorArea[],
  tables: Mesa[],
  elements: FloorElement[],
  preferredAreaId?: string | null,
): FloorElement | null {
  for (const area of orderedAreas(areas, preferredAreaId)) {
    const e = areaEdges(area);
    for (let y = e.y0 + 0.5; y < e.y1; y += 0.5) {
      for (let x = e.x0 + 0.5; x < e.x1; x += 0.5) {
        const [sx, sy] = snapElementInArea(area, element, x, y);
        const candidate = { ...element, x: sx, y: sy, areaId: area.id };
        if (elementFits(candidate, area, tables, elements)) return candidate;
      }
    }
  }
  return null;
}

/* ---------- edição de áreas ---------- */

/**
 * Motivo para não aceitar a área nesse tamanho/posição, ou null se pode. Com `withContent`,
 * confere também se mesas e elementos da área continuam cabendo (redimensionar).
 */
export function areaProblem(
  next: FloorArea,
  areas: FloorArea[],
  tables: Mesa[],
  elements: FloorElement[],
  withContent = true,
): string | null {
  if (next.width < MIN_AREA_SIZE || next.depth < MIN_AREA_SIZE) {
    return `A área precisa ter pelo menos ${MIN_AREA_SIZE} x ${MIN_AREA_SIZE}.`;
  }
  if (areas.some((a) => a.id !== next.id && areasOverlap(a, next))) {
    return "A área encostaria em outra área.";
  }
  if (!withContent) return null;
  if (tables.some((t) => t.areaId === next.id && !fitsInArea(next, tableRect(t)))) {
    return "Há mesas que ficariam fora da área. Mova as mesas antes.";
  }
  const own = elements.filter((e) => e.areaId === next.id);
  if (own.some((e) => !isWallElement(e.kind) && !fitsInArea(next, elementRect(e), ELEMENT_PAD))) {
    return "Há elementos (balcão, caixa, cozinha) que ficariam fora da área.";
  }
  const walls = own.filter((e) => isWallElement(e.kind));
  if (walls.length && next.kind === "externa") {
    return "Área externa não tem parede: remova a porta ou a janela antes.";
  }
  if (walls.some((e) => e.width > (e.rotation ? next.depth : next.width))) {
    return "A porta ou a janela não cabe mais na parede.";
  }
  return null;
}

/** Porta/janela acompanham a parede quando a área muda de tamanho ou de lugar. */
export function fitWallElements(area: FloorArea, elements: FloorElement[]) {
  const e = areaEdges(area);
  return elements
    .filter((el) => el.areaId === area.id && isWallElement(el.kind))
    .map((el) => {
      const half = el.width / 2;
      return el.rotation
        ? { ...el, x: e.x0, y: Math.min(e.y1 - half, Math.max(e.y0 + half, el.y)) }
        : { ...el, y: e.y0, x: Math.min(e.x1 - half, Math.max(e.x0 + half, el.x)) };
    });
}

/** Lugar para uma área nova: à direita de tudo o que já existe. */
export function newAreaPosition(areas: FloorArea[]): Pt {
  if (!areas.length) return [0, 0];
  const right = Math.max(...areas.map((a) => a.x + a.width));
  const top = Math.min(...areas.map((a) => a.y));
  return [snapHalf(right + 1), snapHalf(top)];
}
