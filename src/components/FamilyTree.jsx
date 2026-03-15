import React, { useMemo, useRef, useState } from 'react';
import { stratify, tree } from 'd3-hierarchy';
import { useTheme } from '../ThemeContext';

class UnionFind {
    constructor() { this.parent = {}; }
    add(i) { if (this.parent[i] === undefined) this.parent[i] = i; }
    find(i) {
        if (this.parent[i] === undefined) return i;
        if (this.parent[i] === i) return i;
        return this.parent[i] = this.find(this.parent[i]);
    }
    union(i, j) {
        let rootI = this.find(i);
        let rootJ = this.find(j);
        if (rootI !== rootJ) this.parent[rootI] = rootJ;
    }
}

const FamilyTree = ({ data, allData, onFilterHouse, recenterTrigger }) => {
    const { theme } = useTheme();
    const { root, idToNode, charToGroup } = useMemo(() => {
        if (!data || data.length === 0) return { root: null, idToNode: {}, charToGroup: {} };
        // 1. Unify Spouses
        const uf = new UnionFind();
        data.forEach(char => uf.add(char.id.toString()));
        data.forEach(char => {
            if (char.FatherId && char.MotherId) {
                uf.union(char.FatherId.toString(), char.MotherId.toString());
            }
        });

        // 2. Map characters to groups
        const groupsMap = {};
        data.forEach(char => {
            const rootId = uf.find(char.id.toString());
            if (!groupsMap[rootId]) groupsMap[rootId] = [];
            groupsMap[rootId].push(char);
        });

        const d3Nodes = [];
        const charToGroupMap = {};

        // 3. Create Family Units
        Object.values(groupsMap).forEach(groupChars => {
            let tr = groupChars[0];
            let score = -1;
            groupChars.forEach(c => {
                let s = 0;
                if (c.Sex && c.Sex.toLowerCase().startsWith('m')) s += 1;
                if (c.FatherId || c.MotherId) s += 2;
                if (s > score) {
                    score = s;
                    tr = c;
                }
            });

            groupChars.sort((a, b) => {
                const aM = a.Sex && a.Sex.toLowerCase().startsWith('m') ? 0 : 1;
                const bM = b.Sex && b.Sex.toLowerCase().startsWith('m') ? 0 : 1;
                if (aM !== bM) return aM - bM;
                if (a.id === tr.id) return -1;
                if (b.id === tr.id) return 1;
                return 0;
            });

            const d3Node = {
                id: tr.id.toString(),
                TR: tr,
                chars: groupChars,
                groupSize: groupChars.length,
                parentId: null
            };

            groupChars.forEach(c => charToGroupMap[c.id.toString()] = d3Node.id);
            d3Nodes.push(d3Node);
        });

        d3Nodes.push({ id: 'WORLD_ROOT', TR: { id: 'WORLD_ROOT', 'First Name': 'Westeros' }, chars: [], groupSize: 1, parentId: null });

        // 4. Resolve topologies
        const getSafeParent = (nodeId) => {
            const node = d3Nodes.find(n => n.id === nodeId);
            if (!node || node.id === 'WORLD_ROOT') return null;

            const tr = node.TR;
            let parentGroupId = null;
            if (tr.FatherId) parentGroupId = charToGroupMap[tr.FatherId.toString()];
            if (!parentGroupId && tr.MotherId) parentGroupId = charToGroupMap[tr.MotherId.toString()];

            return parentGroupId || 'WORLD_ROOT';
        };

        d3Nodes.forEach(n => {
            if (n.id !== 'WORLD_ROOT') {
                n.parentId = getSafeParent(n.id);
            }
        });

        // 5. Break biological loop errors
        const visited = new Set();
        const stack = new Set();

        const breakCycle = (nodeId) => {
            if (!nodeId || nodeId === 'WORLD_ROOT') return false;
            if (stack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            stack.add(nodeId);

            const node = d3Nodes.find(n => n.id === nodeId);
            if (node && node.parentId) {
                if (breakCycle(node.parentId)) {
                    node.parentId = 'WORLD_ROOT';
                }
            }

            stack.delete(nodeId);
            return false;
        };

        d3Nodes.forEach(n => {
            if (!visited.has(n.id)) breakCycle(n.id);
        });

        try {
            const rootHierarchy = stratify()
                .id(d => d.id)
                .parentId(d => d.parentId)(d3Nodes);

            // Initial Arbitrary Layout Pass to establish parent X coordinates
            rootHierarchy.sort((a, b) => {
                if (!a.parent || a.parent.id === 'WORLD_ROOT') return 0;
                const yearA = parseInt(a.data.TR['Year of Birth']) || 9999;
                const yearB = parseInt(b.data.TR['Year of Birth']) || 9999;
                return yearA - yearB;
            });

            const treeLayout = tree()
                .nodeSize([220, 250])
                .separation((a, b) => (a.data.groupSize + b.data.groupSize) / 2 + 0.2);

            treeLayout(rootHierarchy);

            // Calculate Barycentric X for Cross-Minimization
            const nodeMap = {};
            rootHierarchy.descendants().forEach(n => nodeMap[n.id] = n);

            rootHierarchy.descendants().forEach(node => {
                let sumX = 0;
                let count = 0;

                // Average the X coordinates of ALL parents of ALL spouses in this block
                node.data.chars.forEach(char => {
                    [char.FatherId, char.MotherId].forEach(pid => {
                        if (pid) {
                            const pGroupId = charToGroupMap[pid.toString()];
                            if (pGroupId && nodeMap[pGroupId]) {
                                sumX += nodeMap[pGroupId].x;
                                count++;
                            }
                        }
                    });
                });

                // If the spouses don't have parents inside the graph, default to their own X
                node.barycenterX = count > 0 ? sumX / count : node.x;
            });

            // Second Layout Pass: Sort Siblings Geographically
            rootHierarchy.sort((a, b) => {
                if (!a.parent || a.parent.id === 'WORLD_ROOT') return 0;

                const getCategory = (childNode, parentNode) => {
                    const childChar = childNode.data.TR;
                    const fId = childChar.FatherId ? childChar.FatherId.toString() : null;
                    const mId = childChar.MotherId ? childChar.MotherId.toString() : null;
                    const pIds = parentNode.data.chars.map(c => c.id.toString());

                    const hasFather = fId && pIds.includes(fId);
                    const hasMother = mId && pIds.includes(mId);

                    if (hasFather && !hasMother) return -1;
                    if (!hasFather && hasMother) return 1;
                    return 0; // Shared or other
                };

                const catA = getCategory(a, a.parent);
                const catB = getCategory(b, b.parent);

                // First rule: bastards must go to their respective edges
                if (catA !== catB) return catA - catB;

                // Second rule: Topological X sorting (pulls nodes towards their parent-in-laws)
                return a.barycenterX - b.barycenterX;
            });

            // Apply final layout based on geographical sort
            treeLayout(rootHierarchy);

            // Re-map nodes after final coordinates
            rootHierarchy.descendants().forEach(n => nodeMap[n.id] = n);

            return { root: rootHierarchy, idToNode: nodeMap, charToGroup: charToGroupMap };
        } catch (e) {
            console.error("Tree layout error:", e);
            return { root: null, idToNode: {}, charToGroup: {} };
        }
    }, [data]);

    if (!root) {
        return <div className="text-gray-400 p-8">No valid tree data found.</div>;
    }

    // Helper geometry for clustered layouts
    const getCharXLocal = (node, charId) => {
        const chars = node.data.chars;
        if (!chars) return 0;
        const index = chars.findIndex(c => c.id.toString() === charId.toString());
        if (index === -1) return 0;
        const N = chars.length;
        const W = 190 * N + 20 * (N - 1);
        return -W / 2 + index * 210 + 95;
    };

    const getCharXGlobal = (nodeId, charId) => {
        const node = idToNode[nodeId];
        if (!node) return 0;
        return node.x + getCharXLocal(node, charId);
    };

    const getParentMidpointGlobal = (parentGroupNode, childChar) => {
        if (parentGroupNode.id === 'WORLD_ROOT') return parentGroupNode.x;
        const fId = childChar.FatherId;
        const mId = childChar.MotherId;
        let xSum = 0;
        let count = 0;
        if (fId) {
            const x = getCharXGlobal(parentGroupNode.id, fId);
            if (x !== undefined && !isNaN(x)) { xSum += x; count++; }
        }
        if (mId) {
            const x = getCharXGlobal(parentGroupNode.id, mId);
            if (x !== undefined && !isNaN(x)) { xSum += x; count++; }
        }
        if (count === 0) return parentGroupNode.x;
        return xSum / count;
    };

    // Provide a massive canvas for free panning
    const CANVAS_WIDTH = 20000;
    const CANVAS_HEIGHT = 20000;

    // Place the root node in the upper-middle of the canvas
    const offsetX = CANVAS_WIDTH / 2;
    const offsetY = 2000;

    const containerRef = useRef(null);
    const [isDragging, setIsDragging] = useState(false);
    const [startX, setStartX] = useState(0);
    const [startY, setStartY] = useState(0);
    const [zoom, setZoom] = useState(1);
    const zoomRef = React.useRef(1);

    // Use a ref for pinch state to avoid stale closures
    const pinchRef = React.useRef(null); // { dist, zoom }

    // Keep zoomRef in sync
    React.useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    // Ref for single-finger pan start position (to avoid React stale state in native listeners)
    const panStartRef = React.useRef({ x: 0, y: 0 });
    // Char ID to scroll to after the next re-render (set before filter change, consumed after)
    const scrollToCharRef = React.useRef(null);

    // Search + Zoom State
    const [isSearchOpen, setIsSearchOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState([]);
    const [highlightedCharId, setHighlightedCharId] = useState(null);
    const [isZoomOpen, setIsZoomOpen] = useState(false);

    // On mount / data change
    React.useEffect(() => {
        if (!root) return;
        const charId = scrollToCharRef.current;
        if (charId) {
            scrollToCharRef.current = null;
            // Find this char in the NEW layout
            let targetNode = null;
            let localX = 0;
            root.descendants().forEach(node => {
                if (node.id === 'WORLD_ROOT') return;
                const char = node.data.chars.find(c => c.id.toString() === charId);
                if (char) {
                    targetNode = node;
                    const idx = node.data.chars.findIndex(c => c.id.toString() === charId);
                    const N = node.data.chars.length;
                    const W = 190 * N + 20 * (N - 1);
                    localX = -W / 2 + idx * 210 + 95;
                }
            });
            if (targetNode) {
                setTimeout(() => scrollToSvg(targetNode.x + offsetX + localX, targetNode.y + offsetY, true), 30);
                return;
            }
        }
        setTimeout(handleRecenter, 0);
    }, [root]);

    const handleRecenter = () => {
        const el = containerRef.current;
        if (!el || !root) return;

        // Find the node containing the character with the lowest numeric ID
        let topNode = null;
        let minId = Infinity;
        root.descendants().forEach(node => {
            if (node.id === 'WORLD_ROOT') return;
            node.data.chars.forEach(char => {
                const id = parseInt(char.id, 10);
                if (!isNaN(id) && id < minId) {
                    minId = id;
                    topNode = node;
                }
            });
        });

        if (!topNode) return;

        // Node's unscaled SVG position
        const svgX = topNode.x + offsetX;
        const svgY = topNode.y + offsetY;

        // With transform: scale(zoom) on the inner <g>, the node visually
        // appears at (zoom * svgX, zoom * svgY) within the scroll container.
        const z = zoomRef.current;
        el.scrollTo({
            left: z * svgX - el.clientWidth / 2,
            top: z * svgY - el.clientHeight / 3,
            behavior: 'smooth'
        });
    };

    // Apply zoom while keeping the viewport center fixed
    const applyZoom = (newZoom) => {
        newZoom = Math.min(2, Math.max(0.5, newZoom));
        const el = containerRef.current;
        if (!el) { setZoom(newZoom); zoomRef.current = newZoom; return; }
        const prevZoom = zoomRef.current;
        const cx = el.scrollLeft + el.clientWidth / 2;
        const cy = el.scrollTop + el.clientHeight / 2;
        const unscaledX = cx / prevZoom;
        const unscaledY = cy / prevZoom;
        el.scrollLeft = unscaledX * newZoom - el.clientWidth / 2;
        el.scrollTop = unscaledY * newZoom - el.clientHeight / 2;
        zoomRef.current = newZoom;
        setZoom(newZoom);
    };

    // Shared helper: scroll so that the given SVG coordinate is centered in the viewport
    const scrollToSvg = (svgX, svgY, smooth = true) => {
        const el = containerRef.current;
        if (!el) return;
        const z = zoomRef.current;
        el.scrollTo({
            left: z * svgX - el.clientWidth / 2,
            top: z * svgY - el.clientHeight / 3,
            behavior: smooth ? 'smooth' : 'instant',
        });
    };

    const handleSearch = (e) => {
        const query = e.target.value;
        setSearchQuery(query);

        if (query.trim().length === 0) {
            setSearchResults([]);
            return;
        }

        const lowerQuery = query.toLowerCase();

        // Find matches in ALL data to suggest House filters
        const sourceData = allData && allData.length > 0 ? allData : data;
        const matchedCharsAll = sourceData.filter(char => {
            const nameMatch = char['First Name']?.toLowerCase().includes(lowerQuery);
            const houseMatch = char['House']?.toLowerCase().includes(lowerQuery);
            return nameMatch || houseMatch;
        });

        const matchedHouses = Array.from(new Set(matchedCharsAll.map(c => c['House']).filter(Boolean)));

        // Find character matches only in VISIBLE data so we can pan to them
        const matchedCharsVisible = data.filter(char => {
            const nameMatch = char['First Name']?.toLowerCase().includes(lowerQuery);
            const houseMatch = char['House']?.toLowerCase().includes(lowerQuery);
            return nameMatch || houseMatch;
        });

        const results = [
            ...matchedHouses.map(h => ({ isHouseFilter: true, House: h, id: `filter-${h}` })),
            ...matchedCharsVisible.slice(0, 8)
        ];

        setSearchResults(results);
    };

    const handleSelectSearchResult = (res) => {
        if (res.isHouseFilter) {
            if (onFilterHouse) onFilterHouse(res.House);
            setSearchQuery('');
            setSearchResults([]);
            setIsSearchOpen(false);
            return;
        }

        const char = res;
        setHighlightedCharId(char.id.toString());
        setSearchQuery('');
        setSearchResults([]);
        setIsSearchOpen(false);

        // Calculate global coordinates of the selected character
        const parentGroupId = charToGroup[char.id.toString()];
        if (!parentGroupId) return;

        const charXGlobal = getCharXGlobal(parentGroupId, char.id.toString());
        const parentGroupNode = idToNode[parentGroupId];
        if (!parentGroupNode) return;
        const charYGlobal = parentGroupNode.y;

        // Animate pan to center the desired character
        if (containerRef.current) {
            containerRef.current.scrollTo({
                left: (charXGlobal + offsetX) * zoom - window.innerWidth / 2,
                top: (charYGlobal + offsetY) * zoom - window.innerHeight / 2,
                behavior: 'smooth'
            });
        }
    };

    // Handle Wheel for Zoom
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const handleWheel = (e) => {
            e.preventDefault();
            const delta = e.deltaY;

            setZoom(prev => {
                let newZoom = prev - delta * 0.002;
                newZoom = Math.min(Math.max(0.1, newZoom), 3);

                // Adjust scroll position to keep mouse at same relative spot
                const rect = el.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;

                const scrollX = el.scrollLeft;
                const scrollY = el.scrollTop;

                const canvasX = scrollX + mouseX;
                const canvasY = scrollY + mouseY;

                const unscaledX = canvasX / prev;
                const unscaledY = canvasY / prev;

                const newScrollX = unscaledX * newZoom - mouseX;
                const newScrollY = unscaledY * newZoom - mouseY;

                requestAnimationFrame(() => {
                    if (el) {
                        el.scrollLeft = newScrollX;
                        el.scrollTop = newScrollY;
                    }
                });

                return newZoom;
            });
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        // Also disable normal dragging so that trackpad swipe doesn't naturally trigger history gestures
        return () => el.removeEventListener('wheel', handleWheel);
    }, []);

    const onPointerDown = (e) => {
        if (e.target.closest('button')) return;
        setIsDragging(true);
        setStartX(e.clientX);
        setStartY(e.clientY);
        if (containerRef.current) {
            containerRef.current.style.cursor = 'grabbing';
            containerRef.current.style.userSelect = 'none';
        }
    };

    const onPointerMove = (e) => {
        if (!isDragging || !containerRef.current) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        containerRef.current.scrollLeft -= dx;
        containerRef.current.scrollTop -= dy;

        setStartX(e.clientX);
        setStartY(e.clientY);
    };

    const onPointerUp = () => {
        setIsDragging(false);
        if (containerRef.current) {
            containerRef.current.style.cursor = 'grab';
            containerRef.current.style.userSelect = 'auto';
        }
    };

    // Single-finger pan via native listeners (no pinch)
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onTouchStart = (e) => {
            if (e.touches.length === 1 && !e.target.closest('button') && !e.target.closest('input')) {
                panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        };

        const onTouchMove = (e) => {
            if (e.touches.length === 1) {
                e.preventDefault();
                const dx = e.touches[0].clientX - panStartRef.current.x;
                const dy = e.touches[0].clientY - panStartRef.current.y;
                el.scrollLeft -= dx;
                el.scrollTop -= dy;
                panStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            }
        };

        el.addEventListener('touchstart', onTouchStart, { passive: true });
        el.addEventListener('touchmove', onTouchMove, { passive: false });

        return () => {
            el.removeEventListener('touchstart', onTouchStart);
            el.removeEventListener('touchmove', onTouchMove);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            onPointerCancel={onPointerUp}
            className={`w-full h-full overflow-hidden ${theme.bg} text-black absolute inset-0 transition-colors duration-500 cursor-grab touch-none`}
        >
            <svg width={CANVAS_WIDTH * zoom} height={CANVAS_HEIGHT * zoom} className="mx-auto border-none outline-none overflow-hidden">
                <g style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
                    {/* Primary Pedigree Links */}
                    {root.links().map((link, i) => {
                        if (link.source.id === 'WORLD_ROOT') return null;

                        const childTR = link.target.data.TR;
                        const sourceX = getParentMidpointGlobal(link.source, childTR) + offsetX;
                        const targetX = getCharXGlobal(link.target.id, childTR.id.toString()) + offsetX;

                        return (
                            <path
                                key={`link-${i}`}
                                className={`${theme.link} fill-none transition-all duration-300`}
                                strokeWidth={2.5}
                                d={`
                  M ${sourceX},${link.source.y + 65 + offsetY}
                  C ${sourceX},${(link.source.y + link.target.y) / 2 + offsetY}
                    ${targetX},${(link.source.y + link.target.y) / 2 + offsetY}
                    ${targetX},${link.target.y - 65 + offsetY}
                `}
                            />
                        );
                    })}

                    {/* Secondary Consanguinity Links */}
                    {root.descendants().map((node) => {
                        if (node.id === 'WORLD_ROOT') return null;

                        return node.data.chars.map((char) => {
                            if (char.id.toString() === node.data.TR.id.toString()) return null;

                            const parentId = char.FatherId || char.MotherId;
                            if (!parentId) return null;

                            const parentGroupId = charToGroup[parentId.toString()];
                            if (!parentGroupId) return null;

                            const parentGroupNode = idToNode[parentGroupId];
                            if (!parentGroupNode) return null;

                            const sourceX = getParentMidpointGlobal(parentGroupNode, char) + offsetX;
                            const targetX = getCharXGlobal(node.id, char.id.toString()) + offsetX;

                            return (
                                <path
                                    key={`consang-${char.id}`}
                                    className={`${theme.link} fill-none transition-all duration-300`}
                                    strokeWidth={2.5}
                                    d={`
                      M ${sourceX},${parentGroupNode.y + 65 + offsetY}
                      C ${sourceX},${(parentGroupNode.y + node.y) / 2 + offsetY}
                        ${targetX},${(parentGroupNode.y + node.y) / 2 + offsetY}
                        ${targetX},${node.y - 65 + offsetY}
                    `}
                                />
                            );
                        });
                    })}

                    {/* Draw Family Units */}
                    {root.descendants().map(node => {
                        if (node.id === 'WORLD_ROOT') return null;

                        const chars = node.data.chars;
                        const N = chars.length;
                        const W = 190 * N + 20 * (N - 1);

                        return (
                            <g key={node.id} transform={`translate(${node.x + offsetX},${node.y + offsetY})`}>
                                {/* Marriage horizontal line between spouses in the cluster */}
                                {N > 1 && (
                                    <line
                                        x1={-W / 2 + 95}
                                        y1={0}
                                        x2={W / 2 - 95}
                                        y2={0}
                                        className={`${theme.link} opacity-50`}
                                        strokeWidth={2}
                                    />
                                )}

                                {chars.map(data => {
                                    const charXLocal = getCharXLocal(node, data.id.toString());
                                    const isHighlighted = highlightedCharId === data.id.toString();
                                    const sexColor = data['Sex']?.toLowerCase().startsWith('f') ? '#fb7185' :
                                        data['Sex']?.toLowerCase().startsWith('m') ? '#60a5fa' :
                                            '#9ca3af';

                                    // Theme colors mapping to hex for SVG compatibility
                                    const isDark = theme.current === 'dark';
                                    const cardFill = isDark ? '#1e293b' : '#f8fafc';
                                    const strokeColor = isDark ? '#334155' : '#cbd5e1';
                                    const textPrimary = isDark ? '#f1f5f9' : '#0f172a';
                                    const textSecondary = isDark ? '#94a3b8' : '#475569';
                                    const highlightStroke = '#facc15';

                                    return (
                                        <g
                                            key={data.id}
                                            transform={`translate(${charXLocal}, -60)`}
                                            onDoubleClick={(e) => {
                                                e.stopPropagation();
                                                if (onFilterHouse && data['House']) {
                                                    scrollToCharRef.current = data.id.toString();
                                                    onFilterHouse(data['House']);
                                                }
                                            }}
                                            className="cursor-pointer group"
                                        >
                                            {/* Base Card Background with Shadow (drop-shadow via filter would be better but simple rect works) */}
                                            <rect
                                                x={-95}
                                                y={0}
                                                width={190}
                                                height={120}
                                                rx={12}
                                                fill={cardFill}
                                                stroke={isHighlighted ? highlightStroke : strokeColor}
                                                strokeWidth={isHighlighted ? 4 : 1}
                                                className="transition-all duration-300"
                                            />

                                            {/* Gender-based Accent Line */}
                                            <rect
                                                x={-95}
                                                y={0}
                                                width={4}
                                                height={120}
                                                rx={2}
                                                fill={sexColor}
                                                opacity={0.8}
                                            />

                                            {/* Coat of Arms Background / Side Element */}
                                            {data['House'] && (
                                                <image
                                                    href={`${import.meta.env.BASE_URL}coas/House_${data['House'].replace(/\s+/g, '_')}.svg`}
                                                    x={-5}
                                                    y={20}
                                                    width={100}
                                                    height={80}
                                                    opacity={0.15}
                                                    className="pointer-events-none"
                                                    onError={(e) => {
                                                        const el = e.target;
                                                        if (!el.dataset.triedPng) {
                                                            el.dataset.triedPng = '1';
                                                            const fallbackPath = `${import.meta.env.BASE_URL}coas/House_${data['House'].replace(/\s+/g, '_')}.png`;
                                                            el.setAttribute('href', fallbackPath);
                                                            el.setAttribute('xlink:href', fallbackPath);
                                                        } else {
                                                            el.style.display = 'none';
                                                        }
                                                    }}
                                                />
                                            )}

                                            {/* Character ID */}
                                            <text x={85} y={15} fill={textSecondary} fontSize={9} fontFamily="monospace" textAnchor="end" opacity={0.8}>
                                                #{data.id}
                                            </text>

                                            {/* First Name */}
                                            <text x={0} y={30} fill={textPrimary} fontSize={14} fontWeight="bold" fontFamily="Cinzel, serif" textAnchor="middle">
                                                {data['First Name']}
                                            </text>

                                            {/* House / Dynasty */}
                                            <text x={0} y={45} fill={textSecondary} fontSize={11} letterSpacing={2} textAnchor="middle" textTransform="uppercase">
                                                {data['House']}
                                            </text>


                                            {/* Born Info */}
                                            <text x={-20} y={75} fill={textSecondary} fontSize={9} textAnchor="end" fontWeight="500">Born:</text>
                                            <text x={-15} y={75} fill={textPrimary} fontSize={10} fontWeight="bold" textAnchor="start">
                                                {data['Year of Birth'] || '?'}
                                                <tspan fill={textSecondary} fontSize={8} fontWeight="normal"> (Age {data['Age'] || '?'})</tspan>
                                            </text>

                                            {/* Father Info */}
                                            {data['Father'] && (
                                                <>
                                                    <text x={-20} y={90} fill="#3b82f6" fontSize={9} textAnchor="end" fontWeight="500" opacity={0.8}>F:</text>
                                                    <text x={-15} y={90} fill={textPrimary} fontSize={9} fontWeight="bold" textAnchor="start">
                                                        {data['Father'].length > 18 ? data['Father'].substring(0, 15) + '...' : data['Father']}
                                                    </text>
                                                </>
                                            )}

                                            {/* Mother Info */}
                                            {data['Mother'] && (
                                                <>
                                                    <text x={-20} y={105} fill="#e11d48" fontSize={9} textAnchor="end" fontWeight="500" opacity={0.8}>M:</text>
                                                    <text x={-15} y={105} fill={textPrimary} fontSize={9} fontWeight="bold" textAnchor="start">
                                                        {data['Mother'].length > 18 ? data['Mother'].substring(0, 15) + '...' : data['Mother']}
                                                    </text>
                                                </>
                                            )}
                                        </g>
                                    );
                                })}
                            </g>
                        );
                    })}
                </g>
            </svg>

            <button
                onClick={handleRecenter}
                className={`fixed bottom-8 right-8 p-4 rounded-full shadow-2xl border backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 z-50 flex items-center justify-center ${theme.cardBg} ${theme.border} ${theme.textPrimary}`}
                title="Recenter Tree"
            >
                <svg className="w-6 h-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                </svg>
            </button>

            {/* Zoom Toggle Button */}
            <button
                onClick={() => setIsZoomOpen(o => !o)}
                className={`fixed bottom-[104px] right-8 p-4 rounded-full shadow-2xl border backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 z-50 flex items-center justify-center ${isZoomOpen ? 'bg-blue-600 border-blue-400 text-white' : `${theme.cardBg} ${theme.border} ${theme.textPrimary}`}`}
                title="Zoom"
            >
                <svg className="w-6 h-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 7v3m0 0v3m0-3h3m-3 0H7" />
                </svg>
            </button>

            {/* Zoom Slider Panel */}
            {isZoomOpen && (
                <>
                    {/* Backdrop to close on outside click */}
                    <div className="fixed inset-0 z-40" onClick={() => setIsZoomOpen(false)} />
                    <div className={`fixed bottom-[184px] right-8 z-50 flex flex-col items-center gap-2 p-3 rounded-2xl shadow-2xl border backdrop-blur-md ${theme.cardBg} ${theme.border}`}>
                        <button
                            onClick={() => applyZoom(zoom + 0.1)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold ${theme.textPrimary} hover:bg-white/20 active:scale-90 transition-all`}
                            title="Zoom In"
                        >+</button>
                        <input
                            type="range"
                            min={0.5}
                            max={2}
                            step={0.05}
                            value={zoom}
                            onChange={(e) => applyZoom(parseFloat(e.target.value))}
                            className="h-32 cursor-pointer accent-current"
                            style={{ writingMode: 'vertical-lr', direction: 'rtl', WebkitAppearance: 'slider-vertical' }}
                            title={`Zoom: ${Math.round(zoom * 100)}%`}
                        />
                        <button
                            onClick={() => applyZoom(zoom - 0.1)}
                            className={`w-8 h-8 rounded-full flex items-center justify-center text-lg font-bold ${theme.textPrimary} hover:bg-white/20 active:scale-90 transition-all`}
                            title="Zoom Out"
                        >−</button>
                        <span className={`text-[9px] font-mono ${theme.textSecondary} opacity-70`}>{Math.round(zoom * 100)}%</span>
                    </div>
                </>
            )}

            <div className="fixed bottom-8 right-[112px] z-50 flex items-end flex-col gap-2">
                {isSearchOpen && (
                    <div className={`mb-2 w-72 rounded-xl shadow-2xl border backdrop-blur-md overflow-hidden transition-all duration-300 ${theme.cardBg} ${theme.border}`}>
                        <div className="p-2 border-b border-gray-700/50">
                            <input
                                autoFocus
                                type="text"
                                placeholder="Search by Name or House..."
                                className={`w-full bg-transparent border-none outline-none px-3 py-2 text-sm ${theme.textPrimary} placeholder-gray-500`}
                                value={searchQuery}
                                onChange={handleSearch}
                            />
                        </div>
                        {searchResults.length > 0 && (
                            <div className="max-h-60 overflow-y-auto custom-scrollbar">
                                {searchResults.map(res => {
                                    if (res.isHouseFilter) {
                                        return (
                                            <div
                                                key={res.id}
                                                onClick={() => handleSelectSearchResult(res)}
                                                className={`px-4 py-3 cursor-pointer hover:bg-white/10 border-b last:border-0 border-gray-700/50 transition-colors flex items-center justify-between bg-blue-900/40`}
                                            >
                                                <span className={`${theme.textPrimary} font-bold text-sm tracking-wide`}>Filter: {res.House}</span>
                                                <svg className="w-4 h-4 text-blue-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                                                </svg>
                                            </div>
                                        );
                                    }
                                    return (
                                        <div
                                            key={res.id}
                                            onClick={() => handleSelectSearchResult(res)}
                                            className={`px-4 py-3 cursor-pointer hover:bg-white/5 border-b last:border-0 border-gray-700/50 transition-colors flex justify-between items-center`}
                                        >
                                            <div className="flex flex-col">
                                                <span className={`${theme.textPrimary} font-bold text-sm`}>{res['First Name']}</span>
                                                <span className={`${theme.textSecondary} text-[10px] uppercase tracking-wider`}>{res['House']}</span>
                                            </div>
                                            <div className="text-[10px] text-gray-500 tabular-nums">Born {res['Year of Birth']}</div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                        {searchQuery && searchResults.length === 0 && (
                            <div className="px-4 py-4 text-center text-gray-500 text-xs italic">
                                No characters found.
                            </div>
                        )}
                    </div>
                )}

                <button
                    onClick={() => {
                        setIsSearchOpen(!isSearchOpen);
                        if (isSearchOpen) {
                            setSearchQuery('');
                            setSearchResults([]);
                        }
                    }}
                    className={`p-4 rounded-full shadow-2xl border backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 flex items-center justify-center ${isSearchOpen ? 'bg-blue-600 border-blue-400 text-white' : `${theme.cardBg} ${theme.border} ${theme.textPrimary}`}`}
                    title="Search Tree"
                >
                    <svg className="w-6 h-6 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                </button>
            </div>
        </div>
    );
};

export default FamilyTree;
