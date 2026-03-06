import React, { useState, useEffect, useMemo } from 'react';
import { fetchAndParseData } from './utils/dataParser';
import FamilyTree from './components/FamilyTree';
import { Loader2, Menu, X, Filter } from 'lucide-react';
import { useTheme } from './ThemeContext';

function App() {
  const { theme, currentThemeId, setCurrentThemeId, allThemes } = useTheme();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Filters
  const [selectedHouses, setSelectedHouses] = useState(new Set());
  const [selectedClaims, setSelectedClaims] = useState(new Set());

  useEffect(() => {
    const loadData = async () => {
      try {
        const parsed = await fetchAndParseData();
        console.log("Parsed Characters:", parsed);
        setData(parsed);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, []);

  // Compute unique filter options
  const houses = useMemo(() => {
    const all = new Set(data.map(d => d.House).filter(Boolean));
    return Array.from(all).sort();
  }, [data]);

  const claims = useMemo(() => {
    const all = new Set(data.map(d => d.Claim).filter(Boolean));
    return Array.from(all).sort();
  }, [data]);

  // Apply filters to data before giving it to FamilyTree
  const filteredData = useMemo(() => {
    if (selectedHouses.size === 0 && selectedClaims.size === 0) return data;

    return data.filter(char => {
      const houseMatch = selectedHouses.size === 0 || selectedHouses.has(char.House);
      const claimMatch = selectedClaims.size === 0 || selectedClaims.has(char.Claim);
      return houseMatch && claimMatch;
    });
  }, [data, selectedHouses, selectedClaims]);

  const toggleHouse = (house) => {
    const newSelected = new Set(selectedHouses);
    if (newSelected.has(house)) newSelected.delete(house);
    else newSelected.add(house);
    setSelectedHouses(newSelected);
  };

  const toggleClaim = (claim) => {
    const newSelected = new Set(selectedClaims);
    if (newSelected.has(claim)) newSelected.delete(claim);
    else newSelected.add(claim);
    setSelectedClaims(newSelected);
  };

  return (
    <div className={`w-screen h-screen ${theme.bg} text-white flex flex-col font-sans overflow-hidden transition-colors duration-500`}>
      <header className={`absolute top-0 left-0 w-full z-20 p-4 border-b ${theme.border} bg-white/80 backdrop-blur-md flex justify-between items-center`}>
        <div className="flex items-center gap-4">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`p-2 rounded-lg hover:bg-white/10 transition-colors ${theme.textPrimary}`}
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div>
            <h1 className={`text-2xl font-serif ${theme.textPrimary} font-bold tracking-wider`}>ASOIAF Chronicle</h1>
            <p className="text-sm text-gray-600">Live Family Tree & Character Compendium</p>
          </div>
        </div>
        <div className="text-xs text-gray-700 font-mono flex items-center gap-2">
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin text-amber-500" /> Syncing...</>
          ) : (
            <><div className="w-2 h-2 rounded-full bg-emerald-500"></div> Connected to Data Source</>
          )}
        </div>
      </header>

      {/* Sidebar Overlay */}
      {sidebarOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar Panel */}
      <aside
        className={`absolute top-0 left-0 h-full w-80 bg-white/95 border-r ${theme.border} z-20 transform transition-transform duration-300 ease-in-out flex flex-col pt-20 custom-scrollbar shadow-2xl ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}
      >
        <div className="p-6 overflow-y-auto">
          <div className="flex items-center gap-2 mb-6">
            <Filter size={20} className={theme.textPrimary} />
            <h2 className={`text-xl font-serif ${theme.textPrimary}`}>Filters & Settings</h2>
          </div>

          {/* Theme Selector */}
          <div className="mb-8">
            <h3 className={`text-sm font-bold uppercase tracking-wider ${theme.textSecondary} mb-3`}>Visual Theme</h3>
            <div className="grid grid-cols-1 gap-2">
              {allThemes.map(t => (
                <button
                  key={t.id}
                  onClick={() => setCurrentThemeId(t.id)}
                  className={`p-2 text-sm text-left rounded border transition-all ${currentThemeId === t.id
                    ? `${theme.border} bg-gray-100 shadow-inner ${theme.textPrimary} font-bold`
                    : 'border-gray-300 text-gray-600 hover:border-gray-400 hover:bg-gray-50'
                    }`}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          {/* House Filter */}
          {houses.length > 0 && (
            <div className="mb-8">
              <h3 className={`text-sm font-bold uppercase tracking-wider ${theme.textSecondary} mb-3 flex justify-between items-center`}>
                Filter by House
                {selectedHouses.size > 0 && (
                  <button
                    onClick={() => setSelectedHouses(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-300 normal-case"
                  >
                    Clear
                  </button>
                )}
              </h3>
              <div className="flex flex-col gap-2">
                {houses.map(house => (
                  <label key={house} onClick={() => toggleHouse(house)} className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shadow-inner ${selectedHouses.has(house)
                      ? `${theme.textPrimary} ${theme.border} bg-white/20`
                      : 'border-gray-300 group-hover:border-gray-400 bg-white/10'
                      }`}>
                      {selectedHouses.has(house) && <div className={`w-2.5 h-2.5 rounded-sm bg-current`} />}
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-black transition-colors">{house}</span>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Claim Filter */}
          {claims.length > 0 && (
            <div className="mb-8">
              <h3 className={`text-sm font-bold uppercase tracking-wider ${theme.textSecondary} mb-3 flex justify-between items-center`}>
                Filter by Claim
                {selectedClaims.size > 0 && (
                  <button
                    onClick={() => setSelectedClaims(new Set())}
                    className="text-xs text-gray-500 hover:text-gray-300 normal-case"
                  >
                    Clear
                  </button>
                )}
              </h3>
              <div className="flex flex-col gap-2">
                {claims.map(claim => (
                  <label key={claim} onClick={() => toggleClaim(claim)} className="flex items-center gap-3 cursor-pointer group">
                    <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors shadow-inner ${selectedClaims.has(claim)
                      ? `${theme.textPrimary} ${theme.border} bg-white/20`
                      : 'border-gray-300 group-hover:border-gray-400 bg-white/10'
                      }`}>
                      {selectedClaims.has(claim) && <div className={`w-2.5 h-2.5 rounded-sm bg-current`} />}
                    </div>
                    <span className="text-sm text-gray-700 group-hover:text-black transition-colors">{claim}</span>
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </aside>

      <main className="flex-1 relative pt-20">
        {error && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 bg-red-900/50 text-red-200 p-6 rounded-lg border border-red-500/50 shadow-2xl backdrop-blur-sm max-w-lg text-center z-10">
            <h2 className="text-lg font-bold mb-2 flex items-center justify-center gap-2">
              Connection Error
            </h2>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && filteredData.length > 0 && (
          <FamilyTree data={filteredData} />
        )}

        {!loading && !error && filteredData.length === 0 && (
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-gray-500 flex flex-col items-center">
            <Filter size={48} className="mb-4 opacity-20" />
            <p>No characters match the selected filters.</p>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
