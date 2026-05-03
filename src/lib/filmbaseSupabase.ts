import type { RealtimeChannel, SupabaseClient } from '@supabase/supabase-js';
import type { Movie, MovieCastDetail } from '../types';

const SAVED_MOVIES_TABLE = 'filmbase_saved_movies';
/** 共享公共片单：所有用户读写的唯一可见库表（无 `owner_id`，主键 `movie_id`）。 */
const PUBLIC_MOVIES_TABLE = 'filmbase_public_movies';
const POSTERS_BUCKET = 'filmbase-posters';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const LOCALSTORAGE_MIGRATION_MARKER = 'filmbase_supabase_migrated_v1';
/** 一次性把当前匿名用户的 saved → public 迁移标记。 */
const LOCALSTORAGE_SAVED_TO_PUBLIC_MARKER = 'filmbase_saved_to_public_migrated_v1';
/** 共享海报存放路径前缀；所有用户共享同一对象，便于后续 sign 出统一 URL。 */
const PUBLIC_POSTER_PATH_PREFIX = 'shared';

type SavedMovieRow = {
  owner_id: string;
  movie_id: string;
  title: string | null;
  year: number | null;
  genre: string[] | null;
  imdb_rating: number | null;
  rotten_tomatoes: number | null;
  personal_rating: number | null;

  poster_url: string | null;
  poster_storage_path: string | null;

  director: string | null;
  language: string | null;
  runtime: string | null;
  cast_members: string[] | null;

  trailer_url: string | null;
  date_added: string | null;

  is_favorite: boolean | null;
  badge: string | null;

  content_rating?: string | null;
  plot?: string | null;
  writer?: string | null;
  tagline?: string | null;
  release_date?: string | null;
  country_of_origin?: string | null;
  also_known_as?: string[] | null;
  production_companies?: string[] | null;
  box_office?: string | null;
  cast_details?: MovieCastDetail[] | null;
};

/** 与 `SavedMovieRow` 相同字段，但不包含 `owner_id`（公共表行） */
type LibraryMovieRow = Omit<SavedMovieRow, 'owner_id'>;

const signedUrlCache = new Map<
  string,
  { signedUrl: string; expiresAtMs: number; promise?: Promise<string> }
>();

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:(.*?);base64,(.*)$/);
  if (!match) throw new Error('Invalid data URL.');
  const contentType = match[1];
  const base64 = match[2];
  const binary = atob(base64);

  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  return new Blob([bytes], { type: contentType });
}

function posterStoragePath(uid: string, movieId: string): string {
  return `${uid}/${movieId}/poster.jpg`;
}

/** 共享海报路径：`shared/{movieId}/poster.jpg`；与具体用户 uid 解耦。 */
function publicPosterStoragePath(movieId: string): string {
  return `${PUBLIC_POSTER_PATH_PREFIX}/${movieId}/poster.jpg`;
}

function posterUrlForUIFromSignedUrl(signedUrl: string): string {
  // UI 只认 movie.posterUrl，因此我们把 signedUrl 直接回填即可。
  return signedUrl;
}

/** 将 DB / JSON 中的值规范为 `string[]`。 */
function parseStringArrayField(val: unknown): string[] {
  if (!Array.isArray(val)) return [];
  return val.filter((x): x is string => typeof x === 'string');
}

/** 将 DB JSON 中的 `cast_details` 规范为 `MovieCastDetail[]`。 */
function parseCastDetailsField(val: unknown): MovieCastDetail[] {
  if (!Array.isArray(val)) return [];
  const out: MovieCastDetail[] = [];
  for (const item of val) {
    if (!item || typeof item !== 'object') continue;
    const o = item as { name?: unknown; character?: unknown };
    if (typeof o.name !== 'string' || !o.name.trim()) continue;
    out.push({
      name: o.name.trim(),
      character: typeof o.character === 'string' ? o.character.trim() : '',
    });
  }
  return out;
}

/**
 * 给 URL 增加 cache-busting 查询参数，避免同一路径替换后仍显示旧图。
 *
 * 注意：这里不尝试用 `new URL()` 解析（signedUrl 可能是相对/跨域/包含特殊字符），
 * 只做最小字符串拼接，并确保不会破坏已有查询串结构。
 */
function withCacheBuster(url: string, v: number): string {
  const hasQuery = url.includes('?');
  const joiner = hasQuery ? '&' : '?';
  return `${url}${joiner}v=${encodeURIComponent(String(v))}`;
}

/**
 * 把 `poster_storage_path` 转换成 UI 可用的 signed URL，并缓存 1 小时有效期。
 */
