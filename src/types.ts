export interface Movie {
  id: string;
  title: string;
  year: number;
  genre: string[];
  imdbRating: number;
  rottenTomatoes: number;
  personalRating: number;
  posterUrl: string;
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
