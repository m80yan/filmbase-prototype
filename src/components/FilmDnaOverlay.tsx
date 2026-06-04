import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { FilmDnaGeneratingLoader } from './FilmDnaGeneratingLoader';
import { resolvePosterUrlFromRaw } from '../lib/filmDnaPosterHydration';
import type { FilmDnaNode, FilmDnaTree } from '../types/filmDna';

type FilmDnaPanelProps = {
  status: 'loading' | 'ready' | 'error';
  tree: FilmDnaTree | null;
  errorMessage: string;
  /** 当前预览海报 URL（中心节点必须使用）。 */
  centerPosterUrl: string;
  centerTitle: string;
  centerYear?: number | null;
};

/** 侧栏最多展示的节点数。 */
const MAX_VISIBLE_NODES = 3;

/** 系列前/后作最多展示的节点数（与 Edge `MAX_SERIES_*` 一致）。 */
const MAX_SERIES_VISIBLE = 10;

const POSTER_W = 114;
const POSTER_H = 171;

/**
 * 系列链可视间距：上一格年份文字底边 → 下一格海报顶边（舞台 px）。
 * @see FilmDnaNodeCard — `mt-4` + `text-[14px] leading-normal` 标题/年份
 */
const SERIES_VISUAL_GAP_Y = 144;

/** 海报底到标题顶，与 `FilmDnaNodeCard` 的 `mt-4` 一致。 */
const SERIES_NODE_POSTER_TO_TITLE_GAP = 16;

/**
 * 标题 + 年份块高度：`text-[14px]` × `leading-normal`（1.5）× 2 行。
 */
const SERIES_NODE_TITLE_YEAR_TEXT_HEIGHT = 42;

/** 单格节点视觉高度：海报顶 → 年份底（含海报与下方文案）。 */
const SERIES_VISUAL_NODE_HEIGHT =
  POSTER_H +
  SERIES_NODE_POSTER_TO_TITLE_GAP +
  SERIES_NODE_TITLE_YEAR_TEXT_HEIGHT;

/**
 * 系列链垂直步进：上一格年份底 → 下一格海报顶 = `SERIES_VISUAL_GAP_Y`。
 */
const SERIES_STEP_Y = SERIES_VISUAL_NODE_HEIGHT + SERIES_VISUAL_GAP_Y;

/** Film DNA 虚拟舞台宽度与默认高度（docs/film-dna-spec.md）。 */
const STAGE_W = 1080;
const STAGE_H_BASE = 871;

/** 关系摘要最多展示条数。 */
const RELATIONSHIP_SUMMARY_MAX_BULLETS = 4;

/** 关系摘要浮层宽度（舞台 px）。 */
const RELATIONSHIP_SUMMARY_WIDTH = 360;

/** Significance 悬停摘要浮层宽度（舞台 px）。 */
const SIGNIFICANCE_SUMMARY_WIDTH = 360;

/** 摘要底边与 hover 放大后海报顶边之间的间隙（舞台 px）。 */
const RELATIONSHIP_SUMMARY_GAP_TO_POSTER = 16;

/** Significance 面板与海报右缘间距（舞台 px）。 */
const SIGNIFICANCE_SUMMARY_GAP_TO_POSTER = 24;

/** Significance 摘要最多展示条数。 */
const SIGNIFICANCE_SUMMARY_MAX_BULLETS = 4;

/** 系列轴悬停摘要最多展示条数（剧情 + 票房）。 */
const SERIES_SUMMARY_MAX_BULLETS = 2;


const NON_CANONICAL_LINEAGE_RE =
  /\b(remake|re-?adaptation|readaptation|reboot|new adaptation|same source material|same story|different era|prior (film|version|adaptation)|earlier (film|version|adaptation)|tv version|stage version|based on the same|another adaptation)\b/i;

/**
 * Poster View hover 缩放倍数（与 `scale-115` / `origin-center` 一致）。
 * @see POSTER_VIEW_HOVER
 */
const POSTER_HOVER_SCALE = 1.15;

/** 方向标签与海报边之间的间距（舞台 px）。 */
const DIRECTION_LABEL_GAP = 12;

/** Influence 方向标签相对锚点的额外偏移（舞台 px）。 */
const INFLUENCE_DIRECTION_LABEL_OFFSET_X = 24;
const INFLUENCE_DIRECTION_LABEL_OFFSET_Y = 24;

/** Legacy 方向标签相对锚点的额外偏移（舞台 px）。 */
const LEGACY_DIRECTION_LABEL_OFFSET_X = -24;
const LEGACY_DIRECTION_LABEL_OFFSET_Y = 24;

/**
 * hover 放大后海报顶边 Y（`origin-center` + `scale-115` 时顶边上移）。
 *
 * @param posterPos 海报矩形左上角（虚拟舞台坐标）
 */
function hoveredPosterTopAfterScale(posterPos: StagePoint): number {
  const scaleLift = (POSTER_H * (POSTER_HOVER_SCALE - 1)) / 2;
  return posterPos.top - scaleLift;
}

/**
 * hover 放大后海报左边 X（`origin-center` + `scale-115` 时左缘左移）。
 *
 * @param posterPos 海报矩形左上角（虚拟舞台坐标）
 */
function hoveredPosterLeftAfterScale(posterPos: StagePoint): number {
  const scaleShift = (POSTER_W * (POSTER_HOVER_SCALE - 1)) / 2;
  return posterPos.left - scaleShift;
}

/**
 * 由 hovered 节点海报计算关系摘要锚点（上下文注释，非中心锚定）。
 * `top` 为摘要块底边锚点；`left` 对齐放大后海报视觉左缘；组件内 `translateY(-100%)` 使底边落在此 Y。
 *
 * @param posterPos 海报矩形左上角（虚拟舞台坐标）
 */
function relationshipSummaryAnchor(posterPos: StagePoint): {
  left: number;
  top: number;
  width: number;
} {
  const posterTopScaled = hoveredPosterTopAfterScale(posterPos);
  return {
    left: hoveredPosterLeftAfterScale(posterPos),
    top: posterTopScaled - RELATIONSHIP_SUMMARY_GAP_TO_POSTER,
    width: RELATIONSHIP_SUMMARY_WIDTH,
  };
}

/**
 * Poster View 海报 hover：与列表/网格卡片一致。
 * @see App.tsx — `group-hover:scale-115` + `duration-300` + `origin-center`
 */
const POSTER_VIEW_HOVER =
  'origin-center transition-transform duration-300 ease-out group-hover/poster:scale-115';

type StagePoint = { left: number; top: number };

/**
 * 中心海报在 1080×871 舞台上的几何中心（仅海报矩形，不含标题/年份）。
 * 对齐 Background Dim Overlay 中心。
 */
/** @see docs/film-dna-spec.md — Film DNA Line Assets — Updated (Center Poster) */
const CENTER_POSTER_POS: StagePoint = {
  left: 483,
  top: 350,
};

/**
 * Figma 节点框坐标 → 海报锚点（海报位于节点框顶部，标题/年份在框外下方）。
 *
 * @param frame 节点框左上角（spec Node Position Coordinates）
 */
function nodeFrameToPosterAnchor(frame: StagePoint): StagePoint {
  return { left: frame.left, top: frame.top };
}

/**
 * 节点位置（Figma 虚拟坐标，允许负值）。
 * @see docs/film-dna-spec.md — Node Position Coordinates
 */