async function storagePathToSignedUrl(
  supabase: SupabaseClient,
  storagePath: string
): Promise<string> {
  const now = Date.now();
  const cached = signedUrlCache.get(storagePath);
  if (cached?.signedUrl && cached.expiresAtMs > now + 5_000) {
    return cached.signedUrl;
  }

  if (!cached?.promise) {
    const p = (async () => {
      const { data, error } = await supabase.storage
        .from(POSTERS_BUCKET)
        .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      if (error) throw error;
      const signedUrl = data?.signedUrl;
      if (!signedUrl) throw new Error('Signed URL was empty.');

      signedUrlCache.set(storagePath, {
        signedUrl,
        expiresAtMs: now + SIGNED_URL_TTL_SECONDS * 1000,
      });
      return signedUrl;
    })();

    signedUrlCache.set(storagePath, { signedUrl: cached?.signedUrl ?? '', expiresAtMs: 0, promise: p });
    try {
      const resolved = await p;
      signedUrlCache.set(storagePath, {
        signedUrl: resolved,
        expiresAtMs: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
      });
      return resolved;
    } catch (err) {
      signedUrlCache.delete(storagePath);
      throw err;
    }
  }

  const existingPromise = signedUrlCache.get(storagePath)?.promise;
  if (!existingPromise) throw new Error('Unexpected signed URL cache state.');
  try {
    return await existingPromise;
  } catch (err) {
    signedUrlCache.delete(storagePath);
    throw err;
  }
}

function rowToMovieBase(row: LibraryMovieRow): Movie {
  // 如果 poster_storage_path 不存在，将来合并时可能由 seed 覆盖，
  // 但 UI 合同要求 posterUrl 必须是字符串，所以我们给一个兜底。
  const posterUrlFallback = 'https://picsum.photos/seed/movie/400/600';

  const castMembers = row.cast_members ?? [];
  let castDetails = parseCastDetailsField(row.cast_details);
  if (castDetails.length === 0 && castMembers.length > 0) {
    castDetails = castMembers
      .filter((n): n is string => typeof n === 'string' && n.trim().length > 0)
      .map((name) => ({ name: name.trim(), character: '' }));
  }

  return {
    id: row.movie_id,
    title: row.title ?? '',
    year: row.year ?? 0,
    genre: row.genre ?? [],
    imdbRating: row.imdb_rating ?? 0,
    rottenTomatoes: row.rotten_tomatoes ?? 0,
    personalRating: row.personal_rating ?? 0,

    // 之后在 loadSavedMovies 里根据 storage_path 或 poster_url 再覆盖
    posterUrl: row.poster_url ?? posterUrlFallback,

    director: row.director ?? '',
    language: row.language ?? '',
    runtime: row.runtime ?? '',
    cast: castMembers,
    trailerUrl: row.trailer_url ?? '',

    badge: row.badge ?? undefined,
    isFavorite: row.is_favorite ?? false,

    // 最近添加：UI 用 dateAdded 与 24h 比较；这里把 timestamptz 转为 ms
    dateAdded: row.date_added ? new Date(row.date_added).getTime() : Date.now(),

    // seed 使用的字段；这两个字段在 UI 里主要受 dateAdded 影响
    isRecentlyAdded: undefined,

    // 额外字段（可选）用于后续写操作：当海报来自 Storage 时保留它
    posterStoragePath: row.poster_storage_path ?? undefined,

    contentRating: row.content_rating ?? '',
    plot: row.plot ?? '',
    writer: row.writer ?? '',
    tagline: row.tagline ?? '',
    releaseDate: row.release_date ?? '',
    countryOfOrigin: row.country_of_origin ?? '',
    alsoKnownAs: parseStringArrayField(row.also_known_as),
    productionCompanies: parseStringArrayField(row.production_companies),
    boxOffice: row.box_office ?? '',
    castDetails,
  };
}

const LIBRARY_MOVIE_SELECT_COLUMNS = [
  'movie_id',
  'title',
  'year',
  'genre',
  'imdb_rating',
  'rotten_tomatoes',
  'personal_rating',
  'poster_url',
  'poster_storage_path',
  'director',
  'language',
  'runtime',
  'cast_members',
  'trailer_url',
  'date_added',
  'is_favorite',
  'badge',
  'content_rating',
  'plot',
  'writer',
  'tagline',
  'release_date',
  'country_of_origin',
  'also_known_as',
  'production_companies',
  'box_office',
  'cast_details',
].join(',');

/**
 * 将库表行（无 `owner_id` 要求）映射为 `Movie[]`，并处理 `poster_storage_path` → signed URL。
 */
