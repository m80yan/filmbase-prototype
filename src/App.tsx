import React, { useState, useMemo, useRef, useEffect, useLayoutEffect, useReducer, useCallback } from 'react';
import { 
  ChevronDown, 
  ChevronRight,
  Star, 
  Film,
  Filter,
  Settings,
  Check,
  X,
  Upload,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MOCK_MOVIES } from './constants';
import { Movie, MovieCastDetail } from './types';
import { getSupabaseClient, signInAnonymously } from './lib/supabaseClient';
import {
  deletePublicMovie,
  loadPublicMovies,
  migrateLocalStorageOnce,
  migrateSavedMoviesToPublic,
  subscribeToPublicMovies,
  syncPublicMoviePosterFromStorage,
  updatePublicMoviePoster,
  updatePublicMovieTrailerUrl,
  uploadPublicPosterFileAndSign,
  upsertPublicMovie,
} from './lib/filmbaseSupabase';
import { LibraryLoadingStagedCopy } from './components/LibraryLoadingStagedCopy';
import { LibraryLoadingShowcase } from './components/LibraryLoadingShowcase';

/**
 * `search-movies` Edge Function 返回的单条命中（展示建议时仅保留 `imdbId` 非空的项）。
 */
type MovieSearchHit = {
  tmdbId: number;
  imdbId: string | null;
  title: string;
  originalTitle: string;
  releaseDate: string;
  year: number | null;
  posterUrl: string | null;
  overview: string;
  popularity: number;
  voteAverage: number;
};

/**
 * 从搜索命中构造快加占位 `Movie`（`isMetadataPending`，待 enrich 完成后替换）。
 *
 * @param hit 已保证含非空 `imdbId` 的搜索命中
 */
/** 海报预览 Info Mode：标签 / 演员名强调色（与工具栏 Edit 等 `#EA9794` 一致）。 */
const POSTER_PREVIEW_INFO_ACCENT_CLASS = 'text-[#EA9794]';

/**
 * Info Mode 卡司全量行（无条数截断、无「……」占位），优先 `castDetails`，否则退回 `cast` 纯名。
 *
 * @param movie 当前预览影片
 */
function getPosterPreviewInfoCastRowsFull(movie: Movie): { name: string; character: string }[] {
  const details = (movie.castDetails ?? []).filter((c) => (c.name ?? '').trim().length > 0);
  if (details.length > 0) {
    return details.map((c) => ({
      name: (c.name ?? '').trim(),
      character: (c.character ?? '').trim(),
    }));
  }
  const names = (movie.cast ?? [])
    .map((n) => (typeof n === 'string' ? n.trim() : ''))
    .filter(Boolean);
  return names.map((name) => ({ name, character: '' }));
}

/**
 * 海报预览 Info Mode 卡司：解析用于 `getPosterPreviewInfoCastRowsFull` 的 `Movie`。
 * `posterPreviewMovie` 在打开预览时快照，enrich 后 `castDetails` 可能在 `selectedMovie` / `movies` 中已更新；
 * 若当前选中片与预览同 id，优先用 `selectedMovie`（满足「与选中行同源」）；否则用库中最新行，最后回退快照。
 *
 * @param posterPreview 预览状态中的影片
 * @param selected 主区当前选中影片（可为 null）
 * @param library 影片列表（与网格/列表同源）
 */
function resolvePosterPreviewInfoCastSourceMovie(
  posterPreview: Movie,
  selected: Movie | null,
  library: Movie[],
): Movie {
  if (selected?.id === posterPreview.id) return selected;
  return library.find((m) => m.id === posterPreview.id) ?? posterPreview;
}

/** Info Mode 正文字号与字重（14px、semibold）；行距默认 20px，仅 Plot 段使用 28px。 */
const POSTER_PREVIEW_INFO_BODY_CLASS = 'text-[14px] font-semibold leading-5';

/** Info Mode Plot 段落：与正文块相同字号字重，行距 28px。 */
const POSTER_PREVIEW_INFO_PLOT_CLASS = 'text-[14px] font-semibold leading-[28px]';

/**
 * Crew / Cast / Details 共用双列模板：两列各 264px，`gap-x-4`（16px）为列间距；
 * `max-w-[544px] mx-auto` 在 `max-w-[604px]` 的 section 内水平居中，等效总宽
 * `30 + 264 + 16 + 264 + 30`（px）。
 */
const POSTER_PREVIEW_INFO_ALIGNED_GRID_CLASS =
  'grid w-full max-w-[544px] mx-auto grid-cols-[264px_264px] gap-x-4';

/**
 * 双列栅格左侧标签列（及卡司演员名列）：定宽 264px、右对齐；`justify-self-end` 贴齐两列中线；
 * `break-words` 使长标签 / 姓名在边界内换行。
 */
const POSTER_PREVIEW_INFO_LABEL_COL_CLASS = `min-w-0 w-[264px] max-w-[264px] justify-self-end break-words text-right ${POSTER_PREVIEW_INFO_ACCENT_CLASS}`;

/**
 * 双列栅格右侧数值列（及 Info Mode 卡司「角色」列）：定宽 264px；
 * `justify-self-start` 避免 grid 子项 stretch；`break-words` 使长文案在边界内换行。
 */
const POSTER_PREVIEW_INFO_VALUE_COL_CLASS =
  'min-w-0 w-[264px] max-w-[264px] justify-self-start break-words text-left text-white';

/**
 * 将 ISO 3166-1 alpha-2 转为区域指示符旗帜 emoji。
 *
 * @param code 两字母国家码，如 `US`
 */
function iso3166Alpha2ToFlagEmoji(code: string): string {
  const c = code.trim().toUpperCase();
  if (c.length !== 2 || !/^[A-Z]{2}$/.test(c)) return '';
  const base = 0x1f1e6;
  return String.fromCodePoint(
    base + (c.charCodeAt(0) - 65),
    base + (c.charCodeAt(1) - 65),
  );
}

/** Info Mode「国家/地区」常见英文名 / 别名 → ISO3166-1 alpha-2（用于国旗前缀展示）。 */
const POSTER_PREVIEW_COUNTRY_NAME_TO_ISO2: Record<string, string> = {
  afghanistan: 'AF',
  albania: 'AL',
  algeria: 'DZ',
  argentina: 'AR',
  australia: 'AU',
  austria: 'AT',
  bangladesh: 'BD',
  belgium: 'BE',
  brazil: 'BR',
  bulgaria: 'BG',
  canada: 'CA',
  chile: 'CL',
  china: 'CN',
  colombia: 'CO',
  croatia: 'HR',
  cuba: 'CU',
  'czech republic': 'CZ',
  czechia: 'CZ',
  denmark: 'DK',
  egypt: 'EG',
  england: 'GB',
  estonia: 'EE',
  finland: 'FI',
  france: 'FR',
  georgia: 'GE',
  germany: 'DE',
  greece: 'GR',
  'hong kong': 'HK',
  hungary: 'HU',
  iceland: 'IS',
  india: 'IN',
  indonesia: 'ID',
  iran: 'IR',
  iraq: 'IQ',
  ireland: 'IE',
  israel: 'IL',
  italy: 'IT',
  japan: 'JP',
  korea: 'KR',
  latvia: 'LV',
  lebanon: 'LB',
  lithuania: 'LT',
  luxembourg: 'LU',
  malaysia: 'MY',
  mexico: 'MX',
  morocco: 'MA',
  netherlands: 'NL',
  'new zealand': 'NZ',
  nigeria: 'NG',
  norway: 'NO',
  pakistan: 'PK',
  peru: 'PE',
  philippines: 'PH',
  poland: 'PL',
  portugal: 'PT',
  romania: 'RO',
  russia: 'RU',
  'saudi arabia': 'SA',
  scotland: 'GB',
  serbia: 'RS',
  singapore: 'SG',
  slovakia: 'SK',
  slovenia: 'SI',
  'south africa': 'ZA',
  'south korea': 'KR',
  spain: 'ES',
  sweden: 'SE',
  switzerland: 'CH',
  taiwan: 'TW',
  thailand: 'TH',
  turkey: 'TR',
  ukraine: 'UA',
  'united arab emirates': 'AE',
  'united kingdom': 'GB',
  'united states': 'US',
  'united states of america': 'US',
  america: 'US',
  usa: 'US',
  'u.s.': 'US',
  'u.s.a.': 'US',
  vietnam: 'VN',
  wales: 'GB',
  uk: 'GB',
  'great britain': 'GB',
};

/**
 * 从「国家/地区」字段解析逗号分隔的多国名，生成去重后的国旗 emoji 前缀（空格分隔）。
 *
 * @param raw 原始字符串，如 `United States` 或 `Germany, United States, United Kingdom`
 */
function countryOfOriginToFlagPrefix(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === '—') return '';
  const parts = trimmed
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const flags: string[] = [];
  const seen = new Set<string>();
  for (const part of parts) {
    const key = part
      .toLowerCase()
      .replace(/\./g, '')
      .replace(/\s+/g, ' ')
      .trim();
    const iso = POSTER_PREVIEW_COUNTRY_NAME_TO_ISO2[key];
    if (!iso) continue;
    const emoji = iso3166Alpha2ToFlagEmoji(iso);
    if (!emoji || seen.has(emoji)) continue;
    seen.add(emoji);
    flags.push(emoji);
  }
  return flags.length ? `${flags.join(' ')} ` : '';
}

/**
 * 将金额标量格式化为固定一位小数的字符串（用于 M/B/K 后缀），如 `461.0`、`131.1`、`1.2`。
 *
 * @param scaled 已除以单位（如 1e6）的数值
 */
function formatPosterPreviewMoneyScaled(scaled: number): string {
  const rounded = Math.round(scaled * 10) / 10;
  return rounded.toFixed(1);
}

/**
 * Info Mode「Box Office (US & Canada)」展示用紧凑金额（不修改存储字段）。
 * 无法解析或空 / `—` / `N/A` 时返回 `—`。
 *
 * @param raw 原始文案，如 `$460,998,507`
 */
function formatPosterPreviewInfoBoxOfficeDisplay(raw: string): string {
  const s = raw.trim();
  if (!s || s === '—' || /^n\/a$/i.test(s)) return '—';
  const digits = s.replace(/,/g, '').replace(/[^\d]/g, '');
  if (!digits) return '—';
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) return '—';

  if (n >= 1_000_000_000) {
    return `$${formatPosterPreviewMoneyScaled(n / 1_000_000_000)}B`;
  }
  if (n >= 1_000_000) {
    return `$${formatPosterPreviewMoneyScaled(n / 1_000_000)}M`;
  }
  if (n >= 1_000) {
    return `$${formatPosterPreviewMoneyScaled(n / 1_000)}K`;
  }
  return `$${n.toLocaleString('en-US')}`;
}

/**
 * 海报预览 Info Mode：剧情块（最大宽 420px；外层 `flex justify-center` 避免 `flex-col` 子项
 * `w-full` 被拉满整行导致「块」看起来贴左；正文仍左对齐便于长段阅读）。
 *
 * @param plot 剧情文案
 */
function PosterPreviewInfoPlotBlock({ plot, genres }: { plot: string; genres: string[] }) {
  const body = plot.trim() || '—';
  const genreLabels = uniqueNormalizedGenreLabels(genres ?? []);
  return (
    <div className="flex w-full shrink-0 justify-center">
      <section className="w-full min-w-0 max-w-[420px]" aria-label="Plot">
        <p className={`text-left ${POSTER_PREVIEW_INFO_PLOT_CLASS} whitespace-pre-wrap`}>
          <span className={POSTER_PREVIEW_INFO_ACCENT_CLASS}>PLOT:</span>
          <span className="text-white">
            {' '}
            {body}
            {genreLabels.length > 0 ? (
              <span
                className="inline-flex items-center gap-2 align-middle"
                style={{ marginLeft: 8, verticalAlign: 'middle' }}
                aria-label="Genres"
              >
                {genreLabels.map((label) => (
                  <span key={`plot-genre-${genreLabelToIconSlug(label)}-${label}`}>
                    <PosterGenreIconWithTooltip label={label} />
                  </span>
                ))}
              </span>
            ) : null}
          </span>
        </p>
      </section>
    </div>
  );
}

/**
 * 海报预览 Info Mode：主创（独立双列栅格，标签列定宽右对齐）。
 * 「Director」「Writers」标签左侧各附 16×16 图标，图标与标签间距 8px（`gap-2`）；
 * 标签行 `items-start`，多行姓名时与右侧首行上对齐。
 *
 * @param director 导演
 * @param writer 编剧
 */
function PosterPreviewInfoCrewBlock({ director, writer }: { director: string; writer: string }) {
  return (
    <section
      className="mx-auto mt-[40px] w-full max-w-[604px]"
      aria-label="Director and writers"
    >
      <div className={`${POSTER_PREVIEW_INFO_ALIGNED_GRID_CLASS} gap-y-2 ${POSTER_PREVIEW_INFO_BODY_CLASS}`}>
        <div
          className={`${POSTER_PREVIEW_INFO_LABEL_COL_CLASS} flex items-start justify-end gap-2`}
        >
          <img
            draggable={false}
            src="/icons/director.svg"
            alt=""
            width={20}
            height={20}
            className="pointer-events-none h-5 w-5 shrink-0"
            decoding="async"
            aria-hidden
          />
          <span>Director</span>
        </div>
        <div className={POSTER_PREVIEW_INFO_VALUE_COL_CLASS}>{(director ?? '').trim() || '—'}</div>
        <div
          className={`${POSTER_PREVIEW_INFO_LABEL_COL_CLASS} flex items-start justify-end gap-2`}
        >
          <img
            draggable={false}
            src="/icons/writer.svg"
            alt=""
            width={20}
            height={20}
            className="pointer-events-none h-5 w-5 shrink-0"
            decoding="async"
            aria-hidden
          />
          <span>Writers</span>
        </div>
        <div className={POSTER_PREVIEW_INFO_VALUE_COL_CLASS}>{(writer ?? '').trim() || '—'}</div>
      </div>
    </section>
  );
}

/**
 * 海报预览 Info Mode：卡司（独立双列栅格；约 15 行可视高度，超出区域内滚动）。
 * 行数据必须由 `getPosterPreviewInfoCastRowsFull` 生成，禁止直接 `castDetails.map` / `cast.map`。
 *
 * @param movie 传入 `resolvePosterPreviewInfoCastSourceMovie(...)` 的结果或其它已解析的 `Movie`
 */
