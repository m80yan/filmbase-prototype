/** 与 `filmbase_*` 表 `cast_details` JSON 及 Edge enrich 返回结构一致。 */
export type MovieCastDetail = { name: string; character: string };

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

  /** 以下字段来自 enrich / DB；旧 seed 可无。 */
  contentRating?: string;
  plot?: string;
  writer?: string;
  tagline?: string;
  releaseDate?: string;
  countryOfOrigin?: string;
  alsoKnownAs?: string[];
  productionCompanies?: string[];
  boxOffice?: string;
  castDetails?: MovieCastDetail[];
}

export type FilterType = 'genre' | 'year' | 'rating';