async function hydrateMoviesFromLibraryRows(
  supabase: SupabaseClient,
  rows: LibraryMovieRow[]
): Promise<Movie[]> {
  const movies: Movie[] = [];
  const posterUrlFallback = 'https://picsum.photos/seed/movie/400/600';

  for (const row of rows) {
    const movie = rowToMovieBase(row);
    if (row.poster_storage_path) {
      try {
        const signedUrl = await storagePathToSignedUrl(supabase, row.poster_storage_path);
        movie.posterUrl = posterUrlForUIFromSignedUrl(signedUrl);
        movie.posterStoragePath = row.poster_storage_path;
      } catch (posterErr) {
        console.warn(
          '[filmbaseSupabase] Poster Storage missing or signed URL failed; using poster_url or placeholder.',
          {
            storagePath: row.poster_storage_path,
            movie_id: row.movie_id,
            title: row.title,
            error: posterErr,
          },
        );
        const fromUrl = row.poster_url?.trim();
        movie.posterUrl = fromUrl && fromUrl.length > 0 ? fromUrl : posterUrlFallback;
        movie.posterStoragePath = undefined;
      }
    } else if (row.poster_url?.trim()) {
      movie.posterUrl = row.poster_url.trim();
      movie.posterStoragePath = undefined;
    } else {
      movie.posterStoragePath = undefined;
    }

    const dateAddedMs =
      typeof movie.dateAdded === 'number'
        ? movie.dateAdded
        : new Date(movie.dateAdded ?? 0).getTime();
    movie.isRecentlyAdded = Date.now() - dateAddedMs < 86400000;
    movies.push(movie);
  }

  return movies;
}

/**
 * 从 Supabase 读取公共 demo 片单，并把 Storage 海报回填为 signed URL。
 */
export async function loadPublicMovies(supabase: SupabaseClient): Promise<Movie[]> {
  const { data, error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .select(LIBRARY_MOVIE_SELECT_COLUMNS);

  if (error) throw error;

  const rows = (data ?? []) as unknown as LibraryMovieRow[];
  return hydrateMoviesFromLibraryRows(supabase, rows);
}

/**
 * 从 Supabase 读取当前匿名用户的 saved movies，并把 Storage 海报回填为 signed URL。
 */
export async function loadSavedMovies(
  supabase: SupabaseClient,
  uid: string
): Promise<Movie[]> {
  const { data, error } = await supabase
    .from(SAVED_MOVIES_TABLE)
    .select(['owner_id', LIBRARY_MOVIE_SELECT_COLUMNS].join(','));

  if (error) throw error;

  const rows = (data ?? []) as unknown as SavedMovieRow[];
  const libraryRows: LibraryMovieRow[] = rows.map(({ owner_id: _ownerId, ...rest }) => rest);

  return hydrateMoviesFromLibraryRows(supabase, libraryRows);
}

async function upsertSavedMovieRow(
  supabase: SupabaseClient,
  uid: string,
  movie: Movie
): Promise<void> {
  const storagePath = movie.posterStoragePath ?? undefined;

  const poster_url = storagePath ? null : movie.posterUrl;
  const poster_storage_path = storagePath ?? null;

  // 注意：如果 movie.posterUrl 是 signedUrl，我们不会把它写进 poster_url；
  // 只要 posterStoragePath 存在，就以 storage_path 作为真实来源。
  const record = {
    owner_id: uid,
    movie_id: movie.id,
    title: movie.title,
    year: movie.year,
    genre: movie.genre,
    imdb_rating: movie.imdbRating,
    rotten_tomatoes: movie.rottenTomatoes,
    personal_rating: movie.personalRating,

    poster_url,
    poster_storage_path,

    director: movie.director,
    language: movie.language,
    runtime: movie.runtime,
    cast_members: movie.cast,
    trailer_url: movie.trailerUrl,
    date_added: movie.dateAdded ? new Date(movie.dateAdded).toISOString() : new Date().toISOString(),

    is_favorite: movie.isFavorite,
    badge: movie.badge ?? null,

    content_rating: movie.contentRating?.trim() || null,
    plot: movie.plot?.trim() || null,
    writer: movie.writer?.trim() || null,
    tagline: movie.tagline?.trim() || null,
    release_date: movie.releaseDate?.trim() || null,
    country_of_origin: movie.countryOfOrigin?.trim() || null,
    also_known_as: movie.alsoKnownAs?.length ? movie.alsoKnownAs : [],
    production_companies: movie.productionCompanies?.length ? movie.productionCompanies : [],
    box_office: movie.boxOffice?.trim() || null,
    cast_details: movie.castDetails?.length ? movie.castDetails : [],
  };

  const { error } = await supabase
    .from(SAVED_MOVIES_TABLE)
    .upsert(record, { onConflict: 'owner_id,movie_id' });

  if (error) throw error;
}

async function migrateOnePosterIfNeeded(
  supabase: SupabaseClient,
  uid: string,
  movieId: string,
  posterUrl: string
): Promise<{ poster_url: string | null; poster_storage_path: string | null }> {
  // 仅对本地 data URL 的海报转存到 Storage
  if (!posterUrl.startsWith('data:image/')) {
    return { poster_url: posterUrl, poster_storage_path: null };
  }

  const path = posterStoragePath(uid, movieId);
  const blob = dataUrlToBlob(posterUrl);

  const { error: uploadError } = await supabase.storage
    .from(POSTERS_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });

  if (uploadError) throw uploadError;

  return { poster_url: null, poster_storage_path: path };
}

/**
 * 将 localStorage 的 `filmbase_movies` 一次性迁移到 Supabase。
 * - 迁移标记保存在 localStorage 中：`filmbase_supabase_migrated_v1_<uid>`
 * - 幂等性：表以 (owner_id, movie_id) 为主键，upsert 可重复执行。
 */
