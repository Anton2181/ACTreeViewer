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

const FamilyTree = ({ data }) => {
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

            const treeLayout = tree()
                .nodeSize([220, 250])
                .separation((a, b) => (a.data.groupSize + b.data.groupSize) / 2 + 0.2);
            treeLayout(rootHierarchy);

            const nodeMap = {};
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

    // Center the viewport on the root node on mount/data change
    React.useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollLeft = (CANVAS_WIDTH - window.innerWidth) / 2;
            containerRef.current.scrollTop = offsetY - 100;
        }
    }, [root]);

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

    return (
        <div
            ref={containerRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={onPointerUp}
            className={`w-full h-full overflow-hidden ${theme.bg} text-black absolute inset-0 transition-colors duration-500 cursor-grab`}
        >
            <svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="mx-auto border-none outline-none overflow-hidden">
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
                                    className={`stroke-rose-400/60 fill-none transition-all duration-300`}
                                    strokeWidth={1.5}
                                    strokeDasharray="5,5"
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
                                <foreignObject x={-W / 2 - 10} y="-65" width={W + 20} height="150" style={{ overflow: 'visible' }}>
                                    <div className="w-full h-full flex flex-row gap-[20px] items-center justify-center relative">

                                        {/* Marriage horizontal line between spouses in the cluster */}
                                        {N > 1 && (
                                            <div className={`absolute top-1/2 left-[95px] right-[95px] h-0.5 ${theme.link} -translate-y-1/2 z-0 opacity-50`}></div>
                                        )}

                                        {chars.map(data => (
                                            <div key={data.id} className={`w-[190px] h-[120px] shrink-0 bg-gradient-to-b ${theme.cardBg} border ${theme.border} rounded-xl shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 hover:-translate-y-1 ${theme.hoverShadow} ${theme.hoverBorder} group relative overflow-hidden cursor-pointer z-10`}>
                                                {/* Coat of Arms Background / Side Element */}
                                                {data['House'] && (
                                                    <img
                                                        src={`${import.meta.env.BASE_URL}coas/House_${data['House'].replace(/\s+/g, '_')}.svg`}
                                                        alt={`${data['House']} Coat of Arms`}
                                                        className="absolute -right-2 top-1/2 -translate-y-1/2 h-20 w-20 object-contain opacity-15 pointer-events-none"
                                                        onError={(e) => { e.target.style.display = 'none'; }}
                                                    />
                                                )}

                                                {/* Gender-based Accent Line */}
                                                <div className={`absolute left-0 top-0 bottom-0 w-1 ${data['Sex']?.toLowerCase().startsWith('f') ? 'bg-rose-400/60' :
                                                    data['Sex']?.toLowerCase().startsWith('m') ? 'bg-blue-400/60' :
                                                        'bg-gray-400/60'
                                                    }`} />

                                                <h3 className={`${theme.textPrimary} font-serif font-bold text-sm leading-tight mb-1 transition-colors drop-shadow-sm z-10 pl-1`}>
                                                    {data['First Name']}
                                                    <span className={`block text-[11px] ${theme.textSecondary} font-normal uppercase tracking-widest mt-0.5`}>
                                                        {data['House']}
                                                    </span>
                                                </h3>

                                                <div className={`w-8 h-px ${theme.border} my-1 z-10`}></div>

                                                <div className="w-full px-2 mt-1 z-10 pl-2 space-y-0.5">
                                                    <p className="text-gray-600 text-[9px] grid grid-cols-[3fr_5fr] gap-x-1 text-left w-full">
                                                        <span className="text-right font-medium opacity-80">Born:</span>
                                                        <span className="text-gray-900 font-semibold truncate text-[10px]">{data['Year of Birth'] || '?'} <span className="text-[8px] font-normal">(Age {data['Age'] || '?'})</span></span>
                                                    </p>
                                                    {data['Father'] && (
                                                        <p className="text-gray-600 text-[9px] grid grid-cols-[3fr_5fr] gap-x-1 text-left w-full">
                                                            <span className="text-right font-medium opacity-80 text-blue-700/70">F:</span>
                                                            <span className="text-gray-900 font-semibold truncate" title={data['Father']}>{data['Father']}</span>
                                                        </p>
                                                    )}
                                                    {data['Mother'] && (
                                                        <p className="text-gray-600 text-[9px] grid grid-cols-[3fr_5fr] gap-x-1 text-left w-full">
                                                            <span className="text-right font-medium opacity-80 text-rose-700/70">M:</span>
                                                            <span className="text-gray-900 font-semibold truncate" title={data['Mother']}>{data['Mother']}</span>
                                                        </p>
                                                    )}
                                                </div>

                                                <span className="absolute top-1 right-2 text-gray-400 text-[9px] font-mono opacity-80 z-10">
                                                    #{data.id}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </foreignObject>
                            </g>
                        );
                    })}
                </g>
            </svg>
        </div>
    );
};

export default FamilyTree;
