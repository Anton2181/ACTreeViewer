import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, X } from 'lucide-react';
import { useTheme } from '../ThemeContext';
import { buildDynastyGraph, getDynastyKey, normalizeDynastyName } from '../utils/dynastyGraph';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const NODE_WIDTH = 164;
const NODE_HEIGHT = 86;
const MIN_ZOOM = 0.65;
const MAX_ZOOM = 2.1;
const EDGE_COLORS = {
  marriage: 'rgba(180, 83, 9, 0.58)',
  lineage: 'rgba(30, 64, 175, 0.35)',
  mixed: 'rgba(109, 40, 217, 0.42)'
};

const getSigilUrl = (rawHouse) => `${import.meta.env.BASE_URL}coas/House_${(rawHouse || '').replace(/\s+/g, '_')}.svg`;
const getSigilFallbackUrl = (rawHouse) => `${import.meta.env.BASE_URL}coas/House_${(rawHouse || '').replace(/\s+/g, '_')}.png`;

const DynastyGraph = ({
  data,
  selectedDynasties,
  onToggleDynasty,
  onClearSelectedDynasties,
  hiddenDynasties
}) => {
  const { theme } = useTheme();
  const scrollRef = useRef(null);
  const canvasRef = useRef(null);
  const layoutRef = useRef(new Map());
  const animationFrameRef = useRef(null);
  const dragStateRef = useRef(null);
  const panStateRef = useRef(null);
  const hasAutoCenteredRef = useRef(false);
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 720 });
  const [zoom, setZoom] = useState(1);
  const [renderVersion, setRenderVersion] = useState(0);
  const [renderedNodes, setRenderedNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);

  const graph = useMemo(() => buildDynastyGraph(data), [data]);

  const hiddenKeys = useMemo(
    () => new Set([...hiddenDynasties].map((name) => getDynastyKey(name)).filter(Boolean)),
    [hiddenDynasties]
  );

  const selectedKeys = useMemo(
    () => new Set([...selectedDynasties].map((name) => getDynastyKey(name)).filter(Boolean)),
    [selectedDynasties]
  );

  const graphCollections = useMemo(() => {
    const baseNodes = graph.nodes.filter((node) => !hiddenKeys.has(node.id));
    const nodeMap = new Map(baseNodes.map((node) => [node.id, node]));
    const neighborKeys = new Set(selectedKeys);

    const baseEdges = graph.edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));

    if (selectedKeys.size > 0) {
      baseEdges.forEach((edge) => {
        if (selectedKeys.has(edge.source) || selectedKeys.has(edge.target)) {
          neighborKeys.add(edge.source);
          neighborKeys.add(edge.target);
        }
      });
    }

    const visibleNodes = selectedKeys.size > 0
      ? baseNodes.filter((node) => neighborKeys.has(node.id))
      : baseNodes;

    const visibleNodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
    const visibleEdges = baseEdges.filter((edge) => visibleNodeMap.has(edge.source) && visibleNodeMap.has(edge.target));

    return {
      nodes: visibleNodes,
      edges: visibleEdges,
      allVisibleDynasties: baseNodes.map((node) => node.name)
    };
  }, [graph, hiddenKeys, selectedKeys]);

  const worldSize = useMemo(() => ({
    width: Math.max(2400, viewportSize.width * 4),
    height: Math.max(2400, viewportSize.height * 4)
  }), [viewportSize.height, viewportSize.width]);

  const snapshotNodes = useCallback((nodes) => nodes.map((node) => ({
    ...node,
    position: layoutRef.current.get(node.id) || { x: worldSize.width / 2, y: worldSize.height / 2 }
  })), [worldSize.height, worldSize.width]);

  const searchResults = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return [];

    return graphCollections.allVisibleDynasties
      .filter((name) => name.toLowerCase().includes(query))
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 8);
  }, [graphCollections.allVisibleDynasties, searchQuery]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return undefined;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      setViewportSize({
        width: Math.max(360, entry.contentRect.width),
        height: Math.max(420, entry.contentRect.height)
      });
    });

    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const spacing = 240;
    const rowHeight = 180;
    const columns = Math.max(1, Math.ceil(Math.sqrt(graphCollections.nodes.length || 1)));
    const centerX = worldSize.width / 2;
    const centerY = worldSize.height / 2;

    graphCollections.nodes.forEach((node, index) => {
      const existing = layoutRef.current.get(node.id);
      if (existing) return;

      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = centerX + (column - (columns - 1) / 2) * spacing;
      const y = centerY + (row - Math.floor((graphCollections.nodes.length / columns) / 2)) * rowHeight;

      layoutRef.current.set(node.id, {
        x,
        y,
        vx: 0,
        vy: 0,
        dragging: false
      });
    });

    [...layoutRef.current.keys()].forEach((key) => {
      if (!graphCollections.nodes.some((node) => node.id === key)) {
        layoutRef.current.delete(key);
      }
    });

  }, [graphCollections.nodes, worldSize.height, worldSize.width]);

  useEffect(() => {
    if (hasAutoCenteredRef.current) return;
    const element = scrollRef.current;
    if (!element) return;

    const targetLeft = Math.max(0, (worldSize.width * zoom - viewportSize.width) / 2);
    const targetTop = Math.max(0, (worldSize.height * zoom - viewportSize.height) / 2);

    element.scrollTo({ left: targetLeft, top: targetTop });
    hasAutoCenteredRef.current = true;
  }, [viewportSize.height, viewportSize.width, worldSize.height, worldSize.width, zoom]);

  useEffect(() => {
    let isMounted = true;

    const tick = () => {
      const nodes = graphCollections.nodes;
      const edges = graphCollections.edges;
      const centerX = worldSize.width / 2;
      const centerY = worldSize.height / 2;

      if (!nodes.length) {
        animationFrameRef.current = requestAnimationFrame(tick);
        return;
      }

      const positions = nodes
        .map((node) => ({ node, state: layoutRef.current.get(node.id) }))
        .filter((entry) => entry.state);

      for (let i = 0; i < positions.length; i += 1) {
        const current = positions[i].state;
        if (!current || current.dragging) continue;

        current.vx += (centerX - current.x) * 0.00025;
        current.vy += (centerY - current.y) * 0.00025;

        for (let j = i + 1; j < positions.length; j += 1) {
          const other = positions[j].state;
          if (!other) continue;

          let dx = other.x - current.x;
          let dy = other.y - current.y;
          let distanceSquared = dx * dx + dy * dy;

          if (distanceSquared < 0.01) {
            dx = (Math.random() - 0.5) * 0.5;
            dy = (Math.random() - 0.5) * 0.5;
            distanceSquared = dx * dx + dy * dy;
          }

          const distance = Math.sqrt(distanceSquared);
          const repulsion = 3500 / distanceSquared;
          const forceX = (dx / distance) * repulsion;
          const forceY = (dy / distance) * repulsion;

          if (!current.dragging) {
            current.vx -= forceX;
            current.vy -= forceY;
          }
          if (!other.dragging) {
            other.vx += forceX;
            other.vy += forceY;
          }
        }
      }

      edges.forEach((edge) => {
        const source = layoutRef.current.get(edge.source);
        const target = layoutRef.current.get(edge.target);
        if (!source || !target) return;

        const dx = target.x - source.x;
        const dy = target.y - source.y;
        const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
        const desired = 240 + Math.min(edge.weight * 18, 120);
        const spring = (distance - desired) * 0.002;
        const forceX = (dx / distance) * spring;
        const forceY = (dy / distance) * spring;

        if (!source.dragging) {
          source.vx += forceX;
          source.vy += forceY;
        }
        if (!target.dragging) {
          target.vx -= forceX;
          target.vy -= forceY;
        }
      });

      positions.forEach(({ state }) => {
        if (!state || state.dragging) return;
        state.vx *= 0.92;
        state.vy *= 0.92;
        state.x = clamp(state.x + state.vx, 140, worldSize.width - 140);
        state.y = clamp(state.y + state.vy, 120, worldSize.height - 120);
      });

      if (isMounted) {
        setRenderedNodes(snapshotNodes(nodes));
        setRenderVersion((value) => value + 1);
      }

      animationFrameRef.current = requestAnimationFrame(tick);
    };

    animationFrameRef.current = requestAnimationFrame(tick);

    return () => {
      isMounted = false;
      if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
    };
  }, [graphCollections.edges, graphCollections.nodes, snapshotNodes, worldSize.height, worldSize.width]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const pixelRatio = window.devicePixelRatio || 1;
    canvas.width = worldSize.width * pixelRatio;
    canvas.height = worldSize.height * pixelRatio;
    canvas.style.width = `${worldSize.width}px`;
    canvas.style.height = `${worldSize.height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.clearRect(0, 0, worldSize.width, worldSize.height);

    graphCollections.edges.forEach((edge) => {
      const source = layoutRef.current.get(edge.source);
      const target = layoutRef.current.get(edge.target);
      if (!source || !target) return;

      context.beginPath();
      context.moveTo(source.x, source.y);
      const curveOffset = Math.min(90, 18 * edge.weight);
      context.bezierCurveTo(
        source.x,
        source.y + curveOffset,
        target.x,
        target.y - curveOffset,
        target.x,
        target.y
      );

      const relationKey = edge.relationKinds.length > 1 ? 'mixed' : edge.relationKinds[0];
      context.strokeStyle = EDGE_COLORS[relationKey] || EDGE_COLORS.lineage;
      context.lineWidth = 1.5 + Math.min(edge.weight * 0.6, 5);
      context.stroke();
    });
  }, [graphCollections.edges, renderVersion, worldSize.height, worldSize.width]);

  useEffect(() => {
    const handlePointerMove = (event) => {
      const dragState = dragStateRef.current;
      const panState = panStateRef.current;
      const scrollElement = scrollRef.current;

      if (dragState && scrollElement) {
        const rect = scrollElement.getBoundingClientRect();
        const position = layoutRef.current.get(dragState.nodeId);
        if (!position) return;

        const worldX = (scrollElement.scrollLeft + event.clientX - rect.left) / zoom;
        const worldY = (scrollElement.scrollTop + event.clientY - rect.top) / zoom;
        position.x = clamp(worldX - dragState.offsetX, 140, worldSize.width - 140);
        position.y = clamp(worldY - dragState.offsetY, 120, worldSize.height - 120);
        position.vx = 0;
        position.vy = 0;
        setRenderedNodes(snapshotNodes(graphCollections.nodes));
        setRenderVersion((value) => value + 1);
        return;
      }

      if (panState && scrollElement) {
        scrollElement.scrollLeft = panState.startLeft - (event.clientX - panState.startX);
        scrollElement.scrollTop = panState.startTop - (event.clientY - panState.startY);
      }
    };

    const handlePointerUp = () => {
      const dragState = dragStateRef.current;
      if (dragState) {
        const position = layoutRef.current.get(dragState.nodeId);
        if (position) position.dragging = false;
      }
      dragStateRef.current = null;
      panStateRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [graphCollections.nodes, snapshotNodes, worldSize.height, worldSize.width, zoom]);

  const adjustZoom = (nextZoom, pivot = null) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      setZoom(clamp(nextZoom, MIN_ZOOM, MAX_ZOOM));
      return;
    }

    const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const previousZoom = zoom;
    if (clampedZoom === previousZoom) return;

    const rect = scrollElement.getBoundingClientRect();
    const pivotX = pivot?.x ?? rect.width / 2;
    const pivotY = pivot?.y ?? rect.height / 2;
    const worldX = (scrollElement.scrollLeft + pivotX) / previousZoom;
    const worldY = (scrollElement.scrollTop + pivotY) / previousZoom;

    setZoom(clampedZoom);

    requestAnimationFrame(() => {
      if (!scrollRef.current) return;
      scrollRef.current.scrollLeft = worldX * clampedZoom - pivotX;
      scrollRef.current.scrollTop = worldY * clampedZoom - pivotY;
    });
  };

  const handleSearchSelect = (dynastyName) => {
    if (!dynastyName) return;
    onToggleDynasty(normalizeDynastyName(dynastyName));
    setSearchQuery('');
    setSearchOpen(false);
  };

  const handleSearchSubmit = (event) => {
    event.preventDefault();
    if (searchResults[0]) {
      handleSearchSelect(searchResults[0]);
    }
  };

  return (
    <div className={`absolute inset-0 ${theme.bg} transition-colors duration-500`}>
      <div
        ref={scrollRef}
        onPointerDown={(event) => {
          if (event.target.closest('[data-no-pan]')) return;
          const scrollElement = scrollRef.current;
          if (!scrollElement) return;
          panStateRef.current = {
            startX: event.clientX,
            startY: event.clientY,
            startLeft: scrollElement.scrollLeft,
            startTop: scrollElement.scrollTop
          };
        }}
        onWheel={(event) => {
          if (!event.ctrlKey && !event.metaKey) return;
          event.preventDefault();
          const factor = event.deltaY > 0 ? 1 / 1.08 : 1.08;
          adjustZoom(zoom * factor, { x: event.clientX - event.currentTarget.getBoundingClientRect().left, y: event.clientY - event.currentTarget.getBoundingClientRect().top });
        }}
        className="absolute inset-0 overflow-auto cursor-grab touch-none"
      >
        <div
          className="relative"
          style={{
            width: `${worldSize.width * zoom}px`,
            height: `${worldSize.height * zoom}px`
          }}
        >
          <div
            className="absolute left-0 top-0 origin-top-left"
            style={{
              width: `${worldSize.width}px`,
              height: `${worldSize.height}px`,
              transform: `scale(${zoom})`
            }}
          >
            <canvas ref={canvasRef} className="absolute inset-0" />

            {renderedNodes.map((node) => {
              const isSelected = selectedKeys.has(node.id);

              return (
                <button
                  key={node.id}
                  type="button"
                  data-no-pan
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    const scrollElement = scrollRef.current;
                    if (!scrollElement) return;
                    const rect = scrollElement.getBoundingClientRect();
                    const position = layoutRef.current.get(node.id);
                    if (!position) return;

                    const worldX = (scrollElement.scrollLeft + event.clientX - rect.left) / zoom;
                    const worldY = (scrollElement.scrollTop + event.clientY - rect.top) / zoom;
                    dragStateRef.current = {
                      nodeId: node.id,
                      offsetX: worldX - position.x,
                      offsetY: worldY - position.y
                    };
                    position.dragging = true;
                    position.vx = 0;
                    position.vy = 0;
                  }}
                  onDoubleClick={() => onToggleDynasty(node.name)}
                  className={`group absolute -translate-x-1/2 -translate-y-1/2 rounded-2xl border bg-white/92 p-3 text-left shadow-lg backdrop-blur-sm transition duration-200 ${isSelected ? 'border-blue-500 shadow-blue-200/80 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
                  style={{
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                    width: `${NODE_WIDTH}px`,
                    minHeight: `${NODE_HEIGHT}px`
                  }}
                  title="Double-click to focus this dynasty"
                >
                  <div className="flex items-start gap-3">
                    <img
                      src={getSigilUrl(node.rawHouse)}
                      alt={`${node.name} coat of arms`}
                      className="h-12 w-12 rounded-lg border border-slate-200 bg-slate-50 object-contain p-1"
                      loading="lazy"
                      onError={(event) => {
                        const target = event.currentTarget;
                        if (target.dataset.fallbackApplied === 'true') {
                          target.style.visibility = 'hidden';
                          return;
                        }
                        target.dataset.fallbackApplied = 'true';
                        target.src = getSigilFallbackUrl(node.rawHouse);
                      }}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-slate-900">{node.name}</h3>
                        {isSelected && (
                          <span className="mt-0.5 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.2em] text-blue-700">
                            Focus
                          </span>
                        )}
                      </div>
                      <p className="mt-2 text-xs text-slate-500">
                        {node.members} member{node.members === 1 ? '' : 's'} · {node.relations} linked relation{node.relations === 1 ? '' : 's'}
                      </p>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div data-no-pan className="absolute left-4 top-4 z-10 w-[min(30rem,calc(100%-2rem))] rounded-2xl border border-white/60 bg-white/88 p-4 shadow-xl backdrop-blur-md">
        <div className="mb-3 flex items-center justify-between gap-4">
          <div>
            <h2 className={`text-lg font-semibold ${theme.textPrimary}`}>Dynastic connections</h2>
            <p className="text-sm text-slate-600">The graph starts in a much larger 4×4 dynastic field. Drag the background to pan, use the zoom controls, or hold Ctrl/⌘ while scrolling to zoom.</p>
          </div>
          {selectedDynasties.size > 0 && (
            <button
              type="button"
              data-no-pan
              onClick={onClearSelectedDynasties}
              className="rounded-full border border-slate-300 px-3 py-1 text-xs font-semibold text-slate-600 transition hover:border-slate-400 hover:text-slate-900"
            >
              Clear focus
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <form onSubmit={handleSearchSubmit} className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              data-no-pan
              value={searchQuery}
              onChange={(event) => {
                setSearchQuery(event.target.value);
                setSearchOpen(true);
              }}
              onFocus={() => setSearchOpen(true)}
              placeholder="Search dynasty name…"
              className="w-full rounded-xl border border-slate-300 bg-white/90 py-2.5 pl-10 pr-4 text-sm text-slate-900 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-200"
            />
            {searchOpen && searchResults.length > 0 && (
              <div className="absolute left-0 right-0 top-[calc(100%+0.5rem)] z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
                {searchResults.map((result) => (
                  <button
                    key={result}
                    type="button"
                    data-no-pan
                    onClick={() => handleSearchSelect(result)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-sm text-slate-700 transition hover:bg-slate-50 hover:text-slate-900"
                  >
                    <span>{result}</span>
                    {selectedKeys.has(getDynastyKey(result)) && <span className="text-xs font-semibold text-blue-700">Focused</span>}
                  </button>
                ))}
              </div>
            )}
          </form>

          <div data-no-pan className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-1">
            <button
              type="button"
              data-no-pan
              onClick={() => adjustZoom(zoom / 1.12)}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Zoom out"
            >
              <Minus className="h-4 w-4" />
            </button>
            <span className="min-w-14 text-center text-xs font-semibold text-slate-600">{Math.round(zoom * 100)}%</span>
            <button
              type="button"
              data-no-pan
              onClick={() => adjustZoom(zoom * 1.12)}
              className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              aria-label="Zoom in"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {graphCollections.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-slate-500">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl">
            <p className="text-base font-semibold text-slate-800">No dynasties are visible.</p>
            <p className="mt-2 text-sm">Adjust the hidden dynasty list to bring houses back into the graph.</p>
          </div>
        </div>
      )}

      <div data-no-pan className="absolute bottom-4 right-4 z-10 max-w-sm rounded-2xl border border-white/60 bg-white/88 p-4 shadow-xl backdrop-blur-md">
        <div className="mb-2 flex items-center justify-between gap-4">
          <h3 className={`text-sm font-semibold ${theme.textPrimary}`}>Focused dynasties</h3>
          {selectedDynasties.size > 0 && (
            <button
              type="button"
              data-no-pan
              onClick={onClearSelectedDynasties}
              className="text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              Clear
            </button>
          )}
        </div>
        {selectedDynasties.size > 0 ? (
          <div className="flex flex-wrap gap-2">
            {[...selectedDynasties].sort((a, b) => a.localeCompare(b)).map((name) => (
              <button
                key={name}
                type="button"
                data-no-pan
                onClick={() => onToggleDynasty(name)}
                className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold text-blue-700 transition hover:bg-blue-200"
              >
                {name}
                <X className="h-3 w-3" />
              </button>
            ))}
          </div>
        ) : (
          <p className="text-xs text-slate-500">No dynasty focus is active. Search or double-click any dynasty node to isolate its network.</p>
        )}
      </div>

      <div data-no-pan className="pointer-events-none absolute bottom-4 left-4 z-10 rounded-2xl border border-white/60 bg-white/80 px-4 py-2 text-xs text-slate-600 shadow-lg backdrop-blur-md">
        Pan by dragging the background. Drag a dynasty card to reposition it. Double-click any dynasty to focus its connected graph.
      </div>
    </div>
  );
};

export default DynastyGraph;
