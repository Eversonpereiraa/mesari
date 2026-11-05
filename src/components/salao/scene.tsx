import { memo, type CSSProperties, type ReactNode, type SVGProps } from "react";
import type { FloorArea, FloorElement } from "@/lib/store";
import { areaEdges, ELEMENT_LABEL } from "./areas";
import {
  ELEMENT_COLORS,
  S,
  SELECTED_STROKE,
  TABLE_H,
  WALL_H,
  dims,
  iso,
  pts,
  tableNumber,
  type Faces,
  type Mesa,
  type Palette,
} from "./iso";
import { DOT_R, labelSize, type LabelLevel } from "./labels";

export type SalaoMode = "live" | "edit";

const MONO: CSSProperties = { fontFamily: "var(--font-mono)" };
const DISPLAY: CSSProperties = { fontFamily: "var(--font-display)" };

const LONG_OPEN_STROKE = "#B42318";

type TopProps = Pick<SVGProps<SVGElement>, "stroke" | "strokeWidth" | "className" | "style">;

/** Caixa isométrica: footprint x0..x1, y0..y1, altura h, base z. */
export function Box({
  x0,
  y0,
  x1,
  y1,
  h,
  c,
  z = 0,
  top,
}: {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  h: number;
  c: Faces;
  z?: number;
  top?: TopProps | undefined;
}) {
  return (
    <>
      <polygon
        points={pts([iso(x0, y1, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x0, y1, z + h)])}
        fill={c.side}
      />
      <polygon
        points={pts([iso(x1, y0, z), iso(x1, y1, z), iso(x1, y1, z + h), iso(x1, y0, z + h)])}
        fill={c.side2}
      />
      <polygon
        points={pts([
          iso(x0, y0, z + h),
          iso(x1, y0, z + h),
          iso(x1, y1, z + h),
          iso(x0, y1, z + h),
        ])}
        fill={c.top}
        {...top}
      />
    </>
  );
}

export function Cyl({
  cx,
  cy,
  r,
  h,
  c,
  top,
}: {
  cx: number;
  cy: number;
  r: number;
  h: number;
  c: Faces;
  top?: TopProps | undefined;
}) {
  const [sx, sy] = iso(cx, cy, 0);
  const rx = 1.2247 * r * S;
  const ry = 0.7071 * r * S;
  return (
    <>
      <ellipse cx={sx} cy={sy} rx={rx} ry={ry} fill={c.side2} />
      <rect x={sx - rx} y={sy - h} width={rx * 2} height={h} fill={c.side} />
      <ellipse cx={sx} cy={sy - h} rx={rx} ry={ry} fill={c.top} {...top} />
    </>
  );
}

const FLOOR = {
  interna: {
    fill: "#F4F1EA",
    stroke: "#E2DCCF",
    grid: "#D9D1C1",
    liveGrid: "#ECE6DA",
    name: "#A79C86",
  },
  externa: {
    fill: "#E3EADB",
    stroke: "#B7C4A8",
    grid: "#D3DCC8",
    liveGrid: "#D3DCC8",
    name: "#8E9A7F",
  },
} as const;

