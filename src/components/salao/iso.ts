import type { OrderLine, Status, Table } from "@/lib/store";

/** Projeção isométrica e geometria das mesas — mesmos números do protótipo de referência. */
export const S = 58; // tamanho do ladrilho
export const COS = 0.8660254;
export const SIN = 0.5;
export const OX = 9 * COS * S + 70; // origem do mundo (0,0) no viewBox
export const OY = 150;
export const WALL_H = 52; // altura das paredes das áreas internas
export const TABLE_H = 22; // altura do tampo
export const CHAIR_H = 13;
export const COLLISION_GAP = 0.8;
export const WALL_GAP = 0.6;

export type StatusMesa = Status;
export type ItemPedido = OrderLine;
/** Mesa já posicionada no salão (x/y garantidos). */
export type Mesa = Table & { x: number; y: number };
export type Pt = [number, number];
export type Faces = { top: string; side: string; side2: string };
export type Palette = Faces & { stroke: string; label: string };

export const COLORS: Record<StatusMesa | "edit", Palette> = {
  livre: {
    top: "#DDF2E5",
    side: "#B9DEC8",
    side2: "#A7D3B9",
    stroke: "#1F9D57",
    label: "Livre",
  },
  ocupada: {
    top: "#FBDCDB",
    side: "#EFB4B2",
    side2: "#E59E9C",
    stroke: "#E4464B",
    label: "Ocupada",
  },
  conta: {
    top: "#FDEBC8",
    side: "#F2CF8F",
    side2: "#EAC072",
    stroke: "#E39B2E",
    label: "Conta solicitada",
  },
  edit: { top: "#EFE7DA", side: "#D9CCB6", side2: "#CDBEA5", stroke: "#8A7A5E", label: "" },
};
export const CHAIR_COLORS: Record<"live" | "edit", Faces> = {
  live: { top: "#E7E3DA", side: "#CFC9BC", side2: "#C2BBAB" },
  edit: { top: "#D9CCB6", side: "#C3B396", side2: "#B6A587" },
};
export const ELEMENT_COLORS: Record<"balcao" | "caixa" | "cozinha", Faces> = {
  balcao: { top: "#3C5556", side: "#2B4142", side2: "#233637" },
  caixa: { top: "#E9E2D3", side: "#D2C8B4", side2: "#C5BAA3" },
  cozinha: { top: "#D9D4CB", side: "#BFB8AC", side2: "#B2AA9C" },
};
export const SELECTED_STROKE = "#0E292A";

export const iso = (x: number, y: number, z = 0): Pt => [
  OX + (x - y) * COS * S,
  OY + (x + y) * SIN * S - z,
];
export const pts = (arr: Pt[]) => arr.map((p) => p.join(",")).join(" ");

export type Footprint = Pick<Table, "shape" | "seats" | "rotation"> & { x: number; y: number };

export const MIN_SEATS = 1;
export const MAX_SEATS = 20;
export const clampSeats = (seats: number) =>
  Math.min(MAX_SEATS, Math.max(MIN_SEATS, Math.round(seats) || MIN_SEATS));

const SEAT_SPACING = 0.6; // espaço de cada cadeira ao longo da mesa, em unidades de grade
const CHAIR_OFFSET = 0.42;
// Ordem dos lados da quadrada: fundo, frente, direita, esquerda (2 lugares = fundo e frente).
const SQUARE_SIDES: Pt[] = [
  [0, -1],
  [0, 1],
  [1, 0],
  [-1, 0],
];

function roundDiameter(seats: number) {
  if (seats <= 2) return 0.9;
  if (seats <= 4) return 1.25;
  if (seats <= 6) return 1.6;
  if (seats <= 8) return 1.9;
  return Math.min(3.9, 1.9 + (seats - 8) * 0.17);
}

/** Cadeiras por lado da quadrada: até 4 lugares, 1 por lado; depois distribui igualmente. */
function squareSideCounts(seats: number) {
  const base = Math.floor(seats / 4);
  return SQUARE_SIDES.map((_, i) => base + (i < seats % 4 ? 1 : 0));
}

const cents = (value: number) => Math.round(value * 100) / 100;

function squareSize(seats: number) {
  if (seats <= 2) return 0.9;
  const perSide = Math.ceil(seats / 4);
  return perSide <= 1 ? 1.15 : cents(perSide * SEAT_SPACING + 0.3);
}

