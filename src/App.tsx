import React, { useState, useMemo, useRef, useEffect } from 'react';
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
  X,
  Plus,
  Minus,
  PanelLeft
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MOCK_MOVIES } from './constants';
import { Movie } from './types';

export default function App() {
  const searchInputRef = useRef<HTMLInputElement>(null);
  const trailerIframeRef = useRef<HTMLIFrameElement>(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [movies, setMovies] = useState<Movie[]>(() => {
    const saved = localStorage.getItem('filmbase_movies');
    if (saved) return JSON.parse(saved);
    
    const purgeTitles = ['Avatar', 'Blade Runner 2049', 'Dune: Part One'];
    return MOCK_MOVIES.filter(m => !purgeTitles.includes(m.title));
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedGenres, setSelectedGenres] = useState<string[]>([]);
  const [selectedYears, setSelectedYears] = useState<string[]>([]);
  const [selectedRatings, setSelectedRatings] = useState<number[]>([]);
  const [isRecentlyAddedFilter, setIsRecentlyAddedFilter] = useState(false);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [posterSize, setPosterSize] = useState(160);
  const [selectedMovie, setSelectedMovie] = useState<Movie | null>(null);
  const [modalMode, setModalMode] = useState<'trailer' | 'poster'>('trailer');
  const [sortMode, setSortMode] = useState<'title-asc' | 'title-desc' | 'duration-desc' | 'duration-asc' | 'imdb-asc' | 'imdb-desc' | 'rt-asc' | 'rt-desc' | 'personal-asc' | 'personal-desc'>('title-asc');
  const [isSortDropdownOpen, setIsSortDropdownOpen] = useState(false);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [newMovieTitle, setNewMovieTitle] = useState('');
  const [newMovieUrl, setNewMovieUrl] = useState('');
  const [isImdbEntered, setIsImdbEntered] = useState(false);
  const [newMovieTrailerUrl, setNewMovieTrailerUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [expandedSections, setExpandedSections] = useState({
    genre: true,
    year: false,
    ratings: true
  });

  useEffect(() => {
    if (!selectedMovie && trailerIframeRef.current) {
      trailerIframeRef.current.src = '';
    }
  }, [selectedMovie]);

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

  const toggleSection = (section: keyof typeof expandedSections) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const allUniqueGenres = useMemo(() => {
    const set = new Set<string>();
    movies.forEach(m => m.genre.forEach(g => set.add(g)));
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
    setMovies(prev => {
      const updated = prev.filter(m => m.id !== movie.id);
      localStorage.setItem('filmbase_movies', JSON.stringify(updated));
      return updated;
    });
  };

  const handleRatingChange = (movieId: string, newRating: number) => {
    setMovies(prev => {
      const updated = prev.map(m => m.id === movieId ? { ...m, personalRating: newRating } : m);
      localStorage.setItem('filmbase_movies', JSON.stringify(updated));
      return updated;
    });
  };

  const handleAddMovie = async () => {
    if (!newMovieUrl.trim() || !newMovieTrailerUrl.trim()) return;
    
    setAddError('');
    setIsAdding(true);

    const imdbIdMatch = newMovieUrl.match(/tt\d+/);
    if (!imdbIdMatch) {
      setAddError("Please enter a valid IMDb URL containing 'tt...'");
      setIsAdding(false);
      return;
    }
    const imdbId = imdbIdMatch[0];
    
    try {
      const response = await fetch(`https://www.omdbapi.com/?i=${imdbId}&apikey=d18fbebc`);
      const data = await response.json();
      
      if (data.Response === "False") {
        setAddError(data.Error || "Failed to fetch movie data");
        setIsAdding(false);
        return;
      }
      
      const trailerUrl = getYouTubeEmbedUrl(newMovieTrailerUrl.trim());

      const newMovie: Movie = {
        id: Math.random().toString(36).substr(2, 9),
        title: data.Title,
        year: parseInt(data.Year),
        genre: data.Genre.split(', ').map((g: string) => g.trim()),
        director: data.Director,
        cast: data.Actors.split(', ').map((a: string) => a.trim()).slice(0, 7),
        imdbRating: parseFloat(data.imdbRating) || 0,
        rottenTomatoes: parseInt(data.Ratings.find((r: any) => r.Source === "Rotten Tomatoes")?.Value) || 0,
        personalRating: 0,
        runtime: data.Runtime,
        posterUrl: data.Poster !== "N/A" ? data.Poster : 'https://picsum.photos/seed/movie/400/600',
        trailerUrl: trailerUrl,
        isFavorite: false,
        language: data.Language,
        isRecentlyAdded: true,
        dateAdded: Date.now()
      };
      
      setMovies(prev => {
        const updated = [newMovie, ...prev];
        localStorage.setItem('filmbase_movies', JSON.stringify(updated));
        return updated;
      });

      setIsAddModalOpen(false);
      setNewMovieTitle('');
      setNewMovieUrl('');
      setNewMovieTrailerUrl('');
    } catch (error) {
      console.error("Error fetching from OMDb:", error);
      setAddError("Failed to fetch movie data. Please check your connection.");
    } finally {
      setIsAdding(false);
    }
  };

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
      
      const matchesGenre = selectedGenres.length === 0 || movie.genre.some(g => selectedGenres.includes(g));
      
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

  const SidebarItem = ({ active, label, onClick }: { active: boolean, label: string | React.ReactNode, onClick: () => void }) => (
    <button 
      onClick={onClick}
      className={`flex items-center w-full px-2.5 py-1.5 rounded-md text-[13px] transition-colors text-left ${
        active 
          ? 'bg-[#EB9692]/20 text-[#EB9692] font-medium' 
          : 'text-white/70 hover:bg-white/5 hover:text-[#EB9692]'
      }`}
    >
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <div className="flex h-screen w-full bg-[#121212] overflow-hidden relative">
      {/* Window Controls & Sidebar Toggle (Absolute Layer) */}
      <div className="absolute top-0 left-0 h-10 flex items-center pl-4 gap-3 z-[200]">
        <div className="flex items-center gap-2">
          <div className="w-3 h-3 rounded-full bg-[#ff5f57]" />
          <div className="w-3 h-3 rounded-full bg-[#febc2e]" />
          <div className="w-3 h-3 rounded-full bg-[#28c840]" />
        </div>
        <button 
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-colors"
          title="Toggle Sidebar"
        >
          <PanelLeft size={18} />
        </button>
      </div>

      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64 border-r' : 'w-0 border-r-0'} flex flex-col border-white/5 sidebar-gradient transition-all duration-300 ease-in-out overflow-hidden flex-shrink-0 relative z-10`}>
        {/* Spacer for Window Controls (Axis A) */}
        <div className="h-10 flex-shrink-0 w-full" />
        
        {/* Sidebar Header / Search (Axis B) */}
        <div className="h-12 flex items-center px-4 min-w-[256px] flex-shrink-0">
          <div className="relative group w-full">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-white/40 group-focus-within:text-[#0A84FF] transition-colors" size={14} />
            <input 
              ref={searchInputRef}
              type="text" 
              placeholder="Search FilmBase"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/20 border border-white/10 rounded-md py-1.5 pl-8 pr-8 text-[13px] focus:outline-none focus:ring-1 focus:ring-[#0A84FF] focus:border-[#0A84FF] transition-all placeholder:text-white/40 text-white shadow-inner"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  searchInputRef.current?.focus();
                }}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 bg-white/20 hover:bg-white/40 rounded-full flex items-center justify-center transition-colors"
                title="Clear search"
              >
                <X size={10} strokeWidth={3} className="text-white" />
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto overflow-x-hidden pl-6 pr-4 mt-6 pb-2 min-w-[256px] [scrollbar-gutter:stable]">
          <nav className="space-y-6">
            <div>
              <button 
                onClick={() => toggleSection('genre')}
                className="flex items-center justify-between w-full pl-2.5 text-[11px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>Genre</span>
                <motion.div
                  animate={{ rotate: expandedSections.genre ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={12} strokeWidth={2.5} />
                </motion.div>
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
                      <SidebarItem 
                        label={genre}
                        active={selectedGenres.includes(genre)}
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
                className="flex items-center justify-between w-full pl-2.5 text-[11px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>Year</span>
                <motion.div
                  animate={{ rotate: expandedSections.year ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={12} strokeWidth={2.5} />
                </motion.div>
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
                className="flex items-center justify-between w-full pl-2.5 text-[11px] font-bold text-white/40 uppercase tracking-wider mb-1.5 group hover:text-white/60 transition-colors"
              >
                <span>My Rating</span>
                <motion.div
                  animate={{ rotate: expandedSections.ratings ? 90 : 0 }}
                  transition={{ duration: 0.2 }}
                >
                  <ChevronRight size={12} strokeWidth={2.5} />
                </motion.div>
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
                      <SidebarItem 
                        label={rating === 0 ? 'Unrated' : `${rating} ${rating === 1 ? 'star' : 'stars'}`}
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

        <div className="mt-auto border-t border-white/5 pt-4 p-4 min-w-[256px]">
          <button 
            onClick={resetFilters}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
              !isRecentlyAddedFilter && selectedGenres.length === 0 && selectedYears.length === 0 && selectedRatings.length === 0 && !searchQuery
                ? 'text-white' 
                : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <Film size={18} />
            All Films
          </button>
          <button 
            onClick={() => {
              setSelectedGenres([]);
              setSelectedYears([]);
              setSelectedRatings([]);
              setSearchQuery('');
              setIsRecentlyAddedFilter(true);
            }}
            className={`flex items-center gap-3 w-full px-3 py-2 rounded-lg text-[11px] font-bold uppercase tracking-wider transition-colors ${
              isRecentlyAddedFilter 
                ? 'text-white' 
                : 'text-white/60 hover:bg-white/5'
            }`}
          >
            <Clock size={18} />
            Recently Added
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="relative h-10 bg-[#121212]/60 backdrop-blur-xl sticky top-0 z-50 flex-shrink-0">
          {/* FilmBase Text */}
          <div className="absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2">
            <h1 className="text-[13px] font-bold tracking-tight text-white/40">FilmBase</h1>
          </div>
        </header>

        {/* Toolbar */}
        <div className="h-12 px-8 flex items-center justify-between border-b border-[#292929] bg-[#121212]/50 sticky top-10 z-40 flex-shrink-0">
          <div className="flex items-center gap-8">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
              >
                <Grid size={16} />
              </button>
              <button 
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-md transition-colors ${viewMode === 'list' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
              >
                <List size={16} />
              </button>
            </div>

            <div className="flex items-center gap-3">
              <button
                onClick={() => setPosterSize(Math.max(120, posterSize - 20))}
                disabled={viewMode === 'list' || posterSize <= 120}
                className="text-white/40 hover:text-white disabled:text-white/10 disabled:cursor-not-allowed transition-colors"
                title="Decrease poster size"
              >
                <Grid size={12} />
              </button>
              <input 
                type="range" 
                min="120" 
                max="240" 
                value={posterSize}
                disabled={viewMode === 'list'}
                onChange={(e) => setPosterSize(Number(e.target.value))}
                className="w-32 accent-white/40 disabled:opacity-30 disabled:cursor-not-allowed"
              />
              <button
                onClick={() => setPosterSize(Math.min(240, posterSize + 20))}
                disabled={viewMode === 'list' || posterSize >= 240}
                className="text-white/40 hover:text-white disabled:text-white/10 disabled:cursor-not-allowed transition-colors"
                title="Increase poster size"
              >
                <Grid size={16} />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setIsEditing(!isEditing)}
                className={`p-1.5 rounded-md transition-colors ${isEditing ? 'bg-white text-black' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
                title="Edit Library"
              >
                <Minus size={16} />
              </button>
              <button 
                onClick={() => setIsAddModalOpen(true)}
                className="p-1.5 rounded-md text-white/40 hover:text-white hover:bg-white/5 transition-colors"
                title="Add Movie"
              >
                <Plus size={16} />
              </button>
            </div>
          </div>
        </div>

        {/* Content Area */}
        <div className={`flex-1 overflow-y-auto overflow-x-hidden pb-8 [scrollbar-gutter:stable] ${viewMode === 'list' ? 'pt-0 px-0' : 'pt-4 px-8'}`}>
          {viewMode === 'list' && filteredMovies.length > 0 && (
            <div className="sticky top-0 z-[70] bg-[#121212] py-4 border-b border-[#292929]">
              <div className={`grid ${isEditing ? 'grid-cols-[60px_100px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]' : 'grid-cols-[100px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]'} gap-x-8 px-0 text-[12px] font-bold uppercase tracking-widest text-white/40 items-center`}>
                {isEditing && <span className="pl-8" />}
                <span className={isEditing ? "" : "pl-8"}>Poster</span>
                <div className="relative pl-10">
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
                <span>Starring</span>
                <button 
                  onClick={() => setSortMode(sortMode === 'imdb-desc' ? 'imdb-asc' : 'imdb-desc')}
                  className={`flex items-center gap-[6px] transition-colors justify-center group ${sortMode.startsWith('imdb') ? 'text-white' : 'text-white/40'}`}
                >
                  <span className="w-[41px] h-[16px] inline-flex items-center justify-center bg-[#795E18] group-hover:bg-[#F2BC30] text-black rounded-[2px] text-[10px] font-bold transition-colors duration-200">IMDb</span>
                  <ChevronDown size={10} className={`transition-transform ${sortMode === 'imdb-asc' ? 'rotate-180' : ''} ${sortMode.startsWith('imdb') ? 'opacity-100' : 'opacity-0 group-hover:opacity-40'}`} />
                </button>
                <button 
                  onClick={() => setSortMode(sortMode === 'rt-desc' ? 'rt-asc' : 'rt-desc')}
                  className={`flex items-center gap-1.5 hover:text-white transition-colors justify-center ${sortMode.startsWith('rt') ? 'text-white' : ''}`}
                >
                  <span className="text-[14px] leading-none translate-y-[0.5px]" style={{ filter: 'saturate(1.5) brightness(1.2)' }}>🍅</span>
                  <ChevronDown size={10} className={`transition-transform ${sortMode === 'rt-asc' ? 'rotate-180' : ''} ${sortMode.startsWith('rt') ? 'opacity-100' : 'opacity-0'}`} />
                </button>
                <button 
                  onClick={() => setSortMode(sortMode === 'personal-desc' ? 'personal-asc' : 'personal-desc')}
                  className={`flex items-center gap-1.5 hover:text-white transition-colors justify-center pr-8 ${sortMode.startsWith('personal') ? 'text-white' : ''}`}
                >
                  <span className="text-[12px] font-bold uppercase tracking-widest whitespace-nowrap">MY RATING</span>
                  <ChevronDown size={10} className={`transition-transform ${sortMode === 'personal-asc' ? 'rotate-180' : ''} ${sortMode.startsWith('personal') ? 'opacity-100' : 'opacity-0'}`} />
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
                  isEditing={isEditing}
                  onDelete={() => handleDeleteMovie(movie)}
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
                (() => {
                  const embedUrl = getYouTubeEmbedUrl(selectedMovie.trailerUrl);
                  const isEmbeddable = embedUrl.includes('/embed/');
                  
                  if (isEmbeddable) {
                    return (
                      <iframe
                        ref={trailerIframeRef}
                        src={`${embedUrl}?autoplay=1&mute=0`}
                        title={`${selectedMovie.title} Trailer`}
                        className="w-full h-full border-none"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    );
                  }
                  
                  return (
                    <div className="w-full h-full flex flex-col items-center justify-center bg-zinc-900 p-8 text-center">
                      <Film size={48} className="text-white/20 mb-4" />
                      <h3 className="text-xl font-bold mb-2">Trailer Not Found</h3>
                      <p className="text-white/60 mb-6">We couldn't find a direct trailer for this film.</p>
                      <a 
                        href={selectedMovie.trailerUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-white/90 transition-colors flex items-center gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        Search on YouTube
                      </a>
                    </div>
                  );
                })()
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

      {/* Add Movie Modal */}
      <AnimatePresence>
        {isAddModalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-md bg-zinc-900 border border-white/10 rounded-2xl p-8 shadow-2xl"
            >
              <h2 className="text-xl font-bold text-white mb-6 tracking-tight">Add New Movie</h2>
              
              <div className="space-y-4">
                {addError && (
                  <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm px-4 py-3 rounded-xl mb-4">
                    {addError}
                  </div>
                )}
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5 ml-1">
                    IMDb URL
                  </label>
                  <input 
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
                    className={`w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all placeholder:text-white/20 disabled:opacity-50 ${isImdbEntered ? 'opacity-50 cursor-not-allowed' : ''}`}
                    autoFocus
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40 mb-1.5 ml-1">
                    Trailer URL (Required)
                  </label>
                  <input 
                    id="trailer-input"
                    type="text"
                    placeholder="Trailer URL (Required)"
                    value={newMovieTrailerUrl}
                    onChange={(e) => setNewMovieTrailerUrl(e.target.value)}
                    disabled={isAdding}
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-white/10 transition-all placeholder:text-white/20 disabled:opacity-50"
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
                    setNewMovieTrailerUrl('');
                    setAddError('');
                  }}
                  disabled={isAdding}
                  className="px-6 py-2.5 rounded-full text-sm font-semibold text-white/60 hover:text-white hover:bg-white/5 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleAddMovie}
                  disabled={isAdding || !newMovieUrl.trim() || !newMovieTrailerUrl.trim()}
                  className={`px-8 py-2.5 rounded-full text-sm font-bold transition-colors flex items-center gap-2 ${
                    isAdding || !newMovieUrl.trim() || !newMovieTrailerUrl.trim()
                      ? 'bg-white/10 text-white/40 cursor-not-allowed'
                      : 'bg-[#0A84FF] text-white hover:bg-[#0A84FF]/90'
                  }`}
                >
                  {isAdding ? (
                    <>
                      <div className="w-4 h-4 border-2 border-black/20 border-t-black rounded-full animate-spin" />
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
    </div>
  );
}

interface MovieCardProps {
  movie: Movie;
  size: number;
  viewMode: 'grid' | 'list';
  isEditing: boolean;
  onDelete: () => void;
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

function MovieCard({ movie, size, viewMode, isEditing, onDelete, onRatingChange, onPlayTrailer, onShowPoster }: MovieCardProps) {
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [isSelectedForDeletion, setIsSelectedForDeletion] = useState(false);
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
      setHoverRating(null);
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
    <div 
      className={`flex flex-col ${align === 'center' ? 'items-center' : 'items-start'} gap-1`}
      onMouseLeave={(e) => {
        e.stopPropagation();
        setHoverRating(null);
      }}
    >
      <div className="flex items-center gap-0.5">
        {[...Array(5)].map((_, i) => (
          <button
            key={i}
            onMouseEnter={(e) => {
              e.stopPropagation();
              setHoverRating(i + 1);
            }}
            onMouseLeave={(e) => {
              e.stopPropagation();
              setHoverRating(null);
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
      <div className="h-3 flex items-center justify-center">
        <AnimatePresence>
          {hoverRating !== null && (
            <motion.span 
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0 } }}
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
        className={`group grid ${isEditing ? 'grid-cols-[60px_100px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]' : 'grid-cols-[100px_3.5fr_120px_1.5fr_2.5fr_70px_70px_120px]'} gap-x-8 items-center px-0 py-3 rounded-none hover:bg-white/5 border-b border-[#292929] transition-colors cursor-pointer w-full`}
      >
        {isEditing && (
          <div className="flex justify-center pl-8">
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isSelectedForDeletion) {
                  onDelete();
                } else {
                  setIsSelectedForDeletion(true);
                }
              }}
              className={`w-4 h-4 rounded-full flex items-center justify-center text-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.5] ${isSelectedForDeletion ? 'bg-[#BA242F]' : 'bg-red-500 active:bg-[#BA242F]'}`}
              title={isSelectedForDeletion ? "Confirm Delete" : "Delete Movie"}
            >
              {isSelectedForDeletion ? <X size={10} strokeWidth={3} /> : <Minus size={10} strokeWidth={3} />}
            </button>
          </div>
        )}
        <div 
          className={`w-[100px] h-[150px] rounded-none flex-shrink-0 shadow-lg cursor-zoom-in relative group-hover:z-10 transition-all duration-300 origin-center ${!isEditing ? 'group-hover:scale-115 pl-8 box-content' : ''}`}
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
        
        <div className="min-w-0 pl-10">
          <h3 className="font-semibold text-lg text-white/90 group-hover:text-white transition-colors leading-tight">
            {movie.title}
            <span className="text-white/25 font-semibold">{"\u00A0".repeat(6)}{movie.year}</span>
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

        <div className="relative h-10 overflow-hidden text-[13px] text-white/60 group-hover:text-white transition-colors leading-5">
          <div className="group-hover:animate-marquee-vertical flex flex-col">
            {movie.cast.map((actor, idx) => (
              <span key={idx} className="truncate block h-5">{actor}</span>
            ))}
            {/* Duplicates for seamless rolling list */}
            {movie.cast.map((actor, idx) => (
              <span key={`dup-${idx}`} className="truncate block h-5">{actor}</span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-center text-[13px] text-white/60 group-hover:text-white transition-colors font-medium tabular-nums">
          {movie.imdbRating}
        </div>

        <div className="flex items-center justify-center text-[13px] text-white/60 group-hover:text-white transition-colors font-medium tabular-nums">
          {movie.rottenTomatoes}%
        </div>

        <div className="flex items-center justify-center h-full pt-[4px] pr-8">
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
      <div className={`relative aspect-[2/3] ${isEditing ? 'rounded-xl' : 'rounded-none'} group-hover:rounded-none overflow-hidden mb-3 shadow-2xl transition-all duration-300 ease-out origin-bottom border-none ${!isEditing ? 'group-hover:scale-115 group-hover:-translate-y-1' : ''}`}>
        {isEditing && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (isSelectedForDeletion) {
                onDelete();
              } else {
                setIsSelectedForDeletion(true);
              }
            }}
            className={`absolute top-2 left-2 z-50 w-4 h-4 rounded-full flex items-center justify-center text-white shadow-[0_2px_4px_rgba(0,0,0,0.25)] transition-all duration-200 hover:scale-[1.5] ${isSelectedForDeletion ? 'bg-[#BA242F]' : 'bg-red-500 active:bg-[#BA242F]'}`}
            title={isSelectedForDeletion ? "Confirm Delete" : "Delete Movie"}
          >
            {isSelectedForDeletion ? <X size={10} strokeWidth={3} /> : <Minus size={10} strokeWidth={3} />}
          </button>
        )}
        <img 
          src={movie.posterUrl} 
          alt={movie.title}
          className="w-full h-full object-cover"
          referrerPolicy="no-referrer"
        />
        
        {/* Selection Overlay */}
        <div 
          className={`absolute inset-0 bg-black/50 pointer-events-none transition-opacity duration-500 ease-in-out ${isSelectedForDeletion ? 'opacity-100' : 'opacity-0'}`}
        />
        
        {/* Hover Metadata Overlay */}
        <div className={`absolute inset-0 bg-black/50 opacity-0 transition-opacity flex flex-col justify-end p-4 space-y-2 ${!isEditing ? 'group-hover:opacity-100' : 'pointer-events-none'}`}>
          <div className="space-y-0 text-sm tracking-tight leading-relaxed font-medium text-white/60 group-hover:text-white">
            <div>
              <span className="truncate block">{movie.genre.join(', ')}</span>
            </div>
            <div>
              <span className="truncate block">{movie.year}</span>
            </div>
            <div>
              <span className="truncate block">{movie.runtime}</span>
            </div>
            <div className="pt-2">
              <div className="relative h-4 overflow-hidden">
                <div 
                  ref={castRef}
                  className={`text-white/60 transition-colors whitespace-nowrap ${isCastOverflowing ? 'group-hover:opacity-0' : 'truncate group-hover:text-white'}`}
                >
                  {movie.cast.join(' · ')}
                </div>
                
                {isCastOverflowing && (
                  <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                    <div className="flex animate-marquee-fast gap-4 whitespace-nowrap text-white/90">
                      <span>{movie.cast.join(' · ')}</span>
                      <span>{movie.cast.join(' · ')}</span>
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
        
        <div className="flex flex-col gap-2 text-sm text-white/60 group-hover:text-white transition-colors font-medium tracking-wider">
          <div className="flex items-center justify-between h-5">
            <div className="flex items-center gap-1.5">
              <span className="hidden group-hover:inline-block bg-[#F4C434] text-black font-bold px-1 rounded-[2px] text-[11px] leading-tight">IMDb</span>
              <span className="flex items-baseline gap-1">
                <span className="group-hover:hidden text-[10px] opacity-60">IMDb</span>
                {movie.imdbRating}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="hidden group-hover:inline-block text-[13px] leading-tight" style={{ filter: 'saturate(1.5) brightness(1.2)' }}>🍅</span>
              <span className="flex items-baseline gap-1">
                <span className="group-hover:hidden text-[10px] opacity-60">RT</span>
                {movie.rottenTomatoes}%
              </span>
            </div>
          </div>
          
          <div className="flex items-baseline">
            <StarRating align="start" />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
