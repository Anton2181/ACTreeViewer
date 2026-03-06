import React, { useMemo } from 'react';
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
            const treeLayout = tree().nodeSize([180, 250]);
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

    // Calculate bounding box to center/zoom later
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    root.each(node => {
        if (node.x < minX) minX = node.x;
        if (node.x > maxX) maxX = node.x;
        if (node.y < minY) minY = node.y;
        if (node.y > maxY) maxY = node.y;
    });

    const width = Math.max(maxX - minX + 400, window.innerWidth);
    const height = Math.max(maxY - minY + 400, window.innerHeight);
    // Offset to center the bounding box
    const offsetX = -minX + 200;
    const offsetY = -minY + 200;

    return (
        <div className={`w-full h-full overflow-auto ${theme.bg} text-black absolute inset-0 custom-scrollbar transition-colors duration-500`}>
            <svg width={width} height={height} className="mx-auto transform-origin-top-left transition-transform duration-500 border-none outline-none">
                <g transform={`translate(${offsetX}, ${offsetY})`}>
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
                  M ${link.source.x},${link.source.y + 60}
                  C ${link.source.x},${(link.source.y + link.target.y) / 2}
                    ${link.target.x},${(link.source.y + link.target.y) / 2}
                    ${link.target.x},${link.target.y}
                `}
                            />
                        );
                    })}

                    {/* Draw Nodes */}
                    {root.descendants().map(node => {
                        if (node.id === 'WORLD_ROOT') return null;
                        const data = node.data;
                        return (
                            <g key={node.id} transform={`translate(${node.x},${node.y})`}>
                                <foreignObject x="-75" y="0" width="150" height="100">
                                    <div className={`w-full h-full p-2 bg-gradient-to-b ${theme.cardBg} border ${theme.border} rounded-xl shadow-2xl flex flex-col items-center justify-center text-center transition-all duration-300 hover:-translate-y-1 ${theme.hoverShadow} ${theme.hoverBorder} group relative overflow-hidden`}>

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