function PosterPreviewInfoCastBlock({ movie }: { movie: Movie }) {
  const rows = getPosterPreviewInfoCastRowsFull(movie);

  return (
    <section className="mx-auto mt-6 w-full max-w-[604px] min-w-0" aria-label="Cast">
      {rows.length === 0 ? (
        <div className={`${POSTER_PREVIEW_INFO_ALIGNED_GRID_CLASS} gap-y-1.5 ${POSTER_PREVIEW_INFO_BODY_CLASS}`}>
          <div className={POSTER_PREVIEW_INFO_LABEL_COL_CLASS}>—</div>
          <div className={POSTER_PREVIEW_INFO_VALUE_COL_CLASS} aria-hidden>
            {'\u00A0'}
          </div>
        </div>
      ) : (
        <div
          className="max-h-[calc(15*1.25rem+14*0.375rem)] min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain"
          onWheel={(e) => e.stopPropagation()}
        >
          <div className={`${POSTER_PREVIEW_INFO_ALIGNED_GRID_CLASS} gap-y-1.5 ${POSTER_PREVIEW_INFO_BODY_CLASS}`}>
            {rows.map((row, idx) => (
              <React.Fragment key={`cast-${idx}-${row.name}`}>
                <div className={POSTER_PREVIEW_INFO_LABEL_COL_CLASS}>{row.name}</div>
                <div className={POSTER_PREVIEW_INFO_VALUE_COL_CLASS}>
                  {(row.character ?? '').trim() || '\u00A0'}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * 海报预览 Info Mode：发行与制片等详情（独立双列栅格，数值列可换行）。
 *
 * @param movie 当前预览影片
 */
function PosterPreviewInfoDetailsBlock({ movie }: { movie: Movie }) {
  const releaseDate = (movie.releaseDate ?? '').trim();
  const runtimeRaw = (movie.runtime ?? '').trim();
  const runtimeValue =
    runtimeRaw && /^\d+$/.test(runtimeRaw) ? `${runtimeRaw} min` : runtimeRaw;
  const ratedValue = (movie.contentRating ?? '').trim();
  const countryValue = (movie.countryOfOrigin ?? '').trim();
  const boxOfficeValueRaw = (movie.boxOffice ?? '').trim();
  const boxOfficeValue = formatPosterPreviewInfoBoxOfficeDisplay(boxOfficeValueRaw);
  const productionCompaniesValue =
    (movie.productionCompanies ?? []).filter(Boolean).join(', ').trim();

  const rows = [
    { label: 'Release date', value: releaseDate || '—' },
    runtimeValue ? { label: 'Runtime', value: runtimeValue } : null,
    ratedValue ? { label: 'Rated', value: ratedValue } : null,
    { label: 'Country of origin', value: countryValue || '—' },
    { label: 'Box office', value: boxOfficeValue || '—' },
    { label: 'Production companies', value: productionCompaniesValue || '—' },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <section className="mx-auto mt-6 w-full max-w-[604px]" aria-label="Release and production details">
      <div className={`${POSTER_PREVIEW_INFO_ALIGNED_GRID_CLASS} gap-y-2 ${POSTER_PREVIEW_INFO_BODY_CLASS}`}>
        {rows.map((row) => {
          const flagPrefix =
            row.label === 'Country of origin' ? countryOfOriginToFlagPrefix(row.value) : '';
          return (
            <React.Fragment key={row.label}>
              <div className={POSTER_PREVIEW_INFO_LABEL_COL_CLASS}>{row.label}</div>
              <div className={POSTER_PREVIEW_INFO_VALUE_COL_CLASS}>
                {flagPrefix}
                {row.value}
              </div>
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
}

function buildPlaceholderMovieFromSearchHit(hit: MovieSearchHit & { imdbId: string }): Movie {
  const imdbId = hit.imdbId.trim().toLowerCase();
  const year =
    typeof hit.year === 'number' && Number.isFinite(hit.year)
      ? hit.year
      : hit.releaseDate && /^\d{4}/.test(hit.releaseDate)
        ? parseInt(hit.releaseDate.slice(0, 4), 10) || 0
        : 0;
  const posterUrl =
    typeof hit.posterUrl === 'string' && hit.posterUrl.trim() ? hit.posterUrl.trim() : '';
  return {
    id: imdbId,
    title: hit.title?.trim() || 'Unknown',
    year,
    genre: [],
    director: '',
    cast: [],
    imdbRating: 0,
    rottenTomatoes: 0,
    personalRating: 0,
    runtime: '',
    posterUrl,
    trailerUrl: '',
    isFavorite: false,
    language: '',
    isRecentlyAdded: true,
    dateAdded: Date.now(),
    contentRating: '',
    plot: '',
    writer: '',
    tagline: '',
    releaseDate: typeof hit.releaseDate === 'string' ? hit.releaseDate : '',
    countryOfOrigin: '',
    alsoKnownAs: [],
    productionCompanies: [],
    boxOffice: '',
    castDetails: [],
    isMetadataPending: true,
  };
}

/**
 * 规范化标题用于身份键：小写、trim、去掉标点类字符、合并连续空白。
 */
function normalizeTitleForIdentity(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 判断 Add Movie 搜索建议是否已在当前库中：`imdbId` 与 `movie.id` 一致，或规范化标题 + 年份与已有条目一致。
 *
 * @param hit — `search-movies` 单条命中。
 * @param list — 当前片单 `Movie[]`。
 */
function isAddMovieSearchSuggestionInLibrary(hit: MovieSearchHit, list: Movie[]): boolean {
  const imdb = typeof hit.imdbId === 'string' ? hit.imdbId.trim().toLowerCase() : '';
  if (imdb && list.some((m) => m.id.toLowerCase() === imdb)) return true;

  const nt = normalizeTitleForIdentity(hit.title);
  if (!nt) return false;
  const y = hit.year;
  if (y == null || !Number.isFinite(y)) return false;

  return list.some((m) => normalizeTitleForIdentity(m.title) === nt && m.year === y);
}

/** `public/icons` 下已有素材的类型 slug（与 `{slug}.svg` / `{slug}-hover.svg` 文件名一致）。 */
const SIDEBAR_GENRE_ICON_SLUGS = new Set([
  'action',
  'adventure',
  'animation',
  'biography',
  'comedy',
  'crime',
  'documentary',
  'drama',
  'family',
  'fantasy',
  'film-noir',
  'game-show',
  'history',
  'horror',
  'music',
  'musical',
  'mystery',
  'news',
  'reality-tv',
  'romance',
  'sci-fi',
  'short',
  'sport',
  'talk-show',
  'thriller',
  'tv-movie',
  'war',
  /** `lasso.svg`：用于展示标签 `Western`（见 `genreLabelToIconSlug`）。 */
  'lasso',
]);

/**
 * 侧栏与筛选用的 genre 展示标签：合并 Sci-Fi 诸写法，不写回 `movie.genre`。
 *
 * @param g 原始 genre 字符串
 * @returns 去首尾空白；`science fiction` / `sci fi` / `sci-fi`（大小写不敏感）返回 `Sci-Fi`，否则返回 trim 原串
 */
function normalizeGenreDisplayLabel(g: string): string {
  const t = g.trim();
  const lower = t.toLowerCase();
  if (lower === 'science fiction' || lower === 'sci fi' || lower === 'sci-fi') {
    return 'Sci-Fi';
  }
  return t;
}

/**
 * 将片库中的 genre 文案映射为侧栏图标 slug。
 * 无单独设计的类型统一使用 `fallback`（`fallback.svg` / `fallback-hover.svg`）。
 *
 * @param label 如 `Sci-Fi`、`War`、`Western`（映射为 `lasso` 素材）、`TV Movie`（`tv-movie`）
 */
function genreLabelToIconSlug(label: string): string {
  const t = label.trim();
  if (!t) return 'fallback';
  const lower = t.toLowerCase();
  if (lower === 'sci fi' || lower === 'science fiction') return 'sci-fi';
  if (lower === 'reality' || lower === 'reality tv' || lower === 'reality-tv') return 'reality-tv';
  if (lower === 'tv movie' || lower === 'tv-movie') return 'tv-movie';
  if (lower === 'western') return 'lasso';
  const slug = lower.replace(/\s+/g, '-');
  if (SIDEBAR_GENRE_ICON_SLUGS.has(slug)) return slug;
  return 'fallback';
}

/**
 * 网格海报 hover 叠层：按片中顺序保留首次出现的展示用 genre，避免 Sci-Fi / Science Fiction 重复图标。
 *
 * @param genres `movie.genre` 原始列表
 */
function uniqueNormalizedGenreLabels(genres: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of genres) {
    const label = normalizeGenreDisplayLabel(raw);
    if (!label) continue;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

/**
 * 影片身份键（规范化标题 + 年份），用于跨 `id` 去重与合并（private > public > seed）。
 */
function getMovieIdentityKey(movie: Pick<Movie, 'title' | 'year'>): string {
  return `${normalizeTitleForIdentity(movie.title)}|${movie.year}`;
}

/**
 * 铺满主内容可用框的缩放（contain）：可小于 1（大图需缩小）或大于 1（小图可放大铺满）。
 *
 * @param nw 自然宽
 * @param nh 自然高
 * @param maxW 可用最大宽
 * @param maxH 可用最大高
 */
function getPreviewFillScale(nw: number, nh: number, maxW: number, maxH: number): number {
  if (nw <= 0 || nh <= 0) return 1;
  return Math.min(maxW / nw, maxH / nh);
}

/**
 * 滑块左端百分数：有效 Fit 比例 `min(1, contain)`×100（不超 1:1 原图）。
 * 返回精确小数百分比；UI label 再单独 round，避免 Fit 端点被取整后偏大导致轻微裁切。
 *
 * @param fitScale `getPreviewFillScale`（contain 倍率，可大于 1）
 */
function getPreviewSliderMinPercent(fitScale: number): number {
  if (!Number.isFinite(fitScale)) return 100;
  return Math.min(100, Math.max(0, Math.min(1, fitScale) * 100));
}

/**
 * 预览「宽顶格」缩放上限：`maxW/nw` 与 1:1 取小（原图比视窗窄时不强行放大铺满宽）。
 *
 * @param maxW 可视框最大宽（px）
 * @param nw 原图自然宽（px）
 */
function getPreviewScaleCapByViewportWidth(maxW: number, nw: number): number {
  if (!(nw > 0) || !(maxW > 0)) return 1;
  return Math.min(1, maxW / nw);
}

/** 与滑块取整/浮点误差兼容，判定两档「实际百分比」是否视为同一点。 */
const PREVIEW_ZOOM_PERCENT_NEAR = 0.75;

/**
 * 海报预览缩放滑块右端吸附阈值（百分点）：
 * 拖到 ≥ `max - PREVIEW_ZOOM_SLIDER_SNAP_TO_MAX` 时把受控 value 吸附到 `max`，
 * 让「最右 = 100%」与气泡 `Math.round(s*100)` 及右侧 100 图标 disabled 状态保持一致。
 */
const PREVIEW_ZOOM_SLIDER_SNAP_TO_MAX = 1;

function isNearPreviewZoomPercent(a: number, b: number): boolean {
  return Math.abs(a - b) <= PREVIEW_ZOOM_PERCENT_NEAR;
}

/**
 * 海报点击缩放下一档：Fit → Fit Width → 100% → Fit。
 * 若 Fit 与 Fit Width 等效则退化为 Fit ↔ 100%。
 *
 * @returns `panReset` 为 true 时表示回到 Fit / Fit Width 时居中平移。
 */
function getNextPosterPreviewClickPercent(
  currentPct: number,
  fitPct: number,
  fitWidthPct: number,
): { next: number; panReset: boolean } {
  const sameFitAndWidth = isNearPreviewZoomPercent(fitPct, fitWidthPct);
  if (sameFitAndWidth) {
    if (isNearPreviewZoomPercent(currentPct, fitPct)) return { next: 100, panReset: false };
    if (isNearPreviewZoomPercent(currentPct, 100)) return { next: fitPct, panReset: true };
    if (currentPct < (fitPct + 100) / 2) return { next: 100, panReset: false };
    return { next: fitPct, panReset: true };
  }

  /**
   * Fit 与 Fit Width 数值可能很接近。当前值到达 Fit Width 后，如果先判断 near Fit，
   * 第二次点击会被误吞并重复回到 Fit Width，表现为轻微抖动而不是进到 100%。
   * 因此三档模式下必须优先判断 Fit Width，再判断 Fit。
   */
  if (isNearPreviewZoomPercent(currentPct, fitWidthPct)) return { next: 100, panReset: false };
  if (isNearPreviewZoomPercent(currentPct, fitPct)) return { next: fitWidthPct, panReset: true };
  if (isNearPreviewZoomPercent(currentPct, 100)) return { next: fitPct, panReset: true };
  if (currentPct < (fitPct + fitWidthPct) / 2) return { next: fitWidthPct, panReset: true };
  if (currentPct < (fitWidthPct + 100) / 2) return { next: 100, panReset: false };
  return { next: fitPct, panReset: true };
}

/**
 * 滑块刻度为「实际显示比例 ×100」：`sliderPercent/100` 经 clamp 到
 * `[effectiveFit, 1]`。Fit 可能是 35%，但滑轨仍是 0–100 的真实百分比坐标，
 * 因此 thumb 应显示在 35% 位置，而不是滑轨最左端。
 *
 * @param sFill contain 倍率（可大于 1）
 * @param sliderPercent 滑块当前值（与 UI 刻度一致）
 * @param _sCap 保留参数以兼容调用方；当前最大缩放统一为 1:1，不用宽顶格截断
 */
function getPreviewDisplayScaleFromSlider(
  sFill: number,
  sliderPercent: number,
  _sCap: number,
): number {
  const effectiveFitScale = Math.min(1, sFill);
  const rawScale = sliderPercent / 100;
  return Math.max(effectiveFitScale, Math.min(1, rawScale));
}

/**
 * 海报预览：`maxW` / `maxH` 相对 `mainPreviewHostRef` 矩形各边的内缩（px）。与 overlay 内 `px-*` 独立；0 尽量铺满可用区。
 */
const POSTER_PREVIEW_LAYOUT_PAD_PX = 0;

/** 网格 → 全屏预览 hero 动画：起点/终点视口矩形（px）。 */
type PreviewHeroRect = { left: number; top: number; width: number; height: number };

/**
 * 与 `posterPreviewLayout` 相同：`maxW`/`maxH` 与 contain 后的 `dispW`/`dispH`。
 *
 * @param hostRect `mainPreviewHostRef` 的 `getBoundingClientRect()`
 * @param nw 海报自然宽
 * @param nh 海报自然高
 * @param sliderPercent 滑块百分数（Fit 左端…`previewSliderMaxPercent` 右端）；刻度与 `sliderPercent/100` 即缩放一致。
 * @param padPx 与 `POSTER_PREVIEW_LAYOUT_PAD_PX` 一致
 */
function computePreviewPosterFrameDims(
  hostRect: DOMRect,
  nw: number,
  nh: number,
  sliderPercent: number,
  padPx: number,
): {
  maxW: number;
  maxH: number;
  dispW: number;
  dispH: number;
  s: number;
  sCap: number;
  sFill: number;
  effectiveFitScale: number;
} {
  const cw = hostRect.width;
  const ch = hostRect.height;
  const maxW = Math.max(80, cw - padPx * 2);
  const maxH = Math.max(80, ch - padPx * 2);
  const sFill = getPreviewFillScale(nw, nh, maxW, maxH);
  const sCap = getPreviewScaleCapByViewportWidth(maxW, nw);
  const effectiveFitScale = Math.min(1, sFill);
  const s = getPreviewDisplayScaleFromSlider(sFill, sliderPercent, sCap);
  return { maxW, maxH, dispW: nw * s, dispH: nh * s, s, sCap, sFill, effectiveFitScale };
}

/**
 * 视口中居中（含 pan）后的海报图像外接矩形，与真实预览内 `img` 的 disp 尺寸一致。
 *
 * @param pan 与 `previewPan` 一致（预览图 `translate` 偏移）
 */
function computePreviewPosterDisplayRect(
  hostRect: DOMRect,
  nw: number,
  nh: number,
  sliderPercent: number,
  padPx: number,
  pan: { x: number; y: number },
): PreviewHeroRect {
  if (hostRect.width < 80 || hostRect.height < 80 || nw <= 0 || nh <= 0) {
    const w = Math.max(80, hostRect.width * 0.5);
    const h = Math.max(80, hostRect.height * 0.5);
    return {
      left: hostRect.left + (hostRect.width - w) / 2,
      top: hostRect.top + (hostRect.height - h) / 2,
      width: w,
      height: h,
    };
  }
  const { dispW, dispH } = computePreviewPosterFrameDims(hostRect, nw, nh, sliderPercent, padPx);
  const cx = hostRect.left + hostRect.width / 2;
  const cy = hostRect.top + hostRect.height / 2;
  return {
    left: cx + pan.x - dispW / 2,
    top: cy + pan.y - dispH / 2,
    width: dispW,
    height: dispH,
  };
}

const POSTER_HERO_TRANSITION_MS = 300;

/**
 * 规范化标题相同且年份相差不超过 1 时，视为同一部影片（用于 seed 1993 vs public 1994 等）。
 */
function titlesMatchYearWithinOne(a: Pick<Movie, 'title' | 'year'>, b: Pick<Movie, 'title' | 'year'>): boolean {
  return (
    normalizeTitleForIdentity(a.title) === normalizeTitleForIdentity(b.title) &&
    Math.abs(a.year - b.year) <= 1
  );
}

/**
 * 在 Map 中查找与 `incoming` 标题相同且年份差 ≤1 的条目键；多命中时取年份最接近的一条。
 */
function findFuzzyMapKey(map: Map<string, Movie>, incoming: Movie): string | null {
  let bestKey: string | null = null;
  let bestDist = Infinity;
  for (const [key, val] of map) {
    if (normalizeTitleForIdentity(val.title) !== normalizeTitleForIdentity(incoming.title)) continue;
    const d = Math.abs(val.year - incoming.year);
    if (d > 1) continue;
    if (d < bestDist) {
      bestDist = d;
      bestKey = key;
    }
  }
  return bestKey;
}

/**
 * 在已合并的 Map 中查找与 `source` 属于同一模糊身份簇的那条 `Movie`（用于有序输出）。
 */
function findMergedMovieForSource(map: Map<string, Movie>, source: Movie): Movie | undefined {
  for (const v of map.values()) {
    if (titlesMatchYearWithinOne(v, source)) return v;
  }
  return undefined;
}

/**
 * 共享公共片单首屏排序：按 `dateAdded` 倒序，保留 0/缺省值在末尾；title 升序作为次序。
 * 仅用于初始 hydrate；后续用户切换 `sortMode` 时会被 `filteredMovies` 覆盖。
 */
function sortMoviesForInitialDisplay(list: Movie[]): Movie[] {
  const getMs = (d: Movie['dateAdded']) =>
    typeof d === 'number' ? d : new Date(d || 0).getTime();
  return [...list].sort((a, b) => {
    const da = getMs(a.dateAdded);
    const db = getMs(b.dateAdded);
    if (db !== da) return db - da;
    return (a.title || '').localeCompare(b.title || '');
  });
}

/**
 * 列表 sticky 表头 IMDb / RT 图标：仅用 SVG 区分状态，不用 `opacity` 压色深。
 * - 非当前排序列：`imdb-source-muted` / `rt-source-muted`
 * - 当前排序列（常态）：`imdb-source-header` / `rt-source-header`
 * - 列上 hover：`imdb-source-color` / `rt-source-white`
 */
const LIST_HEADER_RATINGS_ICON = {
  imdbInactive: '/icons/ratings/imdb-source-muted.svg',
  imdbNormal: '/icons/ratings/imdb-source-header.svg',
  imdbHover: '/icons/ratings/imdb-source-color.svg',
  rtInactive: '/icons/ratings/rt-source-muted.svg',
  rtNormal: '/icons/ratings/rt-source-header.svg',
  rtHover: '/icons/ratings/rt-source-white.svg',
} as const;

/** 网格海报尺寸 slider 最小值（px）；再小则 hover overlay 易破版。 */
const GRID_POSTER_SIZE_MIN_PX = 170;
/** 网格海报尺寸 slider 最大值（px）。 */
const GRID_POSTER_SIZE_MAX_PX = 240;
/** 网格海报尺寸 +/- 按钮步长（px）；slider 仍为无级拖动。 */
const GRID_POSTER_SIZE_STEP_PX = 10;
/**
 * 海报尺寸滑块 CSS 轨道高度（px）；两端整半圆时半径 = `H/2`。无 `border` / 外描边式阴影，填充色与原先 `accent-white/40` 控件同系（浅白半透明条）。
 */
const POSTER_SIZE_SLIDER_TRACK_H_PX = 6;
/** 拇指 SVG 栅格边长（px），与 `public/icons/poster-size-slider-thumb*.svg` 一致。 */
const POSTER_SIZE_SLIDER_THUMB_PX = 16;

/**
 * 主内容区全屏遮罩（预告片 / 添加影片）的 opacity 过渡，与 `backdrop-blur` 同帧淡出，减轻关闭时「瞬间消失」抖动。
 */
const MAIN_MODAL_OVERLAY_TRANSITION = { duration: 0.3, ease: 'easeInOut' } as const;

/**
 * 上述遮罩内卡片（播放器 / 表单）的 scale+opacity 过渡；略短于遮罩时序时内容先收，遮罩再淡出。
 */
const MAIN_MODAL_PANEL_TRANSITION = { duration: 0.24, ease: 'easeInOut' } as const;

/**
 * 将海报尺寸限制在 slider 合法区间，避免 `value < min` 时自定义拇指 `left` 线性比例变负而冲出轨道。
 *
 * @param px 原始像素值
 */
function clampPosterSizePx(px: number): number {
  return Math.min(GRID_POSTER_SIZE_MAX_PX, Math.max(GRID_POSTER_SIZE_MIN_PX, px));
}

/** 片库加载叠层：底层静态胶片。 */
const LIBRARY_LOADING_FILM_BASE_SRC = '/icons/library-loading-film-base.svg';
/** 片库加载叠层：上层旋转卷轴。 */
const LIBRARY_LOADING_REEL_SRC = '/icons/library-loading-reel.svg';
/**
 * 片库加载音（方案 A）：`public/sounds/library-ready.mp3` 单次播放、不循环；与 loader 同启，就绪时 cleanup 立刻停声。
 * 若实际加载短于音轨时长则中途截断；长于音轨则播完后静默直至 UI 就绪。
 */
const LIBRARY_LOADING_SOUND_SRC = '/sounds/library-ready.mp3';
/** 预览交互禁用提示音：例如 Z 缩放无可用区间时播放（`public/sounds/ui-disabled.mp3`）。 */
const UI_DISABLED_SOUND_SRC = '/sounds/ui-disabled.mp3';

export default function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trailerIframeRef = useRef<HTMLIFrameElement>(null);
  /** 卡片全屏海报 modal 内 file input；与主内容区内 scoped 上传面板互斥挂载，可安全共用 ref。 */
  const posterFileInputRef = useRef<HTMLInputElement>(null);
  /** 海报预览打开后将焦点移入 overlay，避免 Enter/Space 默认激活底层按钮导致重复 open/hero 闪回。 */
  const posterPreviewOverlayRef = useRef<HTMLDivElement>(null);
  const uiDisabledAudioRef = useRef<HTMLAudioElement | null>(null);
  const uiDisabledAudioLastPlayAtRef = useRef(0);
  const [isSidebarClearSearchPressed, setIsSidebarClearSearchPressed] = useState(false);
  const [isAddMovieClearSearchPressed, setIsAddMovieClearSearchPressed] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [movies, setMovies] = useState<Movie[]>(() => {
    return MOCK_MOVIES.filter(m => !['Avatar', 'Blade Runner 2049', 'Dune: Part One'].includes(m.title));
  });
  /** 供 Add Movie 去重等逻辑读取最新 `movies`，避免闭包陈旧。 */
  const moviesRef = useRef<Movie[]>(movies);
  moviesRef.current = movies;

  const supabaseRef = useRef<ReturnType<typeof getSupabaseClient> | null>(null);
  const supabaseUidRef = useRef<string | null>(null);
  const hasHydratedRef = useRef(false);

  /**
   * Storage 海报 signed URL 可能过期（1h TTL）；筛选/懒加载可能在过期后才触发请求。
   * 对同一 `(movieId, storagePath)` 仅重签一次，避免无限重试循环。
   */
  const posterResignAttemptedRef = useRef<Set<string>>(new Set());
  const refreshPosterSignedUrlOnce = useCallback(
    async (movieId: string, storagePath: string): Promise<string | null> => {
      const sp = storagePath.trim();
      if (!sp) return null;
      const supabase = supabaseRef.current;
      if (!supabase) return null;

      const attemptKey = `${movieId}::${sp}`;
      if (posterResignAttemptedRef.current.has(attemptKey)) return null;
      posterResignAttemptedRef.current.add(attemptKey);

      const SIGNED_URL_TTL_SECONDS = 60 * 60;
      const { data, error } = await supabase.storage
        .from('filmbase-posters')
        .createSignedUrl(sp, SIGNED_URL_TTL_SECONDS);
      if (error) return null;
      const signedUrl = data?.signedUrl;
      if (!signedUrl || !signedUrl.trim()) return null;

      const joiner = signedUrl.includes('?') ? '&' : '?';
      const nextUrl = `${signedUrl}${joiner}v=${encodeURIComponent(String(Date.now()))}`;

      setMovies((prev) =>
        prev.map((m) => (m.id === movieId ? { ...m, posterUrl: nextUrl, posterStoragePath: sp } : m)),
      );
      setSelectedMovie((prev) =>
        prev?.id === movieId ? { ...prev, posterUrl: nextUrl, posterStoragePath: sp } : prev,
      );
      setPosterPreviewMovie((prev) =>
        prev?.id === movieId ? { ...prev, posterUrl: nextUrl, posterStoragePath: sp } : prev,
      );

      return nextUrl;
    },
    [],
  );

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedRatings, setSelectedRatings] = useState<number[]>([]);
  const [isRecentlyAddedFilter, setIsRecentlyAddedFilter] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [posterSize, setPosterSize] = useState(GRID_POSTER_SIZE_MIN_PX);
  /** 海报尺寸自定义滑块：按下/拖动中为 true（列表模式下不用 pressed 图）。 */
  const [isPosterSizeSliderPressed, setIsPosterSizeSliderPressed] = useState(false);
  /** 海报预览 slider：0 = 铺满内容区（Fit/Fill），100 = 1:1 像素（100%）。 */
  const [previewSliderPercent, setPreviewSliderPercent] = useState(100);
  /** 宿主尺寸变化时递增，驱动预览布局 `useMemo` 重算。 */
  const [previewLayoutTick, setPreviewLayoutTick] = useState(0);
  /** 海报预览 Fit↔最大刻度 滑块：按下/拖动中为 true（禁用时不用 pressed 图）。 */
  const [isPreviewZoomSliderPressed, setIsPreviewZoomSliderPressed] = useState(false);
  const [isMoviesHydrated, setIsMoviesHydrated] = useState(false);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const trailerOpenGuardUntilRef = useRef(0);
  const [modalMode, setModalMode] = useState<'trailer' | 'poster'>('trailer');
  /** 海报预览内「Upload Poster」：仅覆盖 `mainPreviewHostRef`，不关闭预览。 */
  const [isScopedPosterUploadOpen, setIsScopedPosterUploadOpen] = useState(false);
  const [pendingPosterUrl, setPendingPosterUrl] = useState<string | null>(null);
  const [pendingPosterFile, setPendingPosterFile] = useState<File | null>(null);
  const [posterUploadError, setPosterUploadError] = useState('');
  const [isPosterApplying, setIsPosterApplying] = useState(false);
  const [isPosterSyncing, setIsPosterSyncing] = useState(false);
  const [applyingDots, setApplyingDots] = useState<1 | 2 | 3>(1);
  const [isPosterPreviewOpen, setIsPosterPreviewOpen] = useState(false);
  /** 全屏海报预览：整片元数据（仅用于右侧面板与海报 URL）。 */
  const [posterPreviewMovie, setPosterPreviewMovie] = useState<Movie | null>(null);
  /** 海报预览 Info Mode：叠层展示剧情/职员等，关闭预览时复位。 */
  const [isInfoMode, setIsInfoMode] = useState(false);
  /** 网格放大镜 hero：起点/终点与动画相位（仅 Grid 传入 `DOMRect` 时启用）。 */
  const [posterHeroFromRect, setPosterHeroFromRect] = useState<PreviewHeroRect | null>(null);
  const [posterHeroTargetRect, setPosterHeroTargetRect] = useState<PreviewHeroRect | null>(null);
  const [isPosterHeroAnimating, setIsPosterHeroAnimating] = useState(false);
  const [posterHeroRun, setPosterHeroRun] = useState(false);
  const posterHeroFinishOnceRef = useRef(false);
  /** Hero 期间用于目标框与收尾预填；与点击处 `img.naturalWidth/Height` 同源。 */
  const [posterHeroNaturalSize, setPosterHeroNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const posterHeroNaturalRef = useRef<{ w: number; h: number } | null>(null);
  const [previewNaturalSize, setPreviewNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [previewPan, setPreviewPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isPreviewDragging, setIsPreviewDragging] = useState(false);
  const previewDragRef = useRef<{
    pointerId: number | null;
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
    moved: boolean;
  }>({
    pointerId: null,
    startX: 0,
    startY: 0,
    startPanX: 0,
    startPanY: 0,
    moved: false,
  });
  /** 指针是否在海报预览 `img` 上（用于 Z 键仅在图上生效）。 */
  const previewPointerOverImgRef = useRef(false);
  /** 主内容滚动区（海报预览 overlay 仅覆盖此区域，用于量测可用宽高）。 */
  const mainPreviewHostRef = useRef<HTMLDivElement>(null);
  /** 供 pointer 拖拽时读取最新布局（避免闭包陈旧）。 */
  const posterPreviewLayoutRef = useRef<{
    maxW: number;
    maxH: number;
    nw: number;
    nh: number;
    sFill: number;
    effectiveFitScale: number;
    s: number;
    sCap: number;
    dispW: number;
    dispH: number;
    needsPan: boolean;
  } | null>(null);
  /** Fit / Fit Width 百分数，供 Z 与点击早于部分 useMemo 处读取。 */
  const previewSliderRangeRef = useRef({ fitPct: 100, fitWidthPct: 100 });
  /** 滑块无可调区间时 Z 不生效（与 `previewSliderMaxPercent <= previewSliderMinPercent` 同步）。 */
  const previewSliderInteractionLockedRef = useRef(false);
  /** 供 Z 键读取当前滑块百分数（避免 effect 闭包陈旧）。 */
  const previewSliderPercentRef = useRef(100);
  const [sortMode, setSortMode] = useState<'title-asc' | 'title-desc' | 'duration-desc' | 'duration-asc' | 'imdb-asc' | 'imdb-desc' | 'rt-asc' | 'rt-desc' | 'personal-asc' | 'personal-desc'>('title-asc');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  /** 编辑库模式下「删除影片」二次确认弹窗当前选中的条目（与 Add / Edit Trailer 同宿主、同遮罩规范）。 */
  const [deleteMovieConfirm, setDeleteMovieConfirm] = useState<Movie | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [newMovieTitle, setNewMovieTitle] = useState('');
  const [newMovieUrl, setNewMovieUrl] = useState('');
  const [isImdbEntered, setIsImdbEntered] = useState(false);
  /** Add Movie：IMDb URL 区默认折叠，点击「Use IMDb URL instead」后展开至 Trailer 输入之上。 */
  const [isAddMovieImdbSectionExpanded, setIsAddMovieImdbSectionExpanded] = useState(false);
  const [newMovieTrailerUrl, setNewMovieTrailerUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  /** Add Movie 在线标题搜索：`search-movies` 返回且含 `imdbId` 的候选。 */
  const [addMovieSearchHits, setAddMovieSearchHits] = useState<Array<MovieSearchHit & { imdbId: string }>>([]);
  const [addMovieSearchLoading, setAddMovieSearchLoading] = useState(false);
  const [addMovieSearchError, setAddMovieSearchError] = useState('');
  /** 用户按 Esc 后暂隐藏建议下拉，直至查询变化。 */
  const [addMovieSuggestionsDismissed, setAddMovieSuggestionsDismissed] = useState(false);
  /** 键盘导航时当前高亮的建议索引（`-1` 表示无）。 */
  const [addMovieActiveSuggestionIndex, setAddMovieActiveSuggestionIndex] = useState(-1);
  const addMovieSearchSeqRef = useRef(0);
  /** Add Movie modal「Search by title」输入框：打开 modal 时自动聚焦。 */
  const addMovieTitleSearchInputRef = useRef<HTMLInputElement>(null);
  /** Add Movie：展开 IMDb URL 区后聚焦。 */
  const addMovieImdbUrlInputRef = useRef<HTMLInputElement>(null);
  /** 主片库纵向滚动容器（网格/列表共用），用于 `scrollIntoView` 的滚动祖先与可见区判断。 */
  const mainLibraryScrollRef = useRef<HTMLDivElement>(null);
  /** 片库中每部影片根节点（网格卡片 / 列表行）`movie.id → HTMLElement`。 */
  const movieLibraryItemElsRef = useRef<Map<string, HTMLElement>>(new Map());
  /**
   * 新增影片写入 `movies` 后：在下一帧布局中滚动到该片。
   * 成功添加后写入 id，`useLayoutEffect` 消费后置 `null`。
   */
  const [pendingScrollMovieId, setPendingScrollMovieId] = useState<string | null>(null);

  /** 注册/卸载片库条目 DOM，供新增后滚动定位。 */
  const registerMovieLibraryItemEl = useCallback((movieId: string, el: HTMLElement | null) => {
    const map = movieLibraryItemElsRef.current;
    if (el) map.set(movieId, el);
    else map.delete(movieId);
  }, []);
  /**
   * 遮罩关闭手势：仅当指针在遮罩层本身按下并松开（`target === currentTarget`），
   * 避免从面板内拖选文本后在外围松手误触关闭。
   */
  const addMovieBackdropCloseArmedRef = useRef(false);
  const editTrailerBackdropCloseArmedRef = useRef(false);
  const deleteMovieBackdropCloseArmedRef = useRef(false);
  /** 预告片浮层「Edit Trailer URL」弹窗：仅打开/关闭，与 `selectedMovie` 当前 `trailerUrl` 关联。 */
  const [isEditTrailerModalOpen, setIsEditTrailerModalOpen] = useState(false);
  const [editTrailerUrlInput, setEditTrailerUrlInput] = useState('');
  const [editTrailerError, setEditTrailerError] = useState('');
  const [isEditingTrailer, setIsEditingTrailer] = useState(false);
  /**
   * 全局共享公共片单写操作（删除 / 评分 / 海报 / 预告片 / 新增）失败时的可见错误。
   * 用一个轻量的 fixed 顶部小 toast 展示，避免破坏列表 / 详情布局。
   */
  const [libraryActionError, setLibraryActionError] = useState<string | null>(null);
  useEffect(() => {
    if (!libraryActionError) return;
    const t = window.setTimeout(() => setLibraryActionError(null), 6000);
    return () => window.clearTimeout(t);
  }, [libraryActionError]);
  const [expandedSections, setExpandedSections] = useState({
    genre: true,
    year: false,
    ratings: true
  });

  /** 全局 `pointerup` / `pointercancel` 结束海报尺寸滑块按下态。 */
  useEffect(() => {
    if (!isPosterSizeSliderPressed) return;
    const end = () => setIsPosterSizeSliderPressed(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [isPosterSizeSliderPressed]);

  /** 全局 `pointerup` / `pointercancel` 结束预览缩放滑块按下态。 */
  useEffect(() => {
    if (!isPreviewZoomSliderPressed) return;
    const end = () => setIsPreviewZoomSliderPressed(false);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
    };
  }, [isPreviewZoomSliderPressed]);

  /** 挂载时将 `posterSize` 夹在 `[min,max]`，避免历史默认或持久化值低于当前 `GRID_POSTER_SIZE_MIN_PX`。 */
  useLayoutEffect(() => {
    setPosterSize((p) => clampPosterSizePx(p));
  }, []);

  /** 编辑库模式：`Esc` 退出编辑（其它浮层已占 ESC 时跳过）。 */
  useEffect(() => {
    if (!isEditing) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isPosterPreviewOpen) return;
      if (selectedMovie && modalMode === 'trailer') return;
      if (selectedMovie && modalMode === 'poster') return;
      if (deleteMovieConfirm) return;
      if (isAddModalOpen) return;
      if (isEditTrailerModalOpen) return;
      if (isSortDropdownOpen) return;
      e.preventDefault();
      setIsEditing(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isEditing,
    deleteMovieConfirm,
    isPosterPreviewOpen,
    selectedMovie,
    modalMode,
    isAddModalOpen,
    isEditTrailerModalOpen,
    isSortDropdownOpen,
  ]);

  /** 删除确认弹窗：`Esc` 关闭（不删片）。 */
  useEffect(() => {
    if (!deleteMovieConfirm) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      setDeleteMovieConfirm(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [deleteMovieConfirm]);

  useEffect(() => {
    if (hasHydratedRef.current) return;
    hasHydratedRef.current = true;

    let unsubscribeRealtime: (() => void) | null = null;

    void (async () => {
      const supabase = getSupabaseClient();
      supabaseRef.current = supabase;

      const uid = await signInAnonymously(supabase);
      supabaseUidRef.current = uid;

      /**
       * 兼容历史路径：先把 localStorage(filmbase_movies) 落到 saved 表，
       * 再把当前用户的 saved → public 安全合并迁移；二者都按 uid 维度幂等。
       */
      try {
        await migrateLocalStorageOnce(supabase, uid);
      } catch (err) {
        console.warn('localStorage → saved migration failed:', err);
      }
      try {
        await migrateSavedMoviesToPublic(supabase, uid);
      } catch (err) {
        console.warn('saved → public migration failed:', err);
      }

      /** 仅以共享公共片单作为可见库；失败或为空时回退到本地 seed。 */
      const seedFallback = MOCK_MOVIES.filter(
        (m) => !['Avatar', 'Blade Runner 2049', 'Dune: Part One'].includes(m.title)
      );

      let publicMovies: Movie[] = [];
      let publicLoadFailed = false;
      try {
        publicMovies = await loadPublicMovies(supabase);
      } catch (err) {
        console.error('loadPublicMovies failed:', err);
        publicLoadFailed = true;
        setLibraryActionError('Could not load shared library; showing local fallback.');
      }

      const usePublic = !publicLoadFailed && publicMovies.length > 0;
      const initial = usePublic
        ? sortMoviesForInitialDisplay(publicMovies)
        : seedFallback;

      setMovies(initial);
      setIsMoviesHydrated(true);

      /**
       * 订阅公共表行变更，让其它用户的新增 / 海报 / 预告片更新对当前会话即时可见。
       * 失败不阻塞 UI（订阅本身被 try/catch 包住）。
       */
      unsubscribeRealtime = subscribeToPublicMovies(supabase, {
        onUpsert: (movie) => {
          setMovies((prev) => {
            const idx = prev.findIndex((m) => m.id === movie.id);
            if (idx >= 0) {
              const next = prev.slice();
              next[idx] = movie;
              return next;
            }
            return [movie, ...prev];
          });
        },
        onDelete: (movieId) => {
          setMovies((prev) => prev.filter((m) => m.id !== movieId));
        },
        onError: (err) => {
          console.warn('Realtime update failed:', err);
        },
      });
    })().catch((err) => {
      console.error('Failed to initialize Supabase:', err);
      setLibraryActionError('Could not connect to shared library.');
      setIsMoviesHydrated(true);
    });

    return () => {
      if (unsubscribeRealtime) unsubscribeRealtime();
    };
  }, []);

  /**
   * 与片库旋转加载文案及胶片 loader 同生命周期：`!isMoviesHydrated` 时单次播放加载音（不 loop）；就绪时 cleanup 立刻停声。
   */
  useEffect(() => {
    if (isMoviesHydrated) return;

    const audio = new Audio(LIBRARY_LOADING_SOUND_SRC);
    audio.loop = false;
    audio.volume = 0.28;
    void audio.play().catch(() => {});

    return () => {
      audio.pause();
      audio.currentTime = 0;
      audio.src = '';
      void audio.load();
    };
  }, [isMoviesHydrated]);

  useEffect(() => {
    if (!selectedMovie && trailerIframeRef.current) {
      trailerIframeRef.current.src = '';
    }
    if (!selectedMovie) {
      if (!isScopedPosterUploadOpen) {
        setPendingPosterUrl(null);
        setPosterUploadError('');
      }
    }
  }, [selectedMovie, isScopedPosterUploadOpen]);

  /** 合并/刷新列表后，保持详情 modal 中的影片与 `movies` 同源；条目已删除时关闭 modal。 */
  useEffect(() => {
    setSelectedMovie((prev) => {
      if (!prev) return null;
      const fresh = movies.find((m) => m.id === prev.id);
      return fresh ?? null;
    });
  }, [movies]);

  /** 海报上传进行中时，底部「Applying…」点动画。 */
  useEffect(() => {
    if (!isPosterApplying) return;
    const t = window.setInterval(() => {
      setApplyingDots((d) => (d === 3 ? 1 : ((d + 1) as 1 | 2 | 3)));
    }, 400);
    return () => window.clearInterval(t);
  }, [isPosterApplying]);

  const getYouTubeEmbedUrl = (url: string) => {
    if (!url) return '';
    
    // Extract video ID from various formats
    let videoId = '';
    
    const watchMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/shorts\/)([^&?/\s]+)/);
    if (watchMatch && watchMatch[1]) {
      videoId = watchMatch[1];
    }

    if (videoId) {
      return `https://www.youtube.com/embed/${videoId}`;
    }

    return url;
  };

  const getTrailerEmbedSrc = (url: string) => {
    const embedUrl = getYouTubeEmbedUrl(url);
    if (!embedUrl) return '';

    const params = new URLSearchParams({
      autoplay: '1',
      mute: '0',
      controls: '1',
      rel: '0',
      playsinline: '1',
      origin: window.location.origin,
    });

    return `${embedUrl}?${params.toString()}`;
  };

  /** 关闭预览内海报上传面板（不关闭海报预览）。 */
  const closeScopedPosterUpload = useCallback(() => {
    setIsScopedPosterUploadOpen(false);
    setPendingPosterUrl(null);
    setPosterUploadError('');
  }, []);

  /** 关闭全屏海报预览并重置缩放/平移。 */
  const closePosterPreview = useCallback(() => {
    setIsScopedPosterUploadOpen(false);
    setPendingPosterUrl(null);
    setPosterUploadError('');
    setIsPosterPreviewOpen(false);
    setPosterPreviewMovie(null);
    setIsInfoMode(false);
    setPreviewNaturalSize(null);
    setPreviewSliderPercent(100);
    setPreviewPan({ x: 0, y: 0 });
    setIsPreviewDragging(false);
    setPosterHeroFromRect(null);
    setPosterHeroTargetRect(null);
    setIsPosterHeroAnimating(false);
    setPosterHeroRun(false);
    setPosterHeroNaturalSize(null);
    posterHeroNaturalRef.current = null;
    posterHeroFinishOnceRef.current = false;
    previewDragRef.current = {
      pointerId: null,
      startX: 0,
      startY: 0,
      startPanX: 0,
      startPanY: 0,
      moved: false,
    };
  }, []);

  /**
   * Scheme A：在 shell（侧栏 / 顶栏 / 窗口控件）捕获阶段先关闭主区内浮层（海报预览 / 预告片），不 `stopPropagation`，
   * 以便同一指针序列中原控件照常触发。
   */
  const onShellPointerDownCloseScopedOverlays = useCallback(
    (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      if (isPosterPreviewOpen) {
        if (isInfoMode) return;
        const awaiting =
          isScopedPosterUploadOpen && Boolean(pendingPosterUrl) && !isPosterApplying;
        if (awaiting) return;
        closePosterPreview();
        return;
      }
      if (selectedMovie && modalMode === 'trailer') {
        setSelectedMovie(null);
      }
    },
    [
      isPosterPreviewOpen,
      isInfoMode,
      isScopedPosterUploadOpen,
      pendingPosterUrl,
      isPosterApplying,
      selectedMovie,
      modalMode,
      closePosterPreview,
    ],
  );

  /** 预览打开时 ESC：Info Mode 下先退出信息层；否则关闭预览（选图待 Apply/Cancel 时不响应）。 */
  useEffect(() => {
    if (!isPosterPreviewOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isInfoMode) {
        e.preventDefault();
        setIsInfoMode(false);
        return;
      }
      if (
        isScopedPosterUploadOpen &&
        Boolean(pendingPosterUrl) &&
        !isPosterApplying
      ) {
        return;
      }
      e.preventDefault();
      closePosterPreview();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    isPosterPreviewOpen,
    isInfoMode,
    isScopedPosterUploadOpen,
    pendingPosterUrl,
    isPosterApplying,
    closePosterPreview,
  ]);

  /** 预览打开时将焦点移入 overlay；并屏蔽 Enter/Space 的默认「激活按钮」行为（预览仅响应 ESC 与 Z）。 */
  useEffect(() => {
    if (!isPosterPreviewOpen) return;
    posterPreviewOverlayRef.current?.focus?.();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      e.stopPropagation();
    };
    window.addEventListener('keydown', onKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true } as any);
  }, [isPosterPreviewOpen]);

  /**
   * 海报预览打开时：`Z` 仅在 Fit 与 Fit Width 间切换（不到 100%）；预览区内任意位置生效。
   */
  useEffect(() => {
    if (!isPosterPreviewOpen) {
      previewPointerOverImgRef.current = false;
      return;
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (e.key !== 'z' && e.key !== 'Z') return;
      if (isInfoMode) return;
      const ae = document.activeElement;
      if (
        ae instanceof HTMLInputElement ||
        ae instanceof HTMLTextAreaElement ||
        ae instanceof HTMLSelectElement ||
        (ae instanceof HTMLElement && ae.isContentEditable)
      ) {
        return;
      }
      const { fitPct, fitWidthPct } = previewSliderRangeRef.current;
      if (isNearPreviewZoomPercent(fitPct, fitWidthPct)) {
        const now = Date.now();
        if (now - uiDisabledAudioLastPlayAtRef.current > 180) {
          uiDisabledAudioLastPlayAtRef.current = now;
          const audio =
            uiDisabledAudioRef.current ?? new Audio(UI_DISABLED_SOUND_SRC);
          uiDisabledAudioRef.current = audio;
          try {
            audio.currentTime = 0;
          } catch {
            // no-op
          }
          void audio.play().catch(() => {});
        }
        return;
      }
      if (previewSliderInteractionLockedRef.current) return;
      const p = previewSliderPercentRef.current;
      const nearFitWidth = isNearPreviewZoomPercent(p, fitWidthPct);
      e.preventDefault();
      setPreviewSliderPercent(nearFitWidth ? fitPct : fitWidthPct);
      setPreviewPan({ x: 0, y: 0 });
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      previewPointerOverImgRef.current = false;
    };
  }, [isPosterPreviewOpen, isInfoMode]);

  /** 主区内预告片 overlay 打开时 ESC 关闭（Edit Trailer URL 弹窗占用 ESC 时跳过）。 */
  useEffect(() => {
    if (!selectedMovie || modalMode !== 'trailer') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditTrailerModalOpen) return;
      e.preventDefault();
      setSelectedMovie(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedMovie, modalMode, isEditTrailerModalOpen]);

  /** Edit Trailer URL 弹窗 ESC 关闭（不影响底部预告片浮层）。 */
  useEffect(() => {
    if (!isEditTrailerModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isEditingTrailer) return;
      e.preventDefault();
      setIsEditTrailerModalOpen(false);
      setEditTrailerError('');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isEditTrailerModalOpen, isEditingTrailer]);

  /**
   * 从海报区域 DOM 取 `getBoundingClientRect()` 再打开预览（列表/网格共用 hero）。
   *
   * @param movie 当前影片
   * @param element 列表缩略图外壳或网格海报外壳等
   */
  const openPosterPreviewFromElement = (movie: Movie, element: Element | null | undefined) => {
    const rect = element?.getBoundingClientRect() ?? null;
    const img =
      element instanceof HTMLImageElement
        ? element
        : (element?.querySelector?.('img') as HTMLImageElement | null);
    let naturalHint: { w: number; h: number } | null = null;
    if (img && img.naturalWidth > 0 && img.naturalHeight > 0) {
      naturalHint = { w: img.naturalWidth, h: img.naturalHeight };
    }
    openPosterPreview(movie, rect, naturalHint);
  };

  /**
   * 打开大图预览（与上传用小 modal 分离）。
   * 传入有效 `heroFromRect` 时播放 hero 后再露出完整预览层内容。
   *
   * @param naturalHint 点击处海报 `naturalWidth/Height`；缺失时用 `heroFromRect` 宽高比推算。
   */
  const openPosterPreview = (
    movie: Movie,
    heroFromRect?: DOMRect | null,
    naturalHint?: { w: number; h: number } | null,
  ) => {
    posterHeroFinishOnceRef.current = false;
    const hasHero =
      heroFromRect != null &&
      heroFromRect.width > 1 &&
      heroFromRect.height > 1 &&
      Number.isFinite(heroFromRect.left) &&
      Number.isFinite(heroFromRect.top);
    if (hasHero && heroFromRect) {
      const resolvedNatural =
        naturalHint && naturalHint.w > 0 && naturalHint.h > 0
          ? naturalHint
          : {
              w: Math.max(2, Math.round(heroFromRect.width * 1000)),
              h: Math.max(2, Math.round(heroFromRect.height * 1000)),
            };
      posterHeroNaturalRef.current = resolvedNatural;
      setPosterHeroNaturalSize(resolvedNatural);
      setPosterHeroFromRect({
        left: heroFromRect.left,
        top: heroFromRect.top,
        width: heroFromRect.width,
        height: heroFromRect.height,
      });
      setPosterHeroTargetRect(null);
      setPosterHeroRun(false);
      setIsPosterHeroAnimating(true);
    } else {
      setIsPosterHeroAnimating(false);
      setPosterHeroFromRect(null);
      setPosterHeroTargetRect(null);
      setPosterHeroRun(false);
      setPosterHeroNaturalSize(null);
      posterHeroNaturalRef.current = null;
    }
    setPosterPreviewMovie(movie);
    setPreviewNaturalSize(null);
    setPreviewPan({ x: 0, y: 0 });
    setIsInfoMode(false);
    if (!hasHero) {
      setPreviewSliderPercent(100);
    }
    setIsPosterPreviewOpen(true);
  };

  const finishPosterHero = useCallback(() => {
    if (posterHeroFinishOnceRef.current) return;
    posterHeroFinishOnceRef.current = true;
    const hint = posterHeroNaturalRef.current;
    if (hint && hint.w > 0 && hint.h > 0) {
      setPreviewNaturalSize((prev) => (prev ?? { w: hint.w, h: hint.h }));
    }
    posterHeroNaturalRef.current = null;
    setPosterHeroNaturalSize(null);
    setIsPosterHeroAnimating(false);
    setPosterHeroFromRect(null);
    setPosterHeroTargetRect(null);
    setPosterHeroRun(false);
  }, []);

  /** 下一帧启动 transform；目标为与真实预览一致的 disp 外接矩形，并同步初始 slider。 */
  useLayoutEffect(() => {
    if (!isPosterHeroAnimating || !posterHeroFromRect || !posterHeroNaturalSize) return;
    const host = mainPreviewHostRef.current?.getBoundingClientRect();
    if (!host || host.width < 40) {
      setIsPosterHeroAnimating(false);
      setPosterHeroFromRect(null);
      setPosterHeroTargetRect(null);
      return;
    }
    const pad = POSTER_PREVIEW_LAYOUT_PAD_PX;
    const maxW = Math.max(80, host.width - pad * 2);
    const maxH = Math.max(80, host.height - pad * 2);
    const sFill = getPreviewFillScale(posterHeroNaturalSize.w, posterHeroNaturalSize.h, maxW, maxH);
    const minPct = getPreviewSliderMinPercent(sFill);
    setPreviewSliderPercent(minPct);
    const target = computePreviewPosterDisplayRect(
      host,
      posterHeroNaturalSize.w,
      posterHeroNaturalSize.h,
      minPct,
      pad,
      { x: 0, y: 0 },
    );
    setPosterHeroTargetRect(target);
    let cancelled = false;
    const id = window.requestAnimationFrame(() => {
      if (!cancelled) setPosterHeroRun(true);
    });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(id);
    };
  }, [isPosterHeroAnimating, posterHeroFromRect, posterHeroNaturalSize]);

  /** `transitionend` 未触发时兜底结束 hero。 */
  useEffect(() => {
    if (!posterHeroRun || !isPosterHeroAnimating) return;
    const tid = window.setTimeout(finishPosterHero, POSTER_HERO_TRANSITION_MS + 120);
    return () => window.clearTimeout(tid);
  }, [posterHeroRun, isPosterHeroAnimating, finishPosterHero]);

  useEffect(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return;
    const bump = () => setPreviewLayoutTick((n) => n + 1);
    window.addEventListener('resize', bump);
    return () => window.removeEventListener('resize', bump);
  }, [isPosterPreviewOpen, previewNaturalSize]);

  /**
   * 侧栏开合等会改变主内容宽度，需同步重算预览布局。
   * ResizeObserver 在单帧内可能多次触发，用 rAF 合并为一次 `setPreviewLayoutTick`。
   */
  useEffect(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return;
    const host = mainPreviewHostRef.current;
    if (!host || typeof ResizeObserver === 'undefined') return;
    let rafId: number | null = null;
    const scheduleBump = () => {
      if (rafId !== null) return;
      rafId = window.requestAnimationFrame(() => {
        rafId = null;
        setPreviewLayoutTick((n) => n + 1);
      });
    };
    const ro = new ResizeObserver(scheduleBump);
    ro.observe(host);
    return () => {
      ro.disconnect();
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
        rafId = null;
      }
    };
  }, [isPosterPreviewOpen, previewNaturalSize]);

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const allUniqueGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach((m) => m.genre.forEach((g) => set.add(normalizeGenreDisplayLabel(g))));
    return Array.from(set).sort();
  }, [movies]);

  const genres = allUniqueGenres;
  const years = ['2020s', '2010s', '2000s', '1990s', 'Classic'];
  const ratings = [5, 4, 3, 2, 1, 0];

  const toggleFilter = <T,>(list: T[], item: T, setList: (val: T[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const handleDeleteMovie = (movie: Movie) => {
    const prevSnapshot = movies;
    setMovies((prev) => prev.filter((m) => m.id !== movie.id));

    const supabase = supabaseRef.current;
    if (!supabase) {
      setLibraryActionError('Could not delete movie: not connected to shared library.');
      setMovies(prevSnapshot);
      return;
    }
    void deletePublicMovie(supabase, movie.id).catch((err) => {
      console.error('Failed to delete public movie:', err);
      setLibraryActionError(
        err instanceof Error
          ? `Failed to delete movie: ${err.message}`
          : 'Failed to delete movie.'
      );
      setMovies(prevSnapshot);
    });
  };

  const handleRatingChange = (movieId: string, newRating: number) => {
    const current = movies.find((m) => m.id === movieId);
    if (!current) return;
    const prevSnapshot = movies;
    setMovies((prev) =>
      prev.map((m) => (m.id === movieId ? { ...m, personalRating: newRating } : m))
    );

    const supabase = supabaseRef.current;
    if (!supabase) {
      setLibraryActionError('Could not save rating: not connected to shared library.');
      setMovies(prevSnapshot);
      return;
    }
    const updatedMovie: Movie = { ...current, personalRating: newRating };
    void upsertPublicMovie(supabase, updatedMovie).catch((err) => {
      console.error('Failed to update personal rating:', err);
      setLibraryActionError(
        err instanceof Error ? `Failed to save rating: ${err.message}` : 'Failed to save rating.'
      );
      setMovies(prevSnapshot);
    });
  };

  /**
   * 打开 Edit Trailer URL 弹窗：以当前 `selectedMovie.trailerUrl` 作为初始值，重置错误并清理上一轮 loading。
   */
  const openEditTrailerModal = () => {
    if (!selectedMovie) return;
    setEditTrailerUrlInput(selectedMovie.trailerUrl ?? '');
    setEditTrailerError('');
    setIsEditingTrailer(false);
    setIsEditTrailerModalOpen(true);
  };

  /**
   * 应用新的预告片 URL：先校验并写入 Supabase，成功后再更新 `movies` / `selectedMovie` 并关弹窗；
   * 失败则保留弹窗与背后预告预览不变。
   */
  const handleApplyEditTrailerUrl = async () => {
    if (!selectedMovie) return;
    const raw = editTrailerUrlInput.trim();
    if (!raw) {
      setEditTrailerError('Please enter a trailer URL.');
      return;
    }
    const normalized = getYouTubeEmbedUrl(raw);
    if (!normalized.includes('/embed/')) {
      setEditTrailerError('Could not parse this as a YouTube trailer URL.');
      return;
    }

    setIsEditingTrailer(true);
    setEditTrailerError('');

    const supabase = supabaseRef.current ?? getSupabaseClient();
    supabaseRef.current = supabase;

    try {
      await updatePublicMovieTrailerUrl(supabase, selectedMovie.id, normalized);
      const updatedMovie: Movie = { ...selectedMovie, trailerUrl: normalized };
      setMovies((prev) => prev.map((m) => (m.id === updatedMovie.id ? updatedMovie : m)));
      setSelectedMovie(updatedMovie);
      setIsEditingTrailer(false);
      setIsEditTrailerModalOpen(false);
    } catch (err) {
      console.error('Failed to persist trailer URL to public library:', err);
      setEditTrailerError(
        err instanceof Error
          ? `Could not save trailer URL: ${err.message}`
          : 'Could not save trailer URL. Please try again.',
      );
      setIsEditingTrailer(false);
    }
  };

  const resizePosterImage = (file: File) => new Promise<string>((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please choose an image file.'));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Failed to read the image file.'));
    reader.onload = () => {
      const image = new window.Image();
      image.onerror = () => reject(new Error('Failed to load the image file.'));
      image.onload = () => {
        const maxWidth = 900;
        const maxHeight = 1350;
        const scale = Math.min(1, maxWidth / image.width, maxHeight / image.height);
        const width = Math.max(1, Math.round(image.width * scale));
        const height = Math.max(1, Math.round(image.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');

        if (!context) {
          reject(new Error('Failed to prepare the poster image.'));
          return;
        }

        context.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.88));
      };
      image.src = String(reader.result);
    };
    reader.readAsDataURL(file);
  });

  const handlePosterFileChange = async (file: File | undefined) => {
    if (!file) return;

    setPosterUploadError('');
    try {
      const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!allowed.has(file.type)) {
        throw new Error('Unsupported image type. Please upload JPEG, PNG, or WebP.');
      }
      const maxBytes = 25 * 1024 * 1024; // 25MB
      if (file.size > maxBytes) {
        throw new Error('Image is too large. Please choose a file under 25MB.');
      }

      setPendingPosterFile(file);
      setPendingPosterUrl(URL.createObjectURL(file));
    } catch (error) {
      setPosterUploadError(error instanceof Error ? error.message : 'Failed to process poster image.');
    }
  };

  const handleUsePoster = () => {
    const targetMovie =
      isScopedPosterUploadOpen && posterPreviewMovie ? posterPreviewMovie : selectedMovie;
    if (!targetMovie) {
      setPosterUploadError('No movie selected. Please try again.');
      return;
    }
    if (!pendingPosterFile) {
      setPosterUploadError('Please choose an image first.');
      return;
    }

    const supabase = supabaseRef.current;
    if (!supabase) {
      setPosterUploadError(
        'Unable to upload poster. Please check your connection and try again.',
      );
      return;
    }

    setPosterUploadError('');

    void (async () => {
      setIsPosterApplying(true);
      try {
        const { posterStoragePath, signedPosterUrl } = await uploadPublicPosterFileAndSign(
          supabase,
          targetMovie.id,
          pendingPosterFile
        );

        const updatedMovie: Movie = {
          ...targetMovie,
          posterUrl: signedPosterUrl,
          posterStoragePath,
        };

        await updatePublicMoviePoster(supabase, targetMovie.id, {
          storagePath: posterStoragePath,
          posterUrl: null,
        });

        setMovies((prev) =>
          prev.map((movie) => (movie.id === targetMovie.id ? updatedMovie : movie)),
        );
        setSelectedMovie((prev) => (prev?.id === targetMovie.id ? updatedMovie : prev));
        setPosterPreviewMovie((prev) => (prev?.id === targetMovie.id ? updatedMovie : prev));
        setPendingPosterUrl(null);
        setPendingPosterFile(null);
        setPosterUploadError('');
        setIsScopedPosterUploadOpen(false);
      } catch (error) {
        setPosterUploadError(error instanceof Error ? error.message : 'Failed to upload poster.');
      } finally {
        setIsPosterApplying(false);
      }
    })();
  };

  useEffect(() => {
    return () => {
      if (pendingPosterUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(pendingPosterUrl);
      }
    };
  }, [pendingPosterUrl]);

  /**
   * 从 Storage 拉取该片已存海报，刷新签名 URL，并把共享公共行的海报来源以 Storage 为准（清空外链 `poster_url`）。
   */
  const handleSyncPosterFromStorage = () => {
    if (!selectedMovie) return;

    const supabase = supabaseRef.current;
    if (!supabase) return;

    setPosterUploadError('');
    void (async () => {
      setIsPosterSyncing(true);
      try {
        const updatedMovie = await syncPublicMoviePosterFromStorage(supabase, selectedMovie);
        setMovies((prev) => prev.map((m) => (m.id === updatedMovie.id ? updatedMovie : m)));
        setSelectedMovie(updatedMovie);
        setPendingPosterUrl(null);
        setPosterUploadError('');
      } catch (error) {
        setPosterUploadError(
          error instanceof Error ? error.message : 'Failed to sync poster from Storage.',
        );
      } finally {
        setIsPosterSyncing(false);
      }
    })();
  };

  /**
   * Enrich + 组装完整 `Movie` 并 `upsertPublicMovie`（不含 modal / `isAdding` / 本地列表写入）。
   *
   * @param imdbId 规范小写 `tt…` id
   * @param userTrailerFromModal Add Movie modal 内用户填的预告片 URL（trim 后）
   * @returns 写入后的完整影片
   */
  const enrichAndUpsertNewMovie = async (
    imdbId: string,
    userTrailerFromModal: string,
  ): Promise<Movie> => {
    const supabase = supabaseRef.current ?? getSupabaseClient();
    supabaseRef.current = supabase;

    const { data, error } = await supabase.functions.invoke('enrich-movie-from-imdb', {
      body: { imdbId },
    });

    if (error) {
      throw new Error(error.message || 'Enrich failed');
    }

    const payload = data as {
      mediaType?: 'movie' | 'tv';
      title?: string;
      year?: number;
      runtime?: string;
      genres?: string[];
      director?: string;
      cast?: string[];
      posterUrl?: string;
      trailerUrl?: string | null;
      imdbRating?: number;
      rottenTomatoes?: number;
      contentRating?: string;
      plot?: string;
      writer?: string;
      tagline?: string;
      releaseDate?: string;
      countryOfOrigin?: string;
      alsoKnownAs?: string[];
      productionCompanies?: string[];
      boxOffice?: string;
      castDetails?: Array<{ name?: string; character?: string }>;
      error?: string;
      message?: string;
    };

    if (!payload || typeof payload === 'string' || payload.error) {
      throw new Error(
        typeof payload?.message === 'string'
          ? payload.message
          : typeof payload?.error === 'string'
            ? payload.error
            : 'Failed to enrich movie',
      );
    }

    const trailerFromEdge = payload.trailerUrl?.trim() ?? '';
    const trailerUrl = userTrailerFromModal
      ? getYouTubeEmbedUrl(userTrailerFromModal)
      : trailerFromEdge
        ? getYouTubeEmbedUrl(trailerFromEdge)
        : '';

    const posterUrl =
      payload.posterUrl && payload.posterUrl.trim()
        ? payload.posterUrl.trim()
        : 'https://picsum.photos/seed/movie/400/600';

    const castDetails: MovieCastDetail[] = Array.isArray(payload.castDetails)
      ? payload.castDetails
          .map((e) => {
            if (!e || typeof e !== 'object') return null;
            const name =
              typeof (e as { name?: string }).name === 'string'
                ? (e as { name: string }).name.trim()
                : '';
            if (!name) return null;
            const character =
              typeof (e as { character?: string }).character === 'string'
                ? (e as { character: string }).character.trim()
                : '';
            return { name, character };
          })
          .filter((x): x is MovieCastDetail => x != null)
      : [];

    const newMovie: Movie = {
      id: imdbId,
      title: payload.title ?? 'Unknown',
      year: typeof payload.year === 'number' && Number.isFinite(payload.year) ? payload.year : 0,
      genre: Array.isArray(payload.genres) ? payload.genres : [],
      director: payload.director ?? '',
      cast: Array.isArray(payload.cast)
        ? payload.cast.filter((n): n is string => typeof n === 'string')
        : [],
      imdbRating: typeof payload.imdbRating === 'number' ? payload.imdbRating : 0,
      rottenTomatoes: typeof payload.rottenTomatoes === 'number' ? payload.rottenTomatoes : 0,
      personalRating: 0,
      runtime: payload.runtime ?? '',
      posterUrl,
      trailerUrl,
      isFavorite: false,
      language: '',
      isRecentlyAdded: true,
      dateAdded: Date.now(),
      contentRating: String(payload.contentRating ?? ''),
      plot: typeof payload.plot === 'string' ? payload.plot : '',
      writer: typeof payload.writer === 'string' ? payload.writer : '',
      tagline: typeof payload.tagline === 'string' ? payload.tagline : '',
      releaseDate: typeof payload.releaseDate === 'string' ? payload.releaseDate : '',
      countryOfOrigin: typeof payload.countryOfOrigin === 'string' ? payload.countryOfOrigin : '',
      alsoKnownAs: Array.isArray(payload.alsoKnownAs)
        ? payload.alsoKnownAs.filter((s): s is string => typeof s === 'string')
        : [],
      productionCompanies: Array.isArray(payload.productionCompanies)
        ? payload.productionCompanies.filter((s): s is string => typeof s === 'string')
        : [],
      boxOffice: typeof payload.boxOffice === 'string' ? payload.boxOffice : '',
      castDetails,
      mediaType:
        payload.mediaType === 'tv' ? 'tv' : payload.mediaType === 'movie' ? 'movie' : 'movie',
    };

    let uid = supabaseUidRef.current;
    if (!uid) {
      try {
        uid = await signInAnonymously(supabase);
        supabaseUidRef.current = uid;
      } catch (authErr) {
        console.error('Anonymous auth failed before save:', authErr);
        throw new Error(
          authErr instanceof Error
            ? authErr.message
            : 'Could not sign in to save your library. Please try again.',
        );
      }
    }

    try {
      await upsertPublicMovie(supabase, newMovie);
    } catch (saveErr) {
      console.error('Failed to save new movie to public library:', saveErr);
      throw new Error(
        saveErr instanceof Error
          ? saveErr.message
          : 'Failed to save movie to shared library. Please try again.',
      );
    }

    return newMovie;
  };

  /**
   * 搜索建议快加：立即插入占位、关闭 modal、滚动；后台 enrich + upsert。
   *
   * @param hit 已含非空 `imdbId` 的命中
   */
  const fastAddMovieFromSearchHit = (hit: MovieSearchHit & { imdbId: string }) => {
    const imdbId = hit.imdbId.trim().toLowerCase();
    if (!imdbId) return;
    if (moviesRef.current.some((m) => m.id.toLowerCase() === imdbId)) {
      setAddError('This movie is already in FilmBase.');
      return;
    }
    const userTrailerSnapshot = newMovieTrailerUrl.trim();
    const placeholder = buildPlaceholderMovieFromSearchHit(hit);
    setMovies((prev) => [placeholder, ...prev]);
    setPendingScrollMovieId(imdbId);
    setIsAddModalOpen(false);
    setNewMovieTitle('');
    setNewMovieUrl('');
    setNewMovieTrailerUrl('');
    setIsImdbEntered(false);
    setIsAddMovieImdbSectionExpanded(false);
    setAddError('');
    addMovieSearchSeqRef.current += 1;
    setAddMovieSearchHits([]);
    setAddMovieSearchLoading(false);
    setAddMovieSearchError('');
    setAddMovieSuggestionsDismissed(true);
    setAddMovieActiveSuggestionIndex(-1);

    void (async () => {
      try {
        const newMovie = await enrichAndUpsertNewMovie(imdbId, userTrailerSnapshot);
        setMovies((prev) => prev.map((m) => (m.id === imdbId ? { ...newMovie } : m)));
      } catch (err) {
        console.error('fast add enrich failed:', err);
        setMovies((prev) => prev.filter((m) => m.id !== imdbId));
        setLibraryActionError(
          err instanceof Error ? err.message : 'Failed to add movie. It was removed from the list.',
        );
      }
    })();
  };

  /**
   * 使用已解析的 IMDb id 拉取元数据、写入 `filmbase_public_movies` 并更新本地列表后关闭 Add Movie modal。
   *
   * @param imdbIdRaw — 含 `tt…` 的片段或完整字符串（会规范为小写 `tt` id）。
   * @returns 是否成功完成新增并关闭 modal。
   */
  const addMovieFromImdbId = async (imdbIdRaw: string): Promise<boolean> => {
    const imdbIdMatch = imdbIdRaw.match(/tt\d+/i);
    const imdbId = imdbIdMatch ? imdbIdMatch[0].toLowerCase() : null;
    if (!imdbId) {
      setAddError("Please enter a valid IMDb URL containing 'tt...'");
      return false;
    }

    if (moviesRef.current.some((m) => m.id.toLowerCase() === imdbId)) {
      setAddError('This movie is already in FilmBase.');
      return false;
    }

    setAddError('');
    setIsAdding(true);

    try {
      const newMovie = await enrichAndUpsertNewMovie(imdbId, newMovieTrailerUrl.trim());
      setMovies((prev) => [newMovie, ...prev]);
      setPendingScrollMovieId(newMovie.id);

      setIsAddModalOpen(false);
      setNewMovieTitle('');
      setNewMovieUrl('');
      setNewMovieTrailerUrl('');
      setIsImdbEntered(false);
      setIsAddMovieImdbSectionExpanded(false);
      return true;
    } catch (err) {
      console.error('Error invoking enrich-movie-from-imdb:', err);
      setAddError(err instanceof Error ? err.message : 'Failed to fetch movie data.');
      return false;
    } finally {
      setIsAdding(false);
    }
  };

  const handleAddMovie = async () => {
    if (!newMovieUrl.trim()) return;
    await addMovieFromImdbId(newMovieUrl);
  };

  /** Add Movie modal 内：标题 ≥2 字时防抖调用 `search-movies`。 */
  useEffect(() => {
    if (!isAddModalOpen) return;
    const q = newMovieTitle.trim();
    if (q.length < 2) {
      setAddMovieSearchHits([]);
      setAddMovieSearchLoading(false);
      setAddMovieSearchError('');
      setAddMovieActiveSuggestionIndex(-1);
      return;
    }

    setAddMovieSearchLoading(true);
    setAddMovieSearchError('');
    setAddMovieSearchHits([]);
    const seq = ++addMovieSearchSeqRef.current;
    const t = window.setTimeout(() => {
      void (async () => {
        const supabase = supabaseRef.current ?? getSupabaseClient();
        supabaseRef.current = supabase;
        try {
          const { data, error } = await supabase.functions.invoke('search-movies', {
            body: { query: q },
          });
          if (seq !== addMovieSearchSeqRef.current) return;
          if (error) {
            setAddMovieSearchHits([]);
            setAddMovieSearchError(error.message || 'Search failed');
            return;
          }
          const raw = data as {
            results?: MovieSearchHit[];
            error?: string;
            message?: string;
          };
          if (!raw || typeof raw === 'string' || raw.error) {
            setAddMovieSearchHits([]);
            setAddMovieSearchError(
              typeof raw?.message === 'string'
                ? raw.message
                : typeof raw?.error === 'string'
                  ? raw.error
                  : 'Search failed',
            );
            return;
          }
          const list = Array.isArray(raw.results) ? raw.results : [];
          const withImdb: Array<MovieSearchHit & { imdbId: string }> = [];
          for (const h of list) {
            if (!h || typeof h !== 'object') continue;
            const id = (h as MovieSearchHit).imdbId;
            if (typeof id !== 'string' || !id.trim()) continue;
            withImdb.push({ ...(h as MovieSearchHit), imdbId: id.trim() });
          }
          const visible = withImdb.filter(
            (h) => !isAddMovieSearchSuggestionInLibrary(h, moviesRef.current),
          );
          setAddMovieSearchHits(visible);
          setAddMovieActiveSuggestionIndex(-1);
        } catch (e) {
          if (seq !== addMovieSearchSeqRef.current) return;
          setAddMovieSearchHits([]);
          setAddMovieSearchError(e instanceof Error ? e.message : 'Search failed');
        } finally {
          if (seq === addMovieSearchSeqRef.current) {
            setAddMovieSearchLoading(false);
          }
        }
      })();
    }, 300);

    return () => {
      window.clearTimeout(t);
    };
  }, [newMovieTitle, isAddModalOpen]);

  /** Add Movie modal 关闭时作废进行中的搜索请求并清空建议 UI。 */
  useEffect(() => {
    if (isAddModalOpen) return;
    addMovieSearchSeqRef.current += 1;
    setAddMovieSearchHits([]);
    setAddMovieSearchLoading(false);
    setAddMovieSearchError('');
    setAddMovieSuggestionsDismissed(false);
    setAddMovieActiveSuggestionIndex(-1);
    setIsAddMovieImdbSectionExpanded(false);
  }, [isAddModalOpen]);

  /** Add Movie modal 打开时聚焦「Search by title」输入框。 */
  useEffect(() => {
    if (!isAddModalOpen) return;
    const id = window.requestAnimationFrame(() => {
      addMovieTitleSearchInputRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(id);
  }, [isAddModalOpen]);

  const resetFilters = () => {
    setSelectedGenres([]);
    setSelectedYears([]);
    setSelectedRatings([]);
    setSearchQuery('');
    setIsRecentlyAddedFilter(false);
  };

  const filteredMovies = useMemo(() => {
    const filtered = movies.filter(movie => {
      // Recently Added Filter (24h)
      if (isRecentlyAddedFilter) {
        const addedDate = typeof movie.dateAdded === 'number' ? movie.dateAdded : new Date(movie.dateAdded || 0).getTime();
        if (Date.now() - addedDate >= 86400000) return false;
      }

      const matchesSearch = movie.title.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesGenre =
        selectedGenres.length === 0 ||
        movie.genre.some((g) => selectedGenres.includes(normalizeGenreDisplayLabel(g)));
      
      const matchesRating = selectedRatings.length === 0 || selectedRatings.includes(movie.personalRating) || (selectedRatings.includes(0) && !movie.personalRating);

      let matchesYear = selectedYears.length === 0;
      if (!matchesYear) {
        matchesYear = selectedYears.some(bucket => {
          if (bucket === '2020s') return movie.year >= 2020;
          if (bucket === '2010s') return movie.year >= 2010 && movie.year < 2020;
          if (bucket === '2000s') return movie.year >= 2000 && movie.year < 2010;
          if (bucket === '1990s') return movie.year >= 1990 && movie.year < 2000;
          if (bucket === 'Classic') return movie.year < 1990;
          return false;
        });
      }

      return matchesSearch && matchesGenre && matchesYear && matchesRating;
    });

    return [...filtered].sort((a, b) => {
      if (sortMode === 'title-asc') return a.title.localeCompare(b.title);
      if (sortMode === 'title-desc') return b.title.localeCompare(a.title);
      if (sortMode === 'duration-desc') {
        const durA = parseInt(a.runtime) || 0;
        const durB = parseInt(b.runtime) || 0;
        return durB - durA;
      }
      if (sortMode === 'duration-asc') {
        const durA = parseInt(a.runtime) || 0;
        const durB = parseInt(b.runtime) || 0;
        return durA - durB;
      }
      if (sortMode === 'imdb-asc') return a.imdbRating - b.imdbRating;
      if (sortMode === 'imdb-desc') return b.imdbRating - a.imdbRating;
      if (sortMode === 'rt-asc') return a.rottenTomatoes - b.rottenTomatoes;
      if (sortMode === 'rt-desc') return b.rottenTomatoes - a.rottenTomatoes;
      if (sortMode === 'personal-asc') return a.personalRating - b.personalRating;
      if (sortMode === 'personal-desc') return b.personalRating - a.personalRating;
      return 0;
    });
  }, [movies, searchQuery, selectedGenres, selectedYears, selectedRatings, sortMode]);

  /** 新增影片后：将对应卡片/列表行滚入主片库视口顶部区域（不改变排序）。 */
  useLayoutEffect(() => {
    if (!pendingScrollMovieId || !isMoviesHydrated) return;

    const id = pendingScrollMovieId;
    const NEW_ITEM_SCROLL_TOP_BAND_PX = 100;
    let cancelled = false;
    let rafId = 0;
    let scheduledRafRetry = false;

    const tryScrollToMovie = (): boolean => {
      const el = movieLibraryItemElsRef.current.get(id);
      const container = mainLibraryScrollRef.current;
      if (!el || !container) return false;

      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const alreadyNearTop =
        eRect.top >= cRect.top - 4 &&
        eRect.top <= cRect.top + NEW_ITEM_SCROLL_TOP_BAND_PX &&
        eRect.bottom <= cRect.bottom + 12;

      if (!alreadyNearTop) {
        el.scrollIntoView({ block: 'start', behavior: 'smooth' });
      }

      return true;
    };

    if (tryScrollToMovie()) {
      setPendingScrollMovieId(null);
      return () => {
        cancelled = true;
      };
    }

    scheduledRafRetry = true;
    rafId = window.requestAnimationFrame(() => {
      if (cancelled) {
        setPendingScrollMovieId(null);
        return;
      }
      tryScrollToMovie();
      setPendingScrollMovieId(null);
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(rafId);
      if (scheduledRafRetry) {
        setPendingScrollMovieId((p) => (p === id ? null : p));
      }
    };
  }, [pendingScrollMovieId, filteredMovies, viewMode, isMoviesHydrated]);

  /** 侧栏「All Films」是否为默认筛选态（与 `resetFilters` 后一致）。 */
  const isAllFilmsDefaultView =
    !isRecentlyAddedFilter &&
    selectedGenres.length === 0 &&
    selectedYears.length === 0 &&
    selectedRatings.length === 0 &&
    !searchQuery;

  /**
   * 侧栏 Genre / Year 筛选项行。左内边距为原 `px-2.5`（10px）+ 14px = `pl-6`（24px），右为 `pr-2.5`；图标与文案间距仍为 `mr-[10px]`。
   * 底栏 All Films、Recently Added 不使用本组件。
   */
  const SidebarItem = ({
    active,
    label,
    onClick,
    iconSlug,
  }: {
    active: boolean;
    label: string | React.ReactNode;
    onClick: () => void;
    /** 有值时在文案左侧显示 `public/icons/{slug}.svg`（与 `-hover` 配对）；未知类型用 `fallback`；`Genre` 总标题行勿传。 */
    iconSlug?: string | null;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={`group/sidebarrow flex h-9 w-[200px] items-center pl-3 pr-2.5 py-0 rounded-md text-[13px] transition-colors text-left ${
        active
          ? 'bg-[#EB9692]/20 font-bold text-white'
          : 'font-medium text-white/70 hover:bg-white/5 hover:text-white'
      }`}
    >
      {iconSlug ? (
        <span className="relative mr-[10px] h-[20px] w-[20px] shrink-0">
          <img draggable={false}
            src={`/icons/${iconSlug}.svg`}
            alt=""
            width={20}
            height={20}
            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
              active ? 'opacity-0' : 'opacity-100 group-hover/sidebarrow:opacity-0'
            }`}
            decoding="async"
            aria-hidden
          />
          <img draggable={false}
            src={`/icons/${iconSlug}-hover.svg`}
            alt=""
            width={20}
            height={20}
            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
              active ? 'opacity-100' : 'opacity-0 group-hover/sidebarrow:opacity-100'
            }`}
            decoding="async"
            aria-hidden
          />
        </span>
      ) : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );

  const posterPreviewLayout = useMemo(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return null;
    const host = mainPreviewHostRef.current?.getBoundingClientRect();
    if (!host || host.width < 80 || host.height < 80) return null;
    const pad = POSTER_PREVIEW_LAYOUT_PAD_PX;
    const nw = previewNaturalSize.w;
    const nh = previewNaturalSize.h;
    const { maxW, maxH, dispW, dispH, s, sCap, sFill, effectiveFitScale } =
      computePreviewPosterFrameDims(host, nw, nh, previewSliderPercent, pad);
    const needsPan = dispW > maxW + 0.5 || dispH > maxH + 0.5;
    return { maxW, maxH, nw, nh, sFill, effectiveFitScale, s, sCap, dispW, dispH, needsPan };
  }, [isPosterPreviewOpen, previewNaturalSize, previewSliderPercent, previewLayoutTick]);

  /** `posterPreviewLayout` 尚不可算时（首帧 host 未就绪），与 hero 后首帧同一套 maxW/maxH/disp。 */
  const previewPosterFrameFallback = useMemo(() => {
    if (posterPreviewLayout || !isPosterPreviewOpen || !previewNaturalSize) return null;
    const host = mainPreviewHostRef.current?.getBoundingClientRect();
    if (!host || host.width < 80 || host.height < 80) return null;
    return computePreviewPosterFrameDims(
      host,
      previewNaturalSize.w,
      previewNaturalSize.h,
      previewSliderPercent,
      POSTER_PREVIEW_LAYOUT_PAD_PX,
    );
  }, [posterPreviewLayout, isPosterPreviewOpen, previewNaturalSize, previewSliderPercent, previewLayoutTick]);

  /** 与 range `min` 一致：有效 Fit `round(min(1,sFill)×100)`。 */
  const previewSliderMinPercent = useMemo(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return 100;
    const host = mainPreviewHostRef.current?.getBoundingClientRect();
    if (!host || host.width < 80 || host.height < 80) return 100;
    const pad = POSTER_PREVIEW_LAYOUT_PAD_PX;
    const maxW = Math.max(80, host.width - pad * 2);
    const maxH = Math.max(80, host.height - pad * 2);
    const sFill = getPreviewFillScale(previewNaturalSize.w, previewNaturalSize.h, maxW, maxH);
    return getPreviewSliderMinPercent(sFill);
  }, [isPosterPreviewOpen, previewNaturalSize, previewLayoutTick]);

  /** Fit Width：`min(1, maxW/nw)×100`%，与 Z / 点击第二档一致。 */
  const previewFitWidthPercent = useMemo(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return 100;
    const host = mainPreviewHostRef.current?.getBoundingClientRect();
    if (!host || host.width < 80 || host.height < 80) return 100;
    const pad = POSTER_PREVIEW_LAYOUT_PAD_PX;
    const maxW = Math.max(80, host.width - pad * 2);
    const nw = previewNaturalSize.w;
    return Math.min(100, getPreviewScaleCapByViewportWidth(maxW, nw) * 100);
  }, [isPosterPreviewOpen, previewNaturalSize, previewLayoutTick]);

  /** 与 range `max` 一致：Photos 式真实百分比右端固定为 100%，不超过 1:1 原图。 */
  const previewSliderMaxPercent = useMemo(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return 100;
    return Math.max(previewSliderMinPercent, 100);
  }, [isPosterPreviewOpen, previewNaturalSize, previewSliderMinPercent]);

  const previewZoomSliderRange = previewSliderMaxPercent - previewSliderMinPercent;
  /**
   * 仅以滑块百分数判定 Fit 视觉状态：thumb 固定在最左侧、hover 显示 `Fit`。
   * 不再把「图像 contained / !needsPan」视为 Fit；Fit Width 在小图上同样可能 contained，
   * 若把它当成 Fit 会让 thumb 误回到最左端。
   */
  const isPosterPreviewAtFitVisual =
    posterPreviewLayout != null &&
    isNearPreviewZoomPercent(previewSliderPercent, previewSliderMinPercent);
  const previewZoomSliderNorm =
    previewZoomSliderRange > 1e-6
      ? Math.min(
          1,
          Math.max(
            0,
            (previewSliderPercent - previewSliderMinPercent) / previewZoomSliderRange,
          ),
        )
      : 0;

  /** 无可用区间（min≈max）时禁用滑块与 ±。 */
  const isPreviewZoomSliderNoRange = previewZoomSliderRange <= 1e-6;

  previewSliderRangeRef.current = {
    fitPct: previewSliderMinPercent,
    fitWidthPct: previewFitWidthPercent,
  };
  previewSliderInteractionLockedRef.current =
    previewSliderMaxPercent <= previewSliderMinPercent;

  /** 视口变化导致 fit/max 变化时，保持 slider 值落在 `[min, max]`。 */
  useEffect(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return;
    setPreviewSliderPercent((p) =>
      Math.min(previewSliderMaxPercent, Math.max(previewSliderMinPercent, p)),
    );
  }, [isPosterPreviewOpen, previewNaturalSize, previewSliderMinPercent, previewSliderMaxPercent]);

  /**
   * 选好新本地海报（`pendingPosterUrl` 改变）后，把 thumb 复位到最左侧 fit 位置并清平移：
   * 新图可能与原海报尺寸差异大，旧 zoom 不再有意义；随后 `<img onLoad>` 拿到新尺寸时会再次精准对齐 minPct。
   */
  const lastPendingPosterUrlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!isPosterPreviewOpen) {
      lastPendingPosterUrlRef.current = null;
      return;
    }
    if (!pendingPosterUrl) {
      lastPendingPosterUrlRef.current = null;
      return;
    }
    if (lastPendingPosterUrlRef.current === pendingPosterUrl) return;
    lastPendingPosterUrlRef.current = pendingPosterUrl;
    setPreviewPan({ x: 0, y: 0 });
    setPreviewSliderPercent(previewSliderMinPercent);
  }, [pendingPosterUrl, isPosterPreviewOpen, previewSliderMinPercent]);

  posterPreviewLayoutRef.current = posterPreviewLayout;
  previewSliderPercentRef.current = previewSliderPercent;

  /** 1:1 显示且内容超出可视框时，光标为 zoom-out（Fit Width 仍可拖到 100%，不显示 zoom-out）。 */
  const isPreviewZoomOutCursor = Boolean(
    posterPreviewLayout?.needsPan && posterPreviewLayout.s >= 1 - 1e-6,
  );

  /** 悬停提示：Fit 时显示 Fit，否则显示当前相对原图的实际显示比例。 */
  const previewSliderHoverLabel =
    posterPreviewLayout == null
      ? ''
      : isPosterPreviewAtFitVisual
        ? 'Fit'
        : `${Math.round(posterPreviewLayout.s * 100)}%`;

  /** 预览标题下尺寸行后的 Z 键说明（Fit 与 Fit Width 等效时不显示）。 */
  const posterPreviewZoomHintSuffix = useMemo(() => {
    if (!isPosterPreviewOpen || !previewNaturalSize) return '';
    if (Math.abs(previewFitWidthPercent - previewSliderMinPercent) < 0.5) return '';
    if (isNearPreviewZoomPercent(previewSliderPercent, previewSliderMinPercent)) {
      return ', Press Z to Zoom in';
    }
    if (isNearPreviewZoomPercent(previewSliderPercent, previewFitWidthPercent)) {
      return ', Press Z to Zoom out';
    }
    return '';
  }, [
    isPosterPreviewOpen,
    previewNaturalSize,
    previewFitWidthPercent,
    previewSliderMinPercent,
    previewSliderPercent,
  ]);

  /** 无缩放区间（max≤min）时锁定 Fit↔最大 控件。 */
  const isPreviewZoomSliderLocked = previewSliderMaxPercent <= previewSliderMinPercent;

  /**
   * 海报预览内已选本地图、等待底部 Apply / Cancel 期间：仅锁定可能丢弃当前选图的关闭类入口
   * （顶栏 Back / Upload Poster、背景点击、ESC、shell 点击关浮层），
   * 不锁定缩放交互（slider / FIT / 100% / 鼠标点击缩放 / 拖拽 / 滚轮平移 / Z 键）。
   */
  const isAwaitingPosterApplyConfirm = Boolean(
    isPosterPreviewOpen &&
      isScopedPosterUploadOpen &&
      pendingPosterUrl &&
      !isPosterApplying,
  );

  /** Info Mode 或与待 Apply 一致：侧栏遮罩、顶栏 Back/缩放/上传、背景点按关闭等同锁态。 */
  const isPosterPreviewChromeLocked = isAwaitingPosterApplyConfirm || isInfoMode;

  /** 锁定或 min=max 时禁用滑块与 ±；Info Mode 下亦禁用。 */
  const isPreviewZoomSliderDisabled =
    isPreviewZoomSliderLocked || isPreviewZoomSliderNoRange;
  const isPosterPreviewZoomControlsDisabled = isPreviewZoomSliderDisabled || isInfoMode;

  /** 主内容区内全屏浮层：海报预览或预告片（与侧栏/顶栏分离）。 */
  const isTrailerOverlayInMain = Boolean(selectedMovie && modalMode === 'trailer');
  /**
   * 预告片播放或 Add Movie 弹窗打开时锁定主工具栏（Grid/List、海报尺寸、编辑/新增），
   * 用户需先完成浮层内任务或关闭弹窗。
   */
  const mainLibraryToolbarLockReason = isTrailerOverlayInMain
    ? 'Trailer playing'
    : deleteMovieConfirm
      ? 'Finish delete confirmation first'
      : isAddModalOpen
        ? 'Finish Add Movie first'
        : null;
  const isLibraryToolbarLocked = mainLibraryToolbarLockReason != null;
  /** 编辑库（含删除入口）期间禁用 Add Movie，避免与删片流程并行。 */
  const isAddMovieToolbarDisabled = isLibraryToolbarLocked || isEditing;
  const isMainContentOverlayActive =
    isPosterPreviewOpen || isTrailerOverlayInMain || isAddModalOpen || Boolean(deleteMovieConfirm);

  return (
    <div className="w-screen h-screen bg-[#000] antialiased font-sans overflow-hidden">
      {/* Viewport: Acts as the desktop background */}
      {/* The macOS Window Container */}
      <div className="macos-window w-full h-full bg-[#050505] text-[#E0E0E0] flex flex-col relative selection:bg-[#FFD700] selection:text-[#050505]">
        
        {/* Window Top Edge Highlighter (1px shine) */}
        <div className="absolute top-0 left-0 right-0 h-px bg-white/10 z-50 pointer-events-none"></div>

        {/* 共享公共片单写操作错误：固定在顶部居中、自动消失，不影响列表/详情布局 */}
        <AnimatePresence>
          {libraryActionError ? (
            <motion.div
              key="library-action-error-toast"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="pointer-events-none absolute left-1/2 top-3 z-[300] -translate-x-1/2"
              role="status"
              aria-live="polite"
            >
              <div className="pointer-events-auto flex items-center gap-2 rounded-md border border-red-400/40 bg-red-900/85 px-3 py-1.5 text-[12px] font-medium text-white shadow-[0_8px_24px_rgba(0,0,0,0.45)] backdrop-blur-sm">
                <span className="truncate max-w-[60vw]">{libraryActionError}</span>
                <button
                  type="button"
                  onClick={() => setLibraryActionError(null)}
                  className="ml-1 rounded-sm p-0.5 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
                  aria-label="Dismiss error"
                >
                  <X size={12} />
                </button>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="flex h-full w-full overflow-hidden relative">
          {/* Window Controls & Sidebar Toggle (Absolute Layer) */}
      <div
        className="absolute top-0 left-0 h-10 flex items-center pl-4 gap-3 z-[200]"
        onPointerDownCapture={onShellPointerDownCloseScopedOverlays}
      >
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <button
          type="button"
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="group/togglesidebar relative p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          title="Toggle Sidebar"
          aria-label="Toggle sidebar"
        >
          <img draggable={false}
            src="/icons/toggle-sidebar.svg"
            alt=""
            width={20}
            height={20}
            className="pointer-events-none block h-[20px] w-[20px] opacity-100 transition-opacity group-hover/togglesidebar:opacity-0"
            decoding="async"
            aria-hidden
          />
          <img draggable={false}
            src="/icons/toggle-sidebar-hover.svg"
            alt=""
            width={20}
            height={20}
            className="pointer-events-none absolute left-1/2 top-1/2 h-[20px] w-[20px] -translate-x-1/2 -translate-y-1/2 opacity-0 transition-opacity group-hover/togglesidebar:opacity-100"
            decoding="async"
            aria-hidden
          />
        </button>
      </div>

      {/* Sidebar */}
	      <aside
          className={`${isSidebarOpen ? 'w-[232px] border-r' : 'w-0 border-r-0'} flex h-full min-h-0 flex-col border-white/5 sidebar-gradient transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 relative z-10 ${
            isPosterPreviewChromeLocked ? 'opacity-50 transition-opacity' : ''
          }`}
          onPointerDownCapture={onShellPointerDownCloseScopedOverlays}
        >
        {/* Spacer for Window Controls (Axis A) */}
        <div className="h-10 flex-shrink-0 w-full" />
        
        {/* Sidebar Header / Search (Axis B) */}
        <div className="h-12 flex items-center px-4 min-w-[232px] flex-shrink-0">
          <div className="relative group w-full">
            {/* 16×16 素材缩放到 14×14，与原先 lucide Search size={14} 一致。 */}
            <img draggable={false}
              src="/icons/search.svg"
              alt=""
              width={14}
              height={14}
              className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 opacity-100"
              aria-hidden
            />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Search FilmBase"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="input-focus-primary w-full bg-black/20 border border-white/10 rounded-[17px] py-1.5 pl-8 pr-8 text-[13px] font-normal transition-all placeholder:text-white/20 text-white shadow-inner"
            />
            {searchQuery && (
              <button
                type="button"
                onPointerDown={(e) => {
                  if (!e.isPrimary) return;
                  setIsSidebarClearSearchPressed(true);
                }}
                onPointerUp={(e) => {
                  if (!e.isPrimary) return;
                  setSearchQuery('');
                  setIsSidebarClearSearchPressed(false);
                  searchInputRef.current?.focus();
                }}
                onPointerCancel={() => setIsSidebarClearSearchPressed(false)}
                onPointerLeave={() => setIsSidebarClearSearchPressed(false)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-white/20"
                title="Clear search"
              >
                <img
                  draggable={false}
                  src={
                    isSidebarClearSearchPressed
                      ? '/icons/clear-search-pressed.svg'
                      : '/icons/clear-search.svg'
                  }
                  alt=""
                  width={14}
                  height={14}
                  className="pointer-events-none h-3.5 w-3.5 select-none object-contain"
                  decoding="async"
                  aria-hidden
                />
              </button>
            )}
          </div>
        </div>
	        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pl-4 pr-4 mt-6 pb-2 min-w-[232px] [scrollbar-gutter:stable]">
          <nav className="space-y-2">
            <div>
              <button 
                onClick={() => toggleSection('genre')}
                className="flex items-center justify-between w-full pl-2.5 text-[12px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>Genre</span>
                <motion.div
                  animate={{ rotate: expandedSections.genre ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={16} strokeWidth={2.5} />
                </motion.div>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.genre ? 'auto' : 0,
                  opacity: expandedSections.genre ? 1 : 0,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden w-[200px]"
              >
                <ul className="space-y-0.5 w-[200px]">
                  {genres.map(genre => (
                    <li key={genre} className="w-[200px]">
                      <SidebarItem
                        label={genre}
                        active={selectedGenres.includes(genre)}
                        onClick={() => toggleFilter(selectedGenres, genre, setSelectedGenres)}
                        iconSlug={genreLabelToIconSlug(genre)}
                      />
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>

            <div>
              <button 
                onClick={() => toggleSection('year')}
                className="flex items-center justify-between w-full pl-2.5 text-[12px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>Year</span>
                <motion.div
                  animate={{ rotate: expandedSections.year ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={16} strokeWidth={2.5} />
                </motion.div>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.year ? 'auto' : 0,
                  opacity: expandedSections.year ? 1 : 0,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden w-[200px]"
              >
                <ul className="space-y-0.5 w-[200px]">
                  {years.map(year => (
                    <li key={year} className="w-[200px]">
                      <SidebarItem 
                        label={year}
                        active={selectedYears.includes(year)}
                        onClick={() => toggleFilter(selectedYears, year, setSelectedYears)}
                      />
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>

            <div>
              <button 
                onClick={() => toggleSection('ratings')}
                className="flex items-center justify-between w-full pl-2.5 text-[12px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>My Rating</span>
                <motion.div
                  animate={{ rotate: expandedSections.ratings ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={16} strokeWidth={2.5} />
                </motion.div>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.ratings ? 'auto' : 0,
                  opacity: expandedSections.ratings ? 1 : 0,
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden w-[200px]"
              >
                <ul className="space-y-0.5 w-[200px]">
                  {ratings.map((rating) => (
                    <li key={rating} className="w-[200px]">
                      <SidebarMyRatingFilterRow
                        rating={rating}
                        active={selectedRatings.includes(rating)}
                        onClick={() => toggleFilter(selectedRatings, rating, setSelectedRatings)}
                      />
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </nav>
        </div>

	        <div className="mt-auto flex-shrink-0 border-t border-white/5 pt-4 p-4 min-w-[256px]">
          <button
            type="button"
            onClick={resetFilters}
            className={`group/allfilms flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
              isAllFilmsDefaultView
                ? 'text-white'
                : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <span className="relative block h-[20px] w-[20px] shrink-0">
              <img draggable={false}
                src="/icons/films.svg"
                alt=""
                width={20}
                height={20}
                className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                  isAllFilmsDefaultView
                    ? 'opacity-0'
                    : 'opacity-100 group-hover/allfilms:opacity-0'
                }`}
                decoding="async"
                aria-hidden
              />
              <img draggable={false}
                src="/icons/films-hover.svg"
                alt=""
                width={20}
                height={20}
                className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                  isAllFilmsDefaultView
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/allfilms:opacity-100'
                }`}
                decoding="async"
                aria-hidden
              />
            </span>
            All Films
          </button>
          <button
            type="button"
            onClick={() => {
              setSelectedGenres([]);
              setSelectedYears([]);
              setSelectedRatings([]);
              setSearchQuery('');
              setIsRecentlyAddedFilter(true);
            }}
            className={`group/recent flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
              isRecentlyAddedFilter
                ? 'text-white'
                : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <span className="relative block h-[20px] w-[20px] shrink-0">
              <img draggable={false}
                src="/icons/recently-added.svg"
                alt=""
                width={20}
                height={20}
                className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                  isRecentlyAddedFilter
                    ? 'opacity-0'
                    : 'opacity-100 group-hover/recent:opacity-0'
                }`}
                decoding="async"
                aria-hidden
              />
              <img draggable={false}
                src="/icons/recently-added-hover.svg"
                alt=""
                width={20}
                height={20}
                className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                  isRecentlyAddedFilter
                    ? 'opacity-100'
                    : 'opacity-0 group-hover/recent:opacity-100'
                }`}
                decoding="async"
                aria-hidden
              />
            </span>
            Recently Added
          </button>
        </div>

        {/**
         * 等待 Apply / Cancel 或 Info Mode 时遮住整个 sidebar：阻断 hover/click，显示禁止光标和原生 tooltip。
         * 不影响左上角 `Toggle Sidebar`（在 aside 之外、`z-[200]`），用户仍可折叠以更好预览海报。
         */}
        {isPosterPreviewChromeLocked ? (
          <div
            className="absolute inset-0 z-30 cursor-not-allowed"
            title={
              isAwaitingPosterApplyConfirm
                ? 'Use Apply or Cancel below to finish poster upload'
                : 'Press ESC to exit info'
            }
            aria-hidden
            onPointerDownCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClickCapture={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        ) : null}
      </aside>

      {/* Main Content：顶栏与主列表分区滚动，海报预览 overlay 仅盖住列表区 */}
      <main className="flex flex-1 min-h-0 min-w-0 flex-col overflow-hidden h-full">
        {/* Unified Header & Toolbar */}
        <div
          className="relative z-[60] flex-shrink-0 bg-[#121212]/70 backdrop-blur-xl"
          onPointerDownCapture={
            isPosterPreviewOpen ? undefined : onShellPointerDownCloseScopedOverlays
          }
        >
          {/**
           * 标题行固定 `h-10`：预览与普通模式总高度一致，避免工具栏整体下移 8px；
           * 两种 `h1` 用同一套 class 并 `m-0` 抵消浏览器默认 heading margin，
           * 让 FilmBase 与预览片名垂直 / 排版完全一致，无 Y 轴偏移。
           */}
          <header className="relative flex h-10 shrink-0 items-center justify-center overflow-hidden px-8 text-center">
            {isPosterPreviewOpen && posterPreviewMovie ? (
              <h1 className="m-0 max-w-full truncate text-[13px] font-bold leading-5 tracking-tight text-white/40">
                {posterPreviewMovie.title}
              </h1>
            ) : (
              <h1 className="m-0 max-w-full truncate text-[13px] font-bold leading-5 tracking-tight text-white/40">
                FilmBase
              </h1>
            )}
          </header>

          {/* Toolbar：海报预览打开时切换为预览模式控件；左右槽固定宽度使 slider 水平位置不变 */}
          <div className="relative flex h-12 shrink-0 items-center justify-between border-b border-[#292929] px-8 [box-shadow:0px_0px_0px_0px_rgba(41,41,41,1)]">
          <div className="relative z-10 flex shrink-0 items-center gap-8">
            {isPosterPreviewOpen ? (
              <>
                <div className="flex h-9 min-w-[5.5rem] shrink-0 items-center justify-start gap-2">
                  <button
                    type="button"
                    disabled={isPosterPreviewChromeLocked}
                    onClick={() => closePosterPreview()}
                    className="group/backprev relative p-1.5 rounded-md text-white/80 transition-colors hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/80"
                    title={
                      isPosterPreviewChromeLocked
                        ? isAwaitingPosterApplyConfirm
                          ? 'Use Apply or Cancel below'
                          : 'Press ESC to exit info'
                        : 'Back'
                    }
                    aria-label="Close poster preview"
                  >
                    <span className="relative block h-[18px] w-[18px] shrink-0">
                      <img draggable={false}
                        src="/icons/back.svg"
                        alt=""
                        width={18}
                        height={18}
                        className="pointer-events-none absolute left-0 top-0 h-[18px] w-[18px] opacity-100 transition-opacity group-hover/backprev:opacity-0"
                        decoding="async"
                        aria-hidden
                      />
                      <img draggable={false}
                        src="/icons/back-hover.svg"
                        alt=""
                        width={18}
                        height={18}
                        className="pointer-events-none absolute left-0 top-0 h-[18px] w-[18px] opacity-0 transition-opacity group-hover/backprev:opacity-100"
                        decoding="async"
                        aria-hidden
                      />
                    </span>
                  </button>
                </div>
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewSliderPercent((p) =>
                        Math.max(
                          previewSliderMinPercent,
                          Math.min(previewSliderMaxPercent, p - 5),
                        ),
                      );
                      setPreviewPan({ x: 0, y: 0 });
                    }}
                    disabled={
                      previewSliderPercent <= previewSliderMinPercent ||
                      isPosterPreviewZoomControlsDisabled
                    }
                    className="group/prevfit relative flex h-8 w-8 shrink-0 items-center justify-center text-white/40 hover:text-white disabled:cursor-not-allowed disabled:text-white/10 transition-colors"
                    title="Toward fit / fill"
                  >
                    {previewSliderPercent <= previewSliderMinPercent ||
                    isPosterPreviewZoomControlsDisabled ? (
                      <img draggable={false}
                        src="/icons/poster-preview-fit-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none h-[20px] w-[20px] shrink-0 opacity-100"
                        decoding="async"
                        aria-hidden
                      />
                    ) : (
                      <span className="relative block h-[20px] w-[20px] shrink-0">
                        <img draggable={false}
                          src="/icons/poster-preview-fit.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/prevfit:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/poster-preview-fit-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/prevfit:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </span>
                    )}
                  </button>
                  <div className="group relative flex h-8 w-32 shrink-0 items-center">
                    {previewSliderHoverLabel && !isInfoMode ? (
                      <span
                        className="pointer-events-none absolute bottom-full z-10 mb-1 whitespace-nowrap rounded-md border border-white/10 bg-zinc-900/95 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white/90 opacity-0 shadow-md transition-opacity duration-150 group-hover:opacity-100"
                        style={{
                          left: `${previewZoomSliderNorm * 100}%`,
                          transform: 'translateX(-50%)',
                        }}
                      >
                        {previewSliderHoverLabel}
                      </span>
                    ) : null}
                    <div
                      className="relative h-8 w-full"
                      onPointerDownCapture={(e) => {
                        if (isPosterPreviewZoomControlsDisabled) return;
                        if (e.button !== 0) return;
                        setIsPreviewZoomSliderPressed(true);
                      }}
                    >
                      <div
                        className={`pointer-events-none absolute left-0 top-1/2 w-full -translate-y-1/2 bg-white/15 transition-opacity ${
                          isPosterPreviewZoomControlsDisabled ? 'opacity-15' : 'opacity-100'
                        }`}
                        style={{
                          height: POSTER_SIZE_SLIDER_TRACK_H_PX,
                          borderRadius: POSTER_SIZE_SLIDER_TRACK_H_PX / 2,
                        }}
                        aria-hidden
                      />
                      <div
                        className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 bg-white/40 transition-opacity ${
                          isPosterPreviewZoomControlsDisabled ? 'opacity-15' : 'opacity-100'
                        }`}
                        style={{
                          width: `calc(${POSTER_SIZE_SLIDER_TRACK_H_PX / 2}px + (100% - ${POSTER_SIZE_SLIDER_TRACK_H_PX}px) * ${previewZoomSliderNorm})`,
                          height: POSTER_SIZE_SLIDER_TRACK_H_PX,
                          borderRadius: POSTER_SIZE_SLIDER_TRACK_H_PX / 2,
                        }}
                        aria-hidden
                      />
                      <img draggable={false}
                        src={
                          isPosterPreviewZoomControlsDisabled
                            ? '/icons/poster-size-slider-thumb-disabled.svg'
                            : isPreviewZoomSliderPressed
                              ? '/icons/poster-size-slider-thumb-pressed.svg'
                              : '/icons/poster-size-slider-thumb.svg'
                        }
                        alt=""
                        width={POSTER_SIZE_SLIDER_THUMB_PX}
                        height={POSTER_SIZE_SLIDER_THUMB_PX}
                        className="pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 select-none"
                        style={{
                          left: `calc(${POSTER_SIZE_SLIDER_TRACK_H_PX / 2}px + (100% - ${POSTER_SIZE_SLIDER_TRACK_H_PX}px) * ${previewZoomSliderNorm})`,
                        }}
                        decoding="async"
                        aria-hidden
                      />
                      <input
                        type="range"
                        min={previewSliderMinPercent}
                        max={100}
                        step="0.1"
                        value={previewSliderPercent}
                        disabled={isPosterPreviewZoomControlsDisabled}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          const snapped =
                            previewSliderMaxPercent - v <= PREVIEW_ZOOM_SLIDER_SNAP_TO_MAX
                              ? previewSliderMaxPercent
                              : v;
                          setPreviewSliderPercent(
                            Math.min(
                              previewSliderMaxPercent,
                              Math.max(previewSliderMinPercent, snapped),
                            ),
                          );
                          setPreviewPan({ x: 0, y: 0 });
                        }}
                        className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0 focus:outline-none disabled:cursor-not-allowed"
                        aria-label="Poster preview: fit versus 100 percent scale"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setPreviewSliderPercent((p) =>
                        Math.min(
                          previewSliderMaxPercent,
                          Math.max(previewSliderMinPercent, p + 5),
                        ),
                      );
                      setPreviewPan({ x: 0, y: 0 });
                    }}
                    disabled={
                      previewSliderPercent >= previewSliderMaxPercent ||
                      isPosterPreviewZoomControlsDisabled
                    }
                    className="group/prev100 relative flex h-8 w-8 shrink-0 items-center justify-center text-white/40 hover:text-white disabled:cursor-not-allowed disabled:text-white/10 transition-colors"
                    title="Toward 100%"
                  >
                    {previewSliderPercent >= previewSliderMaxPercent ||
                    isPosterPreviewZoomControlsDisabled ? (
                      <img draggable={false}
                        src="/icons/poster-preview-100-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none h-[20px] w-[20px] shrink-0 opacity-100"
                        decoding="async"
                        aria-hidden
                      />
                    ) : (
                      <span className="relative block h-[20px] w-[20px] shrink-0">
                        <img draggable={false}
                          src="/icons/poster-preview-100.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/prev100:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/poster-preview-100-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/prev100:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </span>
                    )}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="flex h-9 min-w-[5.5rem] shrink-0 items-center justify-start gap-2">
                  <button
                    type="button"
                    onClick={() => setViewMode('grid')}
                    title={mainLibraryToolbarLockReason ?? 'Grid view'}
                    aria-label="Grid view"
                    aria-pressed={viewMode === 'grid'}
                    disabled={isLibraryToolbarLocked}
                    className={`group/viewgrid relative p-1.5 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-100 ${
                      isLibraryToolbarLocked
                        ? 'text-white/25'
                        : viewMode === 'grid'
                          ? 'bg-white/10 text-white'
                          : 'text-white/40 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="relative block h-5 w-5 shrink-0">
                      {isLibraryToolbarLocked ? (
                        <img draggable={false}
                          src="/icons/view-grid-hover-disabled.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none h-5 w-5 shrink-0"
                          decoding="async"
                          aria-hidden
                        />
                      ) : (
                        <>
                          <img draggable={false}
                            src="/icons/view-grid.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-5 w-5 transition-opacity ${
                              viewMode === 'grid'
                                ? 'opacity-0'
                                : 'opacity-100 group-hover/viewgrid:opacity-0'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/view-grid-hover.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-5 w-5 transition-opacity ${
                              viewMode === 'grid'
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/viewgrid:opacity-100'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                        </>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode('list')}
                    title={mainLibraryToolbarLockReason ?? 'List view'}
                    aria-label="List view"
                    aria-pressed={viewMode === 'list'}
                    disabled={isLibraryToolbarLocked}
                    className={`group/viewlist relative p-1.5 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-100 ${
                      isLibraryToolbarLocked
                        ? 'text-white/25'
                        : viewMode === 'list'
                          ? 'bg-white/10 text-white'
                          : 'text-white/40 hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="relative block h-5 w-5 shrink-0">
                      {isLibraryToolbarLocked ? (
                        <img draggable={false}
                          src="/icons/view-list-hover-disabled.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none h-5 w-5 shrink-0"
                          decoding="async"
                          aria-hidden
                        />
                      ) : (
                        <>
                          <img draggable={false}
                            src="/icons/view-list.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-5 w-5 transition-opacity ${
                              viewMode === 'list'
                                ? 'opacity-0'
                                : 'opacity-100 group-hover/viewlist:opacity-0'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/view-list-hover.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-5 w-5 transition-opacity ${
                              viewMode === 'list'
                                ? 'opacity-100'
                                : 'opacity-0 group-hover/viewlist:opacity-100'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                        </>
                      )}
                    </span>
                  </button>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() =>
                      setPosterSize(Math.max(GRID_POSTER_SIZE_MIN_PX, posterSize - GRID_POSTER_SIZE_STEP_PX))
                    }
                    disabled={
                      viewMode === 'list' ||
                      posterSize <= GRID_POSTER_SIZE_MIN_PX ||
                      isLibraryToolbarLocked
                    }
                    className="group/postdec relative flex h-8 w-8 shrink-0 items-center justify-center text-white/40 hover:text-white disabled:cursor-not-allowed disabled:text-white/10 transition-colors"
                    title={mainLibraryToolbarLockReason ?? 'Decrease poster size'}
                  >
                    {viewMode === 'list' ||
                    posterSize <= GRID_POSTER_SIZE_MIN_PX ||
                    isLibraryToolbarLocked ? (
                      <img draggable={false}
                        src="/icons/poster-size-decrease-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none h-[20px] w-[20px] shrink-0"
                        decoding="async"
                        aria-hidden
                      />
                    ) : (
                      <span className="relative block h-[20px] w-[20px] shrink-0">
                        <img draggable={false}
                          src="/icons/poster-size-decrease.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/postdec:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/poster-size-decrease-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/postdec:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </span>
                    )}
                  </button>
                  <div
                    className="relative h-8 w-32 shrink-0"
                    onPointerDownCapture={(e) => {
                      if (viewMode === 'list' || isLibraryToolbarLocked) return;
                      if (e.button !== 0) return;
                      setIsPosterSizeSliderPressed(true);
                    }}
                  >
                    <div
                      className={`pointer-events-none absolute left-0 top-1/2 w-full -translate-y-1/2 bg-white/15 transition-opacity ${
                        viewMode === 'list' || isLibraryToolbarLocked ? 'opacity-15' : 'opacity-100'
                      }`}
                      style={{
                        height: POSTER_SIZE_SLIDER_TRACK_H_PX,
                        borderRadius: POSTER_SIZE_SLIDER_TRACK_H_PX / 2,
                      }}
                      aria-hidden
                    />
                    <div
                      className={`pointer-events-none absolute left-0 top-1/2 -translate-y-1/2 bg-white/40 transition-opacity ${
                        viewMode === 'list' || isLibraryToolbarLocked ? 'opacity-15' : 'opacity-100'
                      }`}
                      style={{
                        width: `calc(${POSTER_SIZE_SLIDER_TRACK_H_PX / 2}px + (100% - ${POSTER_SIZE_SLIDER_TRACK_H_PX}px) * ${Math.max(
                          0,
                          Math.min(
                            1,
                            (clampPosterSizePx(posterSize) - GRID_POSTER_SIZE_MIN_PX) /
                              (GRID_POSTER_SIZE_MAX_PX - GRID_POSTER_SIZE_MIN_PX),
                          ),
                        )})`,
                        height: POSTER_SIZE_SLIDER_TRACK_H_PX,
                        borderRadius: POSTER_SIZE_SLIDER_TRACK_H_PX / 2,
                      }}
                      aria-hidden
                    />
                    <img draggable={false}
                      src={
                        viewMode === 'list' || isLibraryToolbarLocked
                          ? '/icons/poster-size-slider-thumb-disabled.svg'
                          : isPosterSizeSliderPressed
                            ? '/icons/poster-size-slider-thumb-pressed.svg'
                            : '/icons/poster-size-slider-thumb.svg'
                      }
                      alt=""
                      width={POSTER_SIZE_SLIDER_THUMB_PX}
                      height={POSTER_SIZE_SLIDER_THUMB_PX}
                      className="pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 select-none"
                      style={{
                        left: `calc(${POSTER_SIZE_SLIDER_TRACK_H_PX / 2}px + (100% - ${POSTER_SIZE_SLIDER_TRACK_H_PX}px) * ${Math.max(
                          0,
                          Math.min(
                            1,
                            (clampPosterSizePx(posterSize) - GRID_POSTER_SIZE_MIN_PX) /
                              (GRID_POSTER_SIZE_MAX_PX - GRID_POSTER_SIZE_MIN_PX),
                          ),
                        )})`,
                      }}
                      decoding="async"
                      aria-hidden
                    />
                    <input
                      type="range"
                      min={GRID_POSTER_SIZE_MIN_PX}
                      max={GRID_POSTER_SIZE_MAX_PX}
                      step={GRID_POSTER_SIZE_STEP_PX}
                      value={posterSize}
                      disabled={viewMode === 'list' || isLibraryToolbarLocked}
                      onChange={(e) => setPosterSize(clampPosterSizePx(Number(e.target.value)))}
                      className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none opacity-0 focus:outline-none disabled:cursor-not-allowed"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setPosterSize(Math.min(GRID_POSTER_SIZE_MAX_PX, posterSize + GRID_POSTER_SIZE_STEP_PX))
                    }
                    disabled={
                      viewMode === 'list' ||
                      posterSize >= GRID_POSTER_SIZE_MAX_PX ||
                      isLibraryToolbarLocked
                    }
                    className="group/postinc relative flex h-8 w-8 shrink-0 items-center justify-center text-white/40 hover:text-white disabled:cursor-not-allowed disabled:text-white/10 transition-colors"
                    title={mainLibraryToolbarLockReason ?? 'Increase poster size'}
                  >
                    {viewMode === 'list' ||
                    posterSize >= GRID_POSTER_SIZE_MAX_PX ||
                    isLibraryToolbarLocked ? (
                      <img draggable={false}
                        src="/icons/poster-size-increase-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none h-5 w-5 shrink-0"
                        decoding="async"
                        aria-hidden
                      />
                    ) : (
                      <span className="relative block h-5 w-5 shrink-0">
                        <img draggable={false}
                          src="/icons/poster-size-increase.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-5 w-5 opacity-100 transition-opacity group-hover/postinc:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/poster-size-increase-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-5 w-5 opacity-0 transition-opacity group-hover/postinc:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </span>
                    )}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="relative z-10 flex min-w-[5.5rem] shrink-0 items-center justify-end gap-2">
              {isPosterPreviewOpen && posterPreviewMovie ? (() => {
                /**
                 * 仅当底部 action bar 真的可见时，按钮才作为「Close upload panel」toggle；
                 * 否则永远走「打开系统选图对话框」分支，避免 `isScopedPosterUploadOpen` 残留
                 * 状态导致用户需要点 2 次（取消系统对话框 / 取消选图后再尝试上传的场景）。
                 */
                const hasVisibleUploadPanel =
                  isScopedPosterUploadOpen &&
                  (Boolean(pendingPosterUrl) || Boolean(posterUploadError) || isPosterApplying);
                return (
                <>
                <button
                  type="button"
                  disabled={isAwaitingPosterApplyConfirm}
                  onClick={() => setIsInfoMode((v) => !v)}
                  title={isInfoMode ? 'Exit info mode' : 'Movie info'}
                  aria-label={isInfoMode ? 'Exit info mode' : 'Movie info'}
                  aria-pressed={isInfoMode}
                  className={`group/infoprev relative p-1.5 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-100 ${
                    isAwaitingPosterApplyConfirm
                      ? 'text-white/25'
                      : isInfoMode
                        ? 'bg-[#EA9794] text-black hover:bg-[#E08A87]'
                        : 'text-white/40 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="relative block h-[20px] w-[20px] shrink-0">
                    {isAwaitingPosterApplyConfirm ? (
                      <img draggable={false}
                        src="/icons/info-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none h-[20px] w-[20px] shrink-0"
                        decoding="async"
                        aria-hidden
                      />
                    ) : isInfoMode ? (
                      <>
                        <img draggable={false}
                          src="/icons/info-active.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/infoprev:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/info-active-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/infoprev:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </>
                    ) : (
                      <>
                        <img draggable={false}
                          src="/icons/info.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/infoprev:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/info-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/infoprev:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </>
                    )}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={isPosterPreviewChromeLocked}
                  /**
                   * 父级 toolbar 在 capture 阶段挂了 `onShellPointerDownCloseScopedOverlays`，
                   * 会在 trailer / blur 抖动场景下重渲该按钮所在子树，导致首次 click 丢失。
                   * 在按钮 capture 阶段提前 stopPropagation，确保第一次点击就能触发 onClick。
                   */
                  onPointerDownCapture={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!posterPreviewMovie) return;
                    if (hasVisibleUploadPanel) {
                      closeScopedPosterUpload();
                    } else {
                      setPosterUploadError('');
                      setPendingPosterUrl(null);
                      setIsScopedPosterUploadOpen(true);
                      posterFileInputRef.current?.click();
                    }
                  }}
                  className="group/uploadprev relative flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[13px] font-medium text-white/40 transition-colors hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:text-white/15 disabled:hover:bg-transparent disabled:hover:text-white/15"
                  title={
                    isAwaitingPosterApplyConfirm
                      ? 'Use Apply or Cancel below'
                      : isInfoMode
                        ? 'Press ESC to exit info'
                        : hasVisibleUploadPanel
                          ? 'Close upload panel'
                          : 'Upload Poster'
                  }
                >
                  {/* 禁用态：`upload-poster-disabled.svg` 已含 fill-opacity；按钮不再叠加 disabled:opacity-* */}
                  <span className="relative block h-[20px] w-[20px] shrink-0">
                    {isPosterPreviewChromeLocked ? (
                      <img draggable={false}
                        src="/icons/upload-poster-disabled.svg"
                        alt=""
                        width={20}
                        height={20}
                        className="pointer-events-none block h-[20px] w-[20px]"
                        decoding="async"
                        aria-hidden
                      />
                    ) : (
                      <>
                        <img draggable={false}
                          src="/icons/upload-poster.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity duration-150 ease-out group-hover/uploadprev:opacity-0"
                          decoding="async"
                          aria-hidden
                        />
                        <img draggable={false}
                          src="/icons/upload-poster-hover.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity duration-150 ease-out group-hover/uploadprev:opacity-100"
                          decoding="async"
                          aria-hidden
                        />
                      </>
                    )}
                  </span>
                  Upload Poster
                </button>
                </>
                );
              })() : (
                <>
                  <button
                    type="button"
                    onClick={() => setIsEditing(!isEditing)}
                    disabled={isLibraryToolbarLocked}
                    className={`group/editlib relative p-1.5 rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-100 ${
                      isLibraryToolbarLocked
                        ? 'text-white/25'
                        : isEditing
                          ? 'bg-[#EA9794] text-black hover:bg-[#E08A87]'
                          : 'text-white/40 hover:text-white hover:bg-white/5'
                    }`}
                    title={mainLibraryToolbarLockReason ?? 'Edit Library'}
                  >
                    <span className="relative block h-[20px] w-[20px] shrink-0">
                      {isLibraryToolbarLocked ? (
                        <img draggable={false}
                          src="/icons/edit-library-disabled.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none h-[20px] w-[20px] shrink-0"
                          decoding="async"
                          aria-hidden
                        />
                      ) : (
                        <>
                          <img draggable={false}
                            src="/icons/edit-library.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                              isEditing ? 'opacity-0' : 'opacity-100 group-hover/editlib:opacity-0'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/edit-library-hover.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                              isEditing ? 'opacity-0' : 'opacity-0 group-hover/editlib:opacity-100'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/edit-library-active.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                              isEditing ? 'opacity-100 group-hover/editlib:opacity-0' : 'opacity-0'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/edit-library-active-hover.svg"
                            alt=""
                            width={20}
                            height={20}
                            className={`pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] transition-opacity ${
                              isEditing ? 'opacity-0 group-hover/editlib:opacity-100' : 'opacity-0'
                            }`}
                            decoding="async"
                            aria-hidden
                          />
                        </>
                      )}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAddModalOpen(true)}
                    disabled={isAddMovieToolbarDisabled}
                    className="group/addmov relative p-1.5 rounded-md text-white/40 transition-colors enabled:hover:bg-white/5 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-100"
                    title={
                      isLibraryToolbarLocked
                        ? (mainLibraryToolbarLockReason ?? 'Add Movie')
                        : isEditing
                          ? 'Finish editing library first'
                          : 'Add Movie'
                    }
                  >
                    <span className="relative block h-[20px] w-[20px] shrink-0">
                      {isAddMovieToolbarDisabled ? (
                        <img draggable={false}
                          src="/icons/add-movie-disabled.svg"
                          alt=""
                          width={20}
                          height={20}
                          className="pointer-events-none h-[20px] w-[20px] shrink-0"
                          decoding="async"
                          aria-hidden
                        />
                      ) : (
                        <>
                          <img draggable={false}
                            src="/icons/add-movie.svg"
                            alt=""
                            width={20}
                            height={20}
                            className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-100 transition-opacity group-hover/addmov:opacity-0"
                            decoding="async"
                            aria-hidden
                          />
                          <img draggable={false}
                            src="/icons/add-movie-hover.svg"
                            alt=""
                            width={20}
                            height={20}
                            className="pointer-events-none absolute left-0 top-0 h-[20px] w-[20px] opacity-0 transition-opacity group-hover/addmov:opacity-100"
                            decoding="async"
                            aria-hidden
                          />
                        </>
                      )}
                    </span>
                  </button>
                </>
              )}
          </div>

          {isPosterPreviewOpen &&
          previewNaturalSize &&
          previewNaturalSize.w > 0 &&
          previewNaturalSize.h > 0 &&
          posterPreviewMovie ? (
            <p className="pointer-events-none absolute left-1/2 top-1/2 z-0 max-w-[min(90%,36rem)] -translate-x-1/2 -translate-y-1/2 truncate text-center text-[13px] font-medium leading-5 text-white tabular-nums">
              {isScopedPosterUploadOpen && isPosterApplying ? (
                <span className="inline-block w-[11ch] text-left tabular-nums leading-5">
                  {`Applying${'.'.repeat(applyingDots)}`}
                </span>
              ) : isScopedPosterUploadOpen && pendingPosterUrl ? (
                <span className="tabular-nums leading-5">Ready</span>
              ) : isInfoMode ? (
                <span className="leading-5">Press ESC to exit info</span>
              ) : (
                <>
                  {previewNaturalSize.w} × {previewNaturalSize.h},{' '}
                  {inferPosterImageFormatLabel(posterPreviewMovie.posterUrl)}
                  {posterPreviewZoomHintSuffix}
                </>
              )}
            </p>
          ) : null}
        </div>
        </div>

        <div
          ref={mainPreviewHostRef}
          className="relative flex-1 min-h-0 overflow-hidden"
        >
          <div
            ref={mainLibraryScrollRef}
            className={`h-full min-h-0 overflow-x-hidden [scrollbar-gutter:stable] ${isMainContentOverlayActive ? 'overflow-hidden' : 'overflow-y-auto'}`}
          >
        {/* Content area — vertical padding off while poster preview / 预告片 overlay 打开 */}
        <div
          className={
            isMainContentOverlayActive
              ? `${viewMode === 'list' ? 'px-0 py-0' : 'px-8 py-0'}`
              : !isMoviesHydrated
                ? `flex min-h-full flex-col pb-8 ${viewMode === 'list' ? 'pt-0 px-0' : 'pt-4 px-8'}`
                : `pb-8 ${viewMode === 'list' ? 'pt-0 px-0' : 'pt-4 px-8'}`
          }
        >
          {!isMoviesHydrated ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center text-white/35">
              <div className="flex flex-col items-center gap-3">
                <div className="relative h-8 w-8 shrink-0" aria-hidden>
                  <img draggable={false}
                    src={LIBRARY_LOADING_FILM_BASE_SRC}
                    alt=""
                    width={32}
                    height={32}
                    className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                    decoding="async"
                  />
                  <img draggable={false}
                    src={LIBRARY_LOADING_REEL_SRC}
                    alt=""
                    width={32}
                    height={32}
                    className="absolute inset-0 h-full w-full object-contain pointer-events-none animate-spin"
                    decoding="async"
                  />
                </div>
                <LibraryLoadingStagedCopy />
              </div>
              <div className="mt-[80px] w-full flex flex-col items-center">
                <LibraryLoadingShowcase />
              </div>
            </div>
          ) : (
            <>
          {viewMode === 'list' && filteredMovies.length > 0 && (
            <div
              className={`z-[70] bg-[#121212]/70 backdrop-blur-xl py-4 border-b border-[#292929] ${
                isMainContentOverlayActive ? 'static' : 'sticky top-0'
              }`}
            >
              <div className={`grid ${isEditing ? 'grid-cols-[60px_132px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]' : 'grid-cols-[132px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]'} gap-x-8 px-0 text-[12px] leading-5 font-bold uppercase tracking-widest text-white/40 items-center`}>
                {isEditing && <div className="flex min-h-5 w-[60px] shrink-0 items-center justify-center pl-8 leading-5" aria-hidden />}
                <div className="flex min-h-5 min-w-0 shrink-0 items-center justify-center overflow-visible pl-8 leading-5">
                  <span className="block w-[100px] max-w-full text-center">Poster</span>
                </div>
                <div className="relative pl-10">
                  <button 
                    onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                    className={`flex min-h-5 items-center gap-1.5 leading-5 hover:text-white transition-colors group ${sortMode.startsWith('duration') || selectedGenres.length > 0 ? 'text-white' : ''}`}
                  >
                    <span>
                      {sortMode.startsWith('title') ? 'TITLE' : sortMode.startsWith('duration') ? 'TITLE / DUR' : 'TITLE'}
                    </span>
                    <ChevronDown size={10} className={`transition-transform duration-300 ${isSortDropdownOpen ? 'rotate-180' : ''}`} />
                  </button>

                  <AnimatePresence>
                    {isSortDropdownOpen && (
                      <>
                        <div 
                          className="fixed inset-0 z-40" 
                          onClick={() => setIsSortDropdownOpen(false)} 
                        />
                        <motion.div
                          initial={{ opacity: 0, y: 10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: 10, scale: 0.95 }}
                          className="absolute top-full left-0 z-50 mt-3 w-[220px] overflow-hidden rounded-2xl border border-white/10 bg-[#1F1F1F] py-[10px] shadow-2xl"
                        >
                          <div className="px-3.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
                            Title
                          </div>
                          {[
                            { id: 'title-asc', label: 'A-Z' },
                            { id: 'title-desc', label: 'Z-A' },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setSortMode(opt.id as any);
                                setIsSortDropdownOpen(false);
                              }}
                              className={`flex h-9 min-h-[34px] w-full items-center justify-between px-3.5 text-left text-[13px] font-medium transition-colors hover:bg-white/[0.06] ${
                                sortMode === opt.id
                                  ? 'text-white hover:text-white'
                                  : 'text-white/65 hover:text-white/90'
                              }`}
                            >
                              {opt.label}
                              {sortMode === opt.id ? (
                                <Check size={12} className="shrink-0 text-white opacity-90" aria-hidden />
                              ) : null}
                            </button>
                          ))}

                          <div className="my-1.5 border-t border-white/[0.08]" role="presentation" />
                          <div className="px-3.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
                            Duration
                          </div>
                          {[
                            { id: 'duration-desc', label: 'Longest' },
                            { id: 'duration-asc', label: 'Shortest' },
                          ].map((opt) => (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => {
                                setSortMode(opt.id as any);
                                setIsSortDropdownOpen(false);
                              }}
                              className={`flex h-9 min-h-[34px] w-full items-center justify-between px-3.5 text-left text-[13px] font-medium transition-colors hover:bg-white/[0.06] ${
                                sortMode === opt.id
                                  ? 'text-white hover:text-white'
                                  : 'text-white/65 hover:text-white/90'
                              }`}
                            >
                              {opt.label}
                              {sortMode === opt.id ? (
                                <Check size={12} className="shrink-0 text-white opacity-90" aria-hidden />
                              ) : null}
                            </button>
                          ))}

                          <div className="my-1.5 border-t border-white/[0.08]" role="presentation" />
                          <div className="px-3.5 pb-1.5 pt-2 text-[11px] font-medium uppercase tracking-[0.12em] text-white/35">
                            Genre filter
                          </div>
                          {allUniqueGenres.map((genre) => (
                            <button
                              key={genre}
                              type="button"
                              onClick={() => {
                                setSelectedGenres([genre]);
                                setIsSortDropdownOpen(false);
                              }}
                              className={`flex h-9 min-h-[34px] w-full items-center justify-between px-3.5 text-left text-[13px] font-medium transition-colors hover:bg-white/[0.06] ${
                                selectedGenres.length === 1 && selectedGenres[0] === genre
                                  ? 'text-white hover:text-white'
                                  : 'text-white/65 hover:text-white/90'
                              }`}
                            >
                              {genre}
                              {selectedGenres.length === 1 && selectedGenres[0] === genre ? (
                                <Check size={12} className="shrink-0 text-white opacity-90" aria-hidden />
                              ) : null}
                            </button>
                          ))}
                          {selectedGenres.length > 0 && (
                            <>
                              <div className="my-1.5 border-t border-white/[0.08]" role="presentation" />
                              <button
                                type="button"
                                onClick={() => {
                                  setSelectedGenres([]);
                                  setIsSortDropdownOpen(false);
                                }}
                                className="flex h-9 min-h-[34px] w-full items-center justify-between px-3.5 text-left text-[13px] font-medium text-red-400/70 transition-colors hover:bg-white/[0.06] hover:text-red-400"
                              >
                                Clear genre filter
                              </button>
                            </>
                          )}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
                <span className="flex min-h-5 items-center justify-center text-center leading-5">Trailer</span>
                <span className="flex min-h-5 items-center justify-center text-center leading-5">Director</span>
                <span className="flex min-h-5 items-center justify-center text-center leading-5">Starring</span>
                <button 
                  type="button"
                  onClick={() => setSortMode(sortMode === 'imdb-desc' ? 'imdb-asc' : 'imdb-desc')}
                  className="group relative flex min-h-5 items-center justify-center leading-5"
                  aria-label="Sort by IMDb rating"
                >
                  {/** 与列表行 hover 同：18px 高、60×32 等比宽 */}
                  <span className="relative inline-block h-[18px] w-[calc(18px*60/32)] shrink-0">
                    <img draggable={false}
                      src={sortMode.startsWith('imdb') ? LIST_HEADER_RATINGS_ICON.imdbNormal : LIST_HEADER_RATINGS_ICON.imdbInactive}
                      alt=""
                      width={60}
                      height={32}
                      decoding="async"
                      className="pointer-events-none absolute left-1/2 top-1/2 h-[18px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain group-hover:hidden"
                    />
                    <img draggable={false}
                      src={LIST_HEADER_RATINGS_ICON.imdbHover}
                      alt=""
                      width={60}
                      height={32}
                      decoding="async"
                      className="pointer-events-none absolute left-1/2 top-1/2 hidden h-[18px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain group-hover:block"
                    />
                  </span>
                </button>
                <button 
                  type="button"
                  onClick={() => setSortMode(sortMode === 'rt-desc' ? 'rt-asc' : 'rt-desc')}
                  className="group relative flex min-h-5 items-center justify-center leading-5"
                  aria-label="Sort by Rotten Tomatoes"
                >
                  <span className="relative inline-block h-[18px] w-[18px] shrink-0">
                    <img draggable={false}
                      src={sortMode.startsWith('rt') ? LIST_HEADER_RATINGS_ICON.rtNormal : LIST_HEADER_RATINGS_ICON.rtInactive}
                      alt=""
                      width={32}
                      height={32}
                      decoding="async"
                      className="pointer-events-none absolute inset-0 m-auto h-[18px] w-[18px] object-contain group-hover:hidden"
                    />
                    <img draggable={false}
                      src={LIST_HEADER_RATINGS_ICON.rtHover}
                      alt=""
                      width={32}
                      height={32}
                      decoding="async"
                      className="pointer-events-none absolute inset-0 m-auto hidden h-[18px] w-[18px] object-contain group-hover:block"
                    />
                  </span>
                </button>
                <button 
                  onClick={() => setSortMode(sortMode === 'personal-desc' ? 'personal-asc' : 'personal-desc')}
                  className={`flex min-h-5 items-center gap-1.5 justify-center pr-8 leading-5 hover:text-white transition-colors ${sortMode.startsWith('personal') ? 'text-white' : ''}`}
                >
                  <span className="text-[12px] font-bold uppercase tracking-widest whitespace-nowrap leading-5">MY RATING</span>
                  <ChevronDown size={10} className={`transition-transform ${sortMode === 'personal-asc' ? 'rotate-180' : ''} ${sortMode.startsWith('personal') ? 'opacity-100' : 'opacity-0'}`} />
                </button>
              </div>
            </div>
          )}
          <AnimatePresence mode="sync">
            <motion.div 
              className={viewMode === 'grid' ? 'grid gap-x-6 gap-y-10 pt-12' : 'flex flex-col gap-0'}
              style={viewMode === 'grid' ? { 
                gridTemplateColumns: `repeat(auto-fill, minmax(${posterSize}px, 1fr))` 
              } : {}}
            >
              {filteredMovies.map((movie, posterListIndex) => (
                <MovieCard 
                  key={movie.id} 
                  movie={movie} 
                  posterListIndex={posterListIndex}
                  size={posterSize} 
                  viewMode={viewMode} 
                  isEditing={isEditing}
                  registerLibraryItemEl={(el) => registerMovieLibraryItemEl(movie.id, el)}
                  onRequestDelete={() => setDeleteMovieConfirm(movie)}
                  onRatingChange={(rating) => handleRatingChange(movie.id, rating)}
                  onPlayTrailer={() => {
                    setSelectedMovie(movie);
                    setModalMode('trailer');
                  }}
                  onShowPoster={() => {
                    setSelectedMovie(movie);
                    setModalMode('poster');
                  }}
                  onOpenPosterPreview={(el) => openPosterPreviewFromElement(movie, el)}
                  onRefreshPosterSignedUrl={refreshPosterSignedUrlOnce}
                />
              ))}
            </motion.div>
          </AnimatePresence>
          
          {filteredMovies.length === 0 && (
            <div
              className="flex min-h-[48vh] flex-col items-center justify-center gap-3 text-white/35"
              role="status"
              aria-live="polite"
            >
              <div className="relative h-8 w-8 shrink-0" aria-hidden>
                <img
                  draggable={false}
                  src="/icons/no-films.svg"
                  alt=""
                  width={32}
                  height={32}
                  className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                  decoding="async"
                />
              </div>
              <p className="text-sm font-medium tracking-wide">
                No films found matching your search
              </p>
            </div>
          )}
            </>
          )}
        </div>
          </div>

      {/* 预告片：仅覆盖主内容区（与海报预览同宿主），侧栏/顶栏可点且先关预告片 */}
      <AnimatePresence>
        {selectedMovie && modalMode === 'trailer' && (
          <motion.div
            key={`trailer-overlay-${selectedMovie.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MAIN_MODAL_OVERLAY_TRANSITION}
            className="absolute inset-0 z-[104] flex h-full min-h-0 items-center justify-center overflow-hidden p-4 md:p-8"
          >
            {/** 预告片叠层：纯视觉压暗与模糊，不命中指针。 */}
            <div
              className="pointer-events-none absolute inset-0 z-0 bg-black/35 backdrop-blur-md"
              aria-hidden
            />
            {/** 预告片叠层：空白处点按关闭，并阻断穿透滚动。 */}
            <div
              className="absolute inset-0 z-[1] cursor-pointer"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                setSelectedMovie(null);
              }}
              onWheel={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchMove={(e) => e.preventDefault()}
            />
            <div className="pointer-events-none relative z-[2] flex w-full max-w-5xl flex-col items-center gap-4">
              <motion.div
                key={`trailer-panel-${selectedMovie.id}`}
                initial={{ scale: 0.9, opacity: 0, y: 20 }}
                animate={{ scale: 1, opacity: 1, y: 0 }}
                exit={{ scale: 0.9, opacity: 0, y: 20 }}
                transition={MAIN_MODAL_PANEL_TRANSITION}
                onClick={(e) => e.stopPropagation()}
                className="pointer-events-auto relative aspect-video w-full cursor-default overflow-hidden bg-black shadow-[0_0_100px_rgba(255,255,255,0.1)]"
              >
                {(() => {
                  const embedUrl = getYouTubeEmbedUrl(selectedMovie.trailerUrl);
                  const isEmbeddable = embedUrl.includes('/embed/');
                  if (isEmbeddable) {
                    return (
                      <iframe
                        ref={trailerIframeRef}
                        src={getTrailerEmbedSrc(selectedMovie.trailerUrl)}
                        title={`${selectedMovie.title} Trailer`}
                        className="h-full w-full border-none"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    );
                  }
                  return (
                    <div className="flex h-full w-full flex-col items-center justify-center bg-zinc-900 p-8 text-center">
                      <Film size={48} className="mb-4 text-white/20" />
                      <h3 className="mb-2 text-xl font-bold">Trailer Not Found</h3>
                      <p className="mb-6 text-white/60">{"We couldn't find a direct trailer for this film."}</p>
                      <a
                        href={selectedMovie.trailerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-full bg-white px-8 py-3 font-bold text-black transition-colors hover:bg-white/90"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Search on YouTube
                      </a>
                    </div>
                  );
                })()}
              </motion.div>
              <motion.button
                key={`trailer-edit-url-${selectedMovie.id}`}
                type="button"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 12 }}
                transition={MAIN_MODAL_PANEL_TRANSITION}
                onClick={(e) => {
                  e.stopPropagation();
                  openEditTrailerModal();
                }}
                className="pointer-events-auto group/edittrailer inline-flex h-9 cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-0 text-[12px] font-bold tracking-widest text-white/60 transition-colors hover:bg-white/20 hover:text-white"
                title="Edit Trailer URL"
              >
                <span className="relative block h-4 w-4 shrink-0">
                  <img draggable={false}
                    src="/icons/edit-trailer-url.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="pointer-events-none absolute left-0 top-0 h-4 w-4 select-none transition-opacity duration-150 ease-out opacity-100 group-hover/edittrailer:opacity-0"
                    decoding="async"
                    aria-hidden
                  />
                  <img draggable={false}
                    src="/icons/edit-trailer-url-hover.svg"
                    alt=""
                    width={16}
                    height={16}
                    className="pointer-events-none absolute left-0 top-0 h-4 w-4 select-none transition-opacity duration-150 ease-out opacity-0 group-hover/edittrailer:opacity-100"
                    decoding="async"
                    aria-hidden
                  />
                </span>
                Edit Trailer URL
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 大图海报预览：仅覆盖主内容滚动区（侧栏与顶栏在 overlay 外，可点且先关预览） */}
      <AnimatePresence>
        {isPosterPreviewOpen && posterPreviewMovie && (
          <motion.div
            ref={posterPreviewOverlayRef}
            tabIndex={-1}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-[105] flex h-full min-h-0 items-center justify-center overflow-hidden outline-none focus:outline-none focus-visible:outline-none"
          >
            {/** 海报预览：纯视觉压暗与模糊，不命中指针。 */}
            <div
              className="pointer-events-none absolute inset-0 z-0 bg-black/35 backdrop-blur-md"
              aria-hidden
            />
            {/** 海报预览：空白处点按关闭；滚轮/触摸仅在此层拦截穿透滚动。 */}
            <div
              className="absolute inset-0 z-[1]"
              onClick={(e) => {
                if (e.target !== e.currentTarget) return;
                if (isAwaitingPosterApplyConfirm || isInfoMode) return;
                closePosterPreview();
              }}
              onWheel={(e) => {
                // 预览打开时阻止底层主内容滚动；缩放仅由滑块/快捷键控制。
                e.preventDefault();
                e.stopPropagation();
              }}
              onTouchMove={(e) => e.preventDefault()}
            />
            {!isPosterHeroAnimating && (
            <div className="pointer-events-none relative z-[2] box-border flex h-full min-h-0 w-full max-w-full items-center justify-center px-4 sm:px-6">
              <div
                className="pointer-events-auto relative shrink-0 overflow-hidden"
                style={
                  posterPreviewLayout
                    ? {
                        width: posterPreviewLayout.maxW,
                        height: posterPreviewLayout.maxH,
                      }
                    : previewPosterFrameFallback
                      ? {
                          width: previewPosterFrameFallback.maxW,
                          height: previewPosterFrameFallback.maxH,
                        }
                      : { width: 'min(100%, 560px)', height: 'min(85dvh, 920px)' }
                }
                onWheel={(e) => {
                  if (isInfoMode) return;
                  const L = posterPreviewLayoutRef.current;
                  if (!L?.needsPan) return;
                  e.preventDefault();
                  e.stopPropagation();
                  setPreviewPan((prev) => {
                    const maxX = Math.max(0, (L.dispW - L.maxW) / 2);
                    const maxY = Math.max(0, (L.dispH - L.maxH) / 2);
                    return {
                      x: Math.max(-maxX, Math.min(maxX, prev.x - e.deltaX)),
                      y: Math.max(-maxY, Math.min(maxY, prev.y - e.deltaY)),
                    };
                  });
                }}
              >
                  <img draggable={false}
                    src={
                      isScopedPosterUploadOpen && pendingPosterUrl
                        ? pendingPosterUrl
                        : posterPreviewMovie.posterUrl
                    }
                    alt={posterPreviewMovie.title}
                    referrerPolicy="no-referrer"
                    onPointerEnter={() => {
                      previewPointerOverImgRef.current = true;
                    }}
                    onPointerLeave={() => {
                      previewPointerOverImgRef.current = false;
                    }}
                    className={`max-h-none max-w-none select-none object-contain${isInfoMode ? ' pointer-events-none' : ''}`}
                    style={
                      posterPreviewLayout
                        ? {
                            position: 'absolute',
                            left: '50%',
                            top: '50%',
                            width: posterPreviewLayout.dispW,
                            height: posterPreviewLayout.dispH,
                            maxWidth: 'none',
                            maxHeight: 'none',
                            transform: `translate(calc(-50% + ${previewPan.x}px), calc(-50% + ${previewPan.y}px))`,
                            cursor: isInfoMode
                              ? 'default'
                              : isPreviewDragging && posterPreviewLayout.needsPan
                                ? 'grabbing'
                                : isPreviewZoomOutCursor
                                  ? 'zoom-out'
                                  : 'zoom-in',
                          }
                        : previewPosterFrameFallback
                          ? {
                              position: 'absolute',
                              left: '50%',
                              top: '50%',
                              width: previewPosterFrameFallback.dispW,
                              height: previewPosterFrameFallback.dispH,
                              maxWidth: 'none',
                              maxHeight: 'none',
                              transform: `translate(calc(-50% + ${previewPan.x}px), calc(-50% + ${previewPan.y}px))`,
                              cursor: isInfoMode
                                ? 'default'
                                : isPreviewDragging &&
                                    (previewPosterFrameFallback.dispW >
                                      previewPosterFrameFallback.maxW + 0.5 ||
                                      previewPosterFrameFallback.dispH >
                                        previewPosterFrameFallback.maxH + 0.5)
                                  ? 'grabbing'
                                  : previewPosterFrameFallback.dispW >
                                        previewPosterFrameFallback.maxW + 0.5 ||
                                      previewPosterFrameFallback.dispH >
                                        previewPosterFrameFallback.maxH + 0.5
                                    ? previewPosterFrameFallback.s >= 1 - 1e-6
                                      ? 'zoom-out'
                                      : 'zoom-in'
                                    : 'zoom-in',
                            }
                          : {
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              cursor: isInfoMode ? 'default' : 'wait',
                            }
                    }
                    onLoad={(e) => {
                      const el = e.currentTarget;
                      const nw = el.naturalWidth;
                      const nh = el.naturalHeight;
                      if (nw <= 0 || nh <= 0) return;
                      setPreviewNaturalSize({ w: nw, h: nh });
                      const host = mainPreviewHostRef.current;
                      const rect = host?.getBoundingClientRect();
                      const pad = POSTER_PREVIEW_LAYOUT_PAD_PX;
                      const cw = rect && rect.width > 0 ? rect.width : 800;
                      const ch = rect && rect.height > 0 ? rect.height : 600;
                      const maxW = Math.max(80, cw - pad * 2);
                      const maxH = Math.max(80, ch - pad * 2);
                      const sFill = getPreviewFillScale(nw, nh, maxW, maxH);
                      const minPct = getPreviewSliderMinPercent(sFill);
                      setPreviewSliderPercent(minPct);
                      setPreviewPan({ x: 0, y: 0 });
                      setPreviewLayoutTick((t) => t + 1);
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isInfoMode) return;
                      if (previewDragRef.current.moved) {
                        previewDragRef.current.moved = false;
                        return;
                      }
                      const L = posterPreviewLayoutRef.current;
                      if (!L) return;
                      if (previewSliderInteractionLockedRef.current) return;
                      const { fitPct, fitWidthPct } = previewSliderRangeRef.current;
                      const cur = previewSliderPercentRef.current;
                      const { next, panReset } = getNextPosterPreviewClickPercent(
                        cur,
                        fitPct,
                        fitWidthPct,
                      );
                      const nextClamped = Math.min(100, Math.max(fitPct, next));
                      if (panReset) {
                        setPreviewSliderPercent(nextClamped);
                        setPreviewPan({ x: 0, y: 0 });
                        return;
                      }
                      const sOld = L.s;
                      const sNew = getPreviewDisplayScaleFromSlider(
                        L.sFill,
                        nextClamped,
                        L.sCap,
                      );
                      if (sOld <= 1e-9) return;
                      const targetScale = sNew / sOld;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const offsetX = e.clientX - (rect.left + rect.width / 2);
                      const offsetY = e.clientY - (rect.top + rect.height / 2);
                      let nextPanX = -offsetX * (targetScale - 1);
                      let nextPanY = -offsetY * (targetScale - 1);
                      const dispWNew = L.nw * sNew;
                      const dispHNew = L.nh * sNew;
                      const maxPanX = Math.max(0, (dispWNew - L.maxW) / 2);
                      const maxPanY = Math.max(0, (dispHNew - L.maxH) / 2);
                      nextPanX = Math.max(-maxPanX, Math.min(maxPanX, nextPanX));
                      nextPanY = Math.max(-maxPanY, Math.min(maxPanY, nextPanY));
                      setPreviewSliderPercent(nextClamped);
                      setPreviewPan({ x: nextPanX, y: nextPanY });
                    }}
                    onPointerDown={(e) => {
                      if (isInfoMode) return;
                      const L = posterPreviewLayoutRef.current;
                      if (!L?.needsPan) return;
                      e.currentTarget.setPointerCapture(e.pointerId);
                      previewDragRef.current = {
                        pointerId: e.pointerId,
                        startX: e.clientX,
                        startY: e.clientY,
                        startPanX: previewPan.x,
                        startPanY: previewPan.y,
                        moved: false,
                      };
                      setIsPreviewDragging(true);
                    }}
                    onPointerMove={(e) => {
                      const d = previewDragRef.current;
                      const L = posterPreviewLayoutRef.current;
                      if (!L?.needsPan || d.pointerId !== e.pointerId) return;
                      const dx = e.clientX - d.startX;
                      const dy = e.clientY - d.startY;
                      if (Math.abs(dx) + Math.abs(dy) > 4) d.moved = true;
                      const maxX = Math.max(0, (L.dispW - L.maxW) / 2);
                      const maxY = Math.max(0, (L.dispH - L.maxH) / 2);
                      const nx = Math.max(-maxX, Math.min(maxX, d.startPanX + dx));
                      const ny = Math.max(-maxY, Math.min(maxY, d.startPanY + dy));
                      setPreviewPan({ x: nx, y: ny });
                    }}
                    onPointerUp={(e) => {
                      if (previewDragRef.current.pointerId !== e.pointerId) return;
                      try {
                        e.currentTarget.releasePointerCapture(e.pointerId);
                      } catch {
                        /* ignore */
                      }
                      previewDragRef.current.pointerId = null;
                      setIsPreviewDragging(false);
                    }}
                    onPointerCancel={(e) => {
                      if (previewDragRef.current.pointerId !== e.pointerId) return;
                      previewDragRef.current.pointerId = null;
                      setIsPreviewDragging(false);
                    }}
                  />

                  {isInfoMode ? (
                    <div
                      role="region"
                      aria-label="Movie information"
                      className="absolute inset-0 z-[25] overflow-y-auto bg-black/85"
                      onClick={(e) => e.stopPropagation()}
                      onWheel={(e) => e.stopPropagation()}
                    >
                      <div className="flex min-h-full w-full flex-col items-center justify-center px-4 py-5">
                        <PosterPreviewInfoPlotBlock
                          plot={posterPreviewMovie.plot ?? ''}
                          genres={posterPreviewMovie.genre ?? []}
                        />
                        <PosterPreviewInfoCrewBlock
                          director={posterPreviewMovie.director ?? ''}
                          writer={posterPreviewMovie.writer ?? ''}
                        />
                        <PosterPreviewInfoCastBlock
                          movie={resolvePosterPreviewInfoCastSourceMovie(
                            posterPreviewMovie,
                            selectedMovie,
                            movies,
                          )}
                        />
                        <PosterPreviewInfoDetailsBlock movie={posterPreviewMovie} />
                      </div>
                    </div>
                  ) : null}

                  {/* Poster Preview 内 scoped Upload：仅底部 action bar，不重复渲染海报图层 */}
                  <AnimatePresence>
                    {isScopedPosterUploadOpen && (pendingPosterUrl || posterUploadError || isPosterApplying) ? (
                      <motion.div
                        key="poster-upload-bar"
                        initial={{ y: 24, opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: 24, opacity: 0 }}
                        onClick={(e) => e.stopPropagation()}
                        className="absolute left-0 right-0 bottom-0 z-20"
                      >
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/85 via-black/55 to-transparent" />
                        <div className="relative pointer-events-none flex flex-col gap-3 p-4">
                          {posterUploadError ? (
                            <div className="pointer-events-auto self-start rounded-md border border-red-400/20 bg-red-500/15 px-3 py-2 text-[12px] font-medium text-red-200">
                              {posterUploadError}
                            </div>
                          ) : null}

                          <div className="pointer-events-auto flex flex-wrap items-center justify-start gap-3 sm:justify-center">
                            {pendingPosterUrl ? (
                              <>
                                <button
                                  type="button"
                                  disabled={isPosterApplying}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setPendingPosterUrl(null);
                                    setPosterUploadError('');
                                  }}
                                  className="inline-flex h-9 items-center justify-center rounded-full bg-white/10 px-4 py-0 text-[12px] font-bold tracking-widest text-white/60 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40"
                                >
                                  Cancel
                                </button>
                                <button
                                  type="button"
                                  disabled={isPosterApplying}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUsePoster();
                                  }}
                                  className="inline-flex h-9 items-center gap-2 rounded-full bg-white/80 px-4 py-0 text-[12px] font-bold tracking-widest text-black shadow-xl transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  Apply
                                </button>
                              </>
                            ) : null}
                          </div>
                        </div>
                      </motion.div>
                    ) : null}
                  </AnimatePresence>

                  {/* Scoped Upload file input：预览打开时常驻挂载，供顶栏按钮同步 click() */}
                  <input
                    ref={posterFileInputRef}
                    id="poster-scoped-file-input"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onClick={(e) => {
                      e.stopPropagation();
                      e.currentTarget.value = '';
                    }}
                    onChange={(e) => {
                      e.stopPropagation();
                      setPosterUploadError('');
                      setPendingPosterUrl(null);
                      setIsScopedPosterUploadOpen(true);
                      void handlePosterFileChange(e.target.files?.[0]);
                    }}
                  />
              </div>
            </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Add Movie Modal：仅主内容宿主区（与预告片/海报预览同 scope），侧栏与顶栏不被压暗 */}
      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MAIN_MODAL_OVERLAY_TRANSITION}
            onPointerDown={(e) => {
              if (!e.isPrimary) return;
              if (isAdding) return;
              addMovieBackdropCloseArmedRef.current = e.target === e.currentTarget;
            }}
            onPointerUp={(e) => {
              if (!e.isPrimary) return;
              if (isAdding) {
                addMovieBackdropCloseArmedRef.current = false;
                return;
              }
              if (addMovieBackdropCloseArmedRef.current && e.target === e.currentTarget) {
                setIsAddModalOpen(false);
                setNewMovieTitle('');
                setNewMovieUrl('');
                setIsImdbEntered(false);
                setIsAddMovieImdbSectionExpanded(false);
                setNewMovieTrailerUrl('');
                setAddError('');
              }
              addMovieBackdropCloseArmedRef.current = false;
            }}
            className="absolute inset-0 z-[106] flex h-full min-h-0 cursor-pointer items-center justify-center overflow-hidden bg-black/35 p-4 backdrop-blur-md md:p-8"
          >
            <motion.div
              layout
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={MAIN_MODAL_PANEL_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] cursor-default bg-[#1F1F1F] border border-white/10 rounded-[46px] p-6 shadow-2xl"
            >
              <h2 className="text-[20px] font-semibold text-white mb-5 tracking-tight">
                Add New Movie
              </h2>

              <div className="space-y-2">
                {addError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-3 py-2.5 rounded-[10px]">
                    {addError}
                  </div>
                )}
                <div className="relative">
                  <label className="block text-xs font-medium text-white/50 mb-2">
                    Search movies by title
                  </label>
                  <div className="group/searchtitle relative w-full">
                    <img
                      draggable={false}
                      src="/icons/search.svg"
                      alt=""
                      width={16}
                      height={16}
                      className="pointer-events-none absolute left-3 top-1/2 z-[1] h-4 w-4 -translate-y-1/2 select-none opacity-100"
                      decoding="async"
                      aria-hidden
                    />
                    <input
                      ref={addMovieTitleSearchInputRef}
                      type="text"
                      placeholder="e.g. blood dia"
                      value={newMovieTitle}
                      onChange={(e) => {
                        setNewMovieTitle(e.target.value);
                        setAddMovieSuggestionsDismissed(false);
                        if (addError) setAddError('');
                      }}
                      onKeyDown={(e) => {
                        const addMovieDropdownOpen =
                          !addMovieSuggestionsDismissed &&
                          newMovieTitle.trim().length >= 2 &&
                          (addMovieSearchLoading || addMovieSearchHits.length > 0);
                        const suggestionsVisible =
                          addMovieDropdownOpen && addMovieSearchHits.length > 0;

                        if (e.key === 'Escape' && addMovieDropdownOpen) {
                          e.preventDefault();
                          setAddMovieSuggestionsDismissed(true);
                          setAddMovieActiveSuggestionIndex(-1);
                          return;
                        }

                        if (
                          e.key === 'ArrowDown' &&
                          newMovieTitle.trim().length >= 2 &&
                          addMovieSearchHits.length > 0
                        ) {
                          e.preventDefault();
                          setAddMovieSuggestionsDismissed(false);
                          setAddMovieActiveSuggestionIndex((prev) => {
                            const n = addMovieSearchHits.length;
                            if (prev < 0) return 0;
                            return Math.min(prev + 1, n - 1);
                          });
                          return;
                        }
                        if (
                          e.key === 'ArrowUp' &&
                          newMovieTitle.trim().length >= 2 &&
                          addMovieSearchHits.length > 0
                        ) {
                          e.preventDefault();
                          setAddMovieSuggestionsDismissed(false);
                          setAddMovieActiveSuggestionIndex((prev) => (prev <= 0 ? -1 : prev - 1));
                          return;
                        }
                        if (
                          e.key === 'Enter' &&
                          suggestionsVisible &&
                          addMovieActiveSuggestionIndex >= 0
                        ) {
                          const hit = addMovieSearchHits[addMovieActiveSuggestionIndex];
                          if (!hit?.imdbId) return;
                          e.preventDefault();
                          fastAddMovieFromSearchHit(hit);
                        }
                      }}
                      disabled={isAdding}
                      className={`input-focus-primary w-full h-10 bg-[#1D1D1D] border border-white/10 rounded-[22px] pl-10 text-white text-sm font-medium transition-colors placeholder:text-white/20 disabled:opacity-50 ${
                        newMovieTitle ? 'pr-10' : 'pr-3'
                      }`}
                    />
                    {newMovieTitle ? (
                      <button
                        type="button"
                        disabled={isAdding}
                        onPointerDown={(e) => {
                          if (!e.isPrimary) return;
                          if (isAdding) return;
                          setIsAddMovieClearSearchPressed(true);
                        }}
                        onPointerUp={(e) => {
                          if (!e.isPrimary) return;
                          if (isAdding) return;
                          addMovieSearchSeqRef.current += 1;
                          setNewMovieTitle('');
                          setAddMovieSearchHits([]);
                          setAddMovieSearchLoading(false);
                          setAddMovieSearchError('');
                          setAddMovieSuggestionsDismissed(true);
                          setAddMovieActiveSuggestionIndex(-1);
                          if (addError) setAddError('');
                          setIsAddMovieClearSearchPressed(false);
                          addMovieTitleSearchInputRef.current?.focus();
                        }}
                        onPointerCancel={() => setIsAddMovieClearSearchPressed(false)}
                        onPointerLeave={() => setIsAddMovieClearSearchPressed(false)}
                        className="absolute right-4 top-1/2 flex h-4 w-4 -translate-y-1/2 items-center justify-center rounded-full bg-white/20 disabled:pointer-events-none disabled:opacity-40"
                        title="Clear search"
                      >
                        <img
                          draggable={false}
                          src={
                            isAddMovieClearSearchPressed
                              ? '/icons/clear-search-pressed.svg'
                              : '/icons/clear-search.svg'
                          }
                          alt=""
                          width={16}
                          height={16}
                          className="pointer-events-none h-4 w-4 select-none object-contain"
                          decoding="async"
                          aria-hidden
                        />
                      </button>
                    ) : null}
                  </div>
                  {addMovieSearchError ? (
                    <p className="mt-1.5 ml-0.5 text-xs text-red-400/90">{addMovieSearchError}</p>
                  ) : null}
                  {!addMovieSuggestionsDismissed &&
                    newMovieTitle.trim().length >= 2 &&
                    (addMovieSearchLoading || addMovieSearchHits.length > 0) && (
                      <div
                        className="absolute left-0 right-0 top-full z-30 mt-1 max-h-60 overflow-y-auto rounded-[10px] border border-white/10 bg-[#1F1F1F] py-1 shadow-xl shadow-black/40"
                        role="listbox"
                        aria-label="Movie search suggestions"
                      >
                        {addMovieSearchLoading && addMovieSearchHits.length === 0 ? (
                          <div className="flex items-center justify-center gap-2 px-4 py-6 text-sm text-white/50">
                            <div className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60" />
                            Searching…
                          </div>
                        ) : null}
                        {addMovieSearchHits.map((hit, idx) => {
                          const yearLabel = hit.year != null ? String(hit.year) : '—';
                          const active = idx === addMovieActiveSuggestionIndex;
                          return (
                            <button
                              key={`${hit.tmdbId}-${hit.imdbId}`}
                              type="button"
                              role="option"
                              aria-selected={active}
                              disabled={isAdding}
                              onMouseDown={(ev) => {
                                ev.preventDefault();
                              }}
                              onMouseEnter={() => setAddMovieActiveSuggestionIndex(idx)}
                              onClick={() => fastAddMovieFromSearchHit(hit)}
                              className={`group/addsug flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                                active ? 'bg-white/10' : 'hover:bg-white/5'
                              }`}
                            >
                              <div className="h-12 w-8 shrink-0 overflow-hidden rounded border border-white/10 bg-white/5">
                                {hit.posterUrl ? (
                                  <img draggable={false}
                                    src={hit.posterUrl}
                                    alt=""
                                    className="h-full w-full object-cover select-none"
                                    loading="lazy"
                                  />
                                ) : (
                                  <div className="flex h-full w-full items-center justify-center" aria-hidden>
                                    <Film className="h-4 w-4 text-white/25" />
                                  </div>
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <div className="flex w-full min-w-0 items-center gap-2">
                                  <div className="min-w-0 flex-1 truncate text-sm font-medium leading-5 text-white">
                                    {hit.title}
                                  </div>
                                  <img draggable={false}
                                    src="/icons/arrow-up-left.svg"
                                    alt=""
                                    width={16}
                                    height={16}
                                    decoding="async"
                                    aria-hidden
                                    className="pointer-events-none h-4 w-4 shrink-0 object-contain opacity-0 transition-opacity duration-150 group-hover/addsug:opacity-100"
                                  />
                                </div>
                                <div className="text-[11px] leading-5 text-white/40 tabular-nums">{yearLabel}</div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    )}
                </div>

                {!isAddMovieImdbSectionExpanded ? (
                  <button
                    type="button"
                    disabled={isAdding}
                    onClick={() => {
                      setIsAddMovieImdbSectionExpanded(true);
                      window.requestAnimationFrame(() => {
                        addMovieImdbUrlInputRef.current?.focus();
                      });
                    }}
                    className="group/addimdblink flex w-full items-center justify-end text-xs font-medium text-white/50 transition-[color,opacity] duration-150 ease-out hover:text-white/70 hover:underline hover:underline-offset-2 cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <span className="mr-[20px] flex items-center gap-2 text-right">
                      <span className="relative inline-flex h-[14px] w-[14px] shrink-0" aria-hidden>
                        <img
                          draggable={false}
                          src="/icons/link.svg"
                          alt=""
                          width={14}
                          height={14}
                          decoding="async"
                          className="pointer-events-none absolute inset-0 h-[14px] w-[14px] object-contain opacity-100 transition-opacity duration-150 group-hover/addimdblink:opacity-0 group-disabled/addimdblink:opacity-100"
                        />
                        <img
                          draggable={false}
                          src="/icons/link-hover.svg"
                          alt=""
                          width={14}
                          height={14}
                          decoding="async"
                          className="pointer-events-none absolute inset-0 h-[14px] w-[14px] object-contain opacity-0 transition-opacity duration-150 group-hover/addimdblink:opacity-100 group-disabled/addimdblink:opacity-0"
                        />
                      </span>
                      <span>Use IMDb URL instead</span>
                    </span>
                  </button>
                ) : (
                  <motion.div
                    layout
                    initial={{ opacity: 0, y: -6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.26, ease: [0.25, 0.1, 0.25, 1] }}
                  >
                    <label className="block text-xs font-medium text-white/50 mb-2">
                      IMDb movie / TV URL
                    </label>
                    <input
                      ref={addMovieImdbUrlInputRef}
                      type="text"
                      placeholder="https://www.imdb.com/title/tt..."
                      value={newMovieUrl}
                      onChange={(e) => {
                        setNewMovieUrl(e.target.value);
                        if (addError) setAddError('');
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newMovieUrl.trim()) {
                          e.preventDefault();
                          setIsImdbEntered(true);
                          document.getElementById('trailer-input')?.focus();
                        }
                      }}
                      onBlur={() => {
                        if (newMovieUrl.trim()) {
                          setIsImdbEntered(true);
                        }
                      }}
                      disabled={isAdding}
                      readOnly={isImdbEntered}
                      className={`input-modal-url-field ${isImdbEntered ? 'opacity-50 cursor-not-allowed' : ''}`}
                    />
                  </motion.div>
                )}

                <div>
                  <label className="block text-xs font-medium text-white/50 mb-2">
                    Trailer URL (optional)
                  </label>
                  <input
                    id="trailer-input"
                    type="text"
                    placeholder="YouTube URL, overrides auto-detected trailer"
                    value={newMovieTrailerUrl}
                    onChange={(e) => setNewMovieTrailerUrl(e.target.value)}
                    disabled={isAdding}
                    className="input-modal-url-field"
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 mt-8">
                <button
                  onClick={() => {
                    setIsAddModalOpen(false);
                    setNewMovieTitle('');
                    setNewMovieUrl('');
                    setIsImdbEntered(false);
                    setIsAddMovieImdbSectionExpanded(false);
                    setNewMovieTrailerUrl('');
                    setAddError('');
                  }}
                  disabled={isAdding}
                  className="h-9 px-5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMovie}
                  disabled={isAdding || !newMovieUrl.trim()}
                  className={`h-9 px-6 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                    isAdding || !newMovieUrl.trim()
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-white/80 text-black hover:bg-white shadow-xl'
                  }`}
                >
                  {isAdding ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent opacity-70 rounded-full animate-spin" />
                      Adding...
                    </>
                  ) : (
                    'Add'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Delete movie confirmation：与 Add Movie / Edit Trailer 同遮罩与面板规范 */}
      <AnimatePresence>
        {deleteMovieConfirm && (
          <motion.div
            key={`delete-movie-overlay-${deleteMovieConfirm.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MAIN_MODAL_OVERLAY_TRANSITION}
            onPointerDown={(e) => {
              if (!e.isPrimary) return;
              deleteMovieBackdropCloseArmedRef.current = e.target === e.currentTarget;
            }}
            onPointerUp={(e) => {
              if (!e.isPrimary) return;
              if (deleteMovieBackdropCloseArmedRef.current && e.target === e.currentTarget) {
                setDeleteMovieConfirm(null);
              }
              deleteMovieBackdropCloseArmedRef.current = false;
            }}
            className="absolute inset-0 z-[106] flex h-full min-h-0 cursor-pointer items-center justify-center overflow-hidden bg-black/35 p-4 backdrop-blur-md md:p-8"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={MAIN_MODAL_PANEL_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] cursor-default bg-[#1F1F1F] border border-white/10 rounded-[46px] p-6 shadow-2xl"
            >
              <h2 className="text-[20px] font-semibold text-white mb-5 tracking-tight">Delete movie</h2>
              <p className="text-sm leading-relaxed text-white/70">
                Remove{' '}
                <span className="font-medium text-white/90">{deleteMovieConfirm.title}</span>
                {' from FilmBase? This cannot be undone.'}
              </p>
              <div className="flex items-center justify-end gap-3 mt-8">
                <button
                  type="button"
                  onClick={() => setDeleteMovieConfirm(null)}
                  className="h-9 px-5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const m = deleteMovieConfirm;
                    setDeleteMovieConfirm(null);
                    handleDeleteMovie(m);
                  }}
                  className="h-9 px-6 rounded-full text-sm font-medium bg-[#EA9794]/45 text-black hover:bg-[#EA9794] hover:text-black transition-colors shadow-xl"
                >
                  Delete
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Edit Trailer URL Modal：浮于预告片浮层之上（z=107 > trailer overlay z=104） */}
      <AnimatePresence>
        {isEditTrailerModalOpen && selectedMovie && (
          <motion.div
            key={`edit-trailer-overlay-${selectedMovie.id}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={MAIN_MODAL_OVERLAY_TRANSITION}
            onPointerDown={(e) => {
              if (!e.isPrimary) return;
              if (isEditingTrailer) return;
              editTrailerBackdropCloseArmedRef.current = e.target === e.currentTarget;
            }}
            onPointerUp={(e) => {
              if (!e.isPrimary) return;
              if (isEditingTrailer) {
                editTrailerBackdropCloseArmedRef.current = false;
                return;
              }
              if (editTrailerBackdropCloseArmedRef.current && e.target === e.currentTarget) {
                setIsEditTrailerModalOpen(false);
                setEditTrailerError('');
              }
              editTrailerBackdropCloseArmedRef.current = false;
            }}
            className="absolute inset-0 z-[107] flex h-full min-h-0 cursor-pointer items-center justify-center overflow-hidden bg-black/35 p-4 backdrop-blur-md md:p-8"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              transition={MAIN_MODAL_PANEL_TRANSITION}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-[420px] cursor-default bg-[#1F1F1F] border border-white/10 rounded-[46px] px-6 pt-6 pb-5 shadow-2xl"
            >
              <h2 className="text-[20px] font-semibold text-white mb-4 tracking-tight">Edit Trailer URL</h2>

              <div className="space-y-3">
                {editTrailerError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-3 py-2.5 rounded-[10px]">
                    {editTrailerError}
                  </div>
                )}
                <input
                  type="text"
                  placeholder="Paste a trailer URL"
                  value={editTrailerUrlInput}
                  onChange={(e) => {
                    setEditTrailerUrlInput(e.target.value);
                    if (editTrailerError) setEditTrailerError('');
                  }}
                  onFocus={(e) => {
                    e.currentTarget.select();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && editTrailerUrlInput.trim() && !isEditingTrailer) {
                      e.preventDefault();
                      void handleApplyEditTrailerUrl();
                    }
                  }}
                  disabled={isEditingTrailer}
                  className="edit-trailer-url-input input-modal-url-field"
                  autoFocus
                />
              </div>

              <div className="flex items-center justify-end gap-3 mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditTrailerModalOpen(false);
                    setEditTrailerError('');
                  }}
                  disabled={isEditingTrailer}
                  className="h-9 px-5 rounded-full text-sm font-medium text-white/60 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void handleApplyEditTrailerUrl()}
                  disabled={isEditingTrailer || !editTrailerUrlInput.trim()}
                  className={`h-9 px-6 rounded-full text-sm font-medium transition-all flex items-center gap-2 ${
                    isEditingTrailer || !editTrailerUrlInput.trim()
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-white/80 text-black hover:bg-white shadow-xl'
                  }`}
                >
                  {isEditingTrailer ? (
                    <>
                      <div className="w-4 h-4 border-2 border-current border-t-transparent opacity-70 rounded-full animate-spin" />
                      Applying...
                    </>
                  ) : (
                    'Apply'
                  )}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {isPosterHeroAnimating &&
        posterPreviewMovie &&
        posterHeroFromRect &&
        posterHeroTargetRect && (
          <div
            className="pointer-events-none fixed z-[120] overflow-hidden rounded-none shadow-2xl"
            style={{
              left: posterHeroFromRect.left,
              top: posterHeroFromRect.top,
              width: posterHeroFromRect.width,
              height: posterHeroFromRect.height,
              transformOrigin: 'top left',
              transform: posterHeroRun
                ? `translate(${posterHeroTargetRect.left - posterHeroFromRect.left}px, ${
                    posterHeroTargetRect.top - posterHeroFromRect.top
                  }px) scale(${
                    posterHeroTargetRect.width / posterHeroFromRect.width
                  }, ${posterHeroTargetRect.height / posterHeroFromRect.height})`
                : 'translate(0px, 0px) scale(1, 1)',
              transition: posterHeroRun
                ? `transform ${POSTER_HERO_TRANSITION_MS}ms cubic-bezier(0.33, 1, 0.25, 1)`
                : undefined,
              willChange: posterHeroRun ? 'transform' : undefined,
            }}
            onTransitionEnd={(e) => {
              if (e.propertyName !== 'transform') return;
              finishPosterHero();
            }}
          >
            <img draggable={false}
              src={posterPreviewMovie.posterUrl}
              alt=""
              className="h-full w-full object-contain select-none"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </div>
        )}
        </div>
      </main>

      {/* Modal：从卡片打开的海报上传/编辑（全屏 fixed）；预览工具栏上传见主内容区内 scoped 面板 */}
      <AnimatePresence>
        {selectedMovie && modalMode === 'poster' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMovie(null)}
            className="fixed inset-0 z-[100] flex cursor-pointer items-center justify-center bg-black/35 p-4 backdrop-blur-md md:p-12"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
              className="relative aspect-[2/3] h-[80vh] cursor-pointer overflow-hidden rounded-none bg-black shadow-[0_0_100px_rgba(255,255,255,0.1)]"
            >
              <>
                <input
                  ref={posterFileInputRef}
                  id="poster-modal-file-input"
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onClick={(e) => {
                    e.stopPropagation();
                    e.currentTarget.value = '';
                  }}
                  onChange={(e) => {
                    e.stopPropagation();
                    void handlePosterFileChange(e.target.files?.[0]);
                  }}
                />
                <img draggable={false}
                  src={pendingPosterUrl || selectedMovie.posterUrl}
                  alt={selectedMovie.title}
                  className="h-full w-full object-contain select-none"
                  referrerPolicy="no-referrer"
                />
                <div className="pointer-events-none absolute left-0 right-0 bottom-0 z-20 flex flex-col gap-3 bg-gradient-to-t from-black/85 via-black/55 to-transparent p-4">
                  {posterUploadError && (
                    <div className="pointer-events-auto self-center rounded-md border border-red-400/20 bg-red-500/15 px-3 py-2 text-[12px] font-medium text-red-200">
                      {posterUploadError}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center justify-center gap-3">
                    <label
                      htmlFor="poster-modal-file-input"
                      className="pointer-events-auto inline-flex cursor-pointer items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[12px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white hover:text-black"
                    >
                      <Upload size={14} />
                      Upload Local Poster
                    </label>
                    <button
                      type="button"
                      title="从 Storage 下载已存海报并写回数据库（poster_storage_path 为准，清空外链 poster_url）"
                      disabled={isPosterApplying || isPosterSyncing}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleSyncPosterFromStorage();
                      }}
                      className="pointer-events-auto inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-2 text-[12px] font-bold uppercase tracking-widest text-white/80 transition-colors hover:bg-white/20 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Download size={14} />
                      {isPosterSyncing ? 'Syncing…' : 'Use Storage Poster'}
                    </button>
                    {pendingPosterUrl && (
                      <>
                        <button
                          type="button"
                          disabled={isPosterApplying}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUsePoster();
                          }}
                          className="pointer-events-auto rounded-full bg-white px-5 py-2 text-[12px] font-bold uppercase tracking-widest text-black transition-colors hover:bg-white/85 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isPosterApplying ? `Applying${'.'.repeat(applyingDots)}` : 'Use Poster'}
                        </button>
                        <button
                          type="button"
                          disabled={isPosterApplying}
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingPosterUrl(null);
                            setPosterUploadError('');
                          }}
                          className="pointer-events-auto rounded-full bg-white/10 px-4 py-2 text-[12px] font-bold uppercase tracking-widest text-white/60 transition-colors hover:bg-white/15 hover:text-white disabled:opacity-40"
                        >
                          Cancel
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </>

              <div className="absolute -inset-4 -z-10 bg-gradient-to-r from-white/5 via-white/10 to-white/5 blur-3xl opacity-50" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

/**
 * Genre 图标 + 延迟提示：悬停满 0.5s 后在图标下方显示展示用名称（深色底、细边，接近顶栏控件提示）。
 *
 * @param label 已规范化的 genre 文案，如 `Sci-Fi`
 * @param iconSizePx 图标边长（px）；默认 20（列表行与网格海报 hover 一致）
 */
function PosterGenreIconWithTooltip({
  label,
  iconSizePx = 20,
}: {
  label: string;
  iconSizePx?: number;
}) {
  const [tipVisible, setTipVisible] = useState(false);
  const showTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(null);

  const clearShowTimer = useCallback(() => {
    if (showTimerRef.current !== null) {
      window.clearTimeout(showTimerRef.current);
      showTimerRef.current = null;
    }
  }, []);

  useEffect(() => () => clearShowTimer(), [clearShowTimer]);

  const handleEnter = useCallback(() => {
    clearShowTimer();
    showTimerRef.current = window.setTimeout(() => {
      showTimerRef.current = null;
      setTipVisible(true);
    }, 500);
  }, [clearShowTimer]);

  const handleLeave = useCallback(() => {
    clearShowTimer();
    setTipVisible(false);
  }, [clearShowTimer]);

  const slug = genreLabelToIconSlug(label);

  return (
    <span
      className="relative inline-flex shrink-0"
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
    >
      <img draggable={false}
        src={`/icons/${slug}-hover.svg`}
        alt=""
        width={iconSizePx}
        height={iconSizePx}
        className="pointer-events-none object-contain"
        style={{ width: iconSizePx, height: iconSizePx }}
        decoding="async"
        aria-hidden
      />
      {tipVisible ? (
        <span
          className="pointer-events-none absolute left-1/2 top-full z-[60] mt-1 -translate-x-1/2 whitespace-nowrap rounded-md border border-white/15 bg-zinc-950/95 px-2 py-1 text-[11px] font-medium text-white shadow-md"
          role="tooltip"
        >
          {label}
        </span>
      ) : null}
    </span>
  );
}

/**
 * 片库海报框内 loading：与全屏片库加载区同胶片 + 卷轴图，无声音。
 */
function LibraryPosterFrameLoadingGlyph() {
  return (
    <div
      className="pointer-events-none absolute inset-0 z-[12] flex items-center justify-center bg-[#1F1F1F]"
      aria-hidden
    >
      <div className="relative flex -translate-y-[12%] flex-col items-center justify-center">
        <div className="relative h-8 w-8 shrink-0">
          <img draggable={false}
            src={LIBRARY_LOADING_FILM_BASE_SRC}
            alt=""
            width={32}
            height={32}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain"
            decoding="async"
          />
          <img draggable={false}
            src={LIBRARY_LOADING_REEL_SRC}
            alt=""
            width={32}
            height={32}
            className="pointer-events-none absolute inset-0 h-full w-full object-contain animate-spin"
            decoding="async"
          />
        </div>
      </div>
    </div>
  );
}

interface MovieCardProps {
  movie: Movie;
  /** 在 `filteredMovies` 中的下标，用于海报 `loading` / `fetchPriority`。 */
  posterListIndex: number;
  size: number;
  viewMode: 'grid' | 'list';
  isEditing: boolean;
  /** 编辑态点击删除图标：打开父级删除确认弹窗。 */
  onRequestDelete: () => void;
  onRatingChange: (rating: number) => void;
  onPlayTrailer: () => void;
  onShowPoster: () => void;
  /** 全屏大图预览（列表点海报 / 网格 hover 预览热区）；传入海报外壳元素以启用 hero。 */
  onOpenPosterPreview: (posterSourceElement: HTMLElement | null) => void;
  /**
   * Storage 海报专用：当 signed URL 过期导致 `img` 加载失败时，尝试为该 `poster_storage_path`
   * 重新签名一次并更新该片的 `posterUrl`。
   *
   * 返回新的 URL 表示可重试；返回 null 表示无法刷新或已重试过一次（避免无限循环）。
   */
  onRefreshPosterSignedUrl?: (movieId: string, storagePath: string) => Promise<string | null>;
  /** 片库根节点注册（网格卡片 / 列表行），用于新增后滚动定位。 */
  registerLibraryItemEl?: (el: HTMLElement | null) => void;
  key?: React.Key;
}

/** 网格卡片评分区：public 目录下 `icons/ratings` 的 SVG（muted / hover color）。 */
const RATINGS_ICON = {
  imdbMuted: '/icons/ratings/imdb-source-muted.svg',
  imdbColor: '/icons/ratings/imdb-source-color.svg',
  rtMuted: '/icons/ratings/rt-source-muted.svg',
  rtFresh: '/icons/ratings/rt-fresh-color.svg',
  rtRotten: '/icons/ratings/rt-rotten-color.svg',
  rtUnknown: '/icons/ratings/rt-unknown-color.svg',
} as const;

/**
 * 根据 RT 百分数选择彩色番茄 SVG（≤0 unknown，≥60 fresh，否则 rotten；与网格 hover 一致）。
 *
 * @param rtPercent Rotten Tomatoes 百分比（0–100）
 * @returns `public/icons/ratings` 下对应 `rt-*-color.svg` 的 URL
 */
function rottenTomatoesColorIconPath(rtPercent: number): string {
  if (rtPercent <= 0) return RATINGS_ICON.rtUnknown;
  if (rtPercent >= 60) return RATINGS_ICON.rtFresh;
  return RATINGS_ICON.rtRotten;
}

/**
 * 海报网格横向跑马灯（cast / 片名）共用线速度基准：约 547px 在 8s 内走完半条（keyframes 的 -50%），
 * 按各条 `scrollWidth` 换算 `animation-duration`，使 hover 时片名与 starring 像素速度一致。
 */
const CAST_MARQUEE_REF_WIDTH_PX = 547;
const CAST_MARQUEE_REF_DURATION_SEC = 8;

/** 列表 starring 纵移每行高度（与 `h-5` / `leading-5` 一致）。 */
const LIST_CAST_LINE_PX = 20;
/** 列表 Title 列 `padding-top`（px）：小于其他列 `pt-[66px]`，为 `text-base`/`leading-6` 片名腾高且保持 year·runtime 与 starring 第 2 行对齐。 */
const LIST_TITLE_COLUMN_PT_PX = 62;
/**
 * 网格海报 hover 右上角「预览」点击热区边长（px）：与 overlay 内「Play Trailer」全宽胶囊同高（`py-2.5` + `text-[12px]` 单行约 40–42px）。
 */
const GRID_POSTER_PREVIEW_HIT_PX = 42;
/**
 * 片库网格/列表海报：前若干张 `loading="eager"`，其余 `lazy`，减轻首帧解码与带宽竞争。
 */
const LIBRARY_POSTER_EAGER_COUNT = 14;
/**
 * 上述 eager 段内，前几张使用 `fetchPriority="high"`（规范上宜 ≤2～4）。
 */
const LIBRARY_POSTER_HIGH_FETCH_PRIORITY_COUNT = 2;
/** 单行平移时长（ms）。 */
const LIST_CAST_SCROLL_MOTION_MS = 420;
/** 每步之间停顿（ms），与 motion 衔接为一步总周期。 */
const LIST_CAST_SCROLL_PAUSE_MS = 180;

/**
 * 网格海报上横向 `marquee`（keyframes -50%）的单圈时长，与 cast 共用同一线速度基准。
 */
function gridStripMarqueeDurationSec(stripScrollWidth: number): number {
  if (stripScrollWidth < 4) return CAST_MARQUEE_REF_DURATION_SEC;
  const distancePx = stripScrollWidth / 2;
  const refVelocityPxPerSec = CAST_MARQUEE_REF_WIDTH_PX / CAST_MARQUEE_REF_DURATION_SEC;
  return Math.min(180, Math.max(4, distancePx / refVelocityPxPerSec));
}

/**
 * 按筛后列表顺序生成海报 `loading` / `fetchPriority`（网格与列表共用）。
 *
 * @param listIndex `filteredMovies.map` 下标，从 0 起
 */
function libraryPosterFetchProps(listIndex: number): {
  loading: 'eager' | 'lazy';
  fetchPriority: 'high' | 'low';
} {
  const useLazy = listIndex >= LIBRARY_POSTER_EAGER_COUNT;
  return {
    loading: useLazy ? 'lazy' : 'eager',
    fetchPriority: !useLazy && listIndex < LIBRARY_POSTER_HIGH_FETCH_PRIORITY_COUNT ? 'high' : 'low',
  };
}

const formatDirectorName = (name: string) => {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length === 0) return '';
  
  const normalizedParts = parts.map(p => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase());
  
  if (normalizedParts.length <= 2) return normalizedParts.join(' ');
  
  const first = normalizedParts[0];
  const last = normalizedParts[normalizedParts.length - 1];
  const middles = normalizedParts.slice(1, -1).map(m => `${m[0].toUpperCase()}.`).join(' ');
  
  return `${first} ${middles} ${last}`;
};

/** 元数据行分隔：` · `（两侧各一空格）。 */
const YEAR_RUNTIME_METADATA_SEP = ' \u2022 ';

/**
 * 年 · 分级（若有）· 时长；`contentRating` 空或 `N/A` 时省略分级，不重复 ` • `。
 *
 * @param movie 需 `year` / `runtime` / `contentRating`
 * @returns 如 `1971 • PG-13 • 136 min` 或 `1971 • 136 min`
 */
function formatYearRatingRuntime(movie: Pick<Movie, 'year' | 'runtime' | 'contentRating'>): string {
  const yearStr = String(movie.year);
  const rawRating = typeof movie.contentRating === 'string' ? movie.contentRating.trim() : '';
  const hasRating = rawRating.length > 0 && rawRating.toUpperCase() !== 'N/A';
  const runtimeStr = (movie.runtime ?? '').trim();
  const parts: string[] = [yearStr];
  if (hasRating) parts.push(rawRating);
  if (runtimeStr.length > 0) parts.push(runtimeStr);
  return parts.join(YEAR_RUNTIME_METADATA_SEP);
}

/**
 * 从海报 URL 路径推断格式展示标签（大写简写）；无法识别时为 `Image`。
 *
 * @param posterUrl 海报地址（可含 query）
 */
function inferPosterImageFormatLabel(posterUrl: string): string {
  const path = (posterUrl.split('?')[0].split('#')[0] ?? '').toLowerCase();
  if (path.endsWith('.jpeg') || path.endsWith('.jpg')) return 'JPG';
  if (path.endsWith('.png')) return 'PNG';
  if (path.endsWith('.webp')) return 'WEBP';
  if (path.endsWith('.gif')) return 'GIF';
  return 'Image';
}

/**
 * IMDb 分数 UI 展示：固定一位小数（整数如 `8` → `8.0`）。
 *
 * @param rating IMDb 10 分制
 * @returns 展示用字符串；非有限数字为 `"—"`
 */
function formatImdbRating(rating: number): string {
  if (!Number.isFinite(rating) || rating <= 0) return '- -';
  return rating.toFixed(1);
}

function formatRottenTomatoesPercent(rt: number): string {
  if (!Number.isFinite(rt) || rt <= 0) return '- -';
  const n = Math.round(rt);
  return `${n}%`;
}

/** 列表 starring 纵移：`tick` 使 `line` 达 `N`（`translate = -N * lineHeight`）后再 `skipTx` 回 0，与双份 DOM 无缝对齐。 */
type ListCastScrollState = { line: number; skipTx: boolean };

type ListCastScrollAction =
  | { type: 'tick'; lineCount: number }
  | { type: 'reset' }
  | { type: 'clearSkipTx' };

function listCastScrollReducer(state: ListCastScrollState, action: ListCastScrollAction): ListCastScrollState {
  switch (action.type) {
    case 'reset':
      return { line: 0, skipTx: false };
    case 'clearSkipTx':
      return state.skipTx ? { ...state, skipTx: false } : state;
    case 'tick': {
      const n = Math.max(1, action.lineCount);
      if (n <= 1) return state;
      const nextLine = state.line + 1;
      if (nextLine > n) {
        return { line: 0, skipTx: true };
      }
      return { line: nextLine, skipTx: false };
    }
    default:
      return state;
  }
}

/** 侧栏「My Rating」筛选项悬停副文案：与海报区星级 hover 行一致（全大写、`#D4AF37`、`text-[10px]`）。 */
const SIDEBAR_MY_RATING_HOVER_LABEL_UPPER: Record<number, string> = {
  0: 'UNRATED',
  1: 'AWFUL',
  2: 'BAD',
  3: 'OKAY',
  4: 'RECOMMENDED',
  5: 'EXCELLENT',
};

/**
 * 侧栏「My Rating」下单条筛选：默认仅星标（N 颗粉星或 Unrated 五颗描边空星）；悬停时星标不隐藏，星排与文案间距同侧栏 Genre 图标与文案（`mr-[10px]`），标签样式与海报星级 hover 一致（不改行高与背景态）。
 * 左内边距与 `SidebarItem` 一致：`pl-6 pr-2.5`（较原 `px-2.5` 整体右移 14px），与 Genre/Year 条目左缘对齐。
 *
 * @param rating 筛选项分值 `0`…`5`（与 `selectedRatings` 一致）
 */
function SidebarMyRatingFilterRow({
  rating,
  active,
  onClick,
}: {
  rating: number;
  active: boolean;
  onClick: () => void;
}) {
  const aria =
    rating === 0
      ? 'Filter by unrated'
      : rating === 1
        ? 'Filter by 1 star'
        : `Filter by ${rating} stars`;
  const hoverUpper = SIDEBAR_MY_RATING_HOVER_LABEL_UPPER[rating] ?? '';

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={aria}
      className={`group/sidebarrow flex h-9 w-full min-w-0 items-center rounded-md pl-3 pr-2.5 py-0 text-left text-[13px] transition-colors ${
        active
          ? 'bg-[#EB9692]/20 font-bold text-white'
          : 'text-white/70 hover:bg-white/5 hover:text-white'
      }`}
    >
      <div className="flex min-h-0 min-w-0 flex-1 items-center">
        <span className="mr-[10px] flex shrink-0 items-center gap-0.5" aria-hidden>
          {rating === 0
            ? [0, 1, 2, 3, 4].map((i) => (
                <Star key={i} size={11} fill="none" stroke="#D4AF37" className="opacity-30" />
              ))
            : Array.from({ length: rating }, (_, i) => (
                <Star key={i} size={11} fill="#EB9692" stroke="#EB9692" />
              ))}
        </span>
        <span
          className="min-w-0 max-w-0 overflow-hidden whitespace-nowrap text-[10px] font-bold uppercase leading-none tracking-[0.1em] text-[#D4AF37] opacity-0 transition-[max-width,opacity] duration-150 ease-out group-hover/sidebarrow:max-w-[200px] group-hover/sidebarrow:opacity-100"
        >
          {hoverUpper}
        </span>
      </div>
    </button>
  );
}

function MovieCard({
  movie,
  posterListIndex,
  size,
  viewMode,
  isEditing,
  onRequestDelete,
  onRatingChange,
  onPlayTrailer,
  onShowPoster,
  onOpenPosterPreview,
  onRefreshPosterSignedUrl,
  registerLibraryItemEl,
}: MovieCardProps) {
  const posterFetch = libraryPosterFetchProps(posterListIndex);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  /**
   * cast 跑马灯视口：写入 `--cast-marquee-viewport`（px）供段首 spacer；子项 `padding-left: var(--cast-marquee-viewport, 100cqw)`，后者需本节点 `[container-type:inline-size]`。
   */
  const castMarqueeViewportRef = useRef<HTMLDivElement>(null);
  const castMarqueeStripRef = useRef<HTMLDivElement>(null);
  const titleMarqueeStripRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef<HTMLDivElement>(null);
  const directorMarqueeStripRef = useRef<HTMLDivElement>(null);
  /** 网格 hover 叠层：年 · 分级 · 时长行溢出测量（与 cast / title 同 marquee 线速）。 */
  const yearRuntimeMetadataRef = useRef<HTMLSpanElement>(null);
  const yearRuntimeMarqueeStripRef = useRef<HTMLDivElement>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [isCastOverflowing, setIsCastOverflowing] = useState(false);
  const [isDirectorOverflowing, setIsDirectorOverflowing] = useState(false);
  const [isYearRuntimeOverflowing, setIsYearRuntimeOverflowing] = useState(false);
  const [castMarqueeDurationSec, setCastMarqueeDurationSec] = useState(CAST_MARQUEE_REF_DURATION_SEC);
  /**
   * 指针进入网格卡片且 cast 溢出时递增；与 `movie.id` 拼成跑马灯 `key`，每次 hover 从 `translateX(0)` 重播。
   */
  const [castMarqueeRunKey, setCastMarqueeRunKey] = useState(0);
  const [titleMarqueeDurationSec, setTitleMarqueeDurationSec] = useState(CAST_MARQUEE_REF_DURATION_SEC);
  const [directorMarqueeDurationSec, setDirectorMarqueeDurationSec] = useState(CAST_MARQUEE_REF_DURATION_SEC);
  const [yearRuntimeMarqueeDurationSec, setYearRuntimeMarqueeDurationSec] = useState(
    CAST_MARQUEE_REF_DURATION_SEC,
  );
  /** 列表行 starring 纵移：`line` 为已上移行数（0…N）；`skipTx` 为滚满一圈回到 0 时本帧关闭 transform。 */
  const [listCastScroll, dispatchListCastScroll] = useReducer(listCastScrollReducer, { line: 0, skipTx: false });
  /** 列表行 hover（与 starring `group-hover` 同步），驱动纵移定时器。 */
  const [isListStarringMarqueeHover, setIsListStarringMarqueeHover] = useState(false);
  /** 网格海报壳（aspect 框），供 hero 起点 `getBoundingClientRect`。 */
  const gridPosterShellRef = useRef<HTMLDivElement>(null);
  /** 列表行海报壳（100×150），供 hero 起点。 */
  const listPosterShellRef = useRef<HTMLDivElement>(null);
  /** 海报位图是否已 `onLoad`（与 `isMetadataPending` 共同决定 loading 叠层）。 */
  const [posterNaturalLoaded, setPosterNaturalLoaded] = useState(true);
  /** 海报加载失败：显示占位，避免原生 broken image 图标与 alt 文案。 */
  const [posterFailed, setPosterFailed] = useState(false);
  /** 同一张海报在单个卡片生命周期内仅触发一次重签请求，避免 onError 多次触发导致重复请求。 */
  const posterResignRequestedRef = useRef(false);

  useLayoutEffect(() => {
    setPosterNaturalLoaded(movie.posterUrl.trim().length === 0);
  }, [movie.posterUrl, movie.id, movie.isMetadataPending]);

  useEffect(() => {
    // posterUrl 刷新（重签成功）或切换到新电影时：清掉失败态并允许一次新的 onError→重签。
    setPosterFailed(false);
    posterResignRequestedRef.current = false;
  }, [movie.id, movie.posterUrl]);

  React.useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current) {
        setIsTitleOverflowing(titleRef.current.scrollWidth > titleRef.current.clientWidth);
      }
      if (castRef.current) {
        setIsCastOverflowing(castRef.current.scrollWidth > castRef.current.clientWidth);
      }
      if (directorRef.current) {
        setIsDirectorOverflowing(directorRef.current.scrollWidth > directorRef.current.clientWidth);
      } else {
        setIsDirectorOverflowing(false);
      }
      if (viewMode === 'grid' && yearRuntimeMetadataRef.current) {
        const yr = yearRuntimeMetadataRef.current;
        setIsYearRuntimeOverflowing(yr.scrollWidth > yr.clientWidth);
      } else {
        setIsYearRuntimeOverflowing(false);
      }
    };
    
    // Small delay to ensure layout is stable
    const timer = setTimeout(checkOverflow, 50);
    window.addEventListener('resize', checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkOverflow);
      setHoverRating(null);
    };
  }, [
    movie.title,
    movie.cast,
    movie.director,
    movie.year,
    movie.runtime,
    movie.contentRating,
    size,
    viewMode,
  ]);

  /** 将 cast 视口宽度写入 `--cast-marquee-viewport`（layout 阶段同步 + ResizeObserver），避免 React state 首帧为 0。 */
  useLayoutEffect(() => {
    if (viewMode !== 'grid' || !isCastOverflowing) return;
    const el = castMarqueeViewportRef.current;
    if (!el) return;
    const sync = () => {
      const w = el.clientWidth;
      el.style.setProperty('--cast-marquee-viewport', w > 0 ? `${w}px` : '');
    };
    sync();
    const ro = new ResizeObserver(() => sync());
    ro.observe(el);
    return () => {
      ro.disconnect();
      el.style.removeProperty('--cast-marquee-viewport');
    };
  }, [viewMode, isCastOverflowing, size, movie.cast]);

  /** 按内容宽度换算 cast 跑马灯时长，使线速度与 Matrix 基准一致。 */
  React.useEffect(() => {
    if (viewMode !== 'grid' || !isCastOverflowing) return;

    const measure = () => {
      const node = castMarqueeStripRef.current;
      if (!node) return;
      setCastMarqueeDurationSec(gridStripMarqueeDurationSec(node.scrollWidth));
    };

    const ro = new ResizeObserver(measure);
    const raf = requestAnimationFrame(() => {
      measure();
      const node = castMarqueeStripRef.current;
      if (node) ro.observe(node);
    });

    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, isCastOverflowing, movie.cast, size, castMarqueeRunKey]);

  /** 列表行与网格 hover：导演名溢出时与片名 / starring 同 `marquee` 线速（`gridStripMarqueeDurationSec`）。 */
  React.useEffect(() => {
    if (!isDirectorOverflowing) return;

    const measure = () => {
      const node = directorMarqueeStripRef.current;
      if (!node) return;
      setDirectorMarqueeDurationSec(gridStripMarqueeDurationSec(node.scrollWidth));
    };

    const ro = new ResizeObserver(measure);
    const raf = requestAnimationFrame(() => {
      measure();
      const node = directorMarqueeStripRef.current;
      if (node) ro.observe(node);
    });

    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, isDirectorOverflowing, movie.director, size]);

  /** 网格 hover：年·分级·时长行溢出时与 cast / 导演同 `gridStripMarqueeDurationSec` 线速。 */
  React.useEffect(() => {
    if (viewMode !== 'grid' || !isYearRuntimeOverflowing) return;

    const measure = () => {
      const node = yearRuntimeMarqueeStripRef.current;
      if (!node) return;
      setYearRuntimeMarqueeDurationSec(gridStripMarqueeDurationSec(node.scrollWidth));
    };

    const ro = new ResizeObserver(measure);
    const raf = requestAnimationFrame(() => {
      measure();
      const node = yearRuntimeMarqueeStripRef.current;
      if (node) ro.observe(node);
    });

    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, isYearRuntimeOverflowing, movie.year, movie.runtime, movie.contentRating, size]);

  /** 片名跑马灯：网格 hover 展示；列表溢出时始终展示。均用 `gridStripMarqueeDurationSec` 与 poster 网格同线速。 */
  React.useEffect(() => {
    if ((viewMode !== 'grid' && viewMode !== 'list') || !isTitleOverflowing) return;

    const measure = () => {
      const node = titleMarqueeStripRef.current;
      if (!node) return;
      setTitleMarqueeDurationSec(gridStripMarqueeDurationSec(node.scrollWidth));
    };

    const ro = new ResizeObserver(measure);
    const raf = requestAnimationFrame(() => {
      measure();
      const node = titleMarqueeStripRef.current;
      if (node) ro.observe(node);
    });

    window.addEventListener('resize', measure);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [viewMode, isTitleOverflowing, movie.title, size]);

  const listCastScrollStepMs = LIST_CAST_SCROLL_MOTION_MS + LIST_CAST_SCROLL_PAUSE_MS;

  /** 列表行 Starring：行高 / 展开行数 / 视口高度（与 `group-hover:h-[120px]` 一致）。 */
  const lineHeightPx = LIST_CAST_LINE_PX;
  const starringVisibleLines = 6;
  const windowHeightPx = starringVisibleLines * lineHeightPx;
  /** 列表行固定高度（与 `h-[172px]` 一致），用于 Title 列 genre 与 Starring 展开视口第 6 行顶对齐。 */
  const LIST_VIEW_ROW_HEIGHT_PX = 172;
  /**
   * Title 列内 genre 绝对定位的 `top`（px）：与 Starring 列在 `group-hover` 时垂直居中、
   * `windowHeightPx` 高视口内第 6 行（`h-5`）顶边同一 Y。
   */
  const listTitleGenreLineTopPx =
    (LIST_VIEW_ROW_HEIGHT_PX - windowHeightPx) / 2 + (starringVisibleLines - 1) * lineHeightPx;
  const maxVisible = 6;
  const cast = movie.cast ?? [];
  /**
   * 网格 hover cast 横向跑马灯专用文案：在首位演员名前加与其字符数等长的空格，循环接缝处留白更易读。
   * 不用于静态 `truncate` 行，仅用于 `isCastOverflowing` 时的双份 marquee。
   */
  const gridHoverCastMarqueeText =
    cast.length === 0 ? '' : `${' '.repeat(cast[0]!.length)}${cast.join(' · ')}`;
  const isRowHovered = isListStarringMarqueeHover;
  const canCarousel =
    viewMode === 'list' &&
    isRowHovered &&
    starringVisibleLines === 6 &&
    cast.length > maxVisible;
  const windowSize = Math.min(maxVisible, cast.length);
  const displayedCast = canCarousel ? [...cast, ...cast] : cast.slice(0, windowSize);
  const starringOffset = listCastScroll.line;

  React.useEffect(() => {
    if (viewMode !== 'list' || !canCarousel) return;
    const id = window.setInterval(() => {
      dispatchListCastScroll({ type: 'tick', lineCount: Math.max(1, cast.length) });
    }, listCastScrollStepMs);
    return () => window.clearInterval(id);
  }, [viewMode, canCarousel, cast.length, listCastScrollStepMs]);

  React.useLayoutEffect(() => {
    if (!listCastScroll.skipTx) return;
    dispatchListCastScroll({ type: 'clearSkipTx' });
  }, [listCastScroll.skipTx]);

  React.useEffect(() => {
    if (viewMode !== 'list') {
      setIsListStarringMarqueeHover(false);
      dispatchListCastScroll({ type: 'reset' });
    }
  }, [viewMode]);

  const ratingLabels: Record<number, string> = {
    1: 'Awful',
    2: 'Bad',
    3: 'Okay',
    4: 'Recommended',
    5: 'Excellent',
  };

  const currentRating = hoverRating !== null ? hoverRating : movie.personalRating;

  /**
   * 五星按钮行（列表与网格共用交互逻辑）。
   * 不在单颗星上 `mouseLeave` 清 `hoverRating`，避免移向邻星经间隙时标签闪烁；清理由外层 `StarRating` / `ListStarRating` 统一处理。
   */
  const PersonalStarRatingButtons = () => (
    <div className="flex items-center gap-0.5">
      {[...Array(5)].map((_, i) => (
        <button
          key={i}
          onMouseEnter={(e) => {
            e.stopPropagation();
            setHoverRating(i + 1);
          }}
          onClick={(e) => {
            e.stopPropagation();
            const newRating = i + 1;
            onRatingChange(newRating === movie.personalRating ? 0 : newRating);
          }}
          className="transition-transform hover:scale-110 duration-300 ease-out focus:outline-none"
        >
          <Star 
            size={14} 
            fill={i < currentRating ? "#EB9692" : "none"} 
            stroke={i < currentRating ? "#EB9692" : "#D4AF37"}
            className={i < currentRating ? "" : (currentRating === 0 ? "opacity-30" : "opacity-50")} 
          />
        </button>
      ))}
    </div>
  );

  /**
   * hover 星级文案：单节点 `animate` 切换星级不换场，避免 `AnimatePresence` 进出造成闪烁；
   * 离开整块评分区后由外层 `mouseLeave` 将 `hoverRating` 置空，此处仅淡出。
   */
  const PersonalStarRatingHoverLabel = () => (
    <motion.span
      initial={false}
      animate={{
        opacity: hoverRating !== null ? 1 : 0,
      }}
      transition={{ duration: 0.12, ease: 'easeOut' }}
      className="inline-block text-[10px] tracking-[0.1em] whitespace-nowrap text-[#D4AF37] font-bold uppercase"
    >
      {hoverRating !== null ? ratingLabels[hoverRating] : '\u00a0'}
    </motion.span>
  );

  /**
   * 海报网格（poster / grid）内星级；改列表请改 `ListStarRating`。
   *
   * @param align 星星与文案水平对齐方式
   */
  const StarRating = ({ align = 'start' }: { align?: 'start' | 'center' }) => {
    const rowJustify = align === 'center' ? 'justify-center' : 'justify-start';
    return (
      <div 
        className={`flex flex-col ${align === 'center' ? 'items-center' : 'items-start'} gap-1`}
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoverRating(null);
        }}
      >
        <PersonalStarRatingButtons />
        <div className={`flex h-3 w-full items-center ${rowJustify}`}>
          <PersonalStarRatingHoverLabel />
        </div>
      </div>
    );
  };

  /**
   * 列表行专用：首行 `h-5` 与片名 `h3` 对齐；与次行用父级 `gap-0.5`（不用子项 `margin-top`）避免行间死区触发外层 `mouseLeave`。
   *
   * @param align 星星与 hover 文案的水平对齐
   */
  const ListStarRating = ({ align = 'start' }: { align?: 'start' | 'center' }) => {
    const rowJustify = align === 'center' ? 'justify-center' : 'justify-start';
    return (
      <div 
        className="flex w-full min-w-0 flex-col items-stretch gap-0.5"
        onMouseLeave={(e) => {
          e.stopPropagation();
          setHoverRating(null);
        }}
      >
        <div className={`flex h-5 w-full shrink-0 items-center gap-0.5 ${rowJustify}`}>
          <PersonalStarRatingButtons />
        </div>
        <div className={`flex h-5 w-full min-w-0 shrink-0 items-center ${rowJustify}`}>
          <PersonalStarRatingHoverLabel />
        </div>
      </div>
    );
  };

  const showPosterSlotLoading =
    movie.isMetadataPending === true ||
    (movie.posterUrl.trim().length > 0 && !posterNaturalLoaded);

  /**
   * 海报加载失败：
   * 1) 立即切到占位，避免浏览器原生破图 icon。
   * 2) 若该片来自 Storage（`posterStoragePath` 存在），则重签一次并更新 `posterUrl` 触发重试。
   */
  const handlePosterImgError = useCallback(() => {
    setPosterNaturalLoaded(true);
    setPosterFailed(true);

    const storagePath = movie.posterStoragePath?.trim();
    if (!storagePath) return;
    if (!onRefreshPosterSignedUrl) return;
    if (posterResignRequestedRef.current) return;
    posterResignRequestedRef.current = true;

    void (async () => {
      const nextUrl = await onRefreshPosterSignedUrl(movie.id, storagePath);
      if (!nextUrl) return;
      // 触发 <img key> 重建并重新发起请求；期间显示 loading 叠层而不是破图
      setPosterFailed(false);
      setPosterNaturalLoaded(false);
    })();
  }, [movie.id, movie.posterStoragePath, onRefreshPosterSignedUrl]);

  /**
   * 列表行入场/退场不用 `opacity`：与 `border-b` 同层时易与背景色 transition 合成出分割线「白闪」，仅用横向位移。
   */
  if (viewMode === 'list') {
    return (
      <motion.div
        ref={registerLibraryItemEl}
        initial={{ opacity: 1, x: -16 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 1, x: 16 }}
        className={`group relative hover:z-10 overflow-visible grid ${isEditing ? 'grid-cols-[60px_132px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]' : 'grid-cols-[132px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]'} gap-x-8 items-stretch px-0 h-[172px] rounded-none border-b border-[rgba(41,41,41,0.5)] hover:bg-white/5 cursor-pointer w-full transition-[background-color] duration-200 ease-out`}
        style={{ flexDirection: 'column' }}
        onMouseEnter={() => setIsListStarringMarqueeHover(true)}
        onMouseLeave={() => {
          setIsListStarringMarqueeHover(false);
          dispatchListCastScroll({ type: 'reset' });
        }}
      >
        {isEditing && (
          <div className="flex min-h-0 self-stretch items-center justify-center pl-8">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRequestDelete();
              }}
              className="flex h-4 w-4 items-center justify-center rounded-full bg-transparent p-0 shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.5] active:brightness-90"
              title="Delete movie"
            >
              <img draggable={false}
                src="/icons/poster-delete.svg"
                alt=""
                width={16}
                height={16}
                className="pointer-events-none h-4 w-4 object-contain"
                decoding="async"
                aria-hidden
              />
            </button>
          </div>
        )}
        <div className="flex shrink-0 self-stretch items-center justify-center overflow-visible pl-8">
          <div
            ref={listPosterShellRef}
            className={`relative w-[100px] h-[150px] transition-transform duration-300 origin-center shadow-lg ${showPosterSlotLoading ? 'bg-[#1F1F1F]' : ''} ${isEditing ? 'cursor-default group/posteredit' : 'cursor-zoom-in group-hover:scale-115'}`}
            onClick={
              isEditing
                ? undefined
                : (e) => {
                    e.stopPropagation();
                    onOpenPosterPreview(listPosterShellRef.current);
                  }
            }
          >
            {showPosterSlotLoading ? <LibraryPosterFrameLoadingGlyph /> : null}
            {movie.posterUrl.trim().length > 0 && !posterFailed ? (
              <img draggable={false}
                key={`poster-${movie.id}-${movie.isMetadataPending ? 'p' : 'r'}-${movie.posterUrl}`}
                src={movie.posterUrl}
                alt={movie.title}
                className="relative z-0 h-full w-full object-cover select-none"
                referrerPolicy="no-referrer"
                loading={posterFetch.loading}
                fetchPriority={posterFetch.fetchPriority}
                decoding="async"
                onLoad={() => setPosterNaturalLoaded(true)}
                onError={handlePosterImgError}
              />
            ) : movie.posterUrl.trim().length > 0 && posterFailed ? (
              <div
                className="absolute inset-0 z-0 flex items-center justify-center bg-[#101010] text-white/15"
                aria-hidden
              >
                <Film size={34} strokeWidth={1} />
              </div>
            ) : null}
            {isEditing ? (
              <div
                className="pointer-events-none absolute inset-0 z-[15] bg-black/75 opacity-100 transition-opacity duration-300 ease-out group-hover/posteredit:opacity-0"
                aria-hidden
              />
            ) : null}
          </div>
        </div>
        
        <div className="flex min-h-0 min-w-0 flex-col self-stretch pl-0">
          {/** 片名 `text-base`/`leading-6`；`pt` 小于他列，首行略上移，year·runtime 仍与 starring 第 2 行对齐 */}
          <div
            className="relative flex min-h-0 flex-1 flex-col items-start justify-start text-left"
            style={{ paddingTop: LIST_TITLE_COLUMN_PT_PX }}
          >
            {/** 溢出时与网格 poster 同 `marquee` 线速，非 hover 亦滚动 */}
            <div className="relative h-6 min-w-0 w-full shrink-0 overflow-hidden">
              <h3
                ref={titleRef}
                className={`w-full truncate text-base font-semibold leading-6 tracking-wide text-white/90 transition-colors group-hover:text-white ${
                  isTitleOverflowing ? 'opacity-0' : ''
                }`}
              >
                {movie.title}
              </h3>
              {isTitleOverflowing ? (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    ref={titleMarqueeStripRef}
                    className="flex w-max whitespace-nowrap text-base font-semibold leading-6 tracking-wide text-white/90 transform-gpu will-change-transform [backface-visibility:hidden] transition-colors group-hover:text-white"
                    style={{
                      animation: `marquee ${titleMarqueeDurationSec}s linear infinite`,
                    }}
                  >
                    <span className="pr-8">{movie.title}</span>
                    <span className="pr-8">{movie.title}</span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="mt-0.5 w-full truncate text-[13px] font-medium leading-5 text-white/60">
              {formatYearRatingRuntime(movie)}
            </div>
            {/** genre：默认文字；行 hover 时换为 `-hover` 图标 20px + 与海报网格相同的延迟提示 */}
            <div
              className="pointer-events-none absolute left-0 right-0 z-[1] flex h-5 max-w-full items-center text-[13px] font-medium leading-5 text-white/60 transition-colors group-hover:text-white"
              style={{ top: listTitleGenreLineTopPx }}
            >
              <span className="min-w-0 flex-1 truncate opacity-100 transition-opacity duration-150 group-hover:opacity-0">
                {movie.genre.length > 0 ? movie.genre.join(', ') : '\u00a0'}
              </span>
              <div className="pointer-events-none absolute inset-0 flex min-w-0 items-center gap-2 opacity-0 transition-opacity duration-150 group-hover:pointer-events-auto group-hover:opacity-100">
                {uniqueNormalizedGenreLabels(movie.genre).map((gl) => (
                  <React.Fragment key={gl}>
                    <PosterGenreIconWithTooltip label={gl} />
                  </React.Fragment>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex min-h-0 self-stretch items-center justify-center">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrailer();
            }}
            className="opacity-0 group-hover:opacity-100 transition-all bg-white/80 hover:bg-white text-black text-[11px] font-bold px-4 py-1.5 rounded-full tracking-wide whitespace-nowrap z-10 shadow-xl"
          >
            Play Trailer
          </button>
        </div>

        {/** 默认与片名首行同带；hover `translateY`；溢出时与 Title 列同横向 marquee（`pr-8` 与 `gridStripMarqueeDurationSec` 与片名一致） */}
        <div className="flex min-h-0 min-w-0 flex-col self-stretch items-center justify-start pt-[66px] text-center text-[13px] leading-5 text-white/60">
          {/** `translate-y`：行高 172、Trailer `items-center` 中心约 86px，片名带首行字中心约 76px → 约 10px；`duration-0` 离开无过渡 */}
          <div className="h-5 min-w-0 w-full shrink-0 translate-y-0 transition-[transform,color] duration-0 ease-out will-change-transform group-hover:translate-y-[10px] group-hover:text-white group-hover:duration-300">
            <div className="relative h-5 min-w-0 w-full shrink-0 overflow-hidden">
              <span
                ref={directorRef}
                className={`block w-full truncate text-center text-[13px] font-medium leading-5 text-white/60 transition-colors group-hover:text-white ${
                  isDirectorOverflowing ? 'opacity-0' : ''
                }`}
              >
                {formatDirectorName(movie.director)}
              </span>
              {isDirectorOverflowing ? (
                <div className="pointer-events-none absolute inset-0 overflow-hidden">
                  <div
                    ref={directorMarqueeStripRef}
                    className="flex w-max whitespace-nowrap text-[13px] font-medium leading-5 text-white/60 transform-gpu will-change-transform [backface-visibility:hidden] transition-colors group-hover:text-white"
                    style={{
                      animation: `marquee ${directorMarqueeDurationSec}s linear infinite`,
                    }}
                  >
                    <span className="pr-8">{formatDirectorName(movie.director)}</span>
                    <span className="pr-8">{formatDirectorName(movie.director)}</span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>

        {/** hover：`flex-1` + `justify-center` + `pt-0`，6 行视口在行高内垂直居中（Title 列已单独 `LIST_TITLE_COLUMN_PT_PX` 解耦） */}
        <div className="flex min-h-0 min-w-0 flex-col self-stretch justify-start pt-[66px] group-hover:flex-1 group-hover:justify-center group-hover:pt-0">
          <div
            className="relative mx-auto w-full min-h-[40px] max-h-[40px] overflow-hidden text-center text-[13px] leading-5 text-white/60 group-hover:h-[120px] group-hover:max-h-[120px] group-hover:text-white"
            data-list-starring-window-h={windowHeightPx}
          >
            {/** hover：展开视口高度 `windowHeightPx`（与 `group-hover:h-[120px]` 一致）；纵移 `motion` + 双份 `displayedCast` 无缝循环 */}
            <div className="absolute inset-0 z-[1] hidden overflow-hidden group-hover:block">
              <motion.div
                className="flex w-full flex-col items-center will-change-transform [backface-visibility:hidden]"
                initial={false}
                animate={{
                  y: canCarousel ? -starringOffset * lineHeightPx : 0,
                }}
                transition={
                  listCastScroll.skipTx
                    ? { duration: 0 }
                    : { duration: LIST_CAST_SCROLL_MOTION_MS / 1000, ease: [0.33, 1, 0.25, 1] }
                }
              >
                {displayedCast.map((name, idx) => (
                  <div
                    key={`${idx}-${name}`}
                    className="flex h-5 w-full shrink-0 items-center justify-center truncate text-[13px] leading-5"
                  >
                    {name}
                  </div>
                ))}
              </motion.div>
            </div>
            <div className="relative z-0 flex flex-col items-center gap-0 group-hover:hidden">
              {cast.slice(0, 2).map((actor, idx) => (
                <span key={idx} className="block h-5 w-full truncate text-center">{actor}</span>
              ))}
            </div>
          </div>
        </div>

        {/** 与导演列同结构：首行分数；次行 `mt-0.5` + `h-5` 与片名区 year/runtime 对齐；hover 显示 IMDb 彩标 */}
        <div className="flex min-h-0 min-w-0 flex-col self-stretch items-center justify-start pt-[66px] text-center text-[13px] leading-5 text-white/60 transition-colors group-hover:text-white">
          <span className="block h-5 min-w-0 w-full shrink-0 truncate text-center font-semibold tabular-nums">{formatImdbRating(movie.imdbRating)}</span>
          <div className="mt-0.5 flex h-5 w-full shrink-0 items-center justify-center">
            {/** 图标 18px 高，宽按 IMDb 60×32 等比；外层仍 `h-5` 与 year/runtime 行盒对齐 */}
            <div className="relative h-[18px] w-[calc(18px*60/32)] shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <img draggable={false}
                src={RATINGS_ICON.imdbColor}
                alt=""
                width={60}
                height={32}
                className="pointer-events-none absolute left-1/2 top-1/2 h-[18px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain"
                decoding="async"
              />
            </div>
          </div>
        </div>

        {/** 首行 RT%；次行与 year/runtime 同距；hover 显示 fresh / rotten / unknown 彩标 */}
        <div className="flex min-h-0 min-w-0 flex-col self-stretch items-center justify-start pt-[66px] text-center text-[13px] leading-5 text-white/60 transition-colors group-hover:text-white">
          <span className="block h-5 min-w-0 w-full shrink-0 truncate text-center font-semibold tabular-nums">{formatRottenTomatoesPercent(movie.rottenTomatoes)}</span>
          <div className="mt-0.5 flex h-5 w-full shrink-0 items-center justify-center">
            <div className="relative h-[18px] w-[18px] shrink-0 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
              <img draggable={false}
                src={rottenTomatoesColorIconPath(movie.rottenTomatoes)}
                alt=""
                width={32}
                height={32}
                className="pointer-events-none absolute inset-0 m-auto h-[18px] w-[18px] object-contain"
                decoding="async"
              />
            </div>
          </div>
        </div>

        <div className="flex min-h-0 self-stretch items-start justify-start pr-8 pt-[66px]">
          <ListStarRating align="start" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      ref={registerLibraryItemEl}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="group min-w-0 w-full cursor-pointer"
      onMouseEnter={() => {
        if (viewMode === 'grid' && isCastOverflowing) {
          setCastMarqueeRunKey((k) => k + 1);
        }
      }}
    >
      <div
        ref={gridPosterShellRef}
        className={`relative aspect-[2/3] overflow-hidden mb-3 shadow-2xl transition-transform duration-300 ease-out origin-bottom border-none ${
          showPosterSlotLoading ? 'bg-[#1F1F1F]' : ''
        } ${
          isEditing
            ? 'group/posteredit rounded-xl group-hover/posteredit:rounded-none group-hover:rounded-none'
            : 'rounded-none group-hover:rounded-none'
        } ${!isEditing ? 'group-hover:scale-115 group-hover:-translate-y-1' : ''}`}
      >
        {isEditing && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onRequestDelete();
            }}
            className="absolute left-2 top-2 z-50 flex h-4 w-4 items-center justify-center rounded-full bg-transparent p-0 shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.5] active:brightness-90"
            title="Delete movie"
          >
            <img draggable={false}
              src="/icons/poster-delete.svg"
              alt=""
              width={16}
              height={16}
              className="pointer-events-none h-4 w-4 object-contain"
              decoding="async"
              aria-hidden
            />
          </button>
        )}
        {!isEditing ? (
          <button
            type="button"
            className="absolute inset-0 z-0 block h-full w-full cursor-pointer border-none bg-transparent p-0"
            onClick={(e) => {
              e.stopPropagation();
              onShowPoster();
            }}
            aria-label={`Open poster options for ${movie.title}`}
          />
        ) : null}
        {showPosterSlotLoading ? <LibraryPosterFrameLoadingGlyph /> : null}
        {movie.posterUrl.trim().length > 0 && !posterFailed ? (
          <img draggable={false}
            key={`poster-${movie.id}-${movie.isMetadataPending ? 'p' : 'r'}-${movie.posterUrl}`}
            src={movie.posterUrl}
            alt={movie.title}
            className="pointer-events-none relative z-0 h-full w-full object-cover select-none"
            referrerPolicy="no-referrer"
            loading={posterFetch.loading}
            fetchPriority={posterFetch.fetchPriority}
            decoding="async"
            onLoad={() => setPosterNaturalLoaded(true)}
            onError={handlePosterImgError}
          />
        ) : movie.posterUrl.trim().length > 0 && posterFailed ? (
          <div
            className="absolute inset-0 z-0 flex items-center justify-center bg-[#101010] text-white/15"
            aria-hidden
          >
            <Film size={36} strokeWidth={1} />
          </div>
        ) : null}
        {isEditing ? (
          <div
            className="pointer-events-none absolute inset-0 z-[15] bg-black/75 opacity-100 transition-opacity duration-300 ease-out group-hover/posteredit:opacity-0"
            aria-hidden
          />
        ) : null}
        {/* Hover Metadata Overlay */}
        <div
          className={`absolute inset-0 z-20 flex flex-col justify-end bg-black/75 p-4 opacity-0 transition-opacity space-y-2 ${
            isEditing
              ? 'pointer-events-none'
              : 'pointer-events-none group-hover:pointer-events-auto group-hover:opacity-100'
          }`}
        >
          <div className="min-w-0 space-y-0 text-sm tracking-tight leading-relaxed font-medium text-white/60 group-hover:text-white">
            <div className="relative min-w-0">
              {/** 导演叠在年/时长行上方；溢出时 hover 横向跑马灯，线速与 starring 同基准。 */}
              <div className="absolute bottom-full left-0 right-0 z-[2] mb-1 h-6 overflow-hidden">
                <div
                  ref={directorRef}
                  className={`block truncate text-sm font-medium leading-relaxed tracking-tight text-white/60 transition-colors group-hover:text-white ${
                    isDirectorOverflowing ? 'group-hover:opacity-0' : ''
                  }`}
                >
                  {formatDirectorName(movie.director)}
                </div>
                {isDirectorOverflowing ? (
                  <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div
                      ref={directorMarqueeStripRef}
                      className="flex h-full w-max items-center whitespace-nowrap text-sm font-medium leading-relaxed tracking-tight text-white transform-gpu will-change-transform [backface-visibility:hidden]"
                      style={{
                        animation: `marquee ${directorMarqueeDurationSec}s linear infinite`,
                      }}
                    >
                      <span className="pr-4">{formatDirectorName(movie.director)}</span>
                      <span className="pr-4">{formatDirectorName(movie.director)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
              <div className="relative h-[17px] min-w-0 overflow-hidden">
                <span
                  ref={yearRuntimeMetadataRef}
                  className={`block truncate text-[12px] font-normal leading-tight tracking-normal text-white/50 transition-colors group-hover:text-white/75 ${
                    isYearRuntimeOverflowing ? 'group-hover:opacity-0' : ''
                  }`}
                >
                  {formatYearRatingRuntime(movie)}
                </span>
                {isYearRuntimeOverflowing ? (
                  <div className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
                    <div
                      ref={yearRuntimeMarqueeStripRef}
                      className="flex h-full w-max items-center whitespace-nowrap text-[12px] font-normal leading-tight tracking-normal text-white/50 transform-gpu will-change-transform [backface-visibility:hidden] transition-colors group-hover:text-white/75"
                      style={{
                        animation: `marquee ${yearRuntimeMarqueeDurationSec}s linear infinite`,
                      }}
                    >
                      <span className="pr-4">{formatYearRatingRuntime(movie)}</span>
                      <span className="pr-4">{formatYearRatingRuntime(movie)}</span>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
            <div className="mt-[8px] flex min-h-0 flex-wrap items-center gap-2">
              {uniqueNormalizedGenreLabels(movie.genre).map((label) => (
                <React.Fragment key={label}>
                  <PosterGenreIconWithTooltip label={label} />
                </React.Fragment>
              ))}
            </div>
            {/** `mt-[1lh]`：合并 year/runtime 少一行后，用一行高垫回 starring 的 Y 位置 */}
            <div className="mt-[1lh] min-w-0 pt-2">
              <div
                ref={castMarqueeViewportRef}
                className="relative h-4 min-w-0 overflow-hidden [container-type:inline-size]"
              >
                <div 
                  ref={castRef}
                  className={`text-white/60 transition-colors whitespace-nowrap ${isCastOverflowing ? 'group-hover:opacity-0' : 'truncate group-hover:text-white'}`}
                >
                  {movie.cast.join(' · ')}
                </div>
                
                {isCastOverflowing && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div
                      key={`${movie.id}-${castMarqueeRunKey}`}
                      ref={castMarqueeStripRef}
                      className="flex w-max whitespace-nowrap text-white transform-gpu will-change-transform [backface-visibility:hidden]"
                      style={{
                        animation: `marquee ${castMarqueeDurationSec}s linear infinite`,
                      }}
                    >
                      <div
                        className="flex shrink-0"
                        style={{ paddingLeft: 'var(--cast-marquee-viewport, 100cqw)' }}
                      >
                        <span className="pr-4">{gridHoverCastMarqueeText}</span>
                      </div>
                      <div
                        className="flex shrink-0"
                        style={{ paddingLeft: 'var(--cast-marquee-viewport, 100cqw)' }}
                      >
                        <span className="pr-4">{gridHoverCastMarqueeText}</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrailer();
            }}
            className="w-full py-2.5 mt-2 rounded-full bg-white/80 hover:bg-white text-black font-bold text-[12px] tracking-widest transform translate-y-4 group-hover:translate-y-0 transition-all duration-500 shadow-xl"
          >
            Play Trailer
          </button>
        </div>
        {!isEditing && (
          <button
            type="button"
            title="Preview poster"
            aria-label="Preview poster"
            onClick={(e) => {
              e.stopPropagation();
              onOpenPosterPreview(gridPosterShellRef.current);
            }}
            style={{
              width: GRID_POSTER_PREVIEW_HIT_PX,
              height: GRID_POSTER_PREVIEW_HIT_PX,
              top: 10,
              right: 10,
            }}
            className="group/posterzoom pointer-events-auto absolute z-30 flex items-center justify-center rounded-[10px] bg-white/20 p-0 opacity-0 transition-opacity group-hover:opacity-100"
          >
            <span className="relative inline-flex h-6 w-6 shrink-0">
              <img draggable={false}
                src="/icons/zoom-in.svg"
                alt=""
                width={24}
                height={24}
                className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 object-contain opacity-100 transition-opacity group-hover/posterzoom:opacity-0"
                decoding="async"
                aria-hidden
              />
              <img draggable={false}
                src="/icons/zoom-in-hover.svg"
                alt=""
                width={24}
                height={24}
                className="pointer-events-none absolute left-1/2 top-1/2 h-6 w-6 -translate-x-1/2 -translate-y-1/2 object-contain opacity-0 transition-opacity group-hover/posterzoom:opacity-100"
                decoding="async"
                aria-hidden
              />
            </span>
          </button>
        )}
      </div>

      <div className="min-w-0 w-full space-y-2">
        <div className="relative h-6 min-w-0 w-full overflow-hidden">
          <div 
            ref={titleRef} 
            className={`block min-w-0 w-full truncate text-base font-semibold leading-6 tracking-wide transition-colors group-hover:text-white ${isTitleOverflowing ? 'group-hover:opacity-0' : ''}`}
          >
            {movie.title}
          </div>
          
          {isTitleOverflowing && (
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div
                ref={titleMarqueeStripRef}
                className="flex w-max whitespace-nowrap text-base font-semibold leading-6 tracking-wide text-white transform-gpu will-change-transform [backface-visibility:hidden]"
                style={{
                  animation: `marquee ${titleMarqueeDurationSec}s linear infinite`,
                }}
              >
                <span className="pr-8">{movie.title}</span>
                <span className="pr-8">{movie.title}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-2 text-sm text-white/60 group-hover:text-white transition-colors tracking-wider">
          <div className="flex items-center justify-between h-5 font-bold">
            <div className="flex items-center gap-1" aria-label={`IMDb ${formatImdbRating(movie.imdbRating)}`}>
              {/** 与列表行 hover 一致：18px 高、60×32 等比宽；`gap-1` 与行 `h-5` 不变 */}
              <div className="relative h-[18px] w-[calc(18px*60/32)] shrink-0">
                <img draggable={false}
                  src={RATINGS_ICON.imdbMuted}
                  alt=""
                  width={60}
                  height={32}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[18px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-100 transition-opacity duration-200 group-hover:opacity-0"
                  decoding="async"
                />
                <img draggable={false}
                  src={RATINGS_ICON.imdbColor}
                  alt=""
                  width={60}
                  height={32}
                  className="pointer-events-none absolute left-1/2 top-1/2 h-[18px] w-auto max-w-none -translate-x-1/2 -translate-y-1/2 object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  decoding="async"
                />
              </div>
              <span className="text-[13px] leading-5 font-bold tabular-nums text-white/40 group-hover:font-bold group-hover:text-white">
                {formatImdbRating(movie.imdbRating)}
              </span>
            </div>
            <div className="flex items-center gap-1" aria-label={`Rotten Tomatoes ${formatRottenTomatoesPercent(movie.rottenTomatoes)}`}>
              <div className="relative h-[18px] w-[18px] shrink-0">
                <img draggable={false}
                  src={RATINGS_ICON.rtMuted}
                  alt=""
                  width={32}
                  height={32}
                  className="pointer-events-none absolute inset-0 m-auto h-[18px] w-[18px] object-contain opacity-100 transition-opacity duration-200 group-hover:opacity-0"
                  decoding="async"
                />
                <img draggable={false}
                  src={rottenTomatoesColorIconPath(movie.rottenTomatoes)}
                  alt=""
                  width={32}
                  height={32}
                  className="pointer-events-none absolute inset-0 m-auto h-[18px] w-[18px] object-contain opacity-0 transition-opacity duration-200 group-hover:opacity-100"
                  decoding="async"
                />
              </div>
              <span className="text-[13px] leading-5 font-bold tabular-nums text-white/40 group-hover:font-bold group-hover:text-white">
                {formatRottenTomatoesPercent(movie.rottenTomatoes)}
              </span>
            </div>
          </div>
          
          <div className="flex items-baseline font-medium">
            <StarRating align="start" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
