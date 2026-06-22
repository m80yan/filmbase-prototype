import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Film } from 'lucide-react';
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
  /** True while the exit animation is playing (toggle or ESC path). */
  isExiting?: boolean;
  /** Scale factor for the enter/exit morph: how many times larger than the DNA node the preview poster appears. */
  enterScale?: number;
  /** Called when the user clicks Play Trailer on the center node. */
  onPlayCenterTrailer?: () => void;
  /** Called when the user clicks Play Trailer on a non-center node. */
  onPlayNodeTrailer?: (node: FilmDnaNode) => void;
  /** Returns true if a non-center node has a matching library movie (determines Play Trailer vs Add Movie CTA). */
  isLibraryNode?: (node: FilmDnaNode) => boolean;
  /** Called when the user clicks Add Movie on a non-center node not yet in the library. */
  onAddMovieNode?: (node: FilmDnaNode) => void;
  /** Called when the user clicks Jump Here on an in-library child node — re-centers Film DNA on that movie. */
  onJumpToNode?: (node: FilmDnaNode) => void;
  /** Called once the move-to-center animation finishes; the parent then enters the jump loading state. */
  onJumpMoveComplete?: () => void;
  /** True while a jump animation or jump load is active — suppresses repeated Jump Here clicks. */
  isJumpActive?: boolean;
  /** When true, the center node skips the morph-in entrance (the jump ghost already moved it in). */
  disableCenterMorph?: boolean;
  /** Loading caption; defaults to the first-open copy. Jump flow passes “Loading This Film’s DNA…”. */
  loadingLabel?: string;
  /** Ref attached to the center node div — used by the parent to capture its rect for the exit FLIP. */
  centerNodeRef?: RefObject<HTMLDivElement>;
  /** When true, the exit FLIP is running: hide the center node instantly so the Preview poster animates instead. */
  exitHeroActive?: boolean;
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

/** Y-axis connector source — 10 px below year text (resting child node). */
const SERIES_YEAR_ANCHOR_BELOW = SERIES_VISUAL_NODE_HEIGHT + 10;
/** Y-axis connector source — 10 px below action button (center node or hovered child).
 *  8 px = `mt-2` wrapper margin, 36 px = `h-9` button height, 10 px gap. */
const SERIES_BUTTON_ANCHOR_BELOW = SERIES_VISUAL_NODE_HEIGHT + 8 + 36 + 10;

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
    { left: -63, top: 551 },  // middle influence node (+88 from original 463)
    { left: 51, top: 196 },
    { left: 164, top: 774 },  // lower influence node (+128 from original 646)
  ],
  legacy: [
    { left: 825, top: 61 },
    { left: 939, top: 687 },  // lower legacy node (+88 from original 599)
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
  straight?: boolean;
  /** When set, overrides the auto-computed midX so the center-side horizontal
   *  segment stays fixed while only the child-side segment changes length. */
  fixedMidX?: number;
};


/**
 * Influence/Legacy（多节点布局）：水平出 → 垂直弯 → 水平进（侧向连接）。
 * When `straight` is true (single visible node on that side), render a direct
 * straight line from source to the approach point instead of the bent polyline.
 */