const NODE_POS = {
  center: { left: 546, top: 317 },
  influence: [
    { left: -63, top: 463 },
    { left: 51, top: 196 },
    { left: 164, top: 646 },
  ],
  legacy: [
    { left: 825, top: 61 },
    { left: 939, top: 599 },
    /** Legacy 03（如 Saving Private Ryan）：海报 top 350 → 左缘中点 y = 435.5，与 Center 右缘水平连线。 */
    { left: 1053, top: 350 },
  ],
  seriesPrev: { left: 483, top: 13 },
  seriesNext: { left: 483, top: 647 },
} as const satisfies Record<string, StagePoint | readonly StagePoint[]>;

type LineKey =
  | 'influence01'
  | 'influence02'
  | 'influence03'
  | 'legacy01'
  | 'legacy02'
  | 'legacy03'
  | 'seriesPrev'
  | 'seriesNext';

type StageCoord = { x: number; y: number };

/** Center Poster 固定边中点（舞台坐标，不随节点框推导）。 */
const CENTER_POSTER_ANCHORS = {
  left: { x: 483, y: 435.5 },
  right: { x: 597, y: 435.5 },
  top: { x: 540, y: 350 },
  bottom: { x: 540, y: 521 },
} as const satisfies Record<string, StageCoord>;

const CONNECTION_MARKER_R = 5.3335;
const CONNECTION_ARROW_LEN = 10;
const CONNECTION_ARROW_HALF = 5.3335;
const CONNECTION_STROKE_W = 2;

type PosterEdge = 'left' | 'right' | 'top' | 'bottom';

/**
 * 海报矩形 → 指定边中点（舞台坐标）。
 *
 * @param poster 海报左上角
 * @param edge 边
 */
function posterEdgeCenter(poster: StagePoint, edge: PosterEdge): StageCoord {
  switch (edge) {
    case 'left':
      return { x: poster.left, y: poster.top + POSTER_H / 2 };
    case 'right':
      return { x: poster.left + POSTER_W, y: poster.top + POSTER_H / 2 };
    case 'top':
      return { x: poster.left + POSTER_W / 2, y: poster.top };
    case 'bottom':
      return { x: poster.left + POSTER_W / 2, y: poster.top + POSTER_H };
  }
}

type ConnectionRouting = 'influence-legacy' | 'series-vertical';

type ConnectionRoute = {
  source: StageCoord;
  target: StageCoord;
  targetEdge: PosterEdge;
  routing: ConnectionRouting;
};


/**
 * Influence/Legacy（多节点布局）：水平出 → 垂直弯 → 水平进（侧向连接）。
 */
function buildInfluenceLegacyPolyline(
  source: StageCoord,
  target: StageCoord,
  targetEdge: PosterEdge,
): string {
  const approach = approachPointBeforeArrow(target, targetEdge);
  const midX = (source.x + approach.x) / 2;
  return `M ${source.x} ${source.y} H ${midX} V ${approach.y} H ${approach.x}`;
}

/**
 * Series Previous/Next：中心与系列节点上下对齐时纯垂直；否则一次水平转折。
 */
function buildSeriesVerticalPolyline(
  source: StageCoord,
  target: StageCoord,
  targetEdge: 'top' | 'bottom',
): string {
  const approach = approachPointBeforeArrow(target, targetEdge);
  if (Math.abs(source.x - approach.x) < 0.5) {
    return `M ${source.x} ${source.y} V ${approach.y}`;
  }
  const midY = (source.y + approach.y) / 2;
  return `M ${source.x} ${source.y} V ${midY} H ${approach.x} V ${approach.y}`;
}

/**
 * @param route 连线锚点与路由策略
 */
function buildConnectionPolyline(route: ConnectionRoute): string {
  if (route.routing === 'series-vertical') {
    return buildSeriesVerticalPolyline(
      route.source,
      route.target,
      route.targetEdge === 'bottom' ? 'bottom' : 'top',
    );
  }
  return buildInfluenceLegacyPolyline(
    route.source,
    route.target,
    route.targetEdge,
  );
}

/**
 * 箭头尖端落在目标锚点；折线止于箭头基底前。
 *
 * @param target 目标锚点
 * @param targetEdge 目标边
 */
function approachPointBeforeArrow(
  target: StageCoord,
  targetEdge: PosterEdge,
): StageCoord {
  switch (targetEdge) {
    case 'left':
      return { x: target.x - CONNECTION_ARROW_LEN, y: target.y };
    case 'right':
      return { x: target.x + CONNECTION_ARROW_LEN, y: target.y };
    case 'top':
      return { x: target.x, y: target.y - CONNECTION_ARROW_LEN };
    case 'bottom':
      return { x: target.x, y: target.y + CONNECTION_ARROW_LEN };
  }
}

/**
 * 目标三角箭头（尖端 = 目标锚点）。
 *
 * @param target 目标锚点
 * @param targetEdge 进入目标的边
 */
function connectionArrowPolygon(
  target: StageCoord,
  targetEdge: PosterEdge,
): string {
  const { x, y } = target;
  const h = CONNECTION_ARROW_HALF;
  const len = CONNECTION_ARROW_LEN;
  switch (targetEdge) {
    case 'left':
      return `${x},${y} ${x - len},${y - h} ${x - len},${y + h}`;
    case 'right':
      return `${x},${y} ${x + len},${y - h} ${x + len},${y + h}`;
    case 'top':
      return `${x},${y} ${x - h},${y - len} ${x + h},${y - len}`;
    case 'bottom':
      return `${x},${y} ${x - h},${y + len} ${x + h},${y + len}`;
  }
}

type FilmDnaConnectionSpec = {
  lineKey: string;
  route: ConnectionRoute;
  /** 系列链相邻段（仅 `seriesSeg*` 连线）。 */
  seriesSegment?: { fromChainIndex: number; toChainIndex: number };
};

/** 有序系列链中的单项（上→下 = 时间升序）。 */
type SeriesChainItem = {
  chainIndex: number;
  posterPos: StagePoint;
  hoverTarget: HoverTarget;
  node: FilmDnaNode;
};

/**
 * 规范化片名用于系列连线推断。
 *
 * @param title 片名
 */
