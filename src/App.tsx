import React, { useState, useMemo, useRef } from 'react';
import { 
  Search, 
  ChevronDown, 
  ChevronRight,
  Grid, 
  List, 
  Star, 
  Clock, 
  Film, 
  Library,
  Filter,
  Settings,
  Check,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MOCK_MOVIES } from './constants';
import { Movie } from './types';

export default function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [movies, setMovies] = useState<Movie[]>(MOCK_MOVIES);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedRatings, setSelectedRatings] = useState<number[]>([]);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [posterSize, setPosterSize] = useState(160);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [modalMode, setModalMode] = useState<'trailer' | 'poster'>('trailer');
  const [sortMode, setSortMode] = useState<'title-asc' | 'title-desc' | 'duration-desc' | 'duration-asc' | 'imdb-asc' | 'imdb-desc' | 'rt-asc' | 'rt-desc' | 'personal-asc' | 'personal-desc'>('title-asc');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    genre: true,
    year: false,
    ratings: true
  });

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const allUniqueGenres = useMemo(() => {
    const set = new Set<string>();
    MOCK_MOVIES.forEach(m => m.genre.forEach(g => set.add(g)));
    return Array.from(set).sort();
  }, []);

  const genres = allUniqueGenres;
  const years = ['2020s', '2010s', '2000s', '1990s', 'Classic'];
  const ratings = [5, 4, 3, 2, 1];

  const toggleFilter = <T,>(list: T[], item: T, setList: (val: T[]) => void) => {
    if (list.includes(item)) {
      setList(list.filter(i => i !== item));
    } else {
      setList([...list, item]);
    }
  };

  const handleRatingChange = (movieId: string, newRating: number) => {
    setMovies(prev => prev.map(m => m.id === movieId ? { ...m, personalRating: newRating } : m));
  };

  const resetFilters = () => {
    setSelectedGenres([]);
    setSelectedYears([]);
    setSelectedRatings([]);
    setSearchQuery('');
  };

  const filteredMovies = useMemo(() => {
    const filtered = movies.filter(movie => {
      const matchesSearch = movie.title.toLowerCase().includes(searchQuery.toLowerCase());
      
      const matchesGenre = selectedGenres.length === 0 || movie.genre.some(g => selectedGenres.includes(g));
      
      const matchesRating = selectedRatings.length === 0 || selectedRatings.includes(movie.personalRating);

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

  const Checkbox = ({ checked, label, onClick }: { checked: boolean, label: string | React.ReactNode, onClick: () => void }) => (
    <button 
      onClick={onClick}
      className="flex items-center gap-3 w-full px-3 py-1.5 rounded-md text-base transition-colors group text-left"
    >
      <div className={`w-4 h-4 rounded border flex-shrink-0 flex items-center justify-center transition-all ${
        checked ? 'bg-white border-white text-black' : 'border-white/20 group-hover:border-white/40'
      }`}>
        {checked && <Check size={12} strokeWidth={4} />}
      </div>
      <span className={`transition-colors ${checked ? 'text-white' : 'text-white/60 group-hover:text-white'}`}>
        {label}
      </span>
    </button>
  );

  return (
    <div className="flex h-screen w-full bg-[#121212] overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-r border-white/5 sidebar-gradient">
        <div className="p-6">
          <div className="flex items-center gap-2 mb-8">
            <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
            <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
            <div className="w-3 h-3 rounded-full bg-[#28c840]" />
          </div>

          <nav className="space-y-6">
            <div>
              <button 
                onClick={() => toggleSection('genre')}
                className="flex items-center justify-between w-full text-sm font-semibold text-white/40 uppercase tracking-wider mb-3 group hover:text-white/60 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: expandedSections.genre ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight size={14} />
                  </motion.div>
                  Genre
                </span>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.genre ? 'auto' : 0,
                  opacity: expandedSections.genre ? 1 : 0,
                  marginBottom: expandedSections.genre ? 12 : 0
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <ul className="space-y-0.5">
                  {genres.map(genre => (
                    <li key={genre}>
                      <Checkbox 
                        label={genre}
                        checked={selectedGenres.includes(genre)}
                        onClick={() => toggleFilter(selectedGenres, genre, setSelectedGenres)}
                      />
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>

            <div>
              <button 
                onClick={() => toggleSection('year')}
                className="flex items-center justify-between w-full text-sm font-semibold text-white/40 uppercase tracking-wider mb-3 group hover:text-white/60 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: expandedSections.year ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight size={14} />
                  </motion.div>
                  Year
                </span>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.year ? 'auto' : 0,
                  opacity: expandedSections.year ? 1 : 0,
                  marginBottom: expandedSections.year ? 12 : 0
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <ul className="space-y-0.5">
                  {years.map(year => (
                    <li key={year}>
                      <Checkbox 
                        label={year}
                        checked={selectedYears.includes(year)}
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
                className="flex items-center justify-between w-full text-sm font-semibold text-white/40 uppercase tracking-wider mb-3 group hover:text-white/60 transition-colors"
              >
                <span className="flex items-center gap-2">
                  <motion.div
                    animate={{ rotate: expandedSections.ratings ? 90 : 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <ChevronRight size={14} />
                  </motion.div>
                  Ratings
                </span>
              </button>
              <motion.div
                initial={false}
                animate={{ 
                  height: expandedSections.ratings ? 'auto' : 0,
                  opacity: expandedSections.ratings ? 1 : 0,
                  marginBottom: expandedSections.ratings ? 12 : 0
                }}
                transition={{ duration: 0.3, ease: "easeInOut" }}
                className="overflow-hidden"
              >
                <ul className="space-y-0.5">
                  {ratings.map(rating => (
                    <li key={rating}>
                      <Checkbox 
                        label={`${rating} ${rating === 1 ? 'star' : 'stars'}`}
                        checked={selectedRatings.includes(rating)}
                        onClick={() => toggleFilter(selectedRatings, rating, setSelectedRatings)}
                      />
                    </li>
                  ))}
                </ul>
              </motion.div>
            </div>
          </nav>
        </div>

        <div className="mt-auto border-t border-white/5 pt-4 p-4">
          <button 
            onClick={resetFilters}
            className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-base text-white/60 hover:bg-white/5 transition-colors"
          >
            <Film size={18} />
            All Films
          </button>
          <button className="flex items-center gap-3 w-full px-3 py-2 rounded-lg text-base text-white/60 hover:bg-white/5 transition-colors">
            <Clock size={18} />
            Recently Added
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="h-14 flex items-center justify-between px-8 border-b border-white/10 bg-[#121212]/60 backdrop-blur-xl sticky top-0 z-50">
          <div className="flex items-center gap-4">
            <h1 className="text-xl font-bold tracking-tight text-white">FilmBase</h1>
          </div>

          <div className="flex items-center gap-6">
            <div className="relative group">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20 group-focus-within:text-white/60 transition-colors" size={14} />
              <input 
                ref={searchInputRef}
                type="text" 
                placeholder="Search films..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white/5 border border-white/10 rounded-full py-1.5 pl-9 pr-9 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-white/10 focus:bg-white/10 transition-all placeholder:text-white/20"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/80 transition-colors p-0.5"
                  title="Clear search"
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </header>

        {/* Toolbar */}
        <div className="px-8 py-4 flex items-center justify-between border-b border-white/5 bg-[#121212]/50">
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setViewMode('grid')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
            >
              <Grid size={18} />
            </button>
            <button 
              onClick={() => setViewMode('list')}
              className={`p-2 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
            >
              <List size={18} />
            </button>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <input 
                type="range" 
                min="120" 
                max="240" 
                value={posterSize}
                disabled={viewMode === 'list'}
                onChange={(e) => setPosterSize(Number(e.target.value))}
                className="w-32 accent-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
              />
              <span className={`text-sm font-medium uppercase tracking-wider flex items-center gap-2 transition-opacity ${viewMode === 'list' ? 'opacity-30' : 'text-white/40'}`}>
                <Filter size={12} />
                Poster Size
              </span>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className={`flex-1 overflow-y-auto px-8 pb-8 ${viewMode === 'list' ? 'pt-0' : 'pt-4'}`}>
          {viewMode === 'list' && filteredMovies.length > 0 && (
            <div className="sticky top-0 z-[70] bg-[#121212] py-4 border-b border-white/5">
              <div className="grid grid-cols-[80px_3.5fr_120px_1.5fr_2.5fr_80px_80px_140px] gap-x-4 px-3 text-[12px] font-bold uppercase tracking-widest text-white/40 items-end">
                <span>Poster</span>
                <div className="relative">
                  <button 
                    onClick={() => setIsSortDropdownOpen(!isSortDropdownOpen)}
                    className={`flex items-center gap-1.5 hover:text-white transition-colors group ${sortMode.startsWith('duration') || selectedGenres.length > 0 ? 'text-white' : ''}`}
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
                          className="absolute top-full left-0 mt-3 w-48 bg-zinc-900 border border-white/10 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.5)] py-2 z-50 backdrop-blur-xl overflow-hidden"
                        >
                          <div className="px-3 py-1.5 text-[11px] text-white/20 uppercase tracking-[0.2em] font-black">Title</div>
                          {[
                            { id: 'title-asc', label: 'A-Z' },
                            { id: 'title-desc', label: 'Z-A' }
                          ].map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setSortMode(opt.id as any);
                                setIsSortDropdownOpen(false);
                              }}
                              className="flex items-center justify-between w-full px-3 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors text-left"
                            >
                              {opt.label}
                              {sortMode === opt.id && <Check size={12} className="text-white" />}
                            </button>
                          ))}

                          <div className="h-px bg-white/5 my-1.5" />
                          <div className="px-3 py-1.5 text-[11px] text-white/20 uppercase tracking-[0.2em] font-black">Duration</div>
                          {[
                            { id: 'duration-desc', label: 'Longest' },
                            { id: 'duration-asc', label: 'Shortest' }
                          ].map(opt => (
                            <button
                              key={opt.id}
                              onClick={() => {
                                setSortMode(opt.id as any);
                                setIsSortDropdownOpen(false);
                              }}
                              className="flex items-center justify-between w-full px-3 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors text-left"
                            >
                              {opt.label}
                              {sortMode === opt.id && <Check size={12} className="text-white" />}
                            </button>
                          ))}

                          <div className="h-px bg-white/5 my-1.5" />
                          <div className="px-3 py-1.5 text-[11px] text-white/20 uppercase tracking-[0.2em] font-black">Genre Filter</div>
                          {allUniqueGenres.map(genre => (
                            <button
                              key={genre}
                              onClick={() => {
                                setSelectedGenres([genre]);
                                setIsSortDropdownOpen(false);
                              }}
                              className="flex items-center justify-between w-full px-3 py-2 text-[13px] text-white/60 hover:text-white hover:bg-white/5 transition-colors text-left"
                            >
                              {genre}
                              {selectedGenres.length === 1 && selectedGenres[0] === genre && <Check size={12} className="text-white" />}
                            </button>
                          ))}
                          {selectedGenres.length > 0 && (
                            <button
                              onClick={() => {
                                setSelectedGenres([]);
                                setIsSortDropdownOpen(false);
                              }}
                              className="flex items-center justify-between w-full px-3 py-2 text-[13px] text-red-400/60 hover:text-red-400 hover:bg-white/5 transition-colors text-left border-t border-white/5 mt-1"
                            >
                              Clear Genre Filter
                            </button>
                          )}
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
                <span className="text-center">Trailer</span>
                <span>Director</span>
                <span>Cast</span>
                <button 
                  onClick={() => setSortMode(sortMode === 'imdb-desc' ? 'imdb-asc' : 'imdb-desc')}
                  className={`flex flex-col items-center gap-1 hover:text-white transition-colors ${sortMode.startsWith('imdb') ? 'text-white' : ''}`}
                >
                  <span className="bg-[#F4C434] text-black px-1 rounded-[2px] text-[11px] font-bold">IMDb</span>
                  <span className="flex items-center gap-1">
                    Score
                    {sortMode === 'imdb-asc' && <ChevronDown size={8} className="rotate-180" />}
                    {sortMode === 'imdb-desc' && <ChevronDown size={8} />}
                  </span>
                </button>
                <button 
                  onClick={() => setSortMode(sortMode === 'rt-desc' ? 'rt-asc' : 'rt-desc')}
                  className={`flex flex-col items-center gap-1 hover:text-white transition-colors ${sortMode.startsWith('rt') ? 'text-white' : ''}`}
                >
                  <span className="text-[14px] leading-none" style={{ filter: 'saturate(1.5) brightness(1.2)' }}>🍅</span>
                  <span className="flex items-center gap-1">
                    RT %
                    {sortMode === 'rt-asc' && <ChevronDown size={8} className="rotate-180" />}
                    {sortMode === 'rt-desc' && <ChevronDown size={8} />}
                  </span>
                </button>
                <button 
                  onClick={() => setSortMode(sortMode === 'personal-desc' ? 'personal-asc' : 'personal-desc')}
                  className={`flex flex-col items-center gap-0 hover:text-white transition-colors ${sortMode.startsWith('personal') ? 'text-white' : ''}`}
                >
                  <span className="text-[12px] font-bold uppercase tracking-widest">My</span>
                  <span className="flex items-center gap-1 text-[12px] font-bold uppercase tracking-widest">
                    Rating
                    {sortMode === 'personal-asc' && <ChevronDown size={8} className="rotate-180" />}
                    {sortMode === 'personal-desc' && <ChevronDown size={8} />}
                  </span>
                </button>
              </div>
            </div>
          )}
          <AnimatePresence mode="popLayout">
            <motion.div 
              layout
              className={viewMode === 'grid' ? 'grid gap-x-6 gap-y-10 pt-12' : 'flex flex-col gap-1'}
              style={viewMode === 'grid' ? { 
                gridTemplateColumns: `repeat(auto-fill, minmax(${posterSize}px, 1fr))` 
              } : {}}
            >
              {filteredMovies.map(movie => (
                <MovieCard 
                  key={movie.id} 
                  movie={movie} 
                  size={posterSize} 
                  viewMode={viewMode} 
                  onRatingChange={(rating) => handleRatingChange(movie.id, rating)}
                  onPlayTrailer={() => {
                    setSelectedMovie(movie);
                    setModalMode('trailer');
                  }}
                  onShowPoster={() => {
                    setSelectedMovie(movie);
                    setModalMode('poster');
                  }}
                />
              ))}
            </motion.div>
          </AnimatePresence>
          
          {filteredMovies.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center text-white/20 space-y-4">
              <Film size={64} strokeWidth={1} />
              <p className="text-xl font-medium">No films found matching your search</p>
            </div>
          )}
        </div>
      </main>

      {/* Modal (Trailer or Poster Lightbox) */}
      <AnimatePresence>
        {selectedMovie && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMovie(null)}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4 md:p-12 cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={() => setSelectedMovie(null)}
              className={`relative ${modalMode === 'trailer' ? 'w-full max-w-5xl aspect-video' : 'h-[80vh] aspect-[2/3]'} bg-black rounded-none overflow-hidden shadow-[0_0_100px_rgba(255,255,255,0.1)] cursor-pointer`}
            >
              {modalMode === 'trailer' ? (
                <iframe
                  src={`${selectedMovie.trailerUrl.replace('watch?v=', 'embed/')}?autoplay=1`}
                  title={`${selectedMovie.title} Trailer`}
                  className="w-full h-full border-none"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              ) : (
                <img 
                  src={selectedMovie.posterUrl} 
                  alt={selectedMovie.title}
                  className="w-full h-full object-contain"
                  referrerPolicy="no-referrer"
                />
              )}
              
              {/* Subtle gold glow behind the player */}
              <div className="absolute -inset-4 -z-10 bg-gradient-to-r from-white/5 via-white/10 to-white/5 blur-3xl opacity-50" />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

interface MovieCardProps {
  movie: Movie;
  size: number;
  viewMode: 'grid' | 'list';
  onRatingChange: (rating: number) => void;
  onPlayTrailer: () => void;
  onShowPoster: () => void;
  key?: React.Key;
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

function MovieCard({ movie, size, viewMode, onRatingChange, onPlayTrailer, onShowPoster }: MovieCardProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const titleRef = useRef<HTMLDivElement>(null);
  const castRef = useRef<HTMLDivElement>(null);
  const [isTitleOverflowing, setIsTitleOverflowing] = useState(false);
  const [isCastOverflowing, setIsCastOverflowing] = useState(false);

  React.useEffect(() => {
    const checkOverflow = () => {
      if (titleRef.current) {
        setIsTitleOverflowing(titleRef.current.scrollWidth > titleRef.current.clientWidth);
      }
      if (castRef.current) {
        setIsCastOverflowing(castRef.current.scrollWidth > castRef.current.clientWidth);
      }
    };
    
    // Small delay to ensure layout is stable
    const timer = setTimeout(checkOverflow, 50);
    window.addEventListener('resize', checkOverflow);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', checkOverflow);
    };
  }, [movie.title, movie.cast, size, viewMode]);

  const ratingLabels: Record<number, string> = {
    1: 'Awful',
    2: 'Bad',
    3: 'Okay',
    4: 'Recommended',
    5: 'Excellent',
  };

  const currentRating = hoverRating !== null ? hoverRating : movie.personalRating;

  const StarRating = ({ align = 'start' }: { align?: 'start' | 'center' }) => (
    <div className={`flex flex-col ${align === 'center' ? 'items-center' : 'items-start'} gap-1`}>
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <button
            key={i}
            onMouseEnter={() => setHoverRating(i + 1)}
            onMouseLeave={() => setHoverRating(null)}
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
      <div className="h-3 flex items-center justify-center">
        <AnimatePresence>
          {hoverRating !== null && (
            <motion.span 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="text-[10px] tracking-[0.1em] whitespace-nowrap text-[#D4AF37] font-bold uppercase"
            >
              {ratingLabels[hoverRating]}
            </motion.span>
          )}
        </AnimatePresence>
      </div>
    </div>
  );

  if (viewMode === 'list') {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        className="group grid grid-cols-[80px_3.5fr_120px_1.5fr_2.5fr_80px_80px_140px] gap-x-4 items-center p-3 rounded-none hover:bg-white/5 transition-colors cursor-pointer"
      >
        <div 
          className="w-16 h-24 rounded-none flex-shrink-0 shadow-lg cursor-zoom-in relative group-hover:z-10 transition-all duration-300 group-hover:scale-115 origin-center"
          onClick={(e) => {
            e.stopPropagation();
            onShowPoster();
          }}
        >
          <img 
            src={movie.posterUrl} 
            alt={movie.title} 
            className="w-full h-full object-cover"
            referrerPolicy="no-referrer"
          />
        </div>
        
        <div className="min-w-0">
          <h3 className="font-semibold text-lg text-white/90 group-hover:text-white transition-colors leading-tight">
            {movie.title}
          </h3>
          <div className="flex items-center gap-1.5 mt-1 text-[13px] text-white/60 font-medium tracking-wide">
            <span>{movie.runtime}</span>
            <span className="text-white/20">•</span>
            <span className="text-white/40 uppercase tracking-widest">{movie.genre.join(', ')}</span>
          </div>
        </div>

        <div className="flex justify-center">
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrailer();
            }}
            className="opacity-0 group-hover:opacity-100 transition-all bg-white/80 hover:bg-white text-black text-[11px] font-bold px-4 py-1.5 rounded-full uppercase tracking-widest whitespace-nowrap z-10 shadow-xl"
          >
            Play Trailer
          </button>
        </div>

        <div className="text-[13px] text-white/60 group-hover:text-white transition-colors truncate">
          {formatDirectorName(movie.director)}
        </div>

        <div className="relative h-14 overflow-hidden text-[13px] text-white/60 group-hover:text-white transition-colors leading-relaxed">
          <div className="group-hover:animate-marquee-vertical flex flex-col gap-1 py-1">
            {movie.cast.map((actor, idx) => (
              <span key={idx} className="truncate block">{actor}</span>
            ))}
            {/* Duplicate for seamless scroll */}
            {movie.cast.map((actor, idx) => (
              <span key={`dup-${idx}`} className="truncate block">{actor}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center text-[13px] text-white/60 group-hover:text-white transition-colors font-medium tabular-nums">
          {movie.imdbRating}
        </div>

        <div className="flex items-center justify-center text-[13px] text-white/60 group-hover:text-white transition-colors font-medium tabular-nums">
          {movie.rottenTomatoes}%
        </div>

        <div className="flex items-center justify-center h-full pt-[4px]">
          <StarRating align="center" />
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div 
      layout
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.9 }}
      className="group cursor-pointer"
    >
      <div className="relative aspect-[2/3] rounded-xl group-hover:rounded-none overflow-hidden mb-3 shadow-2xl transition-all duration-300 ease-out origin-bottom group-hover:scale-115 group-hover:-translate-y-1 border-none">
        <img 
          src={movie.posterUrl} 
          alt={movie.title}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        
        {/* Hover Metadata Overlay */}
        <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-4 space-y-2">
          <div className="space-y-1 text-sm tracking-tight leading-relaxed font-medium text-white/60 group-hover:text-white">
            <div className="pb-1">
              <span className="truncate block">{formatDirectorName(movie.director)}</span>
            </div>
            <div className="pb-1">
              <span className="truncate block">{movie.genre.join(', ')}</span>
            </div>
            <div className="pb-1">
              <span className="truncate block">{movie.runtime}</span>
            </div>
            <div className="pt-1 overflow-hidden">
              <div ref={castRef} className="relative w-full overflow-hidden h-4">
                <div className={`whitespace-nowrap flex gap-4 ${isCastOverflowing ? 'animate-marquee' : ''}`}>
                  <span>{movie.cast.join(' • ')}</span>
                  {isCastOverflowing && <span>{movie.cast.join(' • ')}</span>}
                </div>
              </div>
            </div>
          </div>
          
          <button 
            onClick={(e) => {
              e.stopPropagation();
              onPlayTrailer();
            }}
            className="w-full py-2.5 mt-2 rounded-full bg-white text-black font-bold text-[12px] tracking-widest transform translate-y-4 group-hover:translate-y-0 transition-transform duration-500"
          >
            Play Trailer
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <div className="relative h-6 overflow-hidden">
          <div 
            ref={titleRef} 
            className={`font-semibold text-base transition-colors tracking-wide whitespace-nowrap ${isTitleOverflowing ? 'group-hover:opacity-0' : 'truncate group-hover:text-white'}`}
          >
            {movie.title}
          </div>
          
          {isTitleOverflowing && (
            <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <div className="flex animate-marquee-slow gap-8 whitespace-nowrap font-semibold text-base text-white tracking-wide">
                <span>{movie.title}</span>
                <span>{movie.title}</span>
              </div>
            </div>
          )}
        </div>
        
        <div className="flex flex-col gap-1.5 text-sm text-white/60 group-hover:text-white transition-colors font-medium tracking-wider">
          <div className="flex items-center justify-between h-6">
            <div className="flex items-center gap-1.5">
              <span className="hidden group-hover:inline-block bg-[#F4C434] text-black font-bold px-1 rounded-[2px] text-[11px] leading-tight">IMDb</span>
              <span className="flex items-baseline gap-1">
                {movie.imdbRating}
                <span className="group-hover:hidden text-[10px] opacity-60">IMDb</span>
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="hidden group-hover:inline-block text-[13px] leading-tight" style={{ filter: 'saturate(1.5) brightness(1.2)' }}>🍅</span>
              <span className="flex items-baseline gap-1">
                {movie.rottenTomatoes}%
                <span className="group-hover:hidden text-[10px] opacity-60">RT</span>
              </span>
            </div>
          </div>
          
          <div className="pt-1 flex items-baseline">
            <StarRating align="start" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
