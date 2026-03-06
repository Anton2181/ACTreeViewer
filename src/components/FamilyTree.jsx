import React, { useMemo, useRef, useState } from 'react';
import { stratify, tree } from 'd3-hierarchy';
import { useTheme } from '../ThemeContext';

const FamilyTree = ({ data }) => {
    const { theme } = useTheme();
    const root = useMemo(() => {
        if (!data || data.length === 0) return null;

        // D3 hierarchy typically wants a single root.
        // In our CSV, we have multiple families (Targaryen, Baratheon, Velaryon, Arryn, etc.)
        // We need to create a synthetic "World" root node to tie them all together if they don't share one.

        // First, map nodes by ID so we can look them up by Name
        // The sheet links parents by Name ('Father', 'Mother' columns), not ID.
        const nameToId = {};
        data.forEach(char => {
            nameToId[char['First Name'] + ' ' + char['House']] = char.id;
            // also just store first name in case 'House' is omitted
            nameToId[char['First Name']] = char.id;
        });

        const nodes = data.map(char => {
            // Find parent ID. For a simple tree, we usually pick the Father as the primary topological parent,
            // or Mother if Father is missing.
            let parentId = null;
            if (char.Father) {
                parentId = nameToId[char.Father] || null;
            }
            if (!parentId && char.Mother) {
                parentId = nameToId[char.Mother] || null;
            }

            return {
                ...char,
                parentId: parentId
            };
        });

        // Find nodes without a parent in our dataset
        const parentIds = new Set(nodes.map(n => n.id));
        const roots = nodes.filter(n => !n.parentId || !parentIds.has(n.parentId));

        // Synthesize a master root
        nodes.push({ id: 'WORLD_ROOT', parentId: null, 'First Name': 'Westeros' });
        roots.forEach(r => {
            r.parentId = 'WORLD_ROOT';
        });

        // Detect and break cycles (e.g. Manfred Hightower & Addam Hightower)
        const visited = new Set();
        const stack = new Set();

        const hasCycle = (nodeId) => {
            if (!nodeId) return false;
            if (stack.has(nodeId)) return true;
            if (visited.has(nodeId)) return false;

            visited.add(nodeId);
            stack.add(nodeId);

            const node = nodes.find(n => n.id === nodeId);
            if (node && node.parentId) {
                if (hasCycle(node.parentId)) {
                    // Break the cycle by disconnecting this node from its parent
                    console.warn(`Cycle detected. Breaking at node: ${node['First Name']} (${node.id})`);
                    node.parentId = 'WORLD_ROOT';
                }
            }

            stack.delete(nodeId);
            return false;
        };

        nodes.forEach(n => {
            if (!visited.has(n.id)) {
                hasCycle(n.id);
            }
        });

        try {
            const rootHierarchy = stratify()
                .id(d => d.id)
                .parentId(d => d.parentId)(nodes);

            // configure tree layout
            // Adjust nodeSize based on how big character cards will be
            // Width was increased from 180 to 220 to add padding between the wider cards
            const treeLayout = tree().nodeSize([220, 250]);
            treeLayout(rootHierarchy);
            return rootHierarchy;
        } catch (e) {
            console.error("Tree layout error:", e);
            return null;
        }
    }, [data]);

    if (!root) {
        return <div className="text-gray-400 p-8">No valid tree data found.</div>;
    }

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

    // Center the viewport on the root node on mount/data change
    React.useEffect(() => {
        if (containerRef.current) {
            containerRef.current.scrollLeft = (CANVAS_WIDTH - window.innerWidth) / 2;
            containerRef.current.scrollTop = offsetY - 100;
        }
    }, [root]);

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
            className={`w-full h-full overflow-auto ${theme.bg} text-black absolute inset-0 custom-scrollbar transition-colors duration-500 cursor-grab`}
        >
            <svg width={CANVAS_WIDTH} height={CANVAS_HEIGHT} className="mx-auto transform-origin-top-left transition-transform duration-500 border-none outline-none">
                <g>
                    {/* Draw Links */}
                    {root.links().map((link, i) => {
                        // we don't draw links to the synthetic master root
                        if (link.source.id === 'WORLD_ROOT') return null;
                        return (
                            <path
                                key={`link-${i}`}
                                className={`${theme.link} fill-none transition-all duration-300`}
                                strokeWidth={2.5}
                                d={`
                  M ${link.source.x + offsetX},${link.source.y + 60 + offsetY}
                  C ${link.source.x + offsetX},${(link.source.y + link.target.y) / 2 + offsetY}
                    ${link.target.x + offsetX},${(link.source.y + link.target.y) / 2 + offsetY}
                    ${link.target.x + offsetX},${link.target.y + offsetY}
                `}
                            />
                        );
                    })}

                    {/* Draw Nodes */}
                    {root.descendants().map(node => {
                        if (node.id === 'WORLD_ROOT') return null;
                        const data = node.data;
                        return (
                            <g key={node.id} transform={`translate(${node.x + offsetX},${node.y + offsetY})`}>
                                <foreignObject x="-105" y="-15" width="210" height="130" style={{ overflow: 'visible' }}>
                                    <div className="w-full h-full flex justify-center items-center">
                                        <div className={`w-[180px] h-[100px] bg-gradient-to-b ${theme.cardBg} border ${theme.border} rounded-xl shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 hover:-translate-y-1 ${theme.hoverShadow} ${theme.hoverBorder} group relative overflow-hidden cursor-pointer`}>
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

                                            <p className="text-gray-600 text-[10px] grid grid-cols-2 gap-x-2 text-left w-full px-2 mt-1 z-10 pl-2">
                                                <span className="text-gray-600 text-right font-medium">Born:</span>
                                                <span className="text-gray-900 font-semibold">{data['Year of Birth'] || 'Unknown'}</span>

                                                <span className="text-gray-600 text-right font-medium">Age:</span>
                                                <span className="text-gray-900 font-semibold">{data['Age'] || '?'}</span>
                                            </p>

                                            <span className="absolute top-1 right-2 text-gray-400 text-[9px] font-mono opacity-80 z-10">
                                                #{data.id}
                                            </span>
                                        </div>
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
