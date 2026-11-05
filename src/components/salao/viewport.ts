import type { FloorArea } from "@/lib/store";
import { areaEdges } from "./areas";
import { WALL_H, iso } from "./iso";

/** Pixels de tela por unidade do viewBox em 100% (o tamanho do protótipo num computador). */
export const REF_SCALE = 0.85;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;
const FIT_MARGIN = 28; // unidades do viewBox em volta das áreas
const LABEL_HEADROOM = 70; // espaço acima das áreas para as etiquetas

export type Bounds = { x0: number; y0: number; x1: number; y1: number };
export type Size = { w: number; h: number };
/** Centro da visão (unidades do viewBox) e zoom (1 = 100%). */
export type Viewport = { cx: number; cy: number; zoom: number };

/** Limites, em unidades do viewBox, de todas as áreas projetadas (com paredes e etiquetas). */
export function layoutBounds(
  areas: Pick<FloorArea, "x" | "y" | "width" | "depth" | "kind">[],
): Bounds {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const area of areas) {
    const e = areaEdges(area);
    const wall = area.kind === "interna" ? WALL_H : 0;
    for (const [x, y, z] of [
      [e.x0, e.y0, wall],
      [e.x1, e.y0, wall],
      [e.x1, e.y1, 0],
      [e.x0, e.y1, wall],
    ] as const) {
      const [sx, sy] = iso(x, y, z);
      xs.push(sx);
      ys.push(sy);
    }
  }
  if (!xs.length) return { x0: 40, y0: 40, x1: 1150, y1: 780 };
  return {
    x0: Math.min(...xs) - FIT_MARGIN,
    y0: Math.min(...ys) - FIT_MARGIN - LABEL_HEADROOM,
    x1: Math.max(...xs) + FIT_MARGIN,
    y1: Math.max(...ys) + FIT_MARGIN,
  };
}

const scaleOf = (v: Viewport) => v.zoom * REF_SCALE;

export function viewBoxOf(v: Viewport, size: Size) {
  const k = scaleOf(v);
  const w = size.w / k;
  const h = size.h / k;
  return { x: v.cx - w / 2, y: v.cy - h / 2, w, h };
}

export const fitZoom = (b: Bounds, size: Size) =>
  Math.min(size.w / (b.x1 - b.x0), size.h / (b.y1 - b.y0)) / REF_SCALE;

export function fitViewport(b: Bounds, size: Size, maxZoom = MAX_ZOOM): Viewport {
  return {
    cx: (b.x0 + b.x1) / 2,
    cy: (b.y0 + b.y1) / 2,
    zoom: Math.min(maxZoom, fitZoom(b, size)),
  };
}

/** Mínimo de 50%, mas sempre permitindo ver tudo ("Ajustar") num salão muito grande. */
export const minZoomFor = (b: Bounds, size: Size) => Math.min(MIN_ZOOM, fitZoom(b, size));

/** Zoom mantendo parado o ponto da tela (px, py), em pixels do container. */
export function zoomAround(
  v: Viewport,
  size: Size,
  factor: number,
  px: number,
  py: number,
  minZoom = MIN_ZOOM,
): Viewport {
  const zoom = Math.min(MAX_ZOOM, Math.max(minZoom, v.zoom * factor));
  const k0 = scaleOf(v);
  const k1 = zoom * REF_SCALE;
  const wx = v.cx + (px - size.w / 2) / k0;
  const wy = v.cy + (py - size.h / 2) / k0;
  return { zoom, cx: wx - (px - size.w / 2) / k1, cy: wy - (py - size.h / 2) / k1 };
}

/** Arrastar a visão: o conteúdo acompanha o dedo/mouse. */
export function panPixels(v: Viewport, dx: number, dy: number): Viewport {
  const k = scaleOf(v);
  return { ...v, cx: v.cx - dx / k, cy: v.cy - dy / k };
}

export function lerpViewport(a: Viewport, b: Viewport, t: number): Viewport {
  return {
    cx: a.cx + (b.cx - a.cx) * t,
    cy: a.cy + (b.cy - a.cy) * t,
    zoom: Math.exp(Math.log(a.zoom) + (Math.log(b.zoom) - Math.log(a.zoom)) * t),
  };
}
