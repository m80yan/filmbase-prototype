import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { motion } from 'motion/react';
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

/** 多系列节点垂直堆叠步长（海报 + 标题区）。 */
const SERIES_STACK_STEP = 200;

/** Film DNA 虚拟舞台尺寸（docs/film-dna-spec.md）。 */
const STAGE_W = 1080;
const STAGE_H = 871;

const POSTER_W = 114;
const POSTER_H = 171;

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
 * Influence/Legacy：水平出 → 垂直弯 → 水平进（侧向连接）。
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
};

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
 * @param previousPositions 前作海报左上角（索引 0 = 最远/最上）
 * @param nextPositions 续作海报左上角（索引 0 = 最近 center）
 */
function buildSeriesChain(
  previousPositions: StagePoint[],
  nextPositions: StagePoint[],
): SeriesChainItem[] {
  const chain: SeriesChainItem[] = [];

  previousPositions.forEach((posterPos, index) => {
    chain.push({
      chainIndex: chain.length,
      posterPos,
      hoverTarget: { kind: 'series-prev', index },
    });
  });

  chain.push({
    chainIndex: chain.length,
    posterPos: CENTER_POSTER_POS,
    hoverTarget: { kind: 'center' },
  });

  nextPositions.forEach((posterPos, index) => {
    chain.push({
      chainIndex: chain.length,
      posterPos,
      hoverTarget: { kind: 'series-next', index },
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
    const upperPoster = nodeFrameToPosterAnchor(chain[i].posterPos);
    const lowerPoster = nodeFrameToPosterAnchor(chain[i + 1].posterPos);
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
 * 系列前作垂直堆叠坐标；单节点时保持 spec 原位 (483, 13)。
 *
 * @param count 节点数（1–10）
 */
function layoutSeriesPreviousPositions(count: number): StagePoint[] {
  if (count <= 0) return [];
  if (count === 1) return [NODE_POS.seriesPrev];
  return Array.from({ length: count }, (_, index) => ({
    left: NODE_POS.seriesPrev.left,
    top: NODE_POS.seriesPrev.top + index * SERIES_STACK_STEP,
  }));
}

/**
 * 系列续作垂直堆叠坐标；单节点时保持 spec 原位 (483, 647)。
 *
 * @param count 节点数（1–10）
 */
function layoutSeriesNextPositions(count: number): StagePoint[] {
  if (count <= 0) return [];
  if (count === 1) return [NODE_POS.seriesNext];
  return Array.from({ length: count }, (_, index) => ({
    left: NODE_POS.seriesNext.left,
    top: NODE_POS.seriesNext.top + index * SERIES_STACK_STEP,
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
 * 全舞台 1080×871 SVG：由海报锚点生成正交连线（非 Figma 导出 path）。
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
      height={STAGE_H}
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
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
 * 限制侧栏节点数量（最多 3 个）。
 *
 * @param nodes 原始节点列表
 */
function limitVisibleNodes(nodes: FilmDnaNode[]): FilmDnaNode[] {
  return nodes.slice(0, MAX_VISIBLE_NODES);
}

/**
 * 从 Influence/Legacy 列表中排除与系列节点重复的影片（防止续作显示在右侧 Legacy 区）。
 *
 * @param nodes 侧栏节点
 * @param seriesNodes 系列前/后作列表
 */
function excludeSeriesDuplicates(
  nodes: FilmDnaNode[],
  seriesNodes: FilmDnaNode[],
): FilmDnaNode[] {
  if (!seriesNodes.length) return nodes;
  const keys = new Set(
    seriesNodes.map((n) => n.title.toLowerCase().trim()),
  );
  return nodes.filter((n) => !keys.has(n.title.toLowerCase().trim()));
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
    : posterUrl?.trim()
      ? posterUrl.trim()
      : '';

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
      {posterSrc ? (
        <motion.div
          className={`relative h-[171px] w-[114px] overflow-hidden ${POSTER_VIEW_HOVER} transition-opacity duration-300 ease-out ${
            dimmed ? 'opacity-25' : 'opacity-100'
          } group-hover/poster:opacity-100`}
        >
          <img
            draggable={false}
            src={posterSrc}
            alt=""
            className="block h-[171px] w-[114px] aspect-[2/3] object-cover"
            referrerPolicy="no-referrer"
          />
        </motion.div>
      ) : null}
      <FilmDnaNodeText
        text={node.title}
        isCenter={isCenter}
        className={`${posterSrc ? 'mt-4' : ''} ${textClass} ${dimmed ? '' : '!text-white'} group-hover/poster:!text-white`}
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
  const seriesChain = buildSeriesChain(
    seriesPreviousPositions,
    seriesNextPositions,
  );
  const seriesCenterChainIndex = seriesPrevious.length;
  const seriesConnectionSpecs = buildAdjacentSeriesConnectionSpecs(seriesChain);
  const influenceNodes = excludeSeriesDuplicates(
    limitVisibleNodes(tree.left),
    seriesPrevious,
  );
  const legacyNodes = excludeSeriesDuplicates(
    limitVisibleNodes(tree.right),
    seriesNext,
  );

  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  }>({ pointerId: null, startX: 0, startY: 0, originX: 0, originY: 0 });

  const centerNode: FilmDnaNode = {
    title: centerTitle,
    year: centerYear ?? null,
    note: tree.center.note ?? '',
  };

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
      <motion.div className="film-dna-stage-fit touch-none select-none">
        <div
          className="relative overflow-visible"
          style={{
            width: STAGE_W,
            height: STAGE_H,
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
              posterPos={nodeFrameToPosterAnchor(seriesPreviousPositions[index])}
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
              posterPos={nodeFrameToPosterAnchor(seriesNextPositions[index])}
            />
          ))}
        </div>
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
          <motion.div
            className="h-9 w-9 animate-spin rounded-full border-2 border-white/15 border-t-[#EA9794]"
            aria-hidden
          />
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