function buildInfluenceLegacyPolyline(
  source: StageCoord,
  target: StageCoord,
  targetEdge: PosterEdge,
  straight?: boolean,
  fixedMidX?: number,
): string {
  const approach = approachPointBeforeArrow(target, targetEdge);
  if (straight) {
    return `M ${source.x} ${source.y} L ${approach.x} ${approach.y}`;
  }
  const midX = fixedMidX !== undefined ? fixedMidX : (source.x + approach.x) / 2;
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
    route.straight,
    route.fixedMidX,
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

/**
 * Outward delta for a poster edge when the poster is hovered and scaled (origin-center).
 * Each edge expands outward by half the total size increase.
 */
function scaledPosterEdgeOffset(
  edge: PosterEdge,
  hovered: boolean,
): { dx: number; dy: number } {
  if (!hovered) return { dx: 0, dy: 0 };
  const dH = (POSTER_W * (POSTER_HOVER_SCALE - 1)) / 2;  // 8.55 px
  const dV = (POSTER_H * (POSTER_HOVER_SCALE - 1)) / 2;  // 12.825 px
  switch (edge) {
    case 'left':   return { dx: -dH, dy: 0 };
    case 'right':  return { dx: +dH, dy: 0 };
    case 'top':    return { dx: 0,   dy: -dV };
    case 'bottom': return { dx: 0,   dy: +dV };
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

/** Machine-generated note injected by TMDb collection detection (edge function). */
const SERIES_PREV_NOTE = "Previous entry in the same series.";
const SERIES_NEXT_NOTE = "Next entry in the same series.";

/**
 * Positive signal that two adjacent Y-axis entries are in true series continuity
 * (sequel, prequel, franchise installment) and should draw a connecting line.
 * Model-generated notes for numbered parts, sequels, prequels, follow-ups.
 * NOTE: SERIES_PREV_NOTE / SERIES_NEXT_NOTE are intentionally excluded from the
 * canonical test to prevent self-validation of machine-generated TMDb text.
 */
const CANONICAL_SERIES_RE =
  /\b(sequel|prequel|follow-?up|continuation|franchise|same series|entry in the same|previous entry|next entry|previous installment|next installment|part \d|chapter \d|#\d)\b|\b[2-9]\s*:/i;

// Case-sensitive: excludes lowercase "v" (versus) found in titles like "Batman v Superman".
const ROMAN_NUMERAL_SEQUEL_RE = /\b(II|III|IV|V|VI|VII|VIII|IX|X)\b/;

/**
 * 推断系列链相邻节点是否应绘制垂直连线（无显式 API 字段时）。
 *
 * Returns true only when a positive canonical-series signal is present in
 * lower.note or the titles. upper.note is excluded because it may be the
 * machine-generated TMDb constant which would self-match CANONICAL_SERIES_RE.
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
  // upper.note excluded: may be SERIES_PREV_NOTE / SERIES_NEXT_NOTE which
  // self-matches CANONICAL_SERIES_RE and produces false positives.
  const canonicalTest = `${lower.note} ${upper.title} ${lower.title}`;
  if (CANONICAL_SERIES_RE.test(canonicalTest) || ROMAN_NUMERAL_SEQUEL_RE.test(canonicalTest)) return true;
  return false;
}

/**
 * 是否绘制系列链上、下相邻海报之间的垂直连线/箭头。
 *
 * TMDb-machine-note nodes (SERIES_PREV_NOTE / SERIES_NEXT_NOTE) are always
 * re-validated via inference regardless of cached boolean, because the stored
 * value may have been produced by an older pass that defaulted to false for
 * sequels like "Rambo III" whose note carries no explicit canonical signal.
 * Non-TMDb explicit true/false is trusted as-is.
 *
 * @param upper 上方节点
 * @param lower 下方节点
 */
function shouldDrawSeriesLineAbove(
  upper: FilmDnaNode,
  lower: FilmDnaNode,
): boolean {
  if (upper.note === SERIES_PREV_NOTE || upper.note === SERIES_NEXT_NOTE) {
    return inferLineageConnectedAbove(upper, lower);
  }
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

const EMPTY_FILM_DNA_TREE: FilmDnaTree = {
  center: { title: '', year: null, note: '' },
  left: [],
  right: [],
  seriesPrevious: [],
  seriesNext: [],
};

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
  influenceLegacySpecs: FilmDnaConnectionSpec[];
  influenceLegacyPresence: Record<LineKey, boolean>;
  seriesSpecs: FilmDnaConnectionSpec[];
  /** center 在系列链中的索引（= seriesPrevious 数量）。 */
  seriesCenterChainIndex: number;
  /** Full ordered chain — used to derive hover-aware source anchors per segment. */
  seriesChain: SeriesChainItem[];
  hover: HoverTarget | null;
  influenceCount: number;
  legacyCount: number;
};

/**
 * 全舞台 SVG：由海报锚点生成正交连线；viewBox 固定 1080×871，系列节点/线可溢出。
 */
function FilmDnaConnectionLines({
  influenceLegacySpecs,
  influenceLegacyPresence,
  seriesSpecs,
  seriesCenterChainIndex,
  seriesChain,
  hover,
  influenceCount,
  legacyCount,
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
      {/* X-axis influence/legacy connectors — unchanged, plain SVG */}
      {influenceLegacySpecs.map(({ lineKey, route }) => {
        if (!influenceLegacyPresence[lineKey]) return null;
        const opacity = isLineHighlighted(
          hover,
          lineKey,
          true,
          seriesCenterChainIndex,
        )
          ? 1
          : 0.25;
        const isSingleLeft = lineKey.startsWith('influence') && influenceCount === 1;
        const straight =
          isSingleLeft ||
          (lineKey.startsWith('legacy') && legacyCount === 1);
        const isTargetHovered =
          hover !== null &&
          ((lineKey.startsWith('influence') && hover.kind === 'center') ||
            (lineKey.startsWith('legacy') &&
              hover.kind === 'legacy' &&
              hover.index === parseInt(lineKey.slice(-1), 10) - 1));
        const { dx, dy } = scaledPosterEdgeOffset(route.targetEdge, isTargetHovered);
        const dynamicTarget: StageCoord = { x: route.target.x + dx, y: route.target.y + dy };
        // Influence source = influence poster right edge; legacy source = center poster right edge.
        const isSourceHovered =
          hover !== null &&
          ((lineKey.startsWith('influence') &&
            hover.kind === 'influence' &&
            hover.index === parseInt(lineKey.slice(-1), 10) - 1) ||
            (lineKey.startsWith('legacy') && hover.kind === 'center'));
        const { dx: sdx } = scaledPosterEdgeOffset('right', isSourceHovered);
        const dynamicSource: StageCoord = { x: route.source.x + sdx, y: route.source.y };
        const polyline = buildConnectionPolyline({ ...route, straight, source: dynamicSource, target: dynamicTarget });
        return (
          <g key={lineKey} fill="white" opacity={opacity}>
            <motion.path
              d={polyline}
              animate={{ d: polyline }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              fill="none"
              stroke="white"
              strokeWidth={CONNECTION_STROKE_W}
              strokeLinejoin="miter"
              strokeLinecap="butt"
            />
            <motion.circle
              cx={dynamicSource.x}
              cy={dynamicSource.y}
              animate={{ cx: dynamicSource.x }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              r={CONNECTION_MARKER_R}
            />
            <motion.polygon
              points={connectionArrowPolygon(dynamicTarget, route.targetEdge)}
              animate={{ points: connectionArrowPolygon(dynamicTarget, route.targetEdge) }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
            />
          </g>
        );
      })}
      {/* Y-axis series connectors — motion.path/circle for animated source anchor */}
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

        // Derive hover-aware source Y: center and hovered child use action-button
        // anchor; resting child uses year-text anchor.
        const fromIdx = seriesSegment?.fromChainIndex ?? -1;
        const fromItem = seriesChain[fromIdx];
        const isCenter = fromIdx === seriesCenterChainIndex;
        const isUpperHovered =
          hover !== null &&
          fromItem !== undefined &&
          hoverMatchesTarget(hover, fromItem.hoverTarget);
        const anchorBelow =
          isCenter || isUpperHovered
            ? SERIES_BUTTON_ANCHOR_BELOW
            : SERIES_YEAR_ANCHOR_BELOW;
        const dynamicSourceY =
          fromItem != null
            ? fromItem.posterPos.top + anchorBelow
            : route.source.y;
        const dynamicSource: StageCoord = { x: route.source.x, y: dynamicSourceY };
        // Target hover detection (lower chain item).
        const toIdx = seriesSegment?.toChainIndex ?? -1;
        const toItem = seriesChain[toIdx];
        const isTargetHovered =
          hover !== null && toItem !== undefined && hoverMatchesTarget(hover, toItem.hoverTarget);
        const { dx: tdx, dy: tdy } = scaledPosterEdgeOffset(route.targetEdge, isTargetHovered);
        const dynamicTarget: StageCoord = { x: route.target.x + tdx, y: route.target.y + tdy };
        const dynamicPolyline = buildConnectionPolyline({ ...route, source: dynamicSource, target: dynamicTarget });

        return (
          <g key={lineKey} fill="white" opacity={opacity}>
            <motion.path
              d={dynamicPolyline}
              animate={{ d: dynamicPolyline }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              fill="none"
              stroke="white"
              strokeWidth={CONNECTION_STROKE_W}
              strokeLinejoin="miter"
              strokeLinecap="butt"
            />
            <motion.circle
              cx={dynamicSource.x}
              cy={dynamicSourceY}
              animate={{ cy: dynamicSourceY }}
              transition={{ duration: 0.2, ease: 'easeOut' }}
              r={CONNECTION_MARKER_R}
            />
            <motion.polygon
              points={connectionArrowPolygon(dynamicTarget, route.targetEdge)}
              animate={{ points: connectionArrowPolygon(dynamicTarget, route.targetEdge) }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
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

function hoverMatchesTarget(a: HoverTarget, b: HoverTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'center': return true;
    case 'influence': return b.kind === 'influence' && a.index === b.index;
    case 'legacy': return b.kind === 'legacy' && a.index === b.index;
    case 'series-prev': return b.kind === 'series-prev' && a.index === b.index;
    case 'series-next': return b.kind === 'series-next' && a.index === b.index;
  }
}

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
  /** Called when user clicks Play Trailer. Center: always-visible. Non-center: hover-only, only when node is in library. */
  onPlayTrailer?: () => void;
  /** Called when user clicks Add Movie. Non-center only, hover-only, only when node is NOT in library. */
  onAddMovieNode?: () => void;
  /** Called when user clicks Jump Here. Non-center library nodes only; hover-only lower-right poster CTA. */
  onJumpHere?: () => void;
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
  onPlayTrailer,
  onAddMovieNode,
  onJumpHere,
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

  const [imgError, setImgError] = useState(false);
  // Reset the error flag whenever the URL changes so a freshly hydrated URL gets a real load attempt.
  useEffect(() => { setImgError(false); }, [posterSrc]);
  const showPlaceholder = !posterSrc || imgError;

  return (
    // group/poster on outer div controls CSS hover for poster scale and button reveal.
    // onPointerEnter/Leave are on the inner article only — hovering the action button
    // below does NOT fire onHover, so it never dims/brightens other nodes.
    <div
      className={`group/poster absolute ${isCenter || isSeries ? 'z-20' : 'z-10'}`}
      style={{
        left: posterPos.left,
        top: posterPos.top,
      }}
    >
      {/*
        Fixed-width column: poster is the alignment reference.
        All children — poster, title, year, button — share one centerline.
        Text wider than 114 px overflows visually but remains centered and
        still receives pointer events (CSS overflow:visible bubbles events to
        the article and outer div, so group-hover and onHover both fire).
      */}
      <div style={{ width: POSTER_W }} className="flex flex-col items-center">
        <article
          className="flex w-full flex-col items-center"
          aria-label={node.title}
          onPointerEnter={() => onHover(hoverTarget)}
          onPointerLeave={() => onHover(null)}
        >
          {/* Poster wrapper: sized to the poster so the inline Jump Here action can
              anchor to the poster's right edge and bottom without affecting layout. */}
          <div className="relative">
            <motion.div
              className={`relative h-[171px] w-[114px] overflow-hidden transition-opacity duration-300 ease-out ${
                !showPlaceholder ? POSTER_VIEW_HOVER : ''
              } ${dimmed ? 'opacity-25' : 'opacity-100'} group-hover/poster:opacity-100`}
            >
              {!showPlaceholder ? (
                <img
                  draggable={false}
                  src={posterSrc}
                  alt=""
                  className="block h-[171px] w-[114px] aspect-[2/3] object-cover"
                  referrerPolicy="no-referrer"
                  onError={() => setImgError(true)}
                />
              ) : (
                <div
                  className="flex h-[171px] w-[114px] items-center justify-center bg-[#101010] text-white/40"
                  aria-hidden
                >
                  <Film size={32} strokeWidth={1} />
                </div>
              )}
            </motion.div>

            {/* Jump Here: transparent hit area + visual CTA.
                Always pointer-events-auto (no group-hover guard) so the cursor moving from
                the scale-expanded poster directly into this area keeps group/poster hovered
                — no dead zone.  Height = enlarged-poster height; top offset = -scaleExpandY
                so the element spans exactly the enlarged poster's vertical extent.
                paddingLeft = scaleExpandX (8.55) + 20px gap = 28.55px from the left edge
                (which sits at the normal poster right = POSTER_W), placing the icon 20px
                from the enlarged poster's visual right edge.  items-end aligns icon+text
                to the button's bottom, which equals the enlarged poster's bottom. */}
            {!isCenter && onJumpHere ? (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onJumpHere();
                }}
                aria-label={`Jump to ${node.title} Film DNA`}
                className="group/jump absolute inline-flex cursor-pointer items-end gap-[2px] whitespace-nowrap rounded-none border-0 bg-transparent text-[14px] leading-normal text-white opacity-0 shadow-none transition-opacity duration-200 group-hover/poster:opacity-100"
                style={{
                  left: POSTER_W,
                  top: -(POSTER_H * (POSTER_HOVER_SCALE - 1) / 2),
                  height: POSTER_H * POSTER_HOVER_SCALE,
                  padding: 0,
                  paddingLeft: POSTER_W * (POSTER_HOVER_SCALE - 1) / 2 + 20,
                }}
              >
                <img
                  draggable={false}
                  src="/icons/arrow-down-left.svg"
                  alt=""
                  width={14}
                  height={14}
                  className="pointer-events-none h-3.5 w-3.5 shrink-0"
                  decoding="async"
                  aria-hidden
                />
                <span className="group-hover/jump:underline">Jump Here</span>
              </button>
            ) : null}
          </div>
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
        </article>

        {/* Center: always-visible Play Trailer — centered in the 114 px column */}
        {isCenter && onPlayTrailer ? (
          <div className="mt-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onPlayTrailer(); }}
              className="inline-flex h-9 cursor-pointer items-center rounded-full bg-white/80 hover:bg-white text-black text-[11px] font-bold px-4 tracking-wide whitespace-nowrap shadow-xl transition-all active:translate-y-[2px]"
            >
              Play Trailer
            </button>
          </div>
        ) : null}

        {/* Non-center: hover-only Play Trailer (library node) — space always reserved to prevent layout shift */}
        {!isCenter && onPlayTrailer ? (
          <div className="mt-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onPlayTrailer(); }}
              className="pointer-events-none opacity-0 group-hover/poster:pointer-events-auto group-hover/poster:opacity-100 inline-flex h-9 cursor-pointer items-center rounded-full bg-white/80 hover:bg-white text-black text-[11px] font-bold px-4 tracking-wide whitespace-nowrap shadow-xl transition-all active:translate-y-[2px]"
            >
              Play Trailer
            </button>
          </div>
        ) : null}

        {/* Non-center: hover-only Add Movie (non-library node) — space always reserved */}
        {!isCenter && onAddMovieNode ? (
          <div className="mt-2">
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => { e.stopPropagation(); onAddMovieNode(); }}
              className="pointer-events-none opacity-0 group-hover/poster:pointer-events-auto group-hover/poster:opacity-100 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-white/10 pl-[10px] pr-4 text-[11px] font-bold tracking-wide text-white/70 whitespace-nowrap transition-all hover:bg-white/20 hover:text-white active:translate-y-[2px]"
            >
              <img
                draggable={false}
                src="/icons/add-movie.svg"
                alt=""
                width={16}
                height={16}
                className="pointer-events-none h-4 w-4 shrink-0 opacity-70 transition-opacity"
                decoding="async"
                aria-hidden
              />
              Add Movie
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

type FilmDnaGraphProps = {
  tree: FilmDnaTree;
  centerPosterUrl: string;
  centerTitle: string;
  centerYear: number | null | undefined;
  status: 'loading' | 'ready' | 'error';
  isExiting: boolean;
  enterScale: number;
  onPlayCenterTrailer?: () => void;
  onPlayNodeTrailer?: (node: FilmDnaNode) => void;
  isLibraryNode?: (node: FilmDnaNode) => boolean;
  onAddMovieNode?: (node: FilmDnaNode) => void;
  onJumpToNode?: (node: FilmDnaNode) => void;
  onJumpMoveComplete?: () => void;
  isJumpActive?: boolean;
  disableCenterMorph?: boolean;
  loadingLabel?: string;
  centerNodeRef?: RefObject<HTMLDivElement>;
  exitHeroActive?: boolean;
};

/**
 * Film DNA 关系图：1080×871 虚拟舞台 + 等比缩放 + 可拖拽平移。
 */
function FilmDnaGraph({
  tree,
  centerPosterUrl,
  centerTitle,
  centerYear,
  status,
  isExiting,
  enterScale,
  onPlayCenterTrailer,
  onPlayNodeTrailer,
  isLibraryNode,
  onAddMovieNode,
  onJumpToNode,
  onJumpMoveComplete,
  isJumpActive,
  disableCenterMorph,
  loadingLabel,
  centerNodeRef,
  exitHeroActive,
}: FilmDnaGraphProps) {
  const seriesPrevious = (tree.seriesPrevious ?? []).slice(
    0,
    MAX_SERIES_VISIBLE,
  );
  const seriesNext = (tree.seriesNext ?? []).slice(0, MAX_SERIES_VISIBLE);
  const _baseSeriesNextPositions = layoutSeriesNextPositions(seriesNext.length);
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

  const seriesAxisNodes = [...seriesPrevious, ...seriesNext];
  const legacyNodes = excludeSameStoryOnVerticalAxis(
    limitVisibleNodes(
      orderInfluenceLegacyTimelineNodes(tree.right, centerYear, 'legacy'),
    ),
    centerNode,
    seriesNext,
    seriesAxisNodes,
  );
  // When the right X-axis has 2+ legacy nodes the cluster occupies the center-right
  // quadrant; shift the closest previous node up 86px to clear it visually.
  const _basePreviousPositions = layoutSeriesPreviousPositions(seriesPrevious.length);
  const seriesPreviousPositions =
    seriesPrevious.length > 0 && legacyNodes.length >= 2
      ? _basePreviousPositions.map((pos, i) =>
          i === seriesPrevious.length - 1 ? { ...pos, top: pos.top - 86 } : pos,
        )
      : _basePreviousPositions;

  // When the right X-axis has exactly 3 legacy nodes, drop the nearest seriesNext node
  // (index 0, directly below center) by 242px so its hover annotation — which expands to
  // the right — no longer covers the lower-right legacy node. The center→seriesNext
  // vertical connector follows automatically because it routes to this node position.
  const seriesNextPositions =
    legacyNodes.length === 3 && _baseSeriesNextPositions.length > 0
      ? _baseSeriesNextPositions.map((pos, i) =>
          i === 0 ? { ...pos, top: pos.top + 242 } : pos,
        )
      : _baseSeriesNextPositions;

  const seriesChain = buildSeriesChain(
    seriesPrevious,
    seriesPreviousPositions,
    centerNode,
    seriesNext,
    seriesNextPositions,
  );
  const seriesCenterChainIndex = seriesPrevious.length;
  const seriesConnectionSpecs = buildAdjacentSeriesConnectionSpecs(seriesChain);
  const influenceNodes = excludeSameStoryOnVerticalAxis(
    limitVisibleNodes(
      orderInfluenceLegacyTimelineNodes(tree.left, centerYear, 'influence'),
    ),
    centerNode,
    seriesPrevious,
    seriesAxisNodes,
  );

  const [hover, setHover] = useState<HoverTarget | null>(null);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  /**
   * 跳转「幽灵」节点：被点击的子节点海报副本，从其原位移动到中心位（transform-based）。
   * 移动期间侧栏内容淡出；到位后通知父级进入加载，并清除自身（与新中心静态出现同帧切换，无闪烁）。
   */
  const [jumpGhost, setJumpGhost] = useState<{
    node: FilmDnaNode;
    startPos: StagePoint;
  } | null>(null);

  const handleJumpFromNode = useCallback(
    (node: FilmDnaNode, startPos: StagePoint) => {
      if (isJumpActive || jumpGhost) return;
      setJumpGhost({ node, startPos });
      onJumpToNode?.(node);
    },
    [isJumpActive, jumpGhost, onJumpToNode],
  );

  const handleJumpGhostArrived = useCallback(() => {
    onJumpMoveComplete?.();
    setJumpGhost(null);
  }, [onJumpMoveComplete]);
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

  // Single-node alignment: when only one node on a side, align its y to center poster y.
  // For single influence: also shift right by half the connector distance so the
  // straight line spans half the original distance (poster right-center → center left-center).
  const getEffectiveInfluencePos = useCallback((index: number): StagePoint => {
    const frame = NODE_POS.influence[index];
    if (influenceNodes.length === 1) {
      const halfConnDist =
        (CENTER_POSTER_ANCHORS.left.x - (frame.left + POSTER_W)) / 2;
      return { left: frame.left + halfConnDist, top: CENTER_POSTER_POS.top };
    }
    // 3-node layout: shift all three influence nodes left by 96px.
    if (influenceNodes.length === 3) {
      return { left: frame.left - 96, top: frame.top };
    }
    return frame;
  }, [influenceNodes.length]);

  const getEffectiveLegacyPos = useCallback((index: number): StagePoint => {
    const frame = NODE_POS.legacy[index];
    if (legacyNodes.length === 1) return { left: frame.left, top: CENTER_POSTER_POS.top };
    // 2-node layout: move bottom-right node (index 1) up by 248px.
    if (legacyNodes.length === 2 && index === 1) return { left: frame.left, top: frame.top - 248 };
    // 3-node layout: move bottom-right node (index 1) down by 18px.
    if (legacyNodes.length === 3 && index === 1) return { left: frame.left, top: frame.top + 18 };
    return frame;
  }, [legacyNodes.length]);

  const dynamicInfluenceLegacySpecs = useMemo((): FilmDnaConnectionSpec[] => {
    const specs: FilmDnaConnectionSpec[] = [];
    // approach.x is the same for every influence connector.
    const influenceApproachX = CENTER_POSTER_ANCHORS.left.x - CONNECTION_ARROW_LEN;
    NODE_POS.influence.forEach((_, index) => {
      const frame = getEffectiveInfluencePos(index);
      const poster = nodeFrameToPosterAnchor(frame);
      // 3-node left layout: pin midX to the original (un-shifted) value so the
      // center-side horizontal segment stays unchanged and only the child-side
      // segment changes length (it lengthens by 96px as the node moves left).
      let fixedMidX: number | undefined;
      if (influenceNodes.length === 3) {
        const origPosterRightX = NODE_POS.influence[index].left + POSTER_W;
        fixedMidX = (origPosterRightX + influenceApproachX) / 2;
      }
      specs.push({
        lineKey: `influence0${index + 1}`,
        route: {
          source: posterEdgeCenter(poster, 'right'),
          target: CENTER_POSTER_ANCHORS.left,
          targetEdge: 'left',
          routing: 'influence-legacy',
          ...(fixedMidX !== undefined ? { fixedMidX } : {}),
        },
      });
    });
    NODE_POS.legacy.forEach((_, index) => {
      const frame = getEffectiveLegacyPos(index);
      const poster = nodeFrameToPosterAnchor(frame);
      specs.push({
        lineKey: `legacy0${index + 1}`,
        route: {
          source: CENTER_POSTER_ANCHORS.right,
          target: posterEdgeCenter(poster, 'left'),
          targetEdge: 'left',
          routing: 'influence-legacy',
        },
      });
    });
    return specs;
  }, [getEffectiveInfluencePos, getEffectiveLegacyPos, influenceNodes.length]);


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
        posterPos: nodeFrameToPosterAnchor(getEffectiveInfluencePos(hover.index)),
      };
    }
    if (hover.kind === 'legacy') {
      const node = legacyNodes[hover.index];
      if (!node) return null;
      return {
        direction: 'legacy',
        node,
        posterPos: nodeFrameToPosterAnchor(getEffectiveLegacyPos(hover.index)),
      };
    }
    return null;
  }, [hover, influenceNodes, legacyNodes, getEffectiveInfluencePos, getEffectiveLegacyPos]);

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
        posterPos: nodeFrameToPosterAnchor(getEffectiveInfluencePos(hover.index)),
      };
    }
    if (hover.kind === 'legacy') {
      const node = legacyNodes[hover.index];
      if (!node) return null;
      return {
        node,
        posterPos: nodeFrameToPosterAnchor(getEffectiveLegacyPos(hover.index)),
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
    getEffectiveInfluencePos,
    getEffectiveLegacyPos,
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


  // Side content (lines + side/series nodes) hides while the jump ghost moves to center,
  // so the rest of the graph fades out as the clicked node lifts off toward the middle.
  const showSideContent = status === 'ready' && !isExiting && !jumpGhost;

  return (
    <div
      className="film-dna-stage-host relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden"
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
        <div
          className="relative overflow-visible"
          style={{
            width: STAGE_W,
            height: STAGE_H_BASE,
            transform: `translate(${pan.x}px, ${pan.y}px)`,
          }}
        >
          {/* Center node: morphs in from preview poster size on mount, morphs back on exit */}
          <motion.div
            ref={centerNodeRef}
            className="absolute z-20"
            style={{
              left: CENTER_POSTER_POS.left,
              top: CENTER_POSTER_POS.top,
              transformOrigin: `${POSTER_W / 2}px ${POSTER_H / 2}px`,
            }}
            initial={disableCenterMorph ? false : { scale: enterScale, opacity: 0 }}
            animate={{
              scale: exitHeroActive ? 1 : isExiting ? enterScale : 1,
              opacity: exitHeroActive ? 0 : isExiting ? 0 : 1,
            }}
            transition={
              exitHeroActive
                ? { duration: 0 }
                : isExiting
                  ? {
                      scale: { duration: 0.35, ease: [0.2, 0, 0, 1] },
                      opacity: { delay: 0.28, duration: 0.07, ease: 'easeIn' },
                    }
                  : { duration: 0.35, ease: [0.2, 0, 0, 1] }
            }
          >
            <FilmDnaNodeCard
              node={centerNode}
              posterUrl={resolvedCenterPosterUrl}
              isCenter
              hoverTarget={{ kind: 'center' }}
              highlighted
              onHover={setHover}
              posterPos={{ left: 0, top: 0 }}
              onPlayTrailer={onPlayCenterTrailer}
            />
          </motion.div>

          {/* Jump ghost: the clicked child node's poster, sliding from its position to center. */}
          {jumpGhost ? (
            <motion.div
              className="absolute left-0 top-0 z-30"
              style={{ transformOrigin: `${POSTER_W / 2}px ${POSTER_H / 2}px` }}
              initial={{ x: jumpGhost.startPos.left, y: jumpGhost.startPos.top, opacity: 1 }}
              animate={{ x: CENTER_POSTER_POS.left, y: CENTER_POSTER_POS.top, opacity: 1 }}
              transition={{ duration: 0.4, ease: [0.2, 0, 0, 1] }}
              onAnimationComplete={handleJumpGhostArrived}
            >
              <div className="relative h-[171px] w-[114px] overflow-hidden">
                {(() => {
                  const ghostSrc = resolvePosterUrlFromRaw(jumpGhost.node);
                  return ghostSrc ? (
                    <img
                      draggable={false}
                      src={ghostSrc}
                      alt=""
                      className="block h-[171px] w-[114px] aspect-[2/3] object-cover"
                      referrerPolicy="no-referrer"
                    />
                  ) : (
                    <div
                      className="flex h-[171px] w-[114px] items-center justify-center bg-[#101010] text-white/40"
                      aria-hidden
                    >
                      <Film size={32} strokeWidth={1} />
                    </div>
                  );
                })()}
              </div>
            </motion.div>
          ) : null}

          {/* Loading indicator: positioned below the center node in stage coords */}
          {status === 'loading' ? (
            <motion.div
              className="absolute"
              style={{
                left: STAGE_W / 2,
                top: CENTER_POSTER_POS.top + POSTER_H + 192,
                transform: 'translateX(-50%)',
              }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.2, delay: 0.15 }}
            >
              <div className="flex items-center gap-0">
                <FilmDnaGeneratingLoader size={64} />
                <p className="whitespace-nowrap text-[14px] font-semibold text-white/60">
                  {loadingLabel ?? 'Generating Film DNA…'}
                </p>
              </div>
            </motion.div>
          ) : null}

          {/* Side content: connections + side nodes — fade in when ready, fade out on exit */}
          <AnimatePresence>
            {showSideContent ? (
              <motion.div
                key="dna-side-content"
                className="absolute inset-0"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <div className="pointer-events-none absolute inset-0">
                  <FilmDnaConnectionLines
                    influenceLegacySpecs={dynamicInfluenceLegacySpecs}
                    influenceLegacyPresence={influenceLegacyPresence}
                    seriesSpecs={seriesConnectionSpecs}
                    seriesCenterChainIndex={seriesCenterChainIndex}
                    seriesChain={seriesChain}
                    hover={hover}
                    influenceCount={influenceNodes.length}
                    legacyCount={legacyNodes.length}
                  />
                </div>

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
                    posterPos={nodeFrameToPosterAnchor(getEffectiveInfluencePos(index))}
                    onPlayTrailer={onPlayNodeTrailer && isLibraryNode?.(node) ? () => onPlayNodeTrailer(node) : undefined}
                    onAddMovieNode={!isLibraryNode?.(node) && onAddMovieNode ? () => onAddMovieNode(node) : undefined}
                    onJumpHere={onJumpToNode && isLibraryNode?.(node) ? () => handleJumpFromNode(node, nodeFrameToPosterAnchor(getEffectiveInfluencePos(index))) : undefined}
                  />
                ))}

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
                    posterPos={nodeFrameToPosterAnchor(getEffectiveLegacyPos(index))}
                    onPlayTrailer={onPlayNodeTrailer && isLibraryNode?.(node) ? () => onPlayNodeTrailer(node) : undefined}
                    onAddMovieNode={!isLibraryNode?.(node) && onAddMovieNode ? () => onAddMovieNode(node) : undefined}
                    onJumpHere={onJumpToNode && isLibraryNode?.(node) ? () => handleJumpFromNode(node, nodeFrameToPosterAnchor(getEffectiveLegacyPos(index))) : undefined}
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
                    onPlayTrailer={onPlayNodeTrailer && isLibraryNode?.(node) ? () => onPlayNodeTrailer(node) : undefined}
                    onAddMovieNode={!isLibraryNode?.(node) && onAddMovieNode ? () => onAddMovieNode(node) : undefined}
                    onJumpHere={onJumpToNode && isLibraryNode?.(node) ? () => handleJumpFromNode(node, seriesPreviousPositions[index]) : undefined}
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
                    onPlayTrailer={onPlayNodeTrailer && isLibraryNode?.(node) ? () => onPlayNodeTrailer(node) : undefined}
                    onAddMovieNode={!isLibraryNode?.(node) && onAddMovieNode ? () => onAddMovieNode(node) : undefined}
                    onJumpHere={onJumpToNode && isLibraryNode?.(node) ? () => handleJumpFromNode(node, seriesNextPositions[index]) : undefined}
                  />
                ))}
              </motion.div>
            ) : null}
          </AnimatePresence>
        </div>
      </motion.div>
    </div>
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
  isExiting = false,
  enterScale = 5,
  onPlayCenterTrailer,
  onPlayNodeTrailer,
  isLibraryNode,
  onAddMovieNode,
  onJumpToNode,
  onJumpMoveComplete,
  isJumpActive,
  disableCenterMorph,
  loadingLabel,
  centerNodeRef,
  exitHeroActive,
}: FilmDnaPanelProps) {
  const showGraph = status === 'loading' || status === 'ready';

  return (
    <div
      className="absolute inset-0 flex min-h-0 w-full flex-col"
      aria-busy={status === 'loading'}
    >
      {/* Dark translucent background — matches Film Info mode, fades out on exit */}
      <motion.div
        className="pointer-events-none absolute inset-0 bg-black/85"
        initial={{ opacity: 0 }}
        animate={{ opacity: isExiting ? 0 : 1 }}
        transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
      />
      {status === 'error' ? (
        <motion.div
          className="flex min-h-full w-full flex-col items-center justify-center px-4 py-8 sm:px-8"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          <div className="mx-auto max-w-md px-4 text-center">
            <p className="text-[14px] font-semibold text-red-300/95">
              {errorMessage || 'Could not generate Film DNA.'}
            </p>
          </div>
        </motion.div>
      ) : null}

      {showGraph ? (
        <FilmDnaGraph
          tree={tree ?? EMPTY_FILM_DNA_TREE}
          centerPosterUrl={centerPosterUrl}
          centerTitle={centerTitle}
          centerYear={centerYear}
          status={status}
          isExiting={isExiting}
          enterScale={enterScale}
          onPlayCenterTrailer={onPlayCenterTrailer}
          onPlayNodeTrailer={onPlayNodeTrailer}
          isLibraryNode={isLibraryNode}
          onAddMovieNode={onAddMovieNode}
          onJumpToNode={onJumpToNode}
          onJumpMoveComplete={onJumpMoveComplete}
          isJumpActive={isJumpActive}
          disableCenterMorph={disableCenterMorph}
          loadingLabel={loadingLabel}
          centerNodeRef={centerNodeRef}
          exitHeroActive={exitHeroActive}
        />
      ) : null}
    </div>
  );
}
