import React, { useEffect, useMemo, useState } from 'react';
import { Filter, GitBranch, Loader2, Menu, Network, Trees, X } from 'lucide-react';
import FamilyTree from './components/FamilyTree';
import DynastyGraph from './components/DynastyGraph';
import { useTheme } from './ThemeContext';
import { fetchAndParseData } from './utils/dataParser';
import { DEFAULT_EXCLUDED_DYNASTIES, normalizeDynastyName } from './utils/dynastyGraph';

const TAB_CONFIG = {
  tree: {
    label: 'Character tree',
    icon: Trees
  },
  dynasties: {
    label: 'Dynasty graph',
    icon: Network
  }
};

function App() {
  const { theme } = useTheme();
  const [data, setData] = useState([]);
  const [currentYear, setCurrentYear] = useState('...');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [activeTab, setActiveTab] = useState('tree');

  const [selectedHouses, setSelectedHouses] = useState(new Set());
  const [selectedClaims, setSelectedClaims] = useState(new Set());
  const [recenterTrigger, setRecenterTrigger] = useState(0);

  const [selectedDynasties, setSelectedDynasties] = useState(new Set());
  const [hiddenDynasties, setHiddenDynasties] = useState(new Set(DEFAULT_EXCLUDED_DYNASTIES));

  useEffect(() => {
    const loadData = async () => {
      try {
        const parsed = await fetchAndParseData();
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

  const houses = useMemo(() => {
    const all = new Set(data.map((entry) => entry.House).filter(Boolean));
    return Array.from(all).sort();
  }, [data]);

  const claims = useMemo(() => {
    const all = new Set(data.map((entry) => entry.Claim).filter(Boolean));
    return Array.from(all).sort();
  }, [data]);

  const dynastyOptions = useMemo(() => {
    const dynasties = new Set(
      data
        .map((entry) => normalizeDynastyName(entry.House))
        .filter(Boolean)
    );

    return Array.from(dynasties).sort((a, b) => a.localeCompare(b));
  }, [data]);

  const filteredData = useMemo(() => {
    if (selectedHouses.size === 0 && selectedClaims.size === 0) return data;

    const idToChar = new Map(data.map((entry) => [entry.id.toString(), entry]));
    const nameToChar = new Map(data.filter((entry) => entry['First Name']).map((entry) => [entry['First Name'], entry]));
    const fullNameToChar = new Map();

    data.forEach((character) => {
      if (!character['First Name']) return;
      const full = `${character['First Name']} ${character['House'] || ''}`.trim();
      fullNameToChar.set(full, character);
    });

    const childrenMap = new Map();
    const spouseMap = new Map();

    data.forEach((character) => {
      const fatherId = character.FatherId?.toString();
      const motherId = character.MotherId?.toString();

      if (fatherId) {
        if (!childrenMap.has(fatherId)) childrenMap.set(fatherId, []);
        childrenMap.get(fatherId).push(character);
      }
      if (motherId) {
        if (!childrenMap.has(motherId)) childrenMap.set(motherId, []);
        childrenMap.get(motherId).push(character);
      }

      if (fatherId && motherId) {
        if (!spouseMap.has(fatherId)) spouseMap.set(fatherId, new Set());
        if (!spouseMap.has(motherId)) spouseMap.set(motherId, new Set());
        spouseMap.get(fatherId).add(motherId);
        spouseMap.get(motherId).add(fatherId);
      }
    });

    const directMatches = data.filter((character) => {
      const houseMatch = selectedHouses.size === 0 || selectedHouses.has(character.House);
      const claimMatch = selectedClaims.size === 0 || selectedClaims.has(character.Claim);
      return houseMatch && claimMatch;
    });

    const finalSet = new Set();
    const visited = new Set();

    const addSpousesInferred = (character) => {
      const characterId = character.id.toString();
      const partnerIds = spouseMap.get(characterId) || [];
      partnerIds.forEach((partnerId) => {
        const partner = idToChar.get(partnerId);
        if (partner) finalSet.add(partner);
      });

      if (!character.Partners) return;
      character.Partners.split(',').map((value) => value.trim()).forEach((partnerName) => {
        const partner = fullNameToChar.get(partnerName) || nameToChar.get(partnerName);
        if (partner) finalSet.add(partner);
      });
    };

    const addDescendantsRecursive = (character) => {
      if (visited.has(character.id)) return;
      visited.add(character.id);

      finalSet.add(character);
      addSpousesInferred(character);

      (childrenMap.get(character.id.toString()) || []).forEach((child) => {
        addDescendantsRecursive(child);
      });
    };

    directMatches.forEach((character) => {
      finalSet.add(character);

      if (character.FatherId && idToChar.has(character.FatherId.toString())) {
        finalSet.add(idToChar.get(character.FatherId.toString()));
      }
      if (character.MotherId && idToChar.has(character.MotherId.toString())) {
        finalSet.add(idToChar.get(character.MotherId.toString()));
      }

      addDescendantsRecursive(character);
    });

    return Array.from(finalSet);
  }, [data, selectedClaims, selectedHouses]);

  const toggleHouse = (house) => {
    const next = new Set(selectedHouses);
    if (next.has(house)) next.delete(house);
    else next.add(house);
    setSelectedHouses(next);
    setRecenterTrigger((value) => value + 1);
  };

  const toggleClaim = (claim) => {
    const next = new Set(selectedClaims);
    if (next.has(claim)) next.delete(claim);
    else next.add(claim);
    setSelectedClaims(next);
    setRecenterTrigger((value) => value + 1);
  };

  const toggleDynasty = (dynastyName) => {
    const normalized = normalizeDynastyName(dynastyName);
    if (!normalized) return;

    const next = new Set(selectedDynasties);
    if (next.has(normalized)) next.delete(normalized);
    else next.add(normalized);
    setSelectedDynasties(next);
  };

  const toggleHiddenDynasty = (dynastyName) => {
    const normalized = normalizeDynastyName(dynastyName);
    if (!normalized) return;

    const next = new Set(hiddenDynasties);
    if (next.has(normalized)) next.delete(normalized);
    else next.add(normalized);
    setHiddenDynasties(next);
    setSelectedDynasties((current) => {
      if (!current.has(normalized)) return current;
      const selectedNext = new Set(current);
      selectedNext.delete(normalized);
      return selectedNext;
    });
  };

  const resetHiddenDynasties = () => {
    setHiddenDynasties(new Set(DEFAULT_EXCLUDED_DYNASTIES));
    setSelectedDynasties((current) => {
      const next = new Set(current);
      DEFAULT_EXCLUDED_DYNASTIES.forEach((dynasty) => next.delete(dynasty));
      return next;
    });
  };

  const renderTreeSidebar = () => (
    <>
      {houses.length > 0 && (
        <div className="mb-8">
          <h3 className={`mb-3 flex items-center justify-between text-sm font-bold uppercase tracking-wider ${theme.textSecondary}`}>
            Filter by House
            {selectedHouses.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedHouses(new Set())}
                className="text-xs normal-case text-gray-500 transition hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </h3>
          <div className="flex flex-col gap-2">
            {houses.map((house) => (
              <label key={house} onClick={() => toggleHouse(house)} className="group flex cursor-pointer items-center gap-3">
                <div className={`flex h-5 w-5 items-center justify-center rounded border shadow-inner transition-colors ${selectedHouses.has(house)
                  ? `${theme.textPrimary} ${theme.border} bg-white/20`
                  : 'border-gray-300 bg-white/10 group-hover:border-gray-400'
                  }`}>
                  {selectedHouses.has(house) && <div className="h-2.5 w-2.5 rounded-sm bg-current" />}
                </div>
                <span className="text-sm text-gray-700 transition-colors group-hover:text-black">{house}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {claims.length > 0 && (
        <div className="mb-8">
          <h3 className={`mb-3 flex items-center justify-between text-sm font-bold uppercase tracking-wider ${theme.textSecondary}`}>
            Filter by Claim
            {selectedClaims.size > 0 && (
              <button
                type="button"
                onClick={() => setSelectedClaims(new Set())}
                className="text-xs normal-case text-gray-500 transition hover:text-gray-700"
              >
                Clear
              </button>
            )}
          </h3>
          <div className="flex flex-col gap-2">
            {claims.map((claim) => (
              <label key={claim} onClick={() => toggleClaim(claim)} className="group flex cursor-pointer items-center gap-3">
                <div className={`flex h-5 w-5 items-center justify-center rounded border shadow-inner transition-colors ${selectedClaims.has(claim)
                  ? `${theme.textPrimary} ${theme.border} bg-white/20`
                  : 'border-gray-300 bg-white/10 group-hover:border-gray-400'
                  }`}>
                  {selectedClaims.has(claim) && <div className="h-2.5 w-2.5 rounded-sm bg-current" />}
                </div>
                <span className="text-sm text-gray-700 transition-colors group-hover:text-black">{claim}</span>
              </label>
            ))}
          </div>
        </div>
      )}
    </>
  );

  const renderDynastySidebar = () => (
    <>
      <div className="mb-8 rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h3 className={`text-sm font-bold uppercase tracking-wider ${theme.textSecondary}`}>Graph filtering</h3>
            <p className="mt-2 text-sm text-slate-600">Search from the graph panel or double-click any dynasty card to focus the network around it.</p>
          </div>
          {selectedDynasties.size > 0 && (
            <button
              type="button"
              onClick={() => setSelectedDynasties(new Set())}
              className="text-xs font-semibold text-gray-500 transition hover:text-gray-700"
            >
              Clear
            </button>
          )}
        </div>

        {selectedDynasties.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...selectedDynasties].sort((a, b) => a.localeCompare(b)).map((dynasty) => (
              <button
                key={dynasty}
                type="button"
                onClick={() => toggleDynasty(dynasty)}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-200"
              >
                {dynasty}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-slate-500">No dynasty focus is active yet.</p>
        )}
      </div>

      <div className="mb-8">
        <h3 className={`mb-3 flex items-center justify-between text-sm font-bold uppercase tracking-wider ${theme.textSecondary}`}>
          Hidden dynasties
          <button
            type="button"
            onClick={resetHiddenDynasties}
            className="text-xs normal-case text-gray-500 transition hover:text-gray-700"
          >
            Reset defaults
          </button>
        </h3>
        <p className="mb-4 text-sm text-slate-600">These dynasties start hidden by default, but can be restored individually.</p>
        <div className="flex max-h-[28rem] flex-col gap-2 overflow-y-auto pr-1">
          {dynastyOptions.map((dynasty) => {
            const isHidden = hiddenDynasties.has(dynasty);
            const isDefaultHidden = DEFAULT_EXCLUDED_DYNASTIES.includes(dynasty);

            return (
              <label key={dynasty} onClick={() => toggleHiddenDynasty(dynasty)} className="group flex cursor-pointer items-center gap-3 rounded-xl px-2 py-1 transition hover:bg-slate-100/80">
                <div className={`flex h-5 w-5 items-center justify-center rounded border shadow-inner transition-colors ${isHidden
                  ? 'border-amber-500 bg-amber-100 text-amber-700'
                  : 'border-gray-300 bg-white/10 group-hover:border-gray-400'
                  }`}>
                  {isHidden && <X className="h-3 w-3" />}
                </div>
                <div className="flex min-w-0 flex-1 items-center justify-between gap-3">
                  <span className="truncate text-sm text-gray-700 transition-colors group-hover:text-black">{dynasty}</span>
                  {isDefaultHidden && <span className="rounded-full bg-slate-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-600">Default</span>}
                </div>
              </label>
            );
          })}
        </div>
      </div>
    </>
  );

  return (
    <div className={`flex h-screen w-screen flex-col overflow-hidden font-sans text-white ${theme.bg} transition-colors duration-500`}>
      <header className={`absolute left-0 top-0 z-20 flex w-full items-center justify-between border-b ${theme.border} bg-white/80 p-4 backdrop-blur-md`}>
        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className={`rounded-lg p-2 transition-colors hover:bg-white/10 ${theme.textPrimary}`}
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <div>
            <h1 className={`font-serif text-2xl font-bold tracking-wider ${theme.textPrimary}`}>AegonsConquest Character Chronicle</h1>
            <p className="text-sm text-gray-600">Current year is {currentYear}</p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div className="hidden rounded-full border border-slate-300 bg-white/70 p-1 shadow-sm md:flex">
            {Object.entries(TAB_CONFIG).map(([tabId, config]) => {
              const Icon = config.icon;
              const isActive = activeTab === tabId;

              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-semibold transition ${isActive
                    ? 'bg-slate-900 text-white shadow'
                    : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                    }`}
                >
                  <Icon className="h-4 w-4" />
                  {config.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 font-mono text-xs text-gray-700">
            {loading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin text-amber-500" />
                Syncing...
              </>
            ) : (
              <>
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                Connected to Data Source
              </>
            )}
          </div>
        </div>
      </header>

      {sidebarOpen && (
        <div
          className="absolute inset-0 z-10 bg-black/50 backdrop-blur-sm transition-opacity"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <aside className={`custom-scrollbar absolute left-0 top-0 z-20 flex h-full w-80 transform flex-col border-r ${theme.border} bg-white/95 pt-20 shadow-2xl transition-transform duration-300 ease-in-out ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-slate-200 px-6 pb-4 md:hidden">
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(TAB_CONFIG).map(([tabId, config]) => {
              const Icon = config.icon;
              const isActive = activeTab === tabId;
              return (
                <button
                  key={tabId}
                  type="button"
                  onClick={() => setActiveTab(tabId)}
                  className={`flex items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition ${isActive ? 'bg-slate-900 text-white shadow' : 'bg-slate-100 text-slate-600 hover:bg-slate-200 hover:text-slate-900'}`}
                >
                  <Icon className="h-4 w-4" />
                  {config.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="overflow-y-auto p-6">
          <div className="mb-6 flex items-center gap-2">
            {activeTab === 'tree' ? <Filter size={20} className={theme.textPrimary} /> : <GitBranch size={20} className={theme.textPrimary} />}
            <h2 className={`font-serif text-xl ${theme.textPrimary}`}>{activeTab === 'tree' ? 'Filters & Settings' : 'Dynasty Graph Controls'}</h2>
          </div>
          {activeTab === 'tree' ? renderTreeSidebar() : renderDynastySidebar()}
        </div>
      </aside>

      <main className="relative flex-1 pt-20">
        {error && (
          <div className="absolute left-1/2 top-1/2 z-10 max-w-lg -translate-x-1/2 -translate-y-1/2 rounded-lg border border-red-500/50 bg-red-900/50 p-6 text-center text-red-200 shadow-2xl backdrop-blur-sm">
            <h2 className="mb-2 flex items-center justify-center gap-2 text-lg font-bold">Connection Error</h2>
            <p className="text-sm">{error}</p>
          </div>
        )}

        {activeTab === 'tree' && (selectedHouses.size > 0 || selectedClaims.size > 0) && (
          <div className="pointer-events-none fixed left-4 top-[128px] z-10 flex flex-col gap-3">
            {Array.from(selectedHouses).map((house) => (
              <div key={`active-house-${house}`} className="pointer-events-auto flex items-center gap-2 text-sm font-semibold text-slate-800 drop-shadow-sm transition-colors hover:text-black">
                <button type="button" onClick={() => toggleHouse(house)} className="text-red-500 transition-colors hover:text-red-600">
                  <X size={20} />
                </button>
                <span className="tracking-wide">House {house}</span>
              </div>
            ))}
            {Array.from(selectedClaims).map((claim) => (
              <div key={`active-claim-${claim}`} className="pointer-events-auto flex items-center gap-2 text-sm font-semibold text-slate-800 drop-shadow-sm transition-colors hover:text-black">
                <button type="button" onClick={() => toggleClaim(claim)} className="text-red-500 transition-colors hover:text-red-600">
                  <X size={20} />
                </button>
                <span className="tracking-wide">Claim: {claim}</span>
              </div>
            ))}
          </div>
        )}

        {activeTab === 'tree' && !loading && !error && filteredData.length > 0 && (
          <FamilyTree data={filteredData} allData={data} onFilterHouse={toggleHouse} recenterTrigger={recenterTrigger} />
        )}

        {activeTab === 'tree' && !loading && !error && filteredData.length === 0 && (
          <div className="absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-gray-500">
            <Filter size={48} className="mb-4 opacity-20" />
            <p>No characters match the selected filters.</p>
          </div>
        )}

        {activeTab === 'dynasties' && !loading && !error && (
          <DynastyGraph
            data={data}
            selectedDynasties={selectedDynasties}
            onToggleDynasty={toggleDynasty}
            onClearSelectedDynasties={() => setSelectedDynasties(new Set())}
            hiddenDynasties={hiddenDynasties}
          />
        )}
      </main>
    </div>
  );
}

export default App;