export async function migrateLocalStorageOnce(
  supabase: SupabaseClient,
  uid: string
): Promise<void> {
  const markerKey = `${LOCALSTORAGE_MIGRATION_MARKER}_${uid}`;
  const already = localStorage.getItem(markerKey);
  if (already === 'true') return;

  const raw = localStorage.getItem('filmbase_movies');
  if (!raw) {
    localStorage.setItem(markerKey, 'true');
    return;
  }

  let localMovies: Movie[];
  try {
    localMovies = JSON.parse(raw) as Movie[];
  } catch {
    localStorage.setItem(markerKey, 'true');
    return;
  }

  // 串行迁移：避免并发上传过多导致超时；数据量不大时更稳。
  for (const movie of localMovies) {
    const { poster_url, poster_storage_path } = await migrateOnePosterIfNeeded(
      supabase,
      uid,
      movie.id,
      movie.posterUrl
    );

    const record = {
      owner_id: uid,
      movie_id: movie.id,
      title: movie.title,
      year: movie.year,
      genre: movie.genre,
      imdb_rating: movie.imdbRating,
      rotten_tomatoes: movie.rottenTomatoes,
      personal_rating: movie.personalRating,

      poster_url,
      poster_storage_path,

      director: movie.director,
      language: movie.language,
      runtime: movie.runtime,
      cast_members: movie.cast,
      trailer_url: movie.trailerUrl,
      date_added: movie.dateAdded ? new Date(movie.dateAdded).toISOString() : new Date().toISOString(),

      is_favorite: movie.isFavorite,
      badge: movie.badge ?? null,

      content_rating: movie.contentRating?.trim() || null,
      plot: movie.plot?.trim() || null,
      writer: movie.writer?.trim() || null,
      tagline: movie.tagline?.trim() || null,
      release_date: movie.releaseDate?.trim() || null,
      country_of_origin: movie.countryOfOrigin?.trim() || null,
      also_known_as: movie.alsoKnownAs?.length ? movie.alsoKnownAs : [],
      production_companies: movie.productionCompanies?.length ? movie.productionCompanies : [],
      box_office: movie.boxOffice?.trim() || null,
      cast_details: movie.castDetails?.length ? movie.castDetails : [],
    };

    const { error } = await supabase
      .from(SAVED_MOVIES_TABLE)
      .upsert(record, { onConflict: 'owner_id,movie_id' });

    if (error) throw error;
  }

  localStorage.setItem(markerKey, 'true');
}

/**
 * 删除 saved movie 行 +（可选）删除对应 Storage 海报对象。
 */
export async function deleteSavedMovie(
  supabase: SupabaseClient,
  uid: string,
  movieId: string
): Promise<void> {
  const { error: dbError } = await supabase
    .from(SAVED_MOVIES_TABLE)
    .delete()
    .eq('owner_id', uid)
    .eq('movie_id', movieId);
  if (dbError) throw dbError;

  const path = posterStoragePath(uid, movieId);
  // 删除可能会遇到对象不存在的情况；这不应阻塞功能。
  const { error: storageError } = await supabase
    .storage
    .from(POSTERS_BUCKET)
    .remove([path]);
  if (storageError) {
    // ignore 404-like errors
  }
}

/**
 * 上传 data URL 海报并回填 signed URL + storage path。
 */