function normalizeFilmTitleKey(title: string): string {
  return title.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * 两节点是否同一部影片（按标题）。
 *
 * @param a 节点 A
 * @param b 节点 B
 */
function filmNodesMatchTitle(a: FilmDnaNode, b: FilmDnaNode): boolean {
  return normalizeFilmTitleKey(a.title) === normalizeFilmTitleKey(b.title);
}

/**
 * @param year 年份字段
 */
function isUsableFilmYear(year: number | null | undefined): year is number {
  return typeof year === 'number' && Number.isFinite(year) && year > 0;
}

/**
 * 侧栏节点是否与系列轴节点为同一部影片（与 Edge `generate-film-dna` 跨槽去重一致）。
 *
 * @param a 节点 A
 * @param b 节点 B
 */
function filmNodesMatchForSeriesDedup(
  a: FilmDnaNode,
  b: FilmDnaNode,
): boolean {
  const idA = a.tmdbMovieId;
  const idB = b.tmdbMovieId;
  if (
    typeof idA === 'number' &&
    idA > 0 &&
    typeof idB === 'number' &&
    idB > 0
  ) {
    return idA === idB;
  }
  if (!filmNodesMatchTitle(a, b)) return false;
  const yearA = isUsableFilmYear(a.year) ? a.year : null;
  const yearB = isUsableFilmYear(b.year) ? b.year : null;
  if (yearA != null && yearB != null) return yearA === yearB;
  return true;
}

/**
 * 推断系列链相邻节点是否应绘制垂直连线（无显式 API 字段时）。
 *
 * @param upper 链中上方节点
 * @param lower 链中下方节点
 */
function inferLineageConnectedAbove(
  upper: FilmDnaNode,
  lower: FilmDnaNode,
): boolean {
  if (filmNodesMatchTitle(upper, lower)) return false;
  const combined = `${upper.note} ${lower.note} ${upper.title} ${lower.title}`;
  if (NON_CANONICAL_LINEAGE_RE.test(combined)) return false;
  return true;
}

/**
 * 是否绘制系列链上、下相邻海报之间的垂直连线/箭头。
 *
 * @param upper 上方节点
 * @param lower 下方节点
 */
function shouldDrawSeriesLineAbove(
  upper: FilmDnaNode,
  lower: FilmDnaNode,
): boolean {
  if (typeof lower.lineageConnectedAbove === 'boolean') {
    return lower.lineageConnectedAbove;
  }
  return inferLineageConnectedAbove(upper, lower);
}

/**
 * 根据节点框坐标生成全部连线的海报锚点端点。
 */
function buildFilmDnaConnectionSpecs(): FilmDnaConnectionSpec[] {
  const specs: FilmDnaConnectionSpec[] = [];

  NODE_POS.influence.forEach((frame, index) => {
    const poster = nodeFrameToPosterAnchor(frame);
    specs.push({
      lineKey: `influence0${index + 1}` as LineKey,
      route: {
        source: posterEdgeCenter(poster, 'right'),
        target: CENTER_POSTER_ANCHORS.left,
        targetEdge: 'left',
        routing: 'influence-legacy',
      },
    });
  });

  NODE_POS.legacy.forEach((frame, index) => {
    const poster = nodeFrameToPosterAnchor(frame);
    specs.push({
      lineKey: `legacy0${index + 1}` as LineKey,
      route: {
        source: CENTER_POSTER_ANCHORS.right,
        target: posterEdgeCenter(poster, 'left'),
        targetEdge: 'left',
        routing: 'influence-legacy',
      },
    });
  });

  return specs;
}

const FILM_DNA_INFLUENCE_LEGACY_SPECS = buildFilmDnaConnectionSpecs();

/**
 * 构建有序系列链：`[...seriesPrevious, center, ...seriesNext]`（上映日升序，与垂直布局一致）。
 *
 * @param seriesPrevious 系列前作节点
 * @param previousPositions 前作海报左上角（索引 0 = 最远/最上）
 * @param centerNode 中心节点
 * @param seriesNext 系列续作节点
 * @param nextPositions 续作海报左上角（索引 0 = 最近 center）
 */
function buildSeriesChain(
  seriesPrevious: FilmDnaNode[],
  previousPositions: StagePoint[],
  centerNode: FilmDnaNode,
  seriesNext: FilmDnaNode[],
  nextPositions: StagePoint[],
): SeriesChainItem[] {
  const chain: SeriesChainItem[] = [];

  previousPositions.forEach((posterPos, index) => {
    const node = seriesPrevious[index];
    if (!node) return;
    chain.push({
      chainIndex: chain.length,
      posterPos,
      hoverTarget: { kind: 'series-prev', index },
      node,
    });
  });

  chain.push({
    chainIndex: chain.length,
    posterPos: CENTER_POSTER_POS,
    hoverTarget: { kind: 'center' },
    node: centerNode,
  });

  nextPositions.forEach((posterPos, index) => {
    const node = seriesNext[index];
    if (!node) return;
    chain.push({
      chainIndex: chain.length,
      posterPos,
      hoverTarget: { kind: 'series-next', index },
      node,
    });
  });

  return chain;
}

/**
 * 在系列链相邻项之间生成垂直连线段（上海报底 → 下海报顶）。
 *
 * @param chain `buildSeriesChain` 输出
 */
function buildAdjacentSeriesConnectionSpecs(
  chain: SeriesChainItem[],
): FilmDnaConnectionSpec[] {
  const specs: FilmDnaConnectionSpec[] = [];

  for (let i = 0; i < chain.length - 1; i++) {
    const upper = chain[i];
    const lower = chain[i + 1];
    if (!shouldDrawSeriesLineAbove(upper.node, lower.node)) continue;

    const upperPoster = nodeFrameToPosterAnchor(upper.posterPos);
    const lowerPoster = nodeFrameToPosterAnchor(lower.posterPos);
    specs.push({
      lineKey: `seriesSeg${i}`,
      route: {
        source: posterEdgeCenter(upperPoster, 'bottom'),
        target: posterEdgeCenter(lowerPoster, 'top'),
        targetEdge: 'top',
        routing: 'series-vertical',
      },
      seriesSegment: { fromChainIndex: i, toChainIndex: i + 1 },
    });
  }

  return specs;
}

/**
 * 系列前作垂直堆叠：自固定 Center Poster 向上，步进 `SERIES_STEP_Y`（年份底 → 下一海报顶 `SERIES_VISUAL_GAP_Y`）。
 * `index 0` = 最远/最上；`index count-1` = 紧邻 center 上方一格。
 *
 * @param count 节点数（1–10）
 */
function layoutSeriesPreviousPositions(count: number): StagePoint[] {
  if (count <= 0) return [];
  const centerTop = CENTER_POSTER_POS.top;
  const centerLeft = CENTER_POSTER_POS.left;
  return Array.from({ length: count }, (_, index) => ({
    left: centerLeft,
    top: centerTop - (count - index) * SERIES_STEP_Y,
  }));
}

/**
 * 系列续作垂直堆叠：自固定 Center Poster 向下，步进 `SERIES_STEP_Y`（年份底 → 下一海报顶 `SERIES_VISUAL_GAP_Y`）。
 * `index 0` = 紧邻 center 下方一格。
 *
 * @param count 节点数（1–10）
 */
function layoutSeriesNextPositions(count: number): StagePoint[] {
  if (count <= 0) return [];
  const centerTop = CENTER_POSTER_POS.top;
  const centerLeft = CENTER_POSTER_POS.left;
  return Array.from({ length: count }, (_, index) => ({
    left: centerLeft,
    top: centerTop + (index + 1) * SERIES_STEP_Y,
  }));
}

type FilmDnaConnectionLinesProps = {
  influenceLegacyPresence: Record<LineKey, boolean>;
  seriesSpecs: FilmDnaConnectionSpec[];
  /** center 在系列链中的索引（= seriesPrevious 数量）。 */
  seriesCenterChainIndex: number;
  hover: HoverTarget | null;
};

/**
 * 全舞台 SVG：由海报锚点生成正交连线；viewBox 固定 1080×871，系列节点/线可溢出。
 */
function FilmDnaConnectionLines({
  influenceLegacyPresence,
  seriesSpecs,
  seriesCenterChainIndex,
  hover,
}: FilmDnaConnectionLinesProps) {
  return (
    <svg
      className="pointer-events-none absolute inset-0 z-[5]"
      width={STAGE_W}
      height={STAGE_H_BASE}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H_BASE}`}
      style={{ overflow: 'visible' }}
      aria-hidden
    >
      {FILM_DNA_INFLUENCE_LEGACY_SPECS.map(({ lineKey, route }) => {
        if (!influenceLegacyPresence[lineKey]) return null;
        const opacity = isLineHighlighted(
          hover,
          lineKey,
          true,
          seriesCenterChainIndex,
        )
          ? 1
          : 0.25;
        const polyline = buildConnectionPolyline(route);
        return (
          <g key={lineKey} fill="white" opacity={opacity}>
            <path
              d={polyline}
              fill="none"
              stroke="white"
              strokeWidth={CONNECTION_STROKE_W}
              strokeLinejoin="miter"
              strokeLinecap="butt"
            />
            <circle
              cx={route.source.x}
              cy={route.source.y}
              r={CONNECTION_MARKER_R}
            />
            <polygon
              points={connectionArrowPolygon(route.target, route.targetEdge)}
            />
          </g>
        );
      })}
      {seriesSpecs.map(({ lineKey, route, seriesSegment }) => {
        const opacity = isLineHighlighted(
          hover,
          lineKey,
          true,
          seriesCenterChainIndex,
          seriesSegment,
        )
          ? 1
          : 0.25;
        const polyline = buildConnectionPolyline(route);
        return (
          <g key={lineKey} fill="white" opacity={opacity}>
            <path
              d={polyline}
              fill="none"
              stroke="white"
              strokeWidth={CONNECTION_STROKE_W}
              strokeLinejoin="miter"
              strokeLinecap="butt"
            />
            <circle
              cx={route.source.x}
              cy={route.source.y}
              r={CONNECTION_MARKER_R}
            />
            <polygon
              points={connectionArrowPolygon(route.target, route.targetEdge)}
            />
          </g>
        );
      })}
    </svg>
  );
}

/**
 * 将节点年份格式化为展示文案。
 *
 * @param year 年份或 null
 */
function formatFilmDnaYear(year: number | null): string {
  if (year == null || !Number.isFinite(year)) return '';
  return String(Math.round(year));
}

/**
 * 中心/侧栏年份是否可用于时间序校验与排序。
 *
 * @param year 年份字段
 */
function isUsableFilmDnaYear(year: number | null | undefined): year is number {
  return typeof year === 'number' && Number.isFinite(year) && year > 0;
}

/**
 * Influence 节点年份是否严格早于 center（未知年份保留）。
 *
 * @param nodeYear 关联片年份
 * @param centerYear 中心片年份
 */
function isChronologyValidForInfluence(
  nodeYear: number | null,
  centerYear: number | null,
): boolean {
  if (!isUsableFilmDnaYear(centerYear)) return true;
  if (!isUsableFilmDnaYear(nodeYear)) return true;
  return nodeYear < centerYear;
}

/**
 * Legacy 节点年份是否严格晚于 center（未知年份保留）。
 *
 * @param nodeYear 关联片年份
 * @param centerYear 中心片年份
 */
function isChronologyValidForLegacy(
  nodeYear: number | null,
  centerYear: number | null,
): boolean {
  if (!isUsableFilmDnaYear(centerYear)) return true;
  if (!isUsableFilmDnaYear(nodeYear)) return true;
  return nodeYear > centerYear;
}

/**
 * 按年份升序排列 Influence/Legacy（不依赖 LLM 顺序）；未知年份排在已知年份之后。
 *
 * @param nodes 待排序节点
 */
function sortInfluenceLegacyByYearAsc(nodes: FilmDnaNode[]): FilmDnaNode[] {
  return nodes
    .map((node, index) => ({ node, index }))
    .sort((a, b) => {
      const ay = isUsableFilmDnaYear(a.node.year) ? a.node.year : null;
      const by = isUsableFilmDnaYear(b.node.year) ? b.node.year : null;
      if (ay !== null && by !== null) {
        const diff = ay - by;
        if (diff !== 0) return diff;
      } else if (ay !== null) {
        return -1;
      } else if (by !== null) {
        return 1;
      }
      return a.index - b.index;
    })
    .map(({ node }) => node);
}

/**
 * 校验时间序后按年份升序排列，再映射到 Influence/Legacy 槽位（index 0 最靠中心侧外缘）。
 *
 * @param nodes 原始侧栏列表
 * @param centerYear 中心片年份
 * @param side influence | legacy
 */
function orderInfluenceLegacyTimelineNodes(
  nodes: FilmDnaNode[],
  centerYear: number | null | undefined,
  side: InfluenceLegacyDirection,
): FilmDnaNode[] {
  const center = isUsableFilmDnaYear(centerYear) ? centerYear : null;
  const filtered = nodes.filter((n) =>
    side === 'influence'
      ? isChronologyValidForInfluence(n.year, center)
      : isChronologyValidForLegacy(n.year, center),
  );
  return sortInfluenceLegacyByYearAsc(filtered);
}

/**
 * 限制侧栏节点数量（最多 3 个）。
 *
 * @param nodes 原始节点列表
 */
function limitVisibleNodes(nodes: FilmDnaNode[]): FilmDnaNode[] {
  return nodes.slice(0, MAX_VISIBLE_NODES);
}

/**
 * 当垂直轴已展示与 center 同片名的版本时，从侧栏去掉同片名重复项；
 * 并去掉与系列轴（前作/续作）重复的侧栏节点（系列轴优先）。
 *
 * @param nodes 侧栏节点
 * @param center 中心片
 * @param seriesNodes 与 center 同片名判定用的系列槽（前作或续作）
 * @param seriesAxisNodes 完整系列轴（前作 + 续作），用于跨槽去重
 */
function excludeSameStoryOnVerticalAxis(
  nodes: FilmDnaNode[],
  center: FilmDnaNode,
  seriesNodes: FilmDnaNode[],
  seriesAxisNodes: FilmDnaNode[],
): FilmDnaNode[] {
  const centerKey = normalizeFilmTitleKey(center.title);
  const verticalHasSameStory = seriesNodes.some(
    (n) => normalizeFilmTitleKey(n.title) === centerKey,
  );
  let filtered = nodes;
  if (verticalHasSameStory) {
    filtered = filtered.filter(
      (n) => normalizeFilmTitleKey(n.title) !== centerKey,
    );
  }
  // Series axis wins over side lanes to avoid showing the same film as both a
  // sequel/prequel and an influence/legacy node.
  if (seriesAxisNodes.length) {
    filtered = filtered.filter(
      (n) => !seriesAxisNodes.some((s) => filmNodesMatchForSeriesDedup(n, s)),
    );
  }
  return filtered;
}

/**
 * 解析中心节点海报 URL（去空白；空串表示无可用地址）。
 *
 * @param raw App 传入的预览海报地址
 */
function resolveCenterPosterUrl(raw: string | null | undefined): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * 根据 hover 规则计算元素是否处于高亮路径（100% 不透明度）。
 *
 * @param hover 当前 hover 目标
 * @param target 待判定目标
 */
function isPathHighlighted(
  hover: HoverTarget | null,
  target: HoverTarget,
): boolean {
  if (!hover) return false;

  if (hover.kind === 'center') return true;

  if (target.kind === 'center') return true;

  if (hover.kind === 'influence' && target.kind === 'influence') {
    return hover.index === target.index;
  }
  if (hover.kind === 'legacy' && target.kind === 'legacy') {
    return hover.index === target.index;
  }
  if (hover.kind === 'series-prev' && target.kind === 'series-prev') {
    return hover.index === target.index;
  }
  if (hover.kind === 'series-next' && target.kind === 'series-next') {
    return hover.index === target.index;
  }

  return false;
}

type HoverTarget =
  | { kind: 'center' }
  | { kind: 'influence'; index: number }
  | { kind: 'legacy'; index: number }
  | { kind: 'series-prev'; index: number }
  | { kind: 'series-next'; index: number };

type InfluenceLegacyDirection = 'influence' | 'legacy';

type ActiveInfluenceLegacyHover = {
  direction: InfluenceLegacyDirection;
  node: FilmDnaNode;
  posterPos: StagePoint;
};

/**
 * 截断并清洗关系摘要要点。
 *
 * @param bullets 原始要点列表
 */
function clampRelationshipBullets(bullets: string[] | undefined): string[] {
  if (!bullets?.length) return [];
  return bullets
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, RELATIONSHIP_SUMMARY_MAX_BULLETS);
}

/**
 * 展示用：将每条 bullet 的首个可见字母大写（其余字符保持 API 原文）。
 *
 * @param bullet 原始要点
 */
function formatRelationshipBulletForDisplay(bullet: string): string {
  const trimmed = bullet.trim();
  if (!trimmed) return trimmed;
  const letterIndex = trimmed.search(/[a-zA-Z]/);
  if (letterIndex === -1) return trimmed;
  return (
    trimmed.slice(0, letterIndex) +
    trimmed[letterIndex].toLocaleUpperCase('en-US') +
    trimmed.slice(letterIndex + 1)
  );
}

/**
 * 解析 Influence/Legacy hover 时展示的关系摘要要点（无要点则不展示摘要层）。
 *
 * @param node 被 hover 的侧栏节点
 */
function resolveRelationshipSummaryBullets(
  node: FilmDnaNode,
): string[] | null {
  const bullets = clampRelationshipBullets(node.relationshipBullets);
  return bullets.length > 0 ? bullets : null;
}

/**
 * 截断并清洗 significance 摘要要点。
 *
 * @param bullets 原始要点列表
 */
function clampSignificanceBullets(bullets: string[] | undefined): string[] {
  if (!bullets?.length) return [];
  return bullets
    .map((b) => b.trim())
    .filter(Boolean)
    .slice(0, SIGNIFICANCE_SUMMARY_MAX_BULLETS);
}

/**
 * 垂直轴节点是否为同源/重拍/改编（可展示 significance 摘要）。
 *
 * @param node 系列轴节点
 * @param center 中心片
 */
function isSameSourceVerticalNode(
  node: FilmDnaNode,
  center: FilmDnaNode,
): boolean {
  if (node.sameSourceVertical === true) return true;
  if (node.sameSourceVertical === false) return false;
  if (node.lineageConnectedAbove === true) return false;
  if (node.lineageConnectedAbove === false) return true;
  if (filmNodesMatchTitle(node, center)) return true;
  const text = `${node.note} ${node.title}`;
  return NON_CANONICAL_LINEAGE_RE.test(text);
}

/**
 * 解析垂直轴同源/重拍/改编节点 hover 时的 significance 摘要。
 *
 * @param hover 当前 hover 目标
 * @param node 被 hover 的节点
 * @param center 中心片
 */
function resolveSignificanceSummaryBullets(
  hover: HoverTarget | null,
  node: FilmDnaNode,
  center: FilmDnaNode,
): string[] | null {
  if (!hover) return null;
  if (hover.kind !== 'series-prev' && hover.kind !== 'series-next') {
    return null;
  }
  if (!isSameSourceVerticalNode(node, center)) return null;
  const bullets = clampSignificanceBullets(node.significanceBullets);
  return bullets.length > 0 ? bullets : null;
}

/**
 * 将原始票房文案格式化为紧凑金额（如 `$136.4M`）。
 *
 * @param raw 原始票房字段
 */
function formatFilmDnaCompactBoxOffice(raw: string): string | null {
  const s = raw.trim();
  if (!s || s === '—' || /^n\/a$/i.test(s)) return null;

  const compactMatch = s.match(/^\$?\s*([\d.]+)\s*([BMK])$/i);
  if (compactMatch) {
    const amount = Number(compactMatch[1]);
    const unit = compactMatch[2].toUpperCase();
    if (Number.isFinite(amount) && amount > 0) {
      const display =
        amount >= 10
          ? amount.toFixed(0)
          : amount.toFixed(1).replace(/\.0$/, '');
      return `$${display}${unit}`;
    }
  }

  const digits = s.replace(/,/g, '').replace(/[^\d]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return null;

  const formatScaled = (scaled: number): string =>
    scaled >= 10
      ? scaled.toFixed(0)
      : scaled.toFixed(1).replace(/\.0$/, '');

  if (n >= 1_000_000_000) {
    return `$${formatScaled(n / 1_000_000_000)}B`;
  }
  if (n >= 1_000_000) {
    return `$${formatScaled(n / 1_000_000)}M`;
  }
  if (n >= 1_000) {
    return `$${formatScaled(n / 1_000)}K`;
  }
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * 系列轴票房摘要条：`Box office $136.4M`。
 *
 * @param raw 节点 `boxOffice` 字段
 */
function formatSeriesBoxOfficeBullet(raw: string | undefined): string | null {
  const amount = formatFilmDnaCompactBoxOffice(raw ?? '');
  if (!amount) return null;
  return `Box office ${amount}`;
}

/**
 * 解析垂直轴系列前/续作 hover 时的剧情/票房摘要（非 significance）。
 *
 * @param hover 当前 hover 目标
 * @param node 被 hover 的节点
 */
function resolveSeriesSummaryBullets(
  hover: HoverTarget | null,
  node: FilmDnaNode,
): string[] | null {
  if (!hover) return null;
  if (hover.kind !== 'series-prev' && hover.kind !== 'series-next') {
    return null;
  }

  const bullets: string[] = [];
  const plot = node.plotSummary?.trim();
  if (plot) bullets.push(plot);
  const boxOfficeBullet = formatSeriesBoxOfficeBullet(node.boxOffice);
  if (boxOfficeBullet) bullets.push(boxOfficeBullet);

  if (bullets.length === 0) return null;
  return bullets.slice(0, SERIES_SUMMARY_MAX_BULLETS);
}

/**
 * Significance 摘要锚点：海报右缘 + 24px，顶边与海报顶对齐。
 *
 * @param posterPos 海报矩形左上角（虚拟舞台坐标）
 */
function significanceSummaryAnchor(posterPos: StagePoint): {
  left: number;
  top: number;
  width: number;
} {
  return {
    left: posterPos.left + POSTER_W + SIGNIFICANCE_SUMMARY_GAP_TO_POSTER,
    top: posterPos.top,
    width: SIGNIFICANCE_SUMMARY_WIDTH,
  };
}


type FilmDnaSignificanceSummaryProps = {
  bullets: string[];
  posterPos: StagePoint;
};

/**
 * hovered 海报右侧的 significance 摘要（奖项、文化影响、历史地位、遗产）。
 */
function FilmDnaSignificanceSummary({
  bullets,
  posterPos,
}: FilmDnaSignificanceSummaryProps) {
  const anchor = significanceSummaryAnchor(posterPos);

  return (
    <motion.div
      key={bullets.join('|')}
      className="film-dna-significance-summary absolute z-30"
      style={{
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      role="note"
      aria-live="polite"
    >
      <ul className="list-none space-y-1 text-left">
        {bullets.map((bullet) => {
          const displayBullet = formatRelationshipBulletForDisplay(bullet);
          return (
            <li
              key={bullet}
              className="flex gap-1.5 text-[14px] font-[510] leading-snug text-white"
            >
              <span className="shrink-0 text-white" aria-hidden>
                •
              </span>
              <span>{displayBullet}</span>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

type FilmDnaSeriesSummaryProps = {
  bullets: string[];
  posterPos: StagePoint;
};

/**
 * 系列轴前/续作 hover 时海报右侧的剧情与票房摘要。
 */
function FilmDnaSeriesSummary({ bullets, posterPos }: FilmDnaSeriesSummaryProps) {
  const anchor = significanceSummaryAnchor(posterPos);

  return (
    <motion.div
      key={bullets.join('|')}
      className="film-dna-series-summary absolute z-30"
      style={{
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      role="note"
      aria-live="polite"
    >
      <ul className="list-none space-y-1 text-left">
        {bullets.map((bullet) => (
          <li
            key={bullet}
            className="flex gap-1.5 text-[14px] font-[510] leading-snug text-white"
          >
            <span className="shrink-0 text-white" aria-hidden>
              •
            </span>
            <span>{bullet}</span>
          </li>
        ))}
      </ul>
    </motion.div>
  );
}

type ActivePosterHover = {
  node: FilmDnaNode;
  posterPos: StagePoint;
};

type FilmDnaRelationshipSummaryProps = {
  bullets: string[];
  posterPos: StagePoint;
};

/**
 * hovered Influence/Legacy 海报上方的语义关系摘要（浮动于舞台，不参与布局）。
 */
function FilmDnaRelationshipSummary({
  bullets,
  posterPos,
}: FilmDnaRelationshipSummaryProps) {
  const anchor = relationshipSummaryAnchor(posterPos);

  return (
    <motion.div
      key={bullets.join('|')}
      className="film-dna-relationship-summary absolute z-30"
      style={{
        left: anchor.left,
        top: anchor.top,
        width: anchor.width,
        transform: 'translateY(-100%)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      role="note"
      aria-live="polite"
    >
      <ul className="list-none space-y-1 text-left">
        {bullets.map((bullet) => {
          const displayBullet = formatRelationshipBulletForDisplay(bullet);
          return (
            <li
              key={bullet}
              className="flex gap-1.5 text-[14px] font-[510] leading-snug text-white"
            >
              <span className="shrink-0 text-white" aria-hidden>
                •
              </span>
              <span>{displayBullet}</span>
            </li>
          );
        })}
      </ul>
    </motion.div>
  );
}

type FilmDnaDirectionLabelProps = {
  direction: InfluenceLegacyDirection;
  posterPos: StagePoint;
};

/**
 * Influence ➝ / ➝ Legacy：贴在 hovered 海报边中点，与连线垂直对齐。
 */
function FilmDnaDirectionLabel({
  direction,
  posterPos,
}: FilmDnaDirectionLabelProps) {
  const edge =
    direction === 'influence'
      ? posterEdgeCenter(posterPos, 'right')
      : posterEdgeCenter(posterPos, 'left');

  const isInfluence = direction === 'influence';
  const left = isInfluence
    ? edge.x +
      DIRECTION_LABEL_GAP +
      INFLUENCE_DIRECTION_LABEL_OFFSET_X
    : edge.x -
      DIRECTION_LABEL_GAP +
      LEGACY_DIRECTION_LABEL_OFFSET_X;
  const top = isInfluence
    ? edge.y + INFLUENCE_DIRECTION_LABEL_OFFSET_Y
    : edge.y + LEGACY_DIRECTION_LABEL_OFFSET_Y;

  return (
    <motion.div
      className="film-dna-direction-label absolute z-[25] text-[11px] font-[510] uppercase leading-none text-white/40"
      style={{
        left,
        top,
        transform: isInfluence
          ? 'translateY(-50%)'
          : 'translate(-100%, -50%)',
      }}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
      aria-hidden
    >
      {isInfluence ? (
        <span>
          Influence <span className="text-white/55">➝</span>
        </span>
      ) : (
        <span>
          <span className="text-white/55">➝</span> Legacy
        </span>
      )}
    </motion.div>
  );
}

/**
 * 将 hover 目标映射到系列链索引；非系列节点返回 `null`。
 *
 * @param hover 当前 hover
 * @param seriesCenterChainIndex center 在链中的索引
 */
function seriesChainIndexFromHover(
  hover: HoverTarget,
  seriesCenterChainIndex: number,
): number | null {
  if (hover.kind === 'center') return seriesCenterChainIndex;
  if (hover.kind === 'series-prev') return hover.index;
  if (hover.kind === 'series-next') {
    return seriesCenterChainIndex + 1 + hover.index;
  }
  return null;
}

/**
 * 系列相邻段是否应高亮：center hover 高亮整条系列链；系列节点仅高亮与之相邻的两段。
 *
 * @param hover 当前 hover
 * @param segment 段端点链索引
 * @param seriesCenterChainIndex center 链索引
 */
function isSeriesSegmentHighlighted(
  hover: HoverTarget | null,
  segment: { fromChainIndex: number; toChainIndex: number },
  seriesCenterChainIndex: number,
): boolean {
  if (!hover) return false;
  if (hover.kind === 'center') return true;

  const chainIndex = seriesChainIndexFromHover(hover, seriesCenterChainIndex);
  if (chainIndex === null) return false;

  return (
    chainIndex === segment.fromChainIndex ||
    chainIndex === segment.toChainIndex
  );
}

/**
 * 连线是否应高亮（含中心 hover 时全部连线）。
 *
 * @param hover 当前 hover
 * @param lineKey 连线槽位
 * @param hasNode 对应节点是否存在
 * @param seriesCenterChainIndex center 在系列链中的索引
 * @param seriesSegment 系列相邻段元数据（仅 `seriesSeg*`）
 */
function isLineHighlighted(
  hover: HoverTarget | null,
  lineKey: string,
  hasNode: boolean,
  seriesCenterChainIndex: number,
  seriesSegment?: { fromChainIndex: number; toChainIndex: number },
): boolean {
  if (!hover || !hasNode) return false;
  if (hover.kind === 'center') return true;

  if (seriesSegment) {
    return isSeriesSegmentHighlighted(
      hover,
      seriesSegment,
      seriesCenterChainIndex,
    );
  }

  const influenceLegacyMap: Record<LineKey, HoverTarget> = {
    influence01: { kind: 'influence', index: 0 },
    influence02: { kind: 'influence', index: 1 },
    influence03: { kind: 'influence', index: 2 },
    legacy01: { kind: 'legacy', index: 0 },
    legacy02: { kind: 'legacy', index: 1 },
    legacy03: { kind: 'legacy', index: 2 },
    seriesPrev: { kind: 'series-prev', index: 0 },
    seriesNext: { kind: 'series-next', index: 0 },
  };

  if (lineKey in influenceLegacyMap) {
    return isPathHighlighted(hover, influenceLegacyMap[lineKey as LineKey]);
  }

  return false;
}

type FilmDnaNodeTextProps = {
  text: string;
  className: string;
  /** 中心节点为 100% 不透明白字；侧栏为 25% 默认。 */
  isCenter?: boolean;
};

/**
 * 单行标题/年份：完整显示、不换行、不截断；可宽于 114px 海报。
 */
function FilmDnaNodeText({ text, className, isCenter = false }: FilmDnaNodeTextProps) {
  return (
    <motion.div className={`w-max max-w-none ${className}`}>
      <span
        className={`block whitespace-nowrap ${isCenter ? 'text-white' : ''}`}
      >
        {text}
      </span>
    </motion.div>
  );
}

type FilmDnaNodeCardProps = {
  node: FilmDnaNode;
  posterUrl?: string;
  isCenter?: boolean;
  /** 系列前/后作节点（舞台中心上下，高于侧栏 z-index）。 */
  isSeries?: boolean;
  highlighted: boolean;
  hoverTarget: HoverTarget;
  onHover: (target: HoverTarget | null) => void;
  /** 海报矩形左上角（虚拟舞台坐标，连线锚点）。 */
  posterPos: StagePoint;
};

/**
 * 海报锚点 + 框外元数据：114×171 海报参与连线；标题/年份在海报下方，不参与锚点。
 */
function FilmDnaNodeCard({
  node,
  posterUrl,
  isCenter = false,
  isSeries = false,
  highlighted,
  hoverTarget,
  onHover,
  posterPos,
}: FilmDnaNodeCardProps) {
  const year = formatFilmDnaYear(node.year);
  const dimmed = !isCenter && !highlighted;
  const textClass = isCenter
    ? 'text-[14px] font-[510] leading-normal text-white'
    : 'text-[14px] font-[510] leading-normal text-white/25';

  const posterSrc = isCenter
    ? resolveCenterPosterUrl(posterUrl)
    : resolvePosterUrlFromRaw({
        ...node,
        posterUrl: posterUrl ?? node.posterUrl,
      });

  return (
    <motion.article
      className={`group/poster absolute w-max max-w-none text-left ${
        isCenter || isSeries ? 'z-20' : 'z-10'
      }`}
      style={{ left: posterPos.left, top: posterPos.top }}
      onPointerEnter={() => onHover(hoverTarget)}
      onPointerLeave={() => onHover(null)}
      aria-label={node.title}
    >
      <motion.div
        className={`relative h-[171px] w-[114px] overflow-hidden transition-opacity duration-300 ease-out ${
          posterSrc ? POSTER_VIEW_HOVER : ''
        } ${dimmed ? 'opacity-25' : 'opacity-100'} group-hover/poster:opacity-100`}
      >
        {posterSrc ? (
          <img
            draggable={false}
            src={posterSrc}
            alt=""
            className="block h-[171px] w-[114px] aspect-[2/3] object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <div
            className="block h-[171px] w-[114px] bg-white/10"
            aria-hidden
          />
        )}
      </motion.div>
      <FilmDnaNodeText
        text={node.title}
        isCenter={isCenter}
        className={`mt-4 ${textClass} ${dimmed ? '' : '!text-white'} group-hover/poster:!text-white`}
      />
      {year ? (
        <FilmDnaNodeText
          text={year}
          isCenter={isCenter}
          className={`${textClass} ${dimmed ? '' : '!text-white'} group-hover/poster:!text-white`}
        />
      ) : null}
    </motion.article>
  );
}

type FilmDnaGraphProps = {
  tree: FilmDnaTree;
  centerPosterUrl: string;
  centerTitle: string;
  centerYear: number | null | undefined;
};

/**
 * Film DNA 关系图：1080×871 虚拟舞台 + 等比缩放 + 可拖拽平移。
 */
function FilmDnaGraph({
  tree,
  centerPosterUrl,
  centerTitle,
  centerYear,
}: FilmDnaGraphProps) {
  const seriesPrevious = (tree.seriesPrevious ?? []).slice(
    0,
    MAX_SERIES_VISIBLE,
  );
  const seriesNext = (tree.seriesNext ?? []).slice(0, MAX_SERIES_VISIBLE);
  const seriesPreviousPositions = layoutSeriesPreviousPositions(
    seriesPrevious.length,
  );
  const seriesNextPositions = layoutSeriesNextPositions(seriesNext.length);
  const centerNode: FilmDnaNode = useMemo(
    () => ({
      title: centerTitle,
      year: centerYear ?? null,
      note: tree.center.note ?? '',
      lineageConnectedAbove: tree.center.lineageConnectedAbove,
    }),
    [
      centerTitle,
      centerYear,
      tree.center.lineageConnectedAbove,
      tree.center.note,
    ],
  );

  const seriesChain = buildSeriesChain(
    seriesPrevious,
    seriesPreviousPositions,
    centerNode,
    seriesNext,
    seriesNextPositions,
  );
  const seriesCenterChainIndex = seriesPrevious.length;
  const seriesConnectionSpecs = buildAdjacentSeriesConnectionSpecs(seriesChain);
  const seriesAxisNodes = [...seriesPrevious, ...seriesNext];
  const influenceNodes = excludeSameStoryOnVerticalAxis(
    limitVisibleNodes(
      orderInfluenceLegacyTimelineNodes(tree.left, centerYear, 'influence'),
    ),
    centerNode,
    seriesPrevious,
    seriesAxisNodes,
  );
  const legacyNodes = excludeSameStoryOnVerticalAxis(
    limitVisibleNodes(
      orderInfluenceLegacyTimelineNodes(tree.right, centerYear, 'legacy'),
    ),
    centerNode,
    seriesNext,
    seriesAxisNodes,
  );

  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  // Stage panning only
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 });

  const resolvedCenterPosterUrl = resolveCenterPosterUrl(centerPosterUrl);

  useEffect(() => {
    if (resolvedCenterPosterUrl) return;
    console.warn(
      '[Film DNA] Center poster URL is empty — the center node cannot show the preview poster.',
      { centerTitle, centerPosterUrl },
    );
  }, [resolvedCenterPosterUrl, centerTitle, centerPosterUrl]);

  const influenceLegacyPresence: Record<LineKey, boolean> = {
    influence01: Boolean(influenceNodes[0]),
    influence02: Boolean(influenceNodes[1]),
    influence03: Boolean(influenceNodes[2]),
    legacy01: Boolean(legacyNodes[0]),
    legacy02: Boolean(legacyNodes[1]),
    legacy03: Boolean(legacyNodes[2]),
    seriesPrev: false,
    seriesNext: false,
  };


  const onCanvasPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: pan.x,
        originY: pan.y,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    [pan.x, pan.y],
  );

  const onCanvasPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d.pointerId !== e.pointerId) return;
      setPan({
        x: d.originX + (e.clientX - d.startX),
        y: d.originY + (e.clientY - d.startY),
      });
    },
    [],
  );

  const onCanvasPointerEnd = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d.pointerId !== e.pointerId) return;
      dragRef.current.pointerId = null;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    },
    [],
  );

  const activeInfluenceLegacy = useMemo((): ActiveInfluenceLegacyHover | null => {
    if (!hover) return null;
    if (hover.kind === 'influence') {
      const node = influenceNodes[hover.index];
      if (!node) return null;
      return {
        direction: 'influence',
        node,
        posterPos: nodeFrameToPosterAnchor(NODE_POS.influence[hover.index]),
      };
    }
    if (hover.kind === 'legacy') {
      const node = legacyNodes[hover.index];
      if (!node) return null;
      return {
        direction: 'legacy',
        node,
        posterPos: nodeFrameToPosterAnchor(NODE_POS.legacy[hover.index]),
      };
    }
    return null;
  }, [hover, influenceNodes, legacyNodes]);

  const relationshipBullets = useMemo(() => {
    if (!activeInfluenceLegacy) return null;
    return resolveRelationshipSummaryBullets(activeInfluenceLegacy.node);
  }, [activeInfluenceLegacy]);

  const activePosterHover = useMemo((): ActivePosterHover | null => {
    if (!hover) return null;
    if (hover.kind === 'center') {
      return { node: centerNode, posterPos: CENTER_POSTER_POS };
    }
    if (hover.kind === 'influence') {
      const node = influenceNodes[hover.index];
      if (!node) return null;
      return {
        node,
        posterPos: nodeFrameToPosterAnchor(NODE_POS.influence[hover.index]),
      };
    }
    if (hover.kind === 'legacy') {
      const node = legacyNodes[hover.index];
      if (!node) return null;
      return {
        node,
        posterPos: nodeFrameToPosterAnchor(NODE_POS.legacy[hover.index]),
      };
    }
    if (hover.kind === 'series-prev') {
      const node = seriesPrevious[hover.index];
      if (!node) return null;
      return {
        node,
        posterPos: seriesPreviousPositions[hover.index],
      };
    }
    if (hover.kind === 'series-next') {
      const node = seriesNext[hover.index];
      if (!node) return null;
      return {
        node,
        posterPos: seriesNextPositions[hover.index],
      };
    }
    return null;
  }, [
    hover,
    centerNode,
    influenceNodes,
    legacyNodes,
    seriesPrevious,
    seriesPreviousPositions,
    seriesNext,
    seriesNextPositions,
  ]);

  const seriesSummaryBullets = useMemo(() => {
    if (!activePosterHover) return null;
    return resolveSeriesSummaryBullets(hover, activePosterHover.node);
  }, [hover, activePosterHover]);

  const significanceBullets = useMemo(() => {
    if (!activePosterHover || seriesSummaryBullets) return null;
    return resolveSignificanceSummaryBullets(
      hover,
      activePosterHover.node,
      centerNode,
    );
  }, [hover, activePosterHover, centerNode, seriesSummaryBullets]);


  return (
    <motion.div
      className="film-dna-stage-host relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22 }}
      role="img"
      aria-label="Film DNA relationship graph"
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onCanvasPointerMove}
      onPointerUp={onCanvasPointerEnd}
      onPointerCancel={onCanvasPointerEnd}
    >
      <motion.div
        className="film-dna-stage-fit touch-none select-none"
        style={
          {
            '--film-dna-stage-h': STAGE_H_BASE,
          } as React.CSSProperties
        }
      >
        <motion.div
          className="relative overflow-visible"
          style={{
            width: STAGE_W,
            height: STAGE_H_BASE,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          <motion.div
            className="pointer-events-none absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.18 }}
          >
            <FilmDnaConnectionLines
              influenceLegacyPresence={influenceLegacyPresence}
              seriesSpecs={seriesConnectionSpecs}
              seriesCenterChainIndex={seriesCenterChainIndex}
              hover={hover}
            />
          </motion.div>

          <AnimatePresence>
            {relationshipBullets && activeInfluenceLegacy ? (
              <FilmDnaRelationshipSummary
                key={`${activeInfluenceLegacy.direction}-${activeInfluenceLegacy.node.title}-summary`}
                bullets={relationshipBullets}
                posterPos={activeInfluenceLegacy.posterPos}
              />
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {significanceBullets && activePosterHover ? (
              <FilmDnaSignificanceSummary
                key={`significance-${activePosterHover.node.title}-summary`}
                bullets={significanceBullets}
                posterPos={activePosterHover.posterPos}
              />
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {seriesSummaryBullets && activePosterHover ? (
              <FilmDnaSeriesSummary
                key={`series-summary-${activePosterHover.node.title}`}
                bullets={seriesSummaryBullets}
                posterPos={activePosterHover.posterPos}
              />
            ) : null}
          </AnimatePresence>
          <AnimatePresence>
            {activeInfluenceLegacy ? (
              <FilmDnaDirectionLabel
                key={`${activeInfluenceLegacy.direction}-${activeInfluenceLegacy.node.title}-label`}
                direction={activeInfluenceLegacy.direction}
                posterPos={activeInfluenceLegacy.posterPos}
              />
            ) : null}
          </AnimatePresence>

          {influenceNodes.map((node, index) => (
            <FilmDnaNodeCard
              key={`influence-${index}-${node.title}`}
              node={node}
              hoverTarget={{ kind: 'influence', index }}
              highlighted={isPathHighlighted(hover, {
                kind: 'influence',
                index,
              })}
              onHover={setHover}
              posterUrl={node.posterUrl}
              posterPos={nodeFrameToPosterAnchor(NODE_POS.influence[index])}
            />
          ))}

          <FilmDnaNodeCard
            node={centerNode}
            posterUrl={resolvedCenterPosterUrl}
            isCenter
            hoverTarget={{ kind: 'center' }}
            highlighted
            onHover={setHover}
            posterPos={CENTER_POSTER_POS}
          />

          {legacyNodes.map((node, index) => (
            <FilmDnaNodeCard
              key={`legacy-${index}-${node.title}`}
              node={node}
              hoverTarget={{ kind: 'legacy', index }}
              highlighted={isPathHighlighted(hover, {
                kind: 'legacy',
                index,
              })}
              onHover={setHover}
              posterUrl={node.posterUrl}
              posterPos={nodeFrameToPosterAnchor(NODE_POS.legacy[index])}
            />
          ))}

          {seriesPrevious.map((node, index) => (
            <FilmDnaNodeCard
              key={`series-prev-${index}-${node.title}`}
              node={node}
              posterUrl={node.posterUrl}
              isSeries
              hoverTarget={{ kind: 'series-prev', index }}
              highlighted={isPathHighlighted(hover, {
                kind: 'series-prev',
                index,
              })}
              onHover={setHover}
              posterPos={seriesPreviousPositions[index]}
            />
          ))}

          {seriesNext.map((node, index) => (
            <FilmDnaNodeCard
              key={`series-next-${index}-${node.title}`}
              node={node}
              posterUrl={node.posterUrl}
              isSeries
              hoverTarget={{ kind: 'series-next', index }}
              highlighted={isPathHighlighted(hover, {
                kind: 'series-next',
                index,
              })}
              onHover={setHover}
              posterPos={seriesNextPositions[index]}
            />
          ))}
        </motion.div>
      </motion.div>
    </motion.div>
  );
}

/**
 * 海报预览 Film DNA 模式内容区（与 Info 模式同层叠层，无独立标题栏/关闭按钮）。
 */
export default function FilmDnaPanel({
  status,
  tree,
  errorMessage,
  centerPosterUrl,
  centerTitle,
  centerYear,
}: FilmDnaPanelProps) {
  const isReady = status === 'ready' && Boolean(tree);

  return (
    <motion.div
      className={
        isReady
          ? 'absolute inset-0 flex min-h-0 w-full flex-col'
          : 'flex min-h-full w-full flex-col items-center justify-center px-4 py-8 sm:px-8'
      }
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.18 }}
      aria-busy={status === 'loading'}
    >
      {status === 'loading' ? (
        <motion.div
          className="flex flex-col items-center gap-4 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <FilmDnaGeneratingLoader size={104} />
          <p className="text-[14px] font-semibold text-white/70">
            Generating Film DNA…
          </p>
        </motion.div>
      ) : null}

      {status === 'error' ? (
        <motion.div
          className="mx-auto max-w-md px-4 text-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <p className="text-[14px] font-semibold text-red-300/95">
            {errorMessage || 'Could not generate Film DNA.'}
          </p>
        </motion.div>
      ) : null}

      {isReady && tree ? (
        <FilmDnaGraph
          tree={tree}
          centerPosterUrl={centerPosterUrl}
          centerTitle={centerTitle}
          centerYear={centerYear}
        />
      ) : null}
    </motion.div>
  );
}
