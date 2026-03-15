import React, { useState, useEffect, useMemo } from 'react';
import { fetchAndParseData } from './utils/dataParser';
import FamilyTree from './components/FamilyTree';
import { Loader2, Menu, X, Filter } from 'lucide-react';
import { useTheme } from './ThemeContext';

function App() {
  const { theme, currentThemeId, setCurrentThemeId, allThemes } = useTheme();
  const [data, setData] = useState([]);
  const [currentYear, setCurrentYear] = useState('...');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Filters
  const [selectedHouses, setSelectedHouses] = useState(new Set());
  const [selectedClaims, setSelectedClaims] = useState(new Set());
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  useEffect(() => {
    const loadData = async () => {
      try {
        const parsed = await fetchAndParseData();
        console.log("Parsed Characters:", parsed.characters);
        setData(parsed.characters);
        setCurrentYear(parsed.year || 'Unknown');
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

    // 1. Find direct matches
    const directMatches = new Set(data.filter(char => {
      const houseMatch = selectedHouses.size === 0 || selectedHouses.has(char.House);
      const claimMatch = selectedClaims.size === 0 || selectedClaims.has(char.Claim);
      return houseMatch && claimMatch;
    }));

    // 2. Add parents and spouses of direct matches
    const finalSet = new Set(directMatches);

    // Quick lookup maps
    const idToChar = new Map(data.map(d => [d.id.toString(), d]));
    const nameToChar = new Map(data.filter(d => d['First Name']).map(d => [d['First Name'], d]));

    directMatches.forEach(char => {
      // Add Parents
      if (char.FatherId && idToChar.has(char.FatherId.toString())) {
        finalSet.add(idToChar.get(char.FatherId.toString()));
      } else if (char.Father && nameToChar.has(char.Father)) {
        finalSet.add(nameToChar.get(char.Father));
      }

      if (char.MotherId && idToChar.has(char.MotherId.toString())) {
        finalSet.add(idToChar.get(char.MotherId.toString()));
      } else if (char.Mother && nameToChar.has(char.Mother)) {
        finalSet.add(nameToChar.get(char.Mother));
      }

      // Add Spouses (anyone who lists this char as a partner, or vice versa)
      // Check if this char lists partners
      if (char.Partners) {
        const partnerNames = char.Partners.split(',').map(s => s.trim());
        partnerNames.forEach(pName => {
          if (nameToChar.has(pName)) finalSet.add(nameToChar.get(pName));
        });
      }
    });

    // Also check if anyone else lists a directMatch as a partner
    data.forEach(char => {
      if (char.Partners) {
        const partnerNames = char.Partners.split(',').map(s => s.trim());
        const isPartnerOfMatch = Array.from(directMatches).some(match => partnerNames.includes(match['First Name']));
        if (isPartnerOfMatch) {
          finalSet.add(char);
        }
      }
    });

    return Array.from(finalSet);
  }, [data, selectedHouses, selectedClaims]);

  const toggleHouse = (house) => {
    const newSelected = new Set(selectedHouses);
    if (newSelected.has(house)) newSelected.delete(house);
    else newSelected.add(house);
    setSelectedHouses(newSelected);
    setRecenterTrigger(prev => prev + 1);
  };

  const toggleClaim = (claim) => {
    const newSelected = new Set(selectedClaims);
    if (newSelected.has(claim)) newSelected.delete(claim);
    else newSelected.add(claim);
    setSelectedClaims(newSelected);
    setRecenterTrigger(prev => prev + 1);
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
            <h1 className={`text-2xl font-serif ${theme.textPrimary} font-bold tracking-wider`}>AegonsConquest Character Chronicle</h1>
            <p className="text-sm text-gray-600">Current year is {currentYear}</p>
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
          </div>          {/* House Filter */}
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

        {/* Minimalist Active Filter Sidebar on Left */}
        {(selectedHouses.size > 0 || selectedClaims.size > 0) && (
          <div className="fixed top-[128px] left-4 z-10 flex flex-col gap-3 pointer-events-none">
            {Array.from(selectedHouses).map(house => (
              <div key={`active-house-${house}`} className="pointer-events-auto flex items-center gap-2 text-slate-800 hover:text-black transition-colors text-sm font-semibold drop-shadow-sm filter">
                <button onClick={() => toggleHouse(house)} className="text-red-500 hover:text-red-600 transition-colors">
                  <X size={20} />
                </button>
                <span className="tracking-wide">House {house}</span>
              </div>
            ))}
            {Array.from(selectedClaims).map(claim => (
              <div key={`active-claim-${claim}`} className="pointer-events-auto flex items-center gap-2 text-slate-800 hover:text-black transition-colors text-sm font-semibold drop-shadow-sm filter">
                <button onClick={() => toggleClaim(claim)} className="text-red-500 hover:text-red-600 transition-colors">
                  <X size={20} />
                </button>
                <span className="tracking-wide">Claim: {claim}</span>
              </div>
            ))}
          </div>
        )}

        {!loading && !error && filteredData.length > 0 && (
          <FamilyTree data={filteredData} allData={data} onFilterHouse={toggleHouse} recenterTrigger={recenterTrigger} />
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
