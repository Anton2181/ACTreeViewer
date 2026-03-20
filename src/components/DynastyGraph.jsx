import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, X } from 'lucide-react';
import { useTheme } from '../ThemeContext';
import { buildDynastyGraph, getDynastyKey, normalizeDynastyName } from '../utils/dynastyGraph';

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const NODE_WIDTH = 132;
const NODE_HEIGHT = 132;
const MIN_ZOOM = 0.1;
const MAX_ZOOM = 2.1;
const REPULSION_RADIUS = 400;
const REPULSION_RADIUS_SQUARED = REPULSION_RADIUS ** 2;
const MAX_REPULSION_FORCE = 0.95;
const EDGE_COLORS = {
  marriage: [164, 176, 210],
  lineage: [164, 176, 210],
  mixed: [164, 176, 210]
};

const getEdgeStroke = (relationKey, alpha) => {
  const [r, g, b] = EDGE_COLORS[relationKey] || EDGE_COLORS.lineage;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
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
  const zoomPivotRef = useRef(null); // { worldX, worldY, pivotX, pivotY }
  const [viewportSize, setViewportSize] = useState({ width: 1200, height: 720 });
  const [zoom, setZoom] = useState(1);
  const [renderVersion, setRenderVersion] = useState(0);
  const [renderedNodes, setRenderedNodes] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [isSearchVisible, setIsSearchVisible] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);

  const graph = useMemo(() => buildDynastyGraph(data), [data]);

  const hiddenKeys = useMemo(
    () => new Set([...hiddenDynasties].map((name) => getDynastyKey(name)).filter(Boolean)),
    [hiddenDynasties]
  );

  const selectedKeys = useMemo(
    () => new Set([...selectedDynasties].map((name) => getDynastyKey(name)).filter(Boolean)),
    [selectedDynasties]
  );

  const baseGraphLayout = useMemo(() => {
    const nodes = graph.nodes.filter((node) => !hiddenKeys.has(node.id));
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const edges = graph.edges.filter((edge) => nodeMap.has(edge.source) && nodeMap.has(edge.target));
    const adjacency = new Map(nodes.map((node) => [node.id, new Set()]));

    edges.forEach((edge) => {
      adjacency.get(edge.source)?.add(edge.target);
      adjacency.get(edge.target)?.add(edge.source);
    });

    const visited = new Set();
    const components = [];
    nodes.forEach((node) => {
      if (visited.has(node.id)) return;

      const queue = [node.id];
      const componentIds = [];
      visited.add(node.id);

      while (queue.length > 0) {
        const current = queue.shift();
        componentIds.push(current);
        adjacency.get(current)?.forEach((neighbor) => {
          if (visited.has(neighbor)) return;
          visited.add(neighbor);
          queue.push(neighbor);
        });
      }

      componentIds.sort((a, b) => {
        const nodeA = nodeMap.get(a);
        const nodeB = nodeMap.get(b);
        return (nodeB?.relations || 0) - (nodeA?.relations || 0) || (nodeB?.members || 0) - (nodeA?.members || 0) || a.localeCompare(b);
      });
      components.push(componentIds);
    });

    components.sort((a, b) => b.length - a.length || a[0].localeCompare(b[0]));

    const layoutHints = new Map();
    components.forEach((componentIds, componentIndex) => {
      componentIds.forEach((nodeId, localIndex) => {
        layoutHints.set(nodeId, { componentIndex, localIndex, componentSize: componentIds.length });
      });
    });

    return { nodes, edges, components, layoutHints };
  }, [graph, hiddenKeys]);

  const graphCollections = useMemo(() => {
    const { nodes: baseNodes, edges: baseEdges } = baseGraphLayout;
    const nodeDistances = new Map();

    if (selectedKeys.size > 0) {
      const adjacency = new Map(baseNodes.map((node) => [node.id, new Set()]));
      baseEdges.forEach((edge) => {
        adjacency.get(edge.source)?.add(edge.target);
        adjacency.get(edge.target)?.add(edge.source);
      });

      const queue = [...selectedKeys].filter((key) => adjacency.has(key));
      queue.forEach((key) => nodeDistances.set(key, 0));

      while (queue.length > 0) {
        const current = queue.shift();
        const currentDistance = nodeDistances.get(current) ?? 0;
        adjacency.get(current)?.forEach((neighbor) => {
          if (nodeDistances.has(neighbor)) return;
          nodeDistances.set(neighbor, currentDistance + 1);
          queue.push(neighbor);
        });
      }
    }

    const visibleNodes = selectedKeys.size > 0
      ? baseNodes.filter((node) => nodeDistances.has(node.id))
      : baseNodes;

    const visibleNodeMap = new Map(visibleNodes.map((node) => [node.id, node]));
    const visibleEdges = baseEdges
      .filter((edge) => visibleNodeMap.has(edge.source) && visibleNodeMap.has(edge.target))
      .map((edge) => ({
        ...edge,
        focusDepth: selectedKeys.size > 0
          ? Math.max(nodeDistances.get(edge.source) ?? 0, nodeDistances.get(edge.target) ?? 0)
          : 0
      }));

    return {
      nodes: visibleNodes,
      edges: visibleEdges,
      allVisibleDynasties: baseNodes.map((node) => node.name),
      nodeDistances
    };
  }, [baseGraphLayout, selectedKeys]);

  const worldSize = useMemo(() => ({
    width: Math.max(4800, viewportSize.width * 8),
    height: Math.max(4800, viewportSize.height * 8)
  }), [viewportSize.height, viewportSize.width]);

  const componentRegions = useMemo(() => {
    const centralBounds = {
      x: worldSize.width * 0.25,
      y: worldSize.height * 0.25,
      width: worldSize.width * 0.5,
      height: worldSize.height * 0.5
    };

    const componentBoxes = baseGraphLayout.components.map((componentIds, componentIndex) => {
      const localColumns = Math.max(1, Math.ceil(Math.sqrt(componentIds.length)));
      const localRows = Math.max(1, Math.ceil(componentIds.length / localColumns));

      return {
        componentIndex,
        componentIds,
        componentSize: componentIds.length,
        localColumns,
        localRows,
        baseWidth: Math.max(320, localColumns * 180 + 180),
        baseHeight: Math.max(280, localRows * 150 + 180)
      };
    }).sort((a, b) => b.baseHeight - a.baseHeight || b.baseWidth - a.baseWidth || b.componentSize - a.componentSize);

    const tryPack = (scale) => {
      const placements = new Map();
      let cursorX = centralBounds.x;
      let cursorY = centralBounds.y;
      let shelfHeight = 0;

      for (const box of componentBoxes) {
        const width = box.baseWidth * scale;
        const height = box.baseHeight * scale;

        if (cursorX + width > centralBounds.x + centralBounds.width) {
          cursorX = centralBounds.x;
          cursorY += shelfHeight;
          shelfHeight = 0;
        }

        if (cursorY + height > centralBounds.y + centralBounds.height) {
          return null;
        }

        placements.set(box.componentIndex, {
          x: cursorX,
          y: cursorY,
          width,
          height,
          localColumns: box.localColumns,
          localRows: box.localRows,
          componentSize: box.componentSize
        });

        cursorX += width;
        shelfHeight = Math.max(shelfHeight, height);
      }

      return placements;
    };

    let low = 0.25;
    let high = 1.25;
    let best = tryPack(low) || new Map();

    for (let iteration = 0; iteration < 14; iteration += 1) {
      const mid = (low + high) / 2;
      const packed = tryPack(mid);
      if (packed) {
        best = packed;
        low = mid;
      } else {
        high = mid;
      }
    }

    return best;
  }, [baseGraphLayout.components, worldSize.height, worldSize.width]);

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

  const renderedNodeMap = useMemo(() => new Map(renderedNodes.map((node) => [node.id, node.position])), [renderedNodes]);

  const visibleEdgePaths = useMemo(() => graphCollections.edges.map((edge) => {
    const source = renderedNodeMap.get(edge.source);
    const target = renderedNodeMap.get(edge.target);
    if (!source || !target) return null;

    const curveOffset = Math.min(90, 18 * edge.weight);
    const relationKey = edge.relationKinds.length > 1 ? 'mixed' : edge.relationKinds[0];
    const fade = selectedKeys.size > 0 ? Math.max(0.6, 1 - edge.focusDepth * 0.09) : 1;
    const widthScale = selectedKeys.size > 0 ? Math.max(0.58, 1 - edge.focusDepth * 0.08) : 0.8;

    return {
      id: edge.id,
      d: `M ${source.x},${source.y} C ${source.x},${source.y + curveOffset} ${target.x},${target.y - curveOffset} ${target.x},${target.y}`,
      stroke: getEdgeStroke(relationKey, fade),
      width: (1.8 + Math.min(edge.weight * 0.6, 4.5)) * widthScale
    };
  }).filter(Boolean), [graphCollections.edges, renderedNodeMap, selectedKeys.size]);

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
    baseGraphLayout.nodes.forEach((node) => {
      const existing = layoutRef.current.get(node.id);
      if (existing) return;

      const hint = baseGraphLayout.layoutHints.get(node.id) || { componentIndex: 0, localIndex: 0, componentSize: 1 };
      const region = componentRegions.get(hint.componentIndex) || {
        x: worldSize.width * 0.25,
        y: worldSize.height * 0.25,
        width: worldSize.width * 0.5,
        height: worldSize.height * 0.5,
        localColumns: 1,
        localRows: 1,
        componentSize: hint.componentSize
      };
      const localColumns = Math.max(1, region.localColumns);
      const localRows = Math.max(1, region.localRows);
      const localRow = Math.floor(hint.localIndex / localColumns);
      const localColumn = hint.localIndex % localColumns;
      const localSpacingX = Math.min(220, Math.max(120, region.width / (localColumns + 1)));
      const localSpacingY = Math.min(180, Math.max(110, region.height / (localRows + 1)));
      const componentCenterX = region.x + region.width / 2;
      const componentCenterY = region.y + region.height / 2;
      const x = componentCenterX + (localColumn - (localColumns - 1) / 2) * localSpacingX;
      const y = componentCenterY + (localRow - (localRows - 1) / 2) * localSpacingY;

      layoutRef.current.set(node.id, {
        x: clamp(x, worldSize.width * 0.12, worldSize.width * 0.88),
        y: clamp(y, worldSize.height * 0.12, worldSize.height * 0.88),
        vx: 0,
        vy: 0,
        dragging: false
      });
    });

  }, [baseGraphLayout, componentRegions, worldSize.height, worldSize.width]);

  useEffect(() => {
    if (hasAutoCenteredRef.current) return;
    const element = scrollRef.current;
    if (!element) return;

    const firstRegion = componentRegions.get(0);
    const initialCenterX = firstRegion ? firstRegion.x + firstRegion.width / 2 : worldSize.width / 2;
    const initialCenterY = firstRegion ? firstRegion.y + firstRegion.height / 2 : worldSize.height / 2;
    const targetLeft = Math.max(0, initialCenterX * zoom - viewportSize.width / 2);
    const targetTop = Math.max(0, initialCenterY * zoom - viewportSize.height / 2);

    element.scrollTo({ left: targetLeft, top: targetTop });
    hasAutoCenteredRef.current = true;
  }, [componentRegions, viewportSize.height, viewportSize.width, worldSize.height, worldSize.width, zoom]);

  useEffect(() => {
    let isMounted = true;

    const tick = () => {
      const nodes = graphCollections.nodes;
      const edges = graphCollections.edges;
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
          if (distanceSquared > REPULSION_RADIUS_SQUARED) continue;
          const radiusFalloff = 1 - distance / REPULSION_RADIUS;
          const repulsion = Math.min(MAX_REPULSION_FORCE, (2600 / distanceSquared) * Math.max(radiusFalloff, 0));
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
      context.lineWidth = 2.2 + Math.min(edge.weight * 0.75, 6);
      context.shadowColor = context.strokeStyle;
      context.shadowBlur = 5;
      context.stroke();
      context.shadowBlur = 0;
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

  const adjustZoom = useCallback((zoomUpdate, pivot = null) => {
    const scrollElement = scrollRef.current;
    if (!scrollElement) {
      setZoom(prev => clamp(typeof zoomUpdate === 'function' ? zoomUpdate(prev) : zoomUpdate, MIN_ZOOM, MAX_ZOOM));
      return;
    }

    const rect = scrollElement.getBoundingClientRect();
    const pivotX = pivot?.x ?? rect.width / 2;
    const pivotY = pivot?.y ?? rect.height / 2;

    setZoom(prevZoom => {
      const nextZoom = typeof zoomUpdate === 'function' ? zoomUpdate(prevZoom) : zoomUpdate;
      const clampedZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
      if (clampedZoom === prevZoom) return prevZoom;

      const worldX = (scrollElement.scrollLeft + pivotX) / prevZoom;
      const worldY = (scrollElement.scrollTop + pivotY) / prevZoom;

      zoomPivotRef.current = { worldX, worldY, pivotX, pivotY };
      return clampedZoom;
    });
  }, []);

  React.useLayoutEffect(() => {
    if (zoomPivotRef.current) {
      const scrollElement = scrollRef.current;
      if (scrollElement) {
        const { worldX, worldY, pivotX, pivotY } = zoomPivotRef.current;
        scrollElement.scrollLeft = worldX * zoom - pivotX;
        scrollElement.scrollTop = worldY * zoom - pivotY;
      }
      zoomPivotRef.current = null;
    }
  }, [zoom]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1 / 1.08 : 1.08;
      const rect = el.getBoundingClientRect();
      adjustZoom(z => z * factor, {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top
      });
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [adjustZoom]);

  const handleSearchSelect = (dynastyName) => {
    if (!dynastyName) return;
    onToggleDynasty(normalizeDynastyName(dynastyName));
    setSearchQuery('');
    setSearchOpen(false);
    setIsSearchVisible(false);
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
        className="absolute inset-0 overflow-hidden cursor-grab touch-none"
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
            <canvas ref={canvasRef} className="absolute inset-0 opacity-0" />
            <svg className="pointer-events-none absolute inset-0 z-0 overflow-visible" width={worldSize.width} height={worldSize.height} viewBox={`0 0 ${worldSize.width} ${worldSize.height}`}>
              {visibleEdgePaths.map((edge) => (
                <path
                  key={edge.id}
                  d={edge.d}
                  fill="none"
                  stroke={edge.stroke}
                  strokeWidth={edge.width}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  opacity={1}
                />
              ))}
            </svg>

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
                  className={`group absolute z-10 -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-2xl border text-left shadow-lg backdrop-blur-sm transition duration-200 ${isSelected ? 'border-blue-500 shadow-blue-200/80 ring-2 ring-blue-200' : 'border-slate-200 hover:border-slate-300'}`}
                  style={{
                    left: `${node.position.x}px`,
                    top: `${node.position.y}px`,
                    width: `${NODE_WIDTH}px`,
                    height: `${NODE_HEIGHT}px`
                  }}
                  title="Double-click to focus this dynasty"
                >
                  <img
                    src={getSigilUrl(node.rawHouse)}
                    alt={`${node.name} coat of arms`}
                    className="pointer-events-none absolute inset-0 h-full w-full select-none object-contain bg-white/95 p-2"
                    loading="lazy"
                    draggable={false}
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
                  <div aria-hidden="true" className="absolute inset-0 z-10" />
                  <div className="absolute inset-x-0 bottom-0 z-20 bg-slate-950/68 px-3 py-2 text-center">
                    <span className="block text-sm font-semibold leading-tight text-white drop-shadow-sm">{node.name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div data-no-pan className={`absolute left-4 top-24 z-10 rounded-2xl border border-white/60 bg-white/88 shadow-xl backdrop-blur-md transition-all duration-200 ${isSearchVisible ? 'w-[min(30rem,calc(100%-2rem))] p-4' : 'w-auto p-2'}`}>
        {!isSearchVisible ? (
          <div className="flex items-center gap-2">
            <button
              type="button"
              data-no-pan
              onClick={() => {
                setIsSearchVisible(true);
                setSearchOpen(true);
              }}
              className="rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
            >
              <span className="flex items-center gap-2"><Search className="h-4 w-4" /> Search</span>
            </button>
            <div data-no-pan className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white/80 p-1">
              <button
                type="button"
                data-no-pan
                onClick={() => adjustZoom(z => z / 1.12)}
                className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Zoom out"
              >
                <Minus className="h-4 w-4" />
              </button>
              <span className="min-w-14 text-center text-xs font-semibold text-slate-600">{Math.round(zoom * 100)}%</span>
              <button
                type="button"
                data-no-pan
                onClick={() => adjustZoom(z => z * 1.12)}
                className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                aria-label="Zoom in"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="flex items-center justify-between gap-4">
              <h2 className={`text-lg font-semibold ${theme.textPrimary}`}>Dynastic connections</h2>
              <div className="flex items-center gap-2">
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
                <button
                  type="button"
                  data-no-pan
                  onClick={() => {
                    setIsSearchVisible(false);
                    setSearchOpen(false);
                  }}
                  className="rounded-full p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-800"
                  aria-label="Close dynasty controls"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
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
                  onClick={() => adjustZoom(z => z / 1.12)}
                  className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Zoom out"
                >
                  <Minus className="h-4 w-4" />
                </button>
                <span className="min-w-14 text-center text-xs font-semibold text-slate-600">{Math.round(zoom * 100)}%</span>
                <button
                  type="button"
                  data-no-pan
                  onClick={() => adjustZoom(z => z * 1.12)}
                  className="rounded-lg p-2 text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
                  aria-label="Zoom in"
                >
                  <Plus className="h-4 w-4" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>

      {graphCollections.nodes.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center px-6 text-center text-slate-500">
          <div className="max-w-md rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-xl">
            <p className="text-base font-semibold text-slate-800">No dynasties are visible.</p>
            <p className="mt-2 text-sm">Adjust the hidden dynasty list to bring houses back into the graph.</p>
          </div>
        </div>
      )}

      {selectedDynasties.size > 0 && (
        <div data-no-pan className="absolute bottom-4 right-4 z-10 max-w-sm rounded-2xl border border-white/60 bg-white/88 p-4 shadow-xl backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between gap-4">
            <h3 className={`text-sm font-semibold ${theme.textPrimary}`}>Focused dynasties</h3>
            <button
              type="button"
              data-no-pan
              onClick={onClearSelectedDynasties}
              className="text-xs font-semibold text-slate-500 transition hover:text-slate-800"
            >
              Clear
            </button>
          </div>
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
        </div>
      )}

      {showInstructions && (
        <div data-no-pan className="absolute bottom-4 left-4 z-10 flex max-w-md items-start gap-3 rounded-2xl border border-white/60 bg-white/80 px-4 py-3 text-xs text-slate-600 shadow-lg backdrop-blur-md">
          <p className="flex-1 leading-relaxed">
            Pan by dragging the background. Drag a dynasty card to reposition it. Double-click any dynasty to focus its connected graph.
          </p>
          <button
            type="button"
            data-no-pan
            onClick={() => setShowInstructions(false)}
            className="rounded-full p-1 text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            aria-label="Dismiss graph instructions"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );
};

export default DynastyGraph;