/** Retangular: lugares nos lados compridos; o ímpar vai na cabeceira. 6 → 2,0 e 8 → 2,6. */
function rectLength(seats: number) {
  return Math.max(1.4, cents(Math.floor(seats / 2) * SEAT_SPACING + 0.2));
}

export function dims(t: Footprint) {
  const seats = clampSeats(t.seats);
  if (t.shape === "round") {
    const size = roundDiameter(seats);
    return { w: size, d: size };
  }
  if (t.shape === "square") {
    const size = squareSize(seats);
    return { w: size, d: size };
  }
  const L = rectLength(seats);
  return t.rotation ? { w: 1.05, d: L } : { w: L, d: 1.05 };
}

export function chairs(t: Footprint): Pt[] {
  const { w, d } = dims(t);
  const seats = clampSeats(t.seats);
  const out: Pt[] = [];
  const off = CHAIR_OFFSET;
  if (t.shape === "round") {
    const r = w / 2 + off * 0.95;
    for (let i = 0; i < seats; i++) {
      const a = (i / seats) * Math.PI * 2 + Math.PI / 4;
      out.push([t.x + Math.cos(a) * r, t.y + Math.sin(a) * r]);
    }
    return out;
  }
  if (t.shape === "square") {
    squareSideCounts(seats).forEach((count, side) => {
      const [sx, sy] = SQUARE_SIDES[side] ?? [0, 0];
      const along = sx === 0 ? w : d;
      for (let i = 0; i < count; i++) {
        const f = -along / 2 + (along * (i + 0.5)) / count;
        out.push([
          t.x + sx * (w / 2 + off) + (sx === 0 ? f : 0),
          t.y + sy * (d / 2 + off) + (sy === 0 ? f : 0),
        ]);
      }
    });
    return out;
  }
  const per = Math.floor(seats / 2);
  const long = Math.max(w, d);
  for (let i = 0; i < per; i++) {
    const f = -long / 2 + (long * (i + 0.5)) / per;
    if (!t.rotation) {
      out.push([t.x + f, t.y - (d / 2 + off)]);
      out.push([t.x + f, t.y + (d / 2 + off)]);
    } else {
      out.push([t.x - (w / 2 + off), t.y + f]);
      out.push([t.x + (w / 2 + off), t.y + f]);
    }
  }
  if (seats % 2) {
    out.push(t.rotation ? [t.x, t.y + d / 2 + off] : [t.x + w / 2 + off, t.y]);
  }
  return out;
}

/** Retângulo no chão (centro x/y, largura w ao longo de x, profundidade d ao longo de y). */
export type Rect = { x: number; y: number; w: number; d: number };
/** Folga entre mesa e elementos fixos (balcão, caixa, cozinha). */
export const OBSTACLE_GAP = 0.3;

export const rectsCollide = (a: Rect, b: Rect, gap: number) =>
  Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.d + b.d) / 2 + gap;

export const tableRect = (t: Footprint): Rect => ({ x: t.x, y: t.y, ...dims(t) });

/** A mesa em (nx, ny) encosta em outra mesa (folga `gap`) ou num elemento fixo? */
export function collides(
  t: Footprint & { id: string },
  nx: number,
  ny: number,
  others: Mesa[],
  gap = COLLISION_GAP,
  obstacles: Rect[] = [],
) {
  const a: Rect = { x: nx, y: ny, ...dims(t) };
  const obstacleGap = Math.min(gap, OBSTACLE_GAP);
  if (obstacles.some((o) => rectsCollide(a, o, obstacleGap))) return true;
  return others.some((o) => o.id !== t.id && rectsCollide(a, tableRect(o), gap));
}

export const seatsLabel = (seats: number) => `${seats} ${seats === 1 ? "lugar" : "lugares"}`;

/** Inversa da projeção: ponto da tela (clientX/Y) para coordenadas do salão. */
export function toWorld(svg: SVGSVGElement, clientX: number, clientY: number): Pt | null {
  const ctm = svg.getScreenCTM();
  if (!ctm) return null;
  const p = new DOMPoint(clientX, clientY).matrixTransform(ctm.inverse());
  const a = (p.x - OX) / (COS * S);
  const b = (p.y - OY) / (SIN * S);
  return [(a + b) / 2, (b - a) / 2];
}

export const tableNumber = (n: number) => String(n).padStart(2, "0");
