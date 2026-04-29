import type { SupabaseClient } from '@supabase/supabase-js';
import type { Movie } from '../types';

const SAVED_MOVIES_TABLE = 'filmbase_saved_movies';
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
};

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
    const resolved = await p;
    signedUrlCache.set(storagePath, {
      signedUrl: resolved,
      expiresAtMs: Date.now() + SIGNED_URL_TTL_SECONDS * 1000,
    });
    return resolved;
  }

  const existingPromise = signedUrlCache.get(storagePath)?.promise;
  if (!existingPromise) throw new Error('Unexpected signed URL cache state.');
  return existingPromise;
}

function rowToMovieBase(row: SavedMovieRow): Movie {
  // 如果 poster_storage_path 不存在，将来合并时可能由 seed 覆盖，
  // 但 UI 合同要求 posterUrl 必须是字符串，所以我们给一个兜底。
  const posterUrlFallback = 'https://picsum.photos/seed/movie/400/600';

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
    cast: row.cast_members ?? [],
    trailerUrl: row.trailer_url ?? '',

    badge: row.badge ?? undefined,
    isFavorite: row.is_favorite ?? false,

    // 最近添加：UI 用 dateAdded 与 24h 比较；这里把 timestamptz 转为 ms
    dateAdded: row.date_added ? new Date(row.date_added).getTime() : Date.now(),

    // seed 使用的字段；这两个字段在 UI 里主要受 dateAdded 影响
    isRecentlyAdded: undefined,

    // 额外字段（可选）用于后续写操作：当海报来自 Storage 时保留它
    posterStoragePath: row.poster_storage_path ?? undefined,
  };
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
    .select(
      [
        'owner_id',
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
      ].join(',')
    );

  if (error) throw error;

  const rows = (data ?? []) as unknown as SavedMovieRow[];

  const movies: Movie[] = [];
  for (const row of rows) {
    const movie = rowToMovieBase(row);
    if (row.poster_storage_path) {
      const signedUrl = await storagePathToSignedUrl(supabase, row.poster_storage_path);
      movie.posterUrl = posterUrlForUIFromSignedUrl(signedUrl);
      movie.posterStoragePath = row.poster_storage_path;
    } else if (row.poster_url) {
      movie.posterUrl = row.poster_url;
      movie.posterStoragePath = undefined;
    } else {
      // leave fallback as-is
      movie.posterStoragePath = undefined;
    }

    // 让 UI 的 Recently Added 逻辑继续可用（基于 dateAdded）
    movie.isRecentlyAdded = Date.now() - (movie.dateAdded ?? 0) < 86400000;
    movies.push(movie);
  }

  return movies;
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

  const signedUrl = await storagePathToSignedUrl(supabase, path);
  return { posterStoragePath: path, signedPosterUrl: signedUrl };
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