/** Piso da área, grade e nome escrito no chão. */
export const AreaFloor = memo(function AreaFloor({
  area,
  mode,
  selected,
}: {
  area: FloorArea;
  mode: SalaoMode;
  selected: boolean;
}) {
  const e = areaEdges(area);
  const look = FLOOR[area.kind];
  const lines: ReactNode[] = [];
  for (let i = Math.floor(e.x0) + 1; i < e.x1; i++) {
    const [x1, y1] = iso(i, e.y0);
    const [x2, y2] = iso(i, e.y1);
    lines.push(<line key={`x${i}`} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  for (let j = Math.floor(e.y0) + 1; j < e.y1; j++) {
    const [x1, y1] = iso(e.x0, j);
    const [x2, y2] = iso(e.x1, j);
    lines.push(<line key={`y${j}`} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return (
    <g>
      <polygon
        points={pts([iso(e.x0, e.y0), iso(e.x1, e.y0), iso(e.x1, e.y1), iso(e.x0, e.y1)])}
        fill={look.fill}
        stroke={selected ? SELECTED_STROKE : look.stroke}
        strokeWidth={selected ? 2.5 : 1.5}
        strokeDasharray={area.kind === "externa" && !selected ? "8 6" : undefined}
      />
      {/* No caixa a grade fica quase invisível; no editor ela ajuda a posicionar. */}
      <g
        stroke={mode === "edit" ? look.grid : look.liveGrid}
        strokeWidth={1}
        opacity={mode === "edit" ? 1 : 0.35}
        pointerEvents="none"
      >
        {lines}
      </g>
    </g>
  );
});

/**
 * Nome da área escrito no chão, junto ao lado da frente mais comprido. `scale` compensa o
 * zoom (legível de longe, sem virar letreiro de perto); o texto nunca passa da borda.
 */
export function AreaName({ area, scale, dim }: { area: FloorArea; scale: number; dim: boolean }) {
  const e = areaEdges(area);
  const text = area.name.toLocaleUpperCase("pt-BR");
  const alongFront = area.width >= area.depth;
  const room = ((alongFront ? area.width : area.depth) - 0.9) * S;
  const fontSize = Math.max(6, Math.min(12 * scale, room / (Math.max(text.length, 1) * 0.78)));
  // Começa no canto da frente à esquerda e corre pelo lado da frente ou pelo lado esquerdo.
  const [nx, ny] = iso(e.x0 + 0.45, e.y1 - 0.45);
  return (
    <text
      x={nx}
      y={ny}
      fontSize={fontSize}
      fontWeight={700}
      fill={FLOOR[area.kind].name}
      letterSpacing={fontSize / 6}
      transform={`rotate(${alongFront ? 30 : -30} ${nx} ${ny})`}
      dominantBaseline={alongFront ? "auto" : "hanging"}
      opacity={dim ? 0.35 : undefined}
      style={MONO}
    >
      {text}
    </text>
  );
}

/** Paredes do fundo (área interna). */
export const AreaWalls = memo(function AreaWalls({ area }: { area: FloorArea }) {
  const e = areaEdges(area);
  return (
    <g pointerEvents="none">
      <polygon
        points={pts([
          iso(e.x0, e.y0),
          iso(e.x1, e.y0),
          iso(e.x1, e.y0, WALL_H),
          iso(e.x0, e.y0, WALL_H),
        ])}
        fill="#E3DED3"
      />
      <polygon
        points={pts([
          iso(e.x0, e.y0),
          iso(e.x0, e.y1),
          iso(e.x0, e.y1, WALL_H),
          iso(e.x0, e.y0, WALL_H),
        ])}
        fill="#D6D0C3"
      />
    </g>
  );
});

/** Porta ou janela na parede (rotation 0 = parede do fundo, 1 = parede da esquerda). */
export function WallElementShape({
  element,
  selected,
  editable,
}: {
  element: FloorElement;
  selected: boolean;
  editable: boolean;
}) {
  const half = element.width / 2;
  const [z0, z1] = element.kind === "porta" ? [0, 40] : [18, 40];
  const a = element.rotation
    ? ([element.x, element.y - half] as const)
    : ([element.x - half, element.y] as const);
  const b = element.rotation
    ? ([element.x, element.y + half] as const)
    : ([element.x + half, element.y] as const);
  return (
    <polygon
      data-element-id={editable ? element.id : undefined}
      points={pts([
        iso(a[0], a[1], z0),
        iso(b[0], b[1], z0),
        iso(b[0], b[1], z1),
        iso(a[0], a[1], z1),
      ])}
      fill={element.kind === "porta" ? "#B9B09E" : "#CFE3E6"}
      stroke={selected ? SELECTED_STROKE : undefined}
      strokeWidth={selected ? 2.5 : undefined}
      style={editable ? { cursor: "grab" } : undefined}
      pointerEvents={editable ? undefined : "none"}
    />
  );
}

const ELEMENT_H = { balcao: 26, caixa: 20, cozinha: 34 } as const;

/** Balcão, caixa ou cozinha: bloco no chão. */
export function FloorElementShape({
  element,
  selected,
  editable,
}: {
  element: FloorElement;
  selected: boolean;
  editable: boolean;
}) {
  const kind = element.kind === "caixa" || element.kind === "cozinha" ? element.kind : "balcao";
  const h = ELEMENT_H[kind];
  const [lx, ly] = iso(element.x, element.y, h);
  return (
    <g
      data-element-id={editable ? element.id : undefined}
      style={editable ? { cursor: "grab" } : undefined}
      pointerEvents={editable ? undefined : "none"}
    >
      <Box
        x0={element.x - element.width / 2}
        y0={element.y - element.depth / 2}
        x1={element.x + element.width / 2}
        y1={element.y + element.depth / 2}
        h={h}
        c={ELEMENT_COLORS[kind]}
        top={selected ? { stroke: SELECTED_STROKE, strokeWidth: 2.5 } : undefined}
      />
      {kind !== "balcao" && (
        <text
          x={lx}
          y={ly + 4}
          textAnchor="middle"
          fontSize={10}
          fontWeight={700}
          letterSpacing={1}
          fill="#5D6B69"
          style={MONO}
          pointerEvents="none"
        >
          {ELEMENT_LABEL[kind].toLocaleUpperCase("pt-BR")}
        </text>
      )}
    </g>
  );
}

export function TableBody({
  t,
  palette,
  selected,
  alert,
  mode,
  filterId,
  label,
}: {
  t: Mesa;
  palette: Palette;
  selected: boolean;
  /** hour = ocupada há 60 min ou mais (pisca); long = há mais de 12 h (alerta forte). */
  alert: "none" | "hour" | "long";
  mode: SalaoMode;
  filterId: string;
  label: string;
}) {
  const { w, d } = dims(t);
  const [shx, shy] = iso(t.x, t.y);
  const strokeWidth = selected ? 3 : 1.6;
  const top: TopProps = {
    stroke: selected ? SELECTED_STROKE : alert === "long" ? LONG_OPEN_STROKE : palette.stroke,
    strokeWidth: alert === "long" && !selected ? 3 : strokeWidth,
    ...(alert !== "none" && {
      className: alert === "long" ? "salao-alert salao-alert-long" : "salao-alert",
      style: { "--salao-sw": strokeWidth } as CSSProperties,
    }),
  };
  return (
    <g
      className="salao-table"
      data-table-id={t.id}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      style={{ cursor: mode === "edit" ? "grab" : "pointer" }}
    >
      <ellipse
        cx={shx}
        cy={shy + 4}
        rx={(w + d) * 0.55 * S * 0.866}
        ry={(w + d) * 0.32 * S * 0.5}
        fill="rgba(60,50,30,.16)"
        filter={`url(#${filterId})`}
      />
      {t.shape === "round" ? (
        <Cyl cx={t.x} cy={t.y} r={w / 2} h={TABLE_H} c={palette} top={top} />
      ) : (
        <Box
          x0={t.x - w / 2}
          y0={t.y - d / 2}
          x1={t.x + w / 2}
          y1={t.y + d / 2}
          h={TABLE_H}
          c={palette}
          top={top}
        />
      )}
    </g>
  );
}

/**
 * Etiqueta sobre a mesa. Desenhada em coordenadas locais a partir da ponta (0,0) e escalada
 * por `scale`, para o texto não crescer junto com o zoom. `lift` sobe a etiqueta quando ela
 * encostaria em outra (com um fio até a mesa).
 */
export function TableLabel({
  t,
  level,
  line2,
  dot,
  selected,
  scale,
  lift,
  dim,
  warn = false,
}: {
  t: Mesa;
  level: LabelLevel;
  line2: string;
  dot: string;
  selected: boolean;
  scale: number;
  lift: number;
  dim: boolean;
  /** Mesa aberta há mais de 12 h: borda e tempo em vermelho escuro. */
  warn?: boolean;
}) {
  const [ax, ay] = iso(t.x, t.y, TABLE_H);
  const transform = `translate(${ax} ${ay}) scale(${scale})`;
  if (level === "dot") {
    const cy = -(22 + DOT_R + lift); // mesma posição usada em labels.ts (boxOf)
    return (
      <g transform={transform} opacity={dim ? 0.35 : undefined}>
        <circle
          cy={cy}
          r={DOT_R}
          fill={dot}
          stroke={selected ? SELECTED_STROKE : warn ? LONG_OPEN_STROKE : "#FFFFFF"}
          strokeWidth={selected || warn ? 2.5 : 1.5}
        />
        <text
          y={cy + 4}
          textAnchor="middle"
          fontSize={t.number >= 100 ? 9 : 11}
          fontWeight={800}
          fill="#FFFFFF"
          style={DISPLAY}
        >
          {t.number}
        </text>
      </g>
    );
  }
  const text = level === "full" ? line2 : "";
  const { w, h } = labelSize(level, text);
  const by = -(30 + h);
  return (
    <g transform={transform} opacity={dim ? 0.35 : undefined}>
      {lift > 0 && (
        <line x1={0} y1={-6} x2={0} y2={by + h - lift} stroke="#B9B2A4" strokeWidth={1} />
      )}
      <g transform={`translate(0 ${-lift})`}>
        <rect
          x={-w / 2}
          y={by}
          width={w}
          height={h}
          rx={9}
          fill="#FFFFFF"
          stroke={selected ? SELECTED_STROKE : warn ? LONG_OPEN_STROKE : "#E2DED4"}
          strokeWidth={selected || warn ? 2 : 1}
        />
        <path d={`M -6 ${by + h} L 0 ${by + h + 7} L 6 ${by + h} Z`} fill="#FFFFFF" />
        <circle cx={-w / 2 + 13} cy={by + 14} r={4.5} fill={dot} />
        <text
          x={-w / 2 + 23}
          y={by + 19}
          fontWeight={800}
          fontSize={15}
          fill="#16201F"
          style={DISPLAY}
        >
          Mesa {tableNumber(t.number)}
        </text>
        {text && (
          <text
            x={-w / 2 + 11}
            y={by + 36}
            fontWeight={500}
            fontSize={11.5}
            fill={warn ? LONG_OPEN_STROKE : "#66706D"}
            style={MONO}
          >
            {text}
          </text>
        )}
      </g>
    </g>
  );
}
