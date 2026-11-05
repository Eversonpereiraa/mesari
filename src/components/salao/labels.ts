import type { Status } from "@/lib/store";

/** dot = só o número; name = "Mesa 03"; full = "Mesa 03" + valor/tempo ou lugares. */
export type LabelLevel = "dot" | "name" | "full";

export const DOT_ZOOM = 0.8;
export const FULL_ZOOM = 1.4;

export function labelLevel(
  zoom: number,
  mode: "live" | "edit",
  status: Status,
  emphasized: boolean,
): LabelLevel {
  if (emphasized) return "full";
  if (zoom < DOT_ZOOM) return "dot";
  if (zoom <= FULL_ZOOM) return mode === "live" && status !== "livre" ? "full" : "name";
  return "full";
}

/**
 * Escala das etiquetas, compensando o zoom: abaixo de 80% não encolhem mais; acima de 1,3x
 * não crescem mais (o texto não vira letreiro).
 */
export const labelScale = (zoom: number) =>
  zoom < DOT_ZOOM ? DOT_ZOOM / zoom : zoom > 1.3 ? 1.3 / zoom : 1;

export const DOT_R = 12;
export function labelSize(level: LabelLevel, line2: string) {
  if (level === "dot") return { w: DOT_R * 2, h: DOT_R * 2 };
  if (level === "name" || !line2) return { w: 92, h: 28 };
  return { w: Math.max(92, line2.length * 7.4 + 22), h: 44 };
}

export type LabelSpec = {
  id: string;
  level: LabelLevel;
  line2: string;
  /** Ponto (viewBox) do tampo da mesa onde a etiqueta aponta. */
  ax: number;
  ay: number;
  /** Maior primeiro: selecionada/hover, depois as da frente. */
  priority: number;
};
export type PlacedLabel = { level: LabelLevel; lift: number };

type Box = { x0: number; y0: number; x1: number; y1: number };
const GAP_ABOVE = 30; // distância da ponta da etiqueta até o tampo (unidades sem escala)

function boxOf(spec: LabelSpec, level: LabelLevel, lift: number, s: number): Box {
  const { w, h } = labelSize(level, spec.line2);
  if (level === "dot") {
    const cy = spec.ay - (GAP_ABOVE - 8 + DOT_R + lift) * s;
    return {
      x0: spec.ax - DOT_R * s,
      x1: spec.ax + DOT_R * s,
      y0: cy - DOT_R * s,
      y1: cy + DOT_R * s,
    };
  }
  const top = spec.ay - (GAP_ABOVE + h + lift) * s;
  return { x0: spec.ax - (w / 2) * s, x1: spec.ax + (w / 2) * s, y0: top, y1: top + (h + 7) * s };
}

const hits = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Evita etiquetas umas sobre as outras: as de maior prioridade ficam no lugar; as outras sobem
 * um ou dois "andares" e, se ainda colidirem, viram só o número.
 */
export function layoutLabels(specs: LabelSpec[], scale: number): Map<string, PlacedLabel> {
  const placed: Box[] = [];
  const out = new Map<string, PlacedLabel>();
  for (const spec of [...specs].sort((a, b) => b.priority - a.priority)) {
    const { h } = labelSize(spec.level, spec.line2);
    const lifts = spec.level === "dot" ? [0, DOT_R * 2 + 4] : [0, h + 6, 2 * (h + 6)];
    let result: PlacedLabel | null = null;
    for (const lift of lifts) {
      const box = boxOf(spec, spec.level, lift, scale);
      if (!placed.some((p) => hits(p, box))) {
        placed.push(box);
        result = { level: spec.level, lift };
        break;
      }
    }
    if (!result) {
      const box = boxOf(spec, "dot", 0, scale);
      placed.push(box);
      result = { level: "dot", lift: 0 };
    }
    out.set(spec.id, result);
  }
  return out;
}
