import { describe, expect, it } from "vitest";
import type { FloorArea, FloorElement, Table } from "@/lib/store";
import { chairs, collides, dims, iso } from "@/components/salao/iso";
import {
  DEFAULT_AREA,
  DEFAULT_ELEMENTS,
  areaProblem,
  fitWallElements,
  obstaclesOf,
  placeTables,
  snapInArea,
  sortAreasBackToFront,
  wallSpot,
} from "@/components/salao/areas";
import {
  fitViewport,
  layoutBounds,
  viewBoxOf,
  zoomAround,
  type Size,
} from "@/components/salao/viewport";
import { labelLevel, labelScale, layoutLabels } from "@/components/salao/labels";

const table = (patch: Partial<Table>): Table => ({
  id: "t",
  number: 1,
  seats: 4,
  x: null,
  y: null,
  shape: "square",
  rotation: 0,
  areaId: null,
  status: "livre",
  active: true,
  ...patch,
});
const area = (patch: Partial<FloorArea>): FloorArea => ({ ...DEFAULT_AREA, ...patch });
const layout = (
  areas: FloorArea[] = [DEFAULT_AREA],
  elements: FloorElement[] = DEFAULT_ELEMENTS,
) => ({
  areas,
  obstacles: obstaclesOf(elements),
});

const reference: [number, number, number, Table["shape"], number, 0 | 1][] = [
  [1, 2, 1.5, "square", 4, 0],
  [2, 4.5, 1.5, "square", 4, 0],
  [3, 7, 1.5, "round", 2, 0],
  [4, 9.5, 1.7, "rect", 6, 0],
  [5, 2, 4.2, "round", 4, 0],
  [6, 4.5, 4.2, "round", 4, 0],
  [7, 7, 4.2, "square", 2, 0],
  [8, 9.5, 4.6, "rect", 8, 1],
  [9, 2, 7, "square", 4, 0],
  [10, 4.5, 7, "square", 4, 0],
  [11, 7, 7, "rect", 6, 0],
];

describe("mapa do salão: geometria das mesas", () => {
  it("usa a mesma projeção da referência", () => {
    const [x, y] = iso(0, 0);
    expect(x).toBeCloseTo(9 * 0.8660254 * 58 + 70);
    expect(y).toBe(150);
  });

  it("aceita de 1 a 20 lugares em qualquer formato", () => {
    const at = { x: 5, y: 5, rotation: 0 as const };
    for (const shape of ["round", "square", "rect"] as const) {
      for (let seats = 1; seats <= 20; seats++) {
        expect(chairs({ ...at, shape, seats })).toHaveLength(seats);
      }
    }
    expect(dims({ ...at, shape: "rect", seats: 6 })).toEqual({ w: 2.0, d: 1.05 });
    expect(dims({ ...at, shape: "rect", seats: 8, rotation: 1 })).toEqual({ w: 1.05, d: 2.6 });
    expect(dims({ ...at, shape: "square", seats: 2 })).toEqual({ w: 0.9, d: 0.9 });
  });

  it("põe o lugar ímpar da retangular na cabeceira", () => {
    const seatsAt = chairs({ x: 5, y: 5, shape: "rect", seats: 7, rotation: 0 });
    const head = seatsAt.filter(([, y]) => y === 5);
    expect(head).toHaveLength(1);
    expect(head[0]?.[0]).toBeGreaterThan(5);
  });
});