export async function uploadPosterDataUrlAndSign(
  supabase: SupabaseClient,
  uid: string,
  movieId: string,
  posterDataUrl: string
): Promise<{ posterStoragePath: string; signedPosterUrl: string }> {
  if (!posterDataUrl.startsWith('data:image/')) {
    throw new Error('posterDataUrl must be a data:image/... URL');
  }

  const path = posterStoragePath(uid, movieId);
  const blob = dataUrlToBlob(posterDataUrl);

  const { error: uploadError } = await supabase
    .storage
    .from(POSTERS_BUCKET)
    .upload(path, blob, {
      contentType: blob.type || 'image/jpeg',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  // 替换同一路径对象后，需要生成一个“全新”的 signed URL。
  // 1) 清掉内存缓存，避免复用旧 signedUrl
  signedUrlCache.delete(path);
  // 2) 重新签名，并附加 cache-busting 参数，避免浏览器/中间层缓存命中旧图片内容
  const signedUrl = await storagePathToSignedUrl(supabase, path);
  const cacheBusted = withCacheBuster(signedUrl, Date.now());
  return { posterStoragePath: path, signedPosterUrl: cacheBusted };
}

/**
 * 上传原始海报文件（不缩放不转码）并回填 signed URL + storage path。
 *
 * 注意：Storage 路径仍使用固定的 `{uid}/{movieId}/poster.jpg`，但会以文件自身的 `mime type` 作为 `contentType` 上传，
 * 以便浏览器正确渲染（扩展名与真实格式不一致也能工作）。
 */
export async function uploadPosterFileAndSign(
  supabase: SupabaseClient,
  uid: string,
  movieId: string,
  file: File
): Promise<{ posterStoragePath: string; signedPosterUrl: string }> {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) {
    throw new Error('Unsupported image type. Please upload JPEG, PNG, or WebP.');
  }

  const path = posterStoragePath(uid, movieId);

  const { error: uploadError } = await supabase
    .storage
    .from(POSTERS_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  signedUrlCache.delete(path);
  const signedUrl = await storagePathToSignedUrl(supabase, path);
  const cacheBusted = withCacheBuster(signedUrl, Date.now());
  return { posterStoragePath: path, signedPosterUrl: cacheBusted };
}

/**
 * 从 Storage 下载该片 `poster.jpg`，确认存在后刷新签名 URL，并 upsert 行：
 * `poster_storage_path` 为唯一来源、`poster_url` 置空，避免元数据里残留外链覆盖 Storage。
 *
 * @param supabase 已鉴权的客户端
 * @param uid 当前匿名用户 id（与路径前缀一致）
 * @param movie 当前影片；若缺少 `posterStoragePath` 则按 `{uid}/{movieId}/poster.jpg` 解析
 * @returns 更新后的 `Movie`（供 UI 立即替换列表与 modal）
 */
export async function syncPosterMetadataFromStorage(
  supabase: SupabaseClient,
  uid: string,
  movie: Movie
): Promise<Movie> {
  const path = movie.posterStoragePath ?? posterStoragePath(uid, movie.id);

  const { data: blob, error: downloadError } = await supabase.storage
    .from(POSTERS_BUCKET)
    .download(path);

  if (downloadError) throw downloadError;
  if (!blob || blob.size < 1) {
    throw new Error('Storage 中该路径无有效海报文件。');
  }

  signedUrlCache.delete(path);
  const signedUrl = await storagePathToSignedUrl(supabase, path);
  const signedPosterUrl = withCacheBuster(signedUrl, Date.now());

  const updated: Movie = {
    ...movie,
    posterUrl: signedPosterUrl,
    posterStoragePath: path,
  };

  await upsertSavedMovieRow(supabase, uid, updated);
  return updated;
}

/**
 * 基于 UI 当前 movie 状态写入 Supabase（upsert full row）。
 * 注意：写入海报来源取决于 movie.posterStoragePath 是否存在。
 */
export async function upsertSavedMovieFromUI(
  supabase: SupabaseClient,
  uid: string,
  movie: Movie
): Promise<void> {
  await upsertSavedMovieRow(supabase, uid, movie);
}

/**
 * 校验该 storage 路径仍存在，并刷新签名 URL（带 cache-buster），随后把公共行的
 * `poster_storage_path` 设为该路径，`poster_url` 置空（以 storage 为唯一来源）。
 *
 * 适用于「Use Storage Poster」按钮：当其它用户已上传过更高分辨率海报、
 * 而本地行 cache 出现旧 signed URL 时，从 Storage 重新拉取并同步到 UI。
 *
 * @param movie 当前选中的影片；优先使用 `movie.posterStoragePath`，否则按 shared 路径解析。
 */
export async function syncPublicMoviePosterFromStorage(
  supabase: SupabaseClient,
  movie: Movie
): Promise<Movie> {
  const path = movie.posterStoragePath?.trim() || publicPosterStoragePath(movie.id);

  const { data: blob, error: downloadError } = await supabase.storage
    .from(POSTERS_BUCKET)
    .download(path);
  if (downloadError) throw downloadError;
  if (!blob || blob.size < 1) {
    throw new Error('Storage 中该路径无有效海报文件。');
  }

  signedUrlCache.delete(path);
  const signedUrl = await storagePathToSignedUrl(supabase, path);
  const signedPosterUrl = withCacheBuster(signedUrl, Date.now());

  const updated: Movie = {
    ...movie,
    posterUrl: signedPosterUrl,
    posterStoragePath: path,
  };

  await updatePublicMoviePoster(supabase, movie.id, {
    storagePath: path,
    posterUrl: null,
  });
  return updated;
}

/**
 * 把 `Movie` 转换为 `filmbase_public_movies` 行（无 `owner_id`）。
 * 海报来源：`posterStoragePath` 优先；否则使用 `posterUrl`（外链）。
 */
function movieToPublicRecord(movie: Movie): LibraryMovieRow {
  const storagePath = movie.posterStoragePath ?? null;
  const posterFallbackPlaceholder = 'https://picsum.photos/seed/movie/400/600';
  const externalPoster = movie.posterUrl?.startsWith('http')
    && !movie.posterUrl.includes('/storage/v1/object/sign/')
    ? movie.posterUrl
    : null;

  return {
    movie_id: movie.id,
    title: movie.title ?? null,
    year: typeof movie.year === 'number' ? movie.year : null,
    genre: movie.genre ?? [],
    imdb_rating: typeof movie.imdbRating === 'number' ? movie.imdbRating : null,
    rotten_tomatoes: typeof movie.rottenTomatoes === 'number' ? movie.rottenTomatoes : null,
    personal_rating: typeof movie.personalRating === 'number' ? movie.personalRating : null,

    poster_url: storagePath ? null : externalPoster ?? posterFallbackPlaceholder,
    poster_storage_path: storagePath,

    director: movie.director ?? null,
    language: movie.language ?? null,
    runtime: movie.runtime ?? null,
    cast_members: movie.cast ?? [],
    trailer_url: movie.trailerUrl ?? null,
    date_added: movie.dateAdded
      ? new Date(movie.dateAdded).toISOString()
      : new Date().toISOString(),

    is_favorite: movie.isFavorite ?? false,
    badge: movie.badge ?? null,

    content_rating: movie.contentRating?.trim() || null,
    plot: movie.plot?.trim() || null,
    writer: movie.writer?.trim() || null,
    tagline: movie.tagline?.trim() || null,
    release_date: movie.releaseDate?.trim() || null,
    country_of_origin: movie.countryOfOrigin?.trim() || null,
    also_known_as: movie.alsoKnownAs?.length ? movie.alsoKnownAs : [],
    production_companies: movie.productionCompanies?.length ? movie.productionCompanies : [],
    box_office: movie.boxOffice?.trim() || null,
    cast_details: movie.castDetails?.length ? movie.castDetails : [],
  };
}

/**
 * 写入 / 更新共享公共片单一行。任何已登录用户都可调用（受 RLS 约束）。
 * 失败时抛错；调用方负责显示用户可见的错误。
 */
export async function upsertPublicMovie(
  supabase: SupabaseClient,
  movie: Movie
): Promise<void> {
  const record = movieToPublicRecord(movie);
  const { error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .upsert(record, { onConflict: 'movie_id' });
  if (error) throw error;
}

/**
 * 仅更新公共行的 `trailer_url`。比 full upsert 更轻、且不会覆盖其它字段。
 */
export async function updatePublicMovieTrailerUrl(
  supabase: SupabaseClient,
  movieId: string,
  trailerUrl: string
): Promise<void> {
  const { error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .update({ trailer_url: trailerUrl })
    .eq('movie_id', movieId);
  if (error) throw error;
}

/**
 * 仅更新公共行的海报字段（`poster_storage_path` / `poster_url`）。
 * `storagePath` 非空时优先使用 storage 路径；否则使用外链 `posterUrl`。
 */
export async function updatePublicMoviePoster(
  supabase: SupabaseClient,
  movieId: string,
  args: { storagePath?: string | null; posterUrl?: string | null }
): Promise<void> {
  const storagePath = args.storagePath?.trim() || null;
  const posterUrl = args.posterUrl?.trim() || null;
  const { error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .update({
      poster_storage_path: storagePath,
      poster_url: storagePath ? null : posterUrl,
    })
    .eq('movie_id', movieId);
  if (error) throw error;
}

/**
 * 删除共享公共片单中的某行。注意：此操作对所有用户可见。
 * 不会清理 Storage 中的共享海报对象，避免误删其它仍在使用的资源。
 */
export async function deletePublicMovie(
  supabase: SupabaseClient,
  movieId: string
): Promise<void> {
  const { error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .delete()
    .eq('movie_id', movieId);
  if (error) throw error;
}

/**
 * 上传原始海报文件到共享路径，并回填 signed URL + storage path。
 *
 * Storage 路径：`shared/{movieId}/poster.jpg`，与具体用户 uid 解耦，
 * 便于其它用户读取同一对象并显示同一张海报。
 *
 * 注意：bucket 仍为私有；需要 Storage 策略允许已认证用户读 `shared/*`。
 */
export async function uploadPublicPosterFileAndSign(
  supabase: SupabaseClient,
  movieId: string,
  file: File
): Promise<{ posterStoragePath: string; signedPosterUrl: string }> {
  const allowed = new Set(['image/jpeg', 'image/png', 'image/webp']);
  if (!allowed.has(file.type)) {
    throw new Error('Unsupported image type. Please upload JPEG, PNG, or WebP.');
  }

  const path = publicPosterStoragePath(movieId);

  const { error: uploadError } = await supabase.storage
    .from(POSTERS_BUCKET)
    .upload(path, file, {
      contentType: file.type || 'image/jpeg',
      upsert: true,
    });
  if (uploadError) throw uploadError;

  signedUrlCache.delete(path);
  const signedUrl = await storagePathToSignedUrl(supabase, path);
  const cacheBusted = withCacheBuster(signedUrl, Date.now());
  return { posterStoragePath: path, signedPosterUrl: cacheBusted };
}

/**
 * 按 `movie_id` 拉取一条公共行并 hydrate（处理 storage 海报签名）。
 * 用于 realtime INSERT/UPDATE 后，把单条行同步到 UI。
 */
export async function loadPublicMovieById(
  supabase: SupabaseClient,
  movieId: string
): Promise<Movie | null> {
  const { data, error } = await supabase
    .from(PUBLIC_MOVIES_TABLE)
    .select(LIBRARY_MOVIE_SELECT_COLUMNS)
    .eq('movie_id', movieId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const rows = [data as unknown as LibraryMovieRow];
  const movies = await hydrateMoviesFromLibraryRows(supabase, rows);
  return movies[0] ?? null;
}

type PublicMoviesRealtimeHandlers = {
  onUpsert: (movie: Movie) => void;
  onDelete: (movieId: string) => void;
  onError?: (err: unknown) => void;
};

/**
 * 订阅 `filmbase_public_movies` 行变更。返回的 `unsubscribe` 用于断开。
 * INSERT/UPDATE 自动按 `movie_id` 拉取最新行并 hydrate；DELETE 仅返回 `movie_id`。
 *
 * 注意：需要在 Supabase 控制台为该表开启 Realtime（通常默认开启）。
 */
export function subscribeToPublicMovies(
  supabase: SupabaseClient,
  handlers: PublicMoviesRealtimeHandlers
): () => void {
  let channel: RealtimeChannel | null = null;
  try {
    channel = supabase
      .channel('public:filmbase_public_movies')
      .on(
        'postgres_changes' as never,
        { event: '*', schema: 'public', table: PUBLIC_MOVIES_TABLE },
        (payload: {
          eventType?: 'INSERT' | 'UPDATE' | 'DELETE';
          new?: Record<string, unknown>;
          old?: Record<string, unknown>;
        }) => {
          void (async () => {
            try {
              if (payload.eventType === 'DELETE') {
                const oldId =
                  typeof payload.old?.movie_id === 'string' ? payload.old.movie_id : null;
                if (oldId) handlers.onDelete(oldId);
                return;
              }
              const newId =
                typeof payload.new?.movie_id === 'string' ? payload.new.movie_id : null;
              if (!newId) return;
              const movie = await loadPublicMovieById(supabase, newId);
              if (movie) handlers.onUpsert(movie);
            } catch (err) {
              handlers.onError?.(err);
            }
          })();
        }
      )
      .subscribe();
  } catch (err) {
    handlers.onError?.(err);
  }

  return () => {
    if (channel) {
      try {
        void supabase.removeChannel(channel);
      } catch {
        /* ignore */
      }
    }
  };
}

/**
 * 把当前匿名用户的 `filmbase_saved_movies` 数据合并迁移到 `filmbase_public_movies`。
 * - 标记保存在 localStorage：`filmbase_saved_to_public_migrated_v1_<uid>`，幂等。
 * - 字段合并规则：
 *   - 公共行 **存在** 时，仅以 saved 中**非空**字段覆盖公共行的**空字段**。
 *   - 公共行 **不存在** 时，直接以 saved 行写入（保留高分辨率海报路径与外链）。
 *   - `personal_rating` 与 `is_favorite` 取较大值（0/false 不覆盖非 0/true）。
 *   - 数组字段（cast / castDetails / alsoKnownAs / productionCompanies / genre）：取较长者。
 *
 * 失败时整体抛错；调用方决定是否吞错（迁移不应阻塞 UI 加载）。
 */
export async function migrateSavedMoviesToPublic(
  supabase: SupabaseClient,
  uid: string
): Promise<{ migrated: number; merged: number; skipped: number }> {
  const markerKey = `${LOCALSTORAGE_SAVED_TO_PUBLIC_MARKER}_${uid}`;
  if (typeof localStorage !== 'undefined' && localStorage.getItem(markerKey) === 'true') {
    return { migrated: 0, merged: 0, skipped: 0 };
  }

  const { data: savedData, error: savedErr } = await supabase
    .from(SAVED_MOVIES_TABLE)
    .select(['owner_id', LIBRARY_MOVIE_SELECT_COLUMNS].join(','))
    .eq('owner_id', uid);
  if (savedErr) throw savedErr;

  const savedRows = ((savedData ?? []) as unknown as SavedMovieRow[]).map(
    ({ owner_id: _ownerId, ...rest }) => rest as LibraryMovieRow
  );
  if (!savedRows.length) {
    if (typeof localStorage !== 'undefined') localStorage.setItem(markerKey, 'true');
    return { migrated: 0, merged: 0, skipped: 0 };
  }

  const ids = savedRows.map((r) => r.movie_id).filter((s): s is string => !!s);
  let publicByIdMap = new Map<string, LibraryMovieRow>();
  if (ids.length) {
    const { data: publicData, error: publicErr } = await supabase
      .from(PUBLIC_MOVIES_TABLE)
      .select(LIBRARY_MOVIE_SELECT_COLUMNS)
      .in('movie_id', ids);
    if (publicErr) throw publicErr;
    publicByIdMap = new Map(
      ((publicData ?? []) as unknown as LibraryMovieRow[]).map((r) => [r.movie_id, r])
    );
  }

  let migrated = 0;
  let merged = 0;
  let skipped = 0;

  for (const saved of savedRows) {
    const existing = publicByIdMap.get(saved.movie_id) ?? null;
    const recordToWrite = mergeSavedRowIntoPublic(saved, existing);
    if (!recordToWrite) {
      skipped++;
      continue;
    }
    const { error: upErr } = await supabase
      .from(PUBLIC_MOVIES_TABLE)
      .upsert(recordToWrite, { onConflict: 'movie_id' });
    if (upErr) throw upErr;
    if (existing) merged++;
    else migrated++;
  }

  if (typeof localStorage !== 'undefined') localStorage.setItem(markerKey, 'true');
  return { migrated, merged, skipped };
}

/**
 * 合并 saved → public 的字段策略：保守，绝不用空覆盖非空。
 * 返回 `null` 表示无任何变化（仅在公共行已包含 saved 全部非空字段时）。
 */
function mergeSavedRowIntoPublic(
  saved: LibraryMovieRow,
  existing: LibraryMovieRow | null
): LibraryMovieRow | null {
  const isNonEmptyText = (v: string | null | undefined) =>
    typeof v === 'string' && v.trim().length > 0;
  const isNonEmptyArr = <T,>(v: T[] | null | undefined) =>
    Array.isArray(v) && v.length > 0;
  const preferNonEmptyStr = (a: string | null | undefined, b: string | null | undefined) =>
    isNonEmptyText(a) ? a! : isNonEmptyText(b) ? b! : null;
  const preferLongerArr = <T,>(a: T[] | null | undefined, b: T[] | null | undefined) => {
    const al = isNonEmptyArr(a) ? a!.length : 0;
    const bl = isNonEmptyArr(b) ? b!.length : 0;
    return al >= bl ? (isNonEmptyArr(a) ? a! : []) : isNonEmptyArr(b) ? b! : [];
  };
  const preferNumberMax = (a: number | null | undefined, b: number | null | undefined) => {
    const av = typeof a === 'number' && Number.isFinite(a) ? a : null;
    const bv = typeof b === 'number' && Number.isFinite(b) ? b : null;
    if (av == null) return bv;
    if (bv == null) return av;
    return Math.max(av, bv);
  };
  const preferTrueOrA = (a: boolean | null | undefined, b: boolean | null | undefined) => {
    if (a === true || b === true) return true;
    return a ?? b ?? false;
  };

  if (!existing) {
    return saved;
  }

  const next: LibraryMovieRow = {
    movie_id: existing.movie_id,
    title: preferNonEmptyStr(existing.title, saved.title),
    year:
      typeof existing.year === 'number' && existing.year > 0
        ? existing.year
        : typeof saved.year === 'number' && saved.year > 0
          ? saved.year
          : existing.year ?? saved.year ?? null,
    genre: preferLongerArr(existing.genre, saved.genre),
    imdb_rating:
      typeof existing.imdb_rating === 'number' && existing.imdb_rating > 0
        ? existing.imdb_rating
        : typeof saved.imdb_rating === 'number' && saved.imdb_rating > 0
          ? saved.imdb_rating
          : existing.imdb_rating ?? saved.imdb_rating ?? null,
    rotten_tomatoes:
      typeof existing.rotten_tomatoes === 'number' && existing.rotten_tomatoes > 0
        ? existing.rotten_tomatoes
        : typeof saved.rotten_tomatoes === 'number' && saved.rotten_tomatoes > 0
          ? saved.rotten_tomatoes
          : existing.rotten_tomatoes ?? saved.rotten_tomatoes ?? null,
    personal_rating: preferNumberMax(existing.personal_rating, saved.personal_rating),

    poster_url: preferNonEmptyStr(existing.poster_url, saved.poster_url),
    poster_storage_path: preferNonEmptyStr(
      existing.poster_storage_path,
      saved.poster_storage_path
    ),

    director: preferNonEmptyStr(existing.director, saved.director),
    language: preferNonEmptyStr(existing.language, saved.language),
    runtime: preferNonEmptyStr(existing.runtime, saved.runtime),
    cast_members: preferLongerArr(existing.cast_members, saved.cast_members),
    trailer_url: preferNonEmptyStr(existing.trailer_url, saved.trailer_url),
    date_added: existing.date_added ?? saved.date_added ?? null,

    is_favorite: preferTrueOrA(existing.is_favorite, saved.is_favorite),
    badge: preferNonEmptyStr(existing.badge, saved.badge),

    content_rating: preferNonEmptyStr(existing.content_rating, saved.content_rating),
    plot: preferNonEmptyStr(existing.plot, saved.plot),
    writer: preferNonEmptyStr(existing.writer, saved.writer),
    tagline: preferNonEmptyStr(existing.tagline, saved.tagline),
    release_date: preferNonEmptyStr(existing.release_date, saved.release_date),
    country_of_origin: preferNonEmptyStr(existing.country_of_origin, saved.country_of_origin),
    also_known_as: preferLongerArr(existing.also_known_as, saved.also_known_as),
    production_companies: preferLongerArr(
      existing.production_companies,
      saved.production_companies
    ),
    box_office: preferNonEmptyStr(existing.box_office, saved.box_office),
    cast_details: preferLongerArr(existing.cast_details, saved.cast_details),
  };

  return next;
}

