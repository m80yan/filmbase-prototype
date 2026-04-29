export interface Movie {
  id: string;
  title: string;
  year: number;
  genre: string[];
  imdbRating: number;
  rottenTomatoes: number;
  personalRating: number;
  posterUrl: string;
  /**
   * 当海报来自 Supabase Storage 私有 bucket 时，保存真实 storage 路径。
   * 用于后续写操作时正确更新 `poster_storage_path`，UI 仍只使用 `posterUrl`。
   */
  posterStoragePath?: string;
  badge?: string;
  isFavorite: boolean;
  director: string;
  language: string;
  runtime: string;
  cast: string[];
  trailerUrl: string;
  dateAdded?: string | number;
  isRecentlyAdded?: boolean;
}

export type FilterType = 'genre' | 'year' | 'rating';
