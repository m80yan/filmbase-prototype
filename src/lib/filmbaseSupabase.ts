import type { SupabaseClient } from '@supabase/supabase-js';
import type { Movie, MovieCastDetail } from '../types';

const SAVED_MOVIES_TABLE = 'filmbase_saved_movies';
/** 公共 demo 片单（列与 `filmbase_saved_movies` 一致，但无 `owner_id`） */
const PUBLIC_MOVIES_TABLE = 'filmbase_public_movies';
const POSTERS_BUCKET = 'filmbase-posters';
const SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour
const LOCALSTORAGE_MIGRATION_MARKER = 'filmbase_supabase_migrated_v1';

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