describe("mapa do salão: áreas", () => {
  it("mantém o layout da referência no Salão 12 x 9 (com o balcão)", () => {
    const { changed } = placeTables(
      reference.map(([n, x, y, shape, seats, rotation]) =>
        table({ id: `r${n}`, number: n, x, y, shape, seats, rotation, areaId: DEFAULT_AREA.id }),
      ),
      layout(),
    );
    expect(changed).toEqual([]);
  });

  it("não deixa mesa em cima do balcão", () => {
    const big = { ...table({ id: "big", shape: "round", seats: 12 }), x: 11, y: 1.5 };
    expect(collides(big, 11, 1.5, [], 0.8, obstaclesOf(DEFAULT_ELEMENTS))).toBe(true);
  });

  it("põe na área certa mesas sem posição, com pixels antigos ou uma em cima da outra", () => {
    const varanda = area({ id: "varanda", name: "Varanda", kind: "externa", y: 9, depth: 3 });
    const { placed, changed } = placeTables(
      [
        table({ id: "a", number: 5, x: 4.5, y: 4.5, areaId: DEFAULT_AREA.id }),
        table({ id: "b", number: 17, x: 4.5, y: 4.5, areaId: DEFAULT_AREA.id }),
        table({ id: "c", number: 20, x: 200, y: 140 }),
        table({ id: "d", number: 21, x: 3, y: 10.5, areaId: null }),
      ],
      layout([DEFAULT_AREA, varanda]),
    );
    expect(changed.map((t) => t.id).sort()).toEqual(["b", "c", "d"]);
    expect(placed.find((t) => t.id === "d")?.areaId).toBe("varanda");
    for (const t of placed) {
      expect(t.areaId).not.toBeNull();
      expect(collides(t, t.x, t.y, placed, 0)).toBe(false);
    }
  });

  it("encaixa de meio em meio dentro da área, respeitando a borda", () => {
    expect(snapInArea(DEFAULT_AREA, 1.15, 1.15, 4.3, 2.8)).toEqual([4.5, 3]);
    const [x, y] = snapInArea(DEFAULT_AREA, 1.15, 1.15, -3, 50);
    expect(x).toBeCloseTo(0.6 + 0.575);
    expect(y).toBeCloseTo(9 - 0.6 - 0.575);
  });

  it("não deixa área sobrepor outra nem deixar mesas de fora", () => {
    const varanda = area({ id: "varanda", kind: "externa", y: 9, depth: 3 });
    const tables = [{ ...table({ id: "m", areaId: DEFAULT_AREA.id }), x: 10, y: 7 }];
    expect(areaProblem({ ...varanda, y: 8 }, [DEFAULT_AREA, varanda], tables, [])).toMatch(
      /outra área/,
    );
    expect(areaProblem({ ...DEFAULT_AREA, width: 8 }, [DEFAULT_AREA], tables, [])).toMatch(/mesas/);
    expect(areaProblem({ ...DEFAULT_AREA, width: 14 }, [DEFAULT_AREA], tables, [])).toBeNull();
  });

  it("leva porta e janela junto com a parede", () => {
    const moved = { ...DEFAULT_AREA, x: 2, y: 1 };
    const walls = fitWallElements(moved, DEFAULT_ELEMENTS);
    expect(walls.find((e) => e.kind === "porta")).toMatchObject({ x: 2 });
    expect(walls.find((e) => e.kind === "janela")).toMatchObject({ y: 1 });
    expect(wallSpot(1.2, [area({ kind: "externa" })], 1, 1)).toBeNull();
    expect(wallSpot(1.2, [DEFAULT_AREA], 0.3, 6)).toMatchObject({ x: 0, y: 6, rotation: 1 });
  });

  it("pinta as áreas de trás antes das da frente", () => {
    const frente = area({ id: "frente", y: 9, depth: 3 });
    const fundo = area({ id: "fundo" });
    expect(sortAreasBackToFront([frente, fundo]).map((a) => a.id)).toEqual(["fundo", "frente"]);
  });
});

describe("mapa do salão: zoom", () => {
  const size: Size = { w: 1000, h: 600 };

  it("Ajustar enquadra todas as áreas", () => {
    const b = layoutBounds([DEFAULT_AREA, area({ id: "v", x: 13, kind: "externa" })]);
    const vb = viewBoxOf(fitViewport(b, size), size);
    expect(vb.x).toBeLessThanOrEqual(b.x0 + 1e-6);
    expect(vb.y).toBeLessThanOrEqual(b.y0 + 1e-6);
    expect(vb.x + vb.w).toBeGreaterThanOrEqual(b.x1 - 1e-6);
    expect(vb.y + vb.h).toBeGreaterThanOrEqual(b.y1 - 1e-6);
  });

  it("zoom no cursor mantém o ponto embaixo do cursor e respeita 50%–300%", () => {
    const v = { cx: 500, cy: 400, zoom: 1 };
    const before = viewBoxOf(v, size);
    const next = zoomAround(v, size, 2, 250, 150);
    const after = viewBoxOf(next, size);
    expect(before.x + (250 / size.w) * before.w).toBeCloseTo(after.x + (250 / size.w) * after.w);
    expect(before.y + (150 / size.h) * before.h).toBeCloseTo(after.y + (150 / size.h) * after.h);
    expect(zoomAround(v, size, 100, 0, 0).zoom).toBe(3);
    expect(zoomAround(v, size, 0.01, 0, 0).zoom).toBe(0.5);
  });
});

describe("mapa do salão: etiquetas", () => {
  it("mostra mais detalhe conforme o zoom", () => {
    expect(labelLevel(0.6, "live", "ocupada", false)).toBe("dot");
    expect(labelLevel(1, "live", "ocupada", false)).toBe("full");
    expect(labelLevel(1, "live", "livre", false)).toBe("name");
    expect(labelLevel(1.6, "live", "livre", false)).toBe("full");
    expect(labelLevel(0.6, "live", "livre", true)).toBe("full");
  });

  it("não deixa o texto crescer mais que 1,3x", () => {
    expect(labelScale(3) * 3).toBeCloseTo(1.3);
    expect(labelScale(1)).toBe(1);
  });

  it("sobe ou reduz a etiqueta que encostaria em outra", () => {
    const spec = (id: string, priority: number) => ({
      id,
      level: "full" as const,
      line2: "R$ 10,00 · 5 min",
      ax: 500,
      ay: 400,
      priority,
    });
    const placed = layoutLabels([spec("frente", 2), spec("tras", 1)], 1);
    expect(placed.get("frente")).toEqual({ level: "full", lift: 0 });
    expect(placed.get("tras")?.lift).toBeGreaterThan(0);
  });
});
