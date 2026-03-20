import React, { useMemo, useRef, useState } from 'react';
import { stratify } from 'd3-hierarchy';
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

const getBirthYear = (node) => parseInt(node?.data?.TR?.['Year of Birth'], 10) || 9999;

const getStableNodeOrder = (node) => {
    const numericId = parseInt(node?.id, 10);
    return Number.isNaN(numericId) ? Number.MAX_SAFE_INTEGER : numericId;
};

const average = (values, fallback = 0) => {
    if (!values.length) return fallback;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
};

const normalizeHouse = (house) => (house || '').trim();

const getCharacterDisplayName = (char) => {
    if (!char) return '';
    const firstName = (char['First Name'] || '').trim();
    const house = normalizeHouse(char.House);
    return [firstName, house].filter(Boolean).join(' ').trim();
};

const getDominantHouse = (chars) => {
    const houseCounts = new Map();

    chars.forEach(char => {
        const house = normalizeHouse(char.House);
        if (!house) return;
        houseCounts.set(house, (houseCounts.get(house) || 0) + 1);
    });

    if (houseCounts.size === 0) return '';

    return [...houseCounts.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
};

const getCategory = (childNode, parentNode) => {
    if (!parentNode || parentNode.id === 'WORLD_ROOT') return 0;

    const childChar = childNode.data.TR;
    const fId = childChar.FatherId ? childChar.FatherId.toString() : null;
    const mId = childChar.MotherId ? childChar.MotherId.toString() : null;
    const parentIds = parentNode.data.chars.map(c => c.id.toString());

    const hasFather = fId && parentIds.includes(fId);
    const hasMother = mId && parentIds.includes(mId);

    if (hasFather && !hasMother) return -1;
    if (!hasFather && hasMother) return 1;
    if (Number.isFinite(childNode?.data?.placementCategoryHint)) return childNode.data.placementCategoryHint;
    return 0;
};

const getNodeClusterKey = (node) => node?.data?.familyCluster || node?.data?.primaryHouse || node?.id || '';

const getNodeSubgroupKey = (node) => node?.data?.familySubgroup || node?.data?.primaryHouse || getNodeClusterKey(node);

const getNodeTreeKey = (node) => node?.data?.familyTree || `${getNodeClusterKey(node)}::${node?.id || 'tree'}`;

const getNodeGroupHouse = (node) => node?.data?.groupPreferredHouse || getNodeSubgroupKey(node);

const getOrderingReferenceNode = (node, nodeLookup = {}) => {
    if (!node?.data?.placementPartnerGroupId) return node;
    return nodeLookup[node.data.placementPartnerGroupId] || node;
};

const getParentPairKey = (fatherId, motherId) => `${fatherId || ''}|${motherId || ''}`;

const getParentGroupIdsForChar = (char, parentPairToGroupMap, charToGroupMap, charGroupLists = {}) => {
    const fatherId = char.FatherId ? char.FatherId.toString() : '';
    const motherId = char.MotherId ? char.MotherId.toString() : '';

    if (fatherId && motherId) {
        const pairGroupId = parentPairToGroupMap[getParentPairKey(char.FatherId, char.MotherId)];
        if (pairGroupId) return [pairGroupId];

        return [
            charToGroupMap[fatherId],
            charToGroupMap[motherId]
        ].filter(Boolean);
    }

    if (fatherId) {
        const pairGroupId = (charGroupLists[fatherId] || []).find((groupId) => groupId.startsWith('PAIR:'));
        return [pairGroupId || charToGroupMap[fatherId]].filter(Boolean);
    }

    if (motherId) {
        const pairGroupId = (charGroupLists[motherId] || []).find((groupId) => groupId.startsWith('PAIR:'));
        return [pairGroupId || charToGroupMap[motherId]].filter(Boolean);
    }

    return [];
};

const getPrimaryParentGroupIdForChar = (char, parentPairToGroupMap, charToGroupMap, charGroupLists = {}) => {
    const [primaryParentGroupId] = getParentGroupIdsForChar(char, parentPairToGroupMap, charToGroupMap, charGroupLists);
    return primaryParentGroupId || null;
};

const getMedian = (values, fallback = 0) => {
    if (!values.length) return fallback;
    const sorted = [...values].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[middle];
    return (sorted[middle - 1] + sorted[middle]) / 2;
};

const getRenderedNodeWidth = (nodeLike) => {
    const chars = nodeLike?.data?.chars || nodeLike?.chars || [];
    if (!chars.length) return 0;
    return 190 * chars.length + 20 * Math.max(chars.length - 1, 0);
};

const getRenderedNodeHalfWidth = (nodeLike) => getRenderedNodeWidth(nodeLike) / 2;

const buildRelationshipAdjacency = (nodes, charToGroupMap, resolver) => {
    const adjacency = new Map();
    const nodeMap = {};

    nodes.forEach(node => {
        nodeMap[node.id] = node;
        adjacency.set(node.id, new Set());
    });

    nodes.forEach(node => {
        node.chars.forEach(char => {
            resolver(node, char).forEach(relatedId => {
                if (!relatedId || relatedId === node.id || !adjacency.has(relatedId)) return;
                adjacency.get(node.id).add(relatedId);
                adjacency.get(relatedId).add(node.id);
            });
        });
    });

    return { adjacency, nodeMap };
};

const assignLineageSubgroups = (d3Nodes, getParentGroupIds) => {
    const nodeMap = {};
    d3Nodes.forEach(node => {
        nodeMap[node.id] = node;
    });

    const lineageMemo = new Map();
    const resolveLineage = (nodeId, stack = new Set()) => {
        const node = nodeMap[nodeId];
        if (!node || node.id === 'WORLD_ROOT') return node?.familySubgroup || node?.primaryHouse || 'WORLD_ROOT';
        if (lineageMemo.has(nodeId)) return lineageMemo.get(nodeId);
        if (stack.has(nodeId)) return node.primaryHouse || node.familyCluster || node.id;

        stack.add(nodeId);

        const tr = node.TR || {};
        const [parentGroupId] = getParentGroupIds(tr);
        let lineage = '';

        if (parentGroupId && parentGroupId !== nodeId) {
            lineage = resolveLineage(parentGroupId, stack);
        }

        if (!lineage) lineage = node.primaryHouse || node.familyCluster || node.id;

        stack.delete(nodeId);
        lineageMemo.set(nodeId, lineage);
        node.lineageHouse = lineage;
        node.familySubgroup = node.primaryHouse || lineage;
        return node.familySubgroup;
    };

    d3Nodes.forEach(node => {
        if (node.id !== 'WORLD_ROOT') {
            resolveLineage(node.id);
        }
    });
};

const assignGraphGroups = (d3Nodes, getParentGroupIds) => {
    const nodes = d3Nodes.filter(node => node.id !== 'WORLD_ROOT');
    const { adjacency, nodeMap } = buildRelationshipAdjacency(
        nodes,
        {},
        (_, char) => {
            return getParentGroupIds(char);
        }
    );

    const visited = new Set();
    const components = [];
    nodes.forEach(node => {
        if (visited.has(node.id)) return;

        const stack = [node.id];
        const component = [];
        visited.add(node.id);

        while (stack.length) {
            const currentId = stack.pop();
            const currentNode = nodeMap[currentId];
            component.push(currentNode);

            adjacency.get(currentId)?.forEach(neighborId => {
                const neighborNode = nodeMap[neighborId];
                if (!neighborNode || visited.has(neighborId)) return;
                visited.add(neighborId);
                stack.push(neighborId);
            });
        }

        component.sort((a, b) => getBirthYear({ data: a }) - getBirthYear({ data: b }) || getStableNodeOrder(a) - getStableNodeOrder(b));
        components.push(component);
    });

    components
        .map(component => {
            const houseCounts = new Map();
            component.forEach(member => {
                const house = member.primaryHouse || member.lineageHouse || '';
                if (!house) return;
                houseCounts.set(house, (houseCounts.get(house) || 0) + 1);
            });

            const dominantHouse = houseCounts.size
                ? [...houseCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0]
                : '';

            return { component, dominantHouse };
        })
        .sort((a, b) =>
            a.dominantHouse.localeCompare(b.dominantHouse)
            || getBirthYear({ data: a.component[0] }) - getBirthYear({ data: b.component[0] })
            || getStableNodeOrder(a.component[0]) - getStableNodeOrder(b.component[0])
        )
        .forEach((component, groupIndex) => {
            component.component.forEach(member => {
                member.familyCluster = `group:${groupIndex + 1}`;
                member.groupPreferredHouse = component.dominantHouse || member.primaryHouse || member.lineageHouse || member.familyCluster;
            });
        });
};

const assignTreeBlocks = (d3Nodes) => {
    const nodes = d3Nodes.filter(node => node.id !== 'WORLD_ROOT');
    const { adjacency, nodeMap } = buildRelationshipAdjacency(
        nodes,
        {},
        (node) => (node.parentId && node.parentId !== 'WORLD_ROOT' ? [node.parentId] : [])
    );

    const clusterKeys = [...new Set(nodes.map(node => node.familyCluster))].sort((a, b) => a.localeCompare(b));
    const clusterOrder = new Map(clusterKeys.map((key, index) => [key, index + 1]));
    const subgroupOrderByCluster = new Map();
    clusterKeys.forEach(clusterKey => {
        const subgroupKeys = [...new Set(
            nodes
                .filter(node => node.familyCluster === clusterKey)
                .map(node => node.familySubgroup || node.primaryHouse || clusterKey)
        )].sort((a, b) => a.localeCompare(b));

        subgroupOrderByCluster.set(
            clusterKey,
            new Map(subgroupKeys.map((key, index) => [key, index + 1]))
        );
    });

    const visited = new Set();
    const clusterTreeCounts = new Map();
    nodes.forEach(node => {
        if (visited.has(node.id)) return;

        const stack = [node.id];
        const component = [];
        visited.add(node.id);

        while (stack.length) {
            const currentId = stack.pop();
            const currentNode = nodeMap[currentId];
            component.push(currentNode);

            adjacency.get(currentId)?.forEach(neighborId => {
                const neighborNode = nodeMap[neighborId];
                if (!neighborNode || neighborNode.familyCluster !== node.familyCluster || visited.has(neighborId)) return;
                visited.add(neighborId);
                stack.push(neighborId);
            });
        }

        component.sort((a, b) => getBirthYear({ data: a }) - getBirthYear({ data: b }) || getStableNodeOrder(a) - getStableNodeOrder(b));
        const clusterKey = node.familyCluster;
        const treeIndex = (clusterTreeCounts.get(clusterKey) || 0) + 1;
        clusterTreeCounts.set(clusterKey, treeIndex);

        component.forEach(member => {
            const subgroupKey = member.familySubgroup || member.primaryHouse || clusterKey;
            const subgroupIndex = subgroupOrderByCluster.get(clusterKey)?.get(subgroupKey) || 1;
            member.familyTree = `${clusterKey}::tree:${treeIndex}`;
            member.familyTreeIndex = treeIndex;
            member.blockHierarchyId = `G${clusterOrder.get(clusterKey) || 1}.S${subgroupIndex}.T${treeIndex}`;
        });
    });
};

const buildOrderingMetrics = (rootHierarchy, getParentGroupIds, emphasis = 'parent') => {
    const nodes = rootHierarchy.descendants();
    const nodeMap = {};
    nodes.forEach(node => {
        nodeMap[node.id] = node;
    });

    const clusterByDepth = new Map();
    const treeByDepth = new Map();
    const subgroupByDepth = new Map();
    nodes.forEach(node => {
        if (node.id === 'WORLD_ROOT') return;

        const clusterKey = getNodeClusterKey(node);
        if (clusterKey) {
            if (!clusterByDepth.has(node.depth)) {
                clusterByDepth.set(node.depth, new Map());
            }

            const depthClusterMap = clusterByDepth.get(node.depth);
            const clusterEntry = depthClusterMap.get(clusterKey) || { sum: 0, count: 0 };
            clusterEntry.sum += node.x;
            clusterEntry.count += 1;
            depthClusterMap.set(clusterKey, clusterEntry);
        }

        const treeKey = getNodeTreeKey(node);
        if (!treeByDepth.has(node.depth)) {
            treeByDepth.set(node.depth, new Map());
        }

        const depthTreeMap = treeByDepth.get(node.depth);
        const treeEntry = depthTreeMap.get(treeKey) || { sum: 0, count: 0 };
        treeEntry.sum += node.x;
        treeEntry.count += 1;
        depthTreeMap.set(treeKey, treeEntry);

        const subgroupKey = getNodeSubgroupKey(node);
        if (!subgroupByDepth.has(node.depth)) {
            subgroupByDepth.set(node.depth, new Map());
        }

        const depthSubgroupMap = subgroupByDepth.get(node.depth);
        const subgroupEntry = depthSubgroupMap.get(subgroupKey) || { sum: 0, count: 0 };
        subgroupEntry.sum += node.x;
        subgroupEntry.count += 1;
        depthSubgroupMap.set(subgroupKey, subgroupEntry);
    });

    const descendantAnchor = new Map();
    [...nodes].reverse().forEach(node => {
        const childAnchors = (node.children || []).map(child => descendantAnchor.get(child.id) ?? child.x);
        descendantAnchor.set(node.id, average(childAnchors, node.x));
    });

    const metrics = new Map();
    nodes.forEach(node => {
        if (node.id === 'WORLD_ROOT') {
            metrics.set(node.id, { score: node.x });
            return;
        }

        const uniqueParentGroups = new Set();
        const parentAnchors = [];
        node.data.chars.forEach(char => {
            getParentGroupIds(char).forEach(parentGroupId => {
                if (!parentGroupId || uniqueParentGroups.has(parentGroupId) || !nodeMap[parentGroupId]) return;
                uniqueParentGroups.add(parentGroupId);
                parentAnchors.push(nodeMap[parentGroupId].x);
            });
        });

        const parentAnchor = average(parentAnchors, node.parent?.x ?? node.x);
        const depthClusterMap = clusterByDepth.get(node.depth);
        const clusterEntry = depthClusterMap?.get(getNodeClusterKey(node));
        const clusterAnchor = clusterEntry ? clusterEntry.sum / clusterEntry.count : node.x;
        const depthTreeMap = treeByDepth.get(node.depth);
        const treeEntry = depthTreeMap?.get(getNodeTreeKey(node));
        const treeAnchor = treeEntry ? treeEntry.sum / treeEntry.count : clusterAnchor;
        const depthSubgroupMap = subgroupByDepth.get(node.depth);
        const subgroupEntry = depthSubgroupMap?.get(getNodeSubgroupKey(node));
        const subgroupAnchor = subgroupEntry ? subgroupEntry.sum / subgroupEntry.count : treeAnchor;
        const childAnchor = descendantAnchor.get(node.id) ?? node.x;
        const relatedAnchors = [...parentAnchors, childAnchor].filter(value => Number.isFinite(value));

        const weights = emphasis === 'children'
            ? { parent: 0.18, cluster: 0.17, tree: 0.35, subgroup: 0.1, child: 0.2 }
            : { parent: 0.25, cluster: 0.15, tree: 0.4, subgroup: 0.15, child: 0.05 };

        const score = (
            parentAnchor * weights.parent
            + clusterAnchor * weights.cluster
            + treeAnchor * weights.tree
            + subgroupAnchor * weights.subgroup
            + childAnchor * weights.child
        );

        metrics.set(node.id, {
            parentAnchor,
            clusterAnchor,
            treeAnchor,
            subgroupAnchor,
            childAnchor,
            medianAnchor: getMedian(relatedAnchors, node.x),
            barycenterAnchor: average(relatedAnchors, node.x),
            score
        });
    });

    return metrics;
};

const buildSiblingRanks = (rootHierarchy, metrics) => {
    const rankMap = new Map();
    const nodeLookup = {};
    rootHierarchy.descendants().forEach(node => {
        nodeLookup[node.id] = node;
    });

    rootHierarchy.each(node => {
        if (!node.children || node.children.length === 0) return;

        const categoryBuckets = new Map();
        node.children.forEach(child => {
            const category = getCategory(child, node);
            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
            if (!categoryBuckets.has(category)) {
                categoryBuckets.set(category, new Map());
            }

            const clusterKey = getNodeClusterKey(orderingReferenceNode);
            const clusterBuckets = categoryBuckets.get(category);
            if (!clusterBuckets.has(clusterKey)) {
                clusterBuckets.set(clusterKey, new Map());
            }

            const treeKey = getNodeTreeKey(orderingReferenceNode);
            const treeBuckets = clusterBuckets.get(clusterKey);
            if (!treeBuckets.has(treeKey)) {
                treeBuckets.set(treeKey, new Map());
            }

            const subgroupKey = getNodeSubgroupKey(orderingReferenceNode);
            const subgroupBuckets = treeBuckets.get(treeKey);
            if (!subgroupBuckets.has(subgroupKey)) {
                subgroupBuckets.set(subgroupKey, []);
            }

            subgroupBuckets.get(subgroupKey).push(child);
        });

        const orderedCategories = [-1, 0, 1].filter(category => categoryBuckets.has(category));
        orderedCategories.forEach((category, categoryIndex) => {
            const clusterBuckets = categoryBuckets.get(category);
            const orderedClusters = [...clusterBuckets.entries()].sort((a, b) => {
                const aTreeScores = Array.from(a[1].values()).map(subgroupBuckets => average(
                    Array.from(subgroupBuckets.values()).map(children => average(
                        children.map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.clusterAnchor ?? metrics.get(child.id)?.clusterAnchor ?? child.x;
                        }),
                        node.x
                    )),
                    node.x
                ));
                const bTreeScores = Array.from(b[1].values()).map(subgroupBuckets => average(
                    Array.from(subgroupBuckets.values()).map(children => average(
                        children.map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.clusterAnchor ?? metrics.get(child.id)?.clusterAnchor ?? child.x;
                        }),
                        node.x
                    )),
                    node.x
                ));
                const aScore = average(aTreeScores, node.x);
                const bScore = average(bTreeScores, node.x);
                if (Math.abs(aScore - bScore) > 1e-6) return aScore - bScore;
                return a[0].localeCompare(b[0]);
            });

            orderedClusters.forEach(([clusterKey, treeBuckets], clusterIndex) => {
                const orderedTrees = [...treeBuckets.entries()].sort((a, b) => {
                    const aScore = average(
                        Array.from(a[1].values()).map(children => average(children.map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.treeAnchor ?? metrics.get(child.id)?.treeAnchor ?? child.x;
                        }), node.x)),
                        node.x
                    );
                    const bScore = average(
                        Array.from(b[1].values()).map(children => average(children.map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.treeAnchor ?? metrics.get(child.id)?.treeAnchor ?? child.x;
                        }), node.x)),
                        node.x
                    );
                    if (Math.abs(aScore - bScore) > 1e-6) return aScore - bScore;
                    return a[0].localeCompare(b[0]);
                });

                orderedTrees.forEach(([treeKey, subgroupBuckets], treeIndex) => {
                    const orderedSubgroups = [...subgroupBuckets.entries()].sort((a, b) => {
                        const aScore = average(a[1].map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.subgroupAnchor ?? metrics.get(child.id)?.subgroupAnchor ?? child.x;
                        }), node.x);
                        const bScore = average(b[1].map(child => {
                            const orderingReferenceNode = getOrderingReferenceNode(child, nodeLookup);
                            return metrics.get(orderingReferenceNode.id)?.subgroupAnchor ?? metrics.get(child.id)?.subgroupAnchor ?? child.x;
                        }), node.x);
                        if (Math.abs(aScore - bScore) > 1e-6) return aScore - bScore;
                        return a[0].localeCompare(b[0]);
                    });

                    orderedSubgroups.forEach(([subgroupKey, children], subgroupIndex) => {
                        children
                            .sort((a, b) => {
                                const aOrderingReference = getOrderingReferenceNode(a, nodeLookup);
                                const bOrderingReference = getOrderingReferenceNode(b, nodeLookup);
                                const scoreDelta =
                                    (metrics.get(aOrderingReference.id)?.score ?? metrics.get(a.id)?.score ?? a.x)
                                    - (metrics.get(bOrderingReference.id)?.score ?? metrics.get(b.id)?.score ?? b.x);
                                if (Math.abs(scoreDelta) > 1e-6) return scoreDelta;

                                const birthDelta = getBirthYear(a) - getBirthYear(b);
                                if (birthDelta !== 0) return birthDelta;

                                return getStableNodeOrder(a) - getStableNodeOrder(b);
                            })
                            .forEach((child, childIndex) => {
                                rankMap.set(child.id, {
                                    categoryIndex,
                                    clusterIndex,
                                    treeIndex,
                                    subgroupIndex,
                                    childIndex,
                                    clusterKey,
                                    treeKey,
                                    subgroupKey
                                });
                            });
                    });
                });
            });
        });
    });

    return rankMap;
};

const compareNodeOrder = (a, b, metrics, siblingRanks) => {
    if (a.parent?.id === b.parent?.id) {
        const rankA = siblingRanks.get(a.id);
        const rankB = siblingRanks.get(b.id);
        if (rankA && rankB) {
            const rankFields = ['categoryIndex', 'clusterIndex', 'treeIndex', 'subgroupIndex', 'childIndex'];
            for (const field of rankFields) {
                const delta = rankA[field] - rankB[field];
                if (delta !== 0) return delta;
            }
        }
    }

    const metricA = metrics.get(a.id);
    const metricB = metrics.get(b.id);
    const scoreDelta = (metricA?.score ?? a.x) - (metricB?.score ?? b.x);
    if (Math.abs(scoreDelta) > 1e-6) return scoreDelta;

    const houseDelta = getNodeGroupHouse(a).localeCompare(getNodeGroupHouse(b));
    if (houseDelta !== 0) return houseDelta;

    const clusterDelta = getNodeClusterKey(a).localeCompare(getNodeClusterKey(b));
    if (clusterDelta !== 0) return clusterDelta;

    const treeDelta = getNodeTreeKey(a).localeCompare(getNodeTreeKey(b));
    if (treeDelta !== 0) return treeDelta;

    const subgroupDelta = getNodeSubgroupKey(a).localeCompare(getNodeSubgroupKey(b));
    if (subgroupDelta !== 0) return subgroupDelta;

    const birthDelta = getBirthYear(a) - getBirthYear(b);
    if (birthDelta !== 0) return birthDelta;

    return getStableNodeOrder(a) - getStableNodeOrder(b);
};

const optimizeSiblingSubtreeOrder = (rootHierarchy, getParentGroupIds) => {
    const nodeLookup = new Map(rootHierarchy.descendants().map(node => [node.id, node]));
    const descendantCache = new Map();

    const getDescendantIds = (node) => {
        if (descendantCache.has(node.id)) return descendantCache.get(node.id);
        const descendantIds = new Set([node.id]);
        (node.children || []).forEach((child) => {
            if (child.id === 'WORLD_ROOT') return;
            getDescendantIds(child).forEach(id => descendantIds.add(id));
        });
        descendantCache.set(node.id, descendantIds);
        return descendantIds;
    };

    const evaluateOrderCost = (order, weights) => {
        const positions = new Map(order.map((childIndex, position) => [childIndex, position]));
        let cost = 0;

        for (let leftIndex = 0; leftIndex < weights.length; leftIndex++) {
            for (let rightIndex = leftIndex + 1; rightIndex < weights.length; rightIndex++) {
                const weight = weights[leftIndex][rightIndex] + weights[rightIndex][leftIndex];
                if (!weight) continue;
                const slotDistance = Math.abs((positions.get(leftIndex) || 0) - (positions.get(rightIndex) || 0));
                cost += weight * Math.max(0, slotDistance - 1);
            }
        }

        return cost;
    };

    const permuteOrders = (values) => {
        if (values.length <= 1) return [values];
        const permutations = [];
        values.forEach((value, index) => {
            const remaining = values.slice(0, index).concat(values.slice(index + 1));
            permuteOrders(remaining).forEach(permutation => {
                permutations.push([value, ...permutation]);
            });
        });
        return permutations;
    };

    rootHierarchy.each((node) => {
        if (!node.children || node.children.length < 2) return;

        const visibleChildren = node.children.filter(child => child.id !== 'WORLD_ROOT');
        if (visibleChildren.length < 2) return;

        const ownerByNodeId = new Map();
        visibleChildren.forEach((child, childIndex) => {
            getDescendantIds(child).forEach((descendantId) => {
                ownerByNodeId.set(descendantId, childIndex);
            });
        });

        const weights = Array.from({ length: visibleChildren.length }, () => Array(visibleChildren.length).fill(0));

        visibleChildren.forEach((child, childIndex) => {
            getDescendantIds(child).forEach((descendantId) => {
                const descendantNode = nodeLookup.get(descendantId);
                if (!descendantNode) return;

                const linkedGroupIds = new Set();
                if (descendantNode.data?.placementPartnerGroupId) {
                    linkedGroupIds.add(descendantNode.data.placementPartnerGroupId);
                }

                descendantNode.data?.chars?.forEach((char) => {
                    getParentGroupIds(char).forEach((groupId) => linkedGroupIds.add(groupId));
                });

                linkedGroupIds.forEach((linkedGroupId) => {
                    const linkedOwner = ownerByNodeId.get(linkedGroupId);
                    if (linkedOwner === undefined || linkedOwner === childIndex) return;
                    weights[childIndex][linkedOwner] += 1;
                });
            });
        });

        const hasConnections = weights.some(row => row.some(weight => weight > 0));
        if (!hasConnections) return;

        const childIndices = visibleChildren.map((_, index) => index);
        let bestOrder = childIndices;
        let bestCost = evaluateOrderCost(bestOrder, weights);

        if (visibleChildren.length <= 7) {
            permuteOrders(childIndices).forEach((candidateOrder) => {
                const candidateCost = evaluateOrderCost(candidateOrder, weights);
                if (candidateCost < bestCost) {
                    bestCost = candidateCost;
                    bestOrder = candidateOrder;
                }
            });
        } else {
            bestOrder = [...childIndices].sort((leftIndex, rightIndex) => {
                const leftPull = weights[leftIndex].reduce((sum, weight, linkedIndex) => sum + weight * linkedIndex, 0);
                const rightPull = weights[rightIndex].reduce((sum, weight, linkedIndex) => sum + weight * linkedIndex, 0);
                return leftPull - rightPull;
            });
        }

        const orderedVisibleChildren = bestOrder.map(index => visibleChildren[index]);
        const hiddenChildren = node.children.filter(child => child.id === 'WORLD_ROOT');
        node.children = [...orderedVisibleChildren, ...hiddenChildren];
    });
};

const alignNodeLevels = (rootHierarchy, getParentGroupIds, levelHeight = 250) => {
    const nodes = rootHierarchy.descendants();
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const levels = new Map(nodes.map((node) => [node.id, node.depth]));

    for (let pass = 0; pass < nodes.length * 4; pass++) {
        let changed = false;

        nodes.forEach((node) => {
            if (node.id === 'WORLD_ROOT') return;

            const parentGroupIds = [...new Set(
                node.data.chars
                    .flatMap((char) => getParentGroupIds(char))
                    .filter((groupId) => nodeMap.has(groupId))
            )];

            if (!parentGroupIds.length) {
                if ((levels.get(node.id) || 0) < 1) {
                    levels.set(node.id, 1);
                    changed = true;
                }
                return;
            }

            const requiredLevel = Math.max(...parentGroupIds.map((groupId) => levels.get(groupId) || 0)) + 1;
            if ((levels.get(node.id) || 0) < requiredLevel) {
                levels.set(node.id, requiredLevel);
                changed = true;
            }
        });

        nodes.forEach((node) => {
            if (node.id === 'WORLD_ROOT') return;

            const parentGroupIds = [...new Set(
                node.data.chars
                    .flatMap((char) => getParentGroupIds(char))
                    .filter((groupId) => nodeMap.has(groupId))
            )];

            if (parentGroupIds.length < 2) return;

            const sharedLevel = Math.max(...parentGroupIds.map((groupId) => levels.get(groupId) || 0));
            parentGroupIds.forEach((groupId) => {
                if ((levels.get(groupId) || 0) < sharedLevel) {
                    levels.set(groupId, sharedLevel);
                    changed = true;
                }
            });
        });

        if (!changed) break;
    }

    nodes.forEach((node) => {
        node.y = (levels.get(node.id) || 0) * levelHeight;
    });
};

const assignHorizontalTreePositions = (rootHierarchy, siblingGap = 110) => {
    const computeSubtreeWidth = (node) => {
        const nodeWidth = getRenderedNodeWidth(node);
        const children = (node.children || []).filter(child => child.id !== 'WORLD_ROOT');

        if (!children.length) {
            node.layoutSubtreeWidth = nodeWidth;
            return node.layoutSubtreeWidth;
        }

        const childrenWidth = children.reduce((sum, child, index) => {
            const subtreeWidth = computeSubtreeWidth(child);
            return sum + subtreeWidth + (index > 0 ? siblingGap : 0);
        }, 0);

        node.layoutSubtreeWidth = Math.max(nodeWidth, childrenWidth);
        return node.layoutSubtreeWidth;
    };

    const assignPositions = (node, leftEdge) => {
        const children = (node.children || []).filter(child => child.id !== 'WORLD_ROOT');
        const nodeWidth = getRenderedNodeWidth(node);
        const subtreeWidth = node.layoutSubtreeWidth || nodeWidth;
        node.x = leftEdge + subtreeWidth / 2;

        if (!children.length) return;

        const childrenWidth = children.reduce((sum, child, index) => {
            return sum + (child.layoutSubtreeWidth || getRenderedNodeWidth(child)) + (index > 0 ? siblingGap : 0);
        }, 0);
        let cursor = leftEdge + Math.max(0, (subtreeWidth - childrenWidth) / 2);

        children.forEach((child) => {
            assignPositions(child, cursor);
            cursor += (child.layoutSubtreeWidth || getRenderedNodeWidth(child)) + siblingGap;
        });
    };

    computeSubtreeWidth(rootHierarchy);
    assignPositions(rootHierarchy, 0);
};

const alignSurrogateSpousesOverChildren = (rootHierarchy, getParentGroupIds, rowGap = 30) => {
    const descendants = rootHierarchy.descendants().filter(node => node.id !== 'WORLD_ROOT');
    const nodeMap = new Map(descendants.map(node => [node.id, node]));
    const biologicalChildrenByParent = new Map();
    const rowsByDepth = new Map();

    descendants.forEach((node) => {
        if (!rowsByDepth.has(node.depth)) rowsByDepth.set(node.depth, []);
        rowsByDepth.get(node.depth).push(node);

        node.data.chars.forEach((char) => {
            getParentGroupIds(char).forEach((parentGroupId) => {
                if (!parentGroupId || !nodeMap.has(parentGroupId)) return;
                if (!biologicalChildrenByParent.has(parentGroupId)) {
                    biologicalChildrenByParent.set(parentGroupId, new Set());
                }
                biologicalChildrenByParent.get(parentGroupId).add(node.id);
            });
        });
    });

    [...rowsByDepth.values()].forEach((rowNodes) => {
        rowNodes.sort((a, b) => a.x - b.x);

        rowNodes.forEach((node) => {
            if (!node.data?.placementPartnerGroupId) return;

            const childIds = [...(biologicalChildrenByParent.get(node.id) || [])];
            if (!childIds.length) return;

            const childXs = childIds
                .map((childId) => nodeMap.get(childId)?.x)
                .filter(Number.isFinite);
            if (!childXs.length) return;

            const desiredX = average(childXs, node.x);
            const index = rowNodes.findIndex(rowNode => rowNode.id === node.id);
            const previousNode = index > 0 ? rowNodes[index - 1] : null;
            const nextNode = index < rowNodes.length - 1 ? rowNodes[index + 1] : null;
            const minX = previousNode
                ? previousNode.x + getRenderedNodeHalfWidth(previousNode) + getRenderedNodeHalfWidth(node) + rowGap
                : -Infinity;
            const maxX = nextNode
                ? nextNode.x - getRenderedNodeHalfWidth(nextNode) - getRenderedNodeHalfWidth(node) - rowGap
                : Infinity;

            node.x = Math.min(maxX, Math.max(minX, desiredX));
        });
    });
};

const FamilyTree = ({ data, allData, onFilterHouse, recenterTrigger }) => {
    const { theme } = useTheme();
    const { root, idToNode, charToGroup, charGroupLists, parentPairToGroup, bounds } = useMemo(() => {
        if (!data || data.length === 0) return { root: null, idToNode: {}, charToGroup: {}, charGroupLists: {}, parentPairToGroup: {}, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
        const relationshipSource = allData?.length ? allData : data;
        const byId = {};
        data.forEach(char => {
            byId[char.id.toString()] = char;
        });

        const d3Nodes = [];
        const charToGroupMap = {};
        const charGroupLists = {};
        const parentPairToGroupMap = {};
        const parentPairMemberships = new Map();
        const coParentIdsByChar = new Map();

        relationshipSource.forEach(char => {
            if (!char.FatherId || !char.MotherId) return;
            const pairKey = getParentPairKey(char.FatherId, char.MotherId);

            [char.FatherId, char.MotherId]
                .filter(Boolean)
                .forEach(parentId => {
                    const parentKey = parentId.toString();
                    if (!parentPairMemberships.has(parentKey)) {
                        parentPairMemberships.set(parentKey, new Set());
                    }
                    parentPairMemberships.get(parentKey).add(pairKey);
                });
        });

        const polygamousParentIds = new Set(
            [...parentPairMemberships.entries()]
                .filter(([, pairKeys]) => pairKeys.size > 1)
                .map(([parentId]) => parentId)
        );

        relationshipSource.forEach(char => {
            if (!char.FatherId || !char.MotherId) return;

            const fatherKey = char.FatherId.toString();
            const motherKey = char.MotherId.toString();
            if (!coParentIdsByChar.has(fatherKey)) coParentIdsByChar.set(fatherKey, new Set());
            if (!coParentIdsByChar.has(motherKey)) coParentIdsByChar.set(motherKey, new Set());
            coParentIdsByChar.get(fatherKey).add(motherKey);
            coParentIdsByChar.get(motherKey).add(fatherKey);
        });

        const addNodeForChars = (groupChars, explicitId) => {
            if (!groupChars.length) return null;
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
                id: explicitId || tr.id.toString(),
                TR: tr,
                chars: groupChars,
                primaryHouse: getDominantHouse(groupChars),
                groupPreferredHouse: '',
                familyCluster: '',
                familySubgroup: '',
                familyTree: '',
                blockHierarchyId: '',
                groupSize: groupChars.length,
                parentId: null,
                isPolygamousPair: false,
                placementCategoryHint: 0,
                placementPartnerGroupId: null
            };

            d3Node.familyCluster = d3Node.id;
            d3Node.familySubgroup = d3Node.primaryHouse || d3Node.id;

            groupChars.forEach(c => {
                const charId = c.id.toString();
                if (!charGroupLists[charId]) charGroupLists[charId] = [];
                charGroupLists[charId].push(d3Node.id);
                if (!charToGroupMap[charId]) charToGroupMap[charId] = d3Node.id;
            });
            d3Nodes.push(d3Node);
            return d3Node;
        };

        // 1. Create explicit parent-pair nodes for complete non-polygamous parent pairings.
        data.forEach(char => {
            if (!char.FatherId || !char.MotherId) return;
            if (
                polygamousParentIds.has(char.FatherId.toString())
                || polygamousParentIds.has(char.MotherId.toString())
            ) {
                return;
            }

            const pairKey = getParentPairKey(char.FatherId, char.MotherId);
            if (parentPairToGroupMap[pairKey]) return;

            const groupChars = [
                char.FatherId ? byId[char.FatherId.toString()] : null,
                char.MotherId ? byId[char.MotherId.toString()] : null
            ].filter(Boolean);

            if (!groupChars.length) return;

            const node = addNodeForChars(groupChars, `PAIR:${pairKey}`);
            if (node) {
                parentPairToGroupMap[pairKey] = node.id;
            }
        });

        // 2. Add solo nodes for people who never appear in a partnership node.
        data.forEach(char => {
            const charId = char.id.toString();
            if (charGroupLists[charId]?.length) return;
            addNodeForChars([char], `SOLO:${charId}`);
        });

        d3Nodes.push({
            id: 'WORLD_ROOT',
            TR: { id: 'WORLD_ROOT', 'First Name': 'Westeros' },
            chars: [],
            primaryHouse: '',
            groupPreferredHouse: 'WORLD_ROOT',
            familyCluster: 'WORLD_ROOT',
            familySubgroup: 'WORLD_ROOT',
            familyTree: 'WORLD_ROOT',
            blockHierarchyId: 'G0.S0.T0',
            groupSize: 1,
            parentId: null
        });

        // 4. Resolve topologies
        const resolveParentGroupIds = (char) => getParentGroupIdsForChar(char, parentPairToGroupMap, charToGroupMap, charGroupLists);
        const resolvePrimaryParentGroupId = (char) => getPrimaryParentGroupIdForChar(char, parentPairToGroupMap, charToGroupMap, charGroupLists);
        const getSafeParent = (nodeId) => {
            const node = d3Nodes.find(n => n.id === nodeId);
            if (!node || node.id === 'WORLD_ROOT') return null;

            const biologicalParentGroupId = resolvePrimaryParentGroupId(node.TR);
            if (biologicalParentGroupId) return biologicalParentGroupId;

            if (node.chars.length === 1) {
                const charId = node.chars[0]?.id?.toString();
                const coParentIds = [...(coParentIdsByChar.get(charId) || [])];
                for (const coParentId of coParentIds) {
                    const partnerChar = byId[coParentId];
                    const partnerParentGroupId = partnerChar ? resolvePrimaryParentGroupId(partnerChar) : null;
                    const partnerGroupId = charToGroupMap[coParentId] || null;
                    if (partnerParentGroupId) {
                        node.placementCategoryHint = partnerChar?.Sex?.toLowerCase().startsWith('f') ? 1
                            : partnerChar?.Sex?.toLowerCase().startsWith('m') ? -1
                                : 0;
                        node.placementPartnerGroupId = partnerGroupId;
                        return partnerParentGroupId;
                    }
                }
            }

            return 'WORLD_ROOT';
        };

        d3Nodes.forEach(n => {
            if (n.id !== 'WORLD_ROOT') {
                n.parentId = getSafeParent(n.id);
            }
        });

        assignGraphGroups(d3Nodes, resolveParentGroupIds);
        assignLineageSubgroups(d3Nodes, resolveParentGroupIds);
        assignTreeBlocks(d3Nodes);

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
                const houseDelta = getNodeGroupHouse(a).localeCompare(getNodeGroupHouse(b));
                if (houseDelta !== 0) return houseDelta;

                const clusterDelta = getNodeClusterKey(a).localeCompare(getNodeClusterKey(b));
                if (clusterDelta !== 0) return clusterDelta;

                const treeDelta = getNodeTreeKey(a).localeCompare(getNodeTreeKey(b));
                if (treeDelta !== 0) return treeDelta;

                const subgroupDelta = getNodeSubgroupKey(a).localeCompare(getNodeSubgroupKey(b));
                if (subgroupDelta !== 0) return subgroupDelta;

                const birthDelta = getBirthYear(a) - getBirthYear(b);
                if (birthDelta !== 0) return birthDelta;

                return getStableNodeOrder(a) - getStableNodeOrder(b);
            });

            assignHorizontalTreePositions(rootHierarchy);

            const layoutPasses = ['parent', 'children', 'parent', 'children'];
            const nodeMap = {};

            layoutPasses.forEach(emphasis => {
                const metrics = buildOrderingMetrics(rootHierarchy, resolveParentGroupIds, emphasis);
                const siblingRanks = buildSiblingRanks(rootHierarchy, metrics);
                rootHierarchy.sort((a, b) => compareNodeOrder(a, b, metrics, siblingRanks));
                optimizeSiblingSubtreeOrder(rootHierarchy, resolveParentGroupIds);
                assignHorizontalTreePositions(rootHierarchy);
            });

            alignSurrogateSpousesOverChildren(rootHierarchy, resolveParentGroupIds);
            alignNodeLevels(rootHierarchy, resolveParentGroupIds, 250);

            rootHierarchy.descendants().forEach(n => {
                nodeMap[n.id] = n;
            });

            // Calculate bounds
            let minX = 0, maxX = 0, minY = 0, maxY = 0;
            rootHierarchy.descendants().forEach(n => {
                if (n.id === 'WORLD_ROOT') return;
                const N = n.data.chars.length;
                const W = 190 * N + 20 * (N - 1);
                const halfW = W / 2;
                minX = Math.min(minX, n.x - halfW);
                maxX = Math.max(maxX, n.x + halfW);
                minY = Math.min(minY, n.y);
                maxY = Math.max(maxY, n.y + 120);
            });

            return { root: rootHierarchy, idToNode: nodeMap, charToGroup: charToGroupMap, charGroupLists, parentPairToGroup: parentPairToGroupMap, bounds: { minX, maxX, minY, maxY } };
        } catch (e) {
            console.error("Tree layout error:", e);
            return { root: null, idToNode: {}, charToGroup: {}, charGroupLists: {}, parentPairToGroup: {}, bounds: { minX: 0, maxX: 0, minY: 0, maxY: 0 } };
        }
    }, [allData, data]);

    const charDirectory = useMemo(() => {
        const source = allData?.length ? allData : data;
        return new Map(source.map((char) => [char.id.toString(), char]));
    }, [allData, data]);

    const getParentLabel = (char, parentType) => {
        const nameField = parentType === 'father' ? 'Father' : 'Mother';
        const idField = parentType === 'father' ? 'FatherId' : 'MotherId';

        if (char[nameField]) return char[nameField];
        if (!char[idField]) return '';

        return getCharacterDisplayName(charDirectory.get(char[idField].toString()));
    };

    const showDevMetadata = import.meta.env.DEV;

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

    const resolveParentGroupIds = (char) => getParentGroupIdsForChar(char, parentPairToGroup, charToGroup, charGroupLists);

    const getParentAnchorGlobals = (parentGroupNode, childChar) => {
        if (parentGroupNode.id === 'WORLD_ROOT') return [parentGroupNode.x];

        const anchors = [];
        const fId = childChar.FatherId?.toString();
        const mId = childChar.MotherId?.toString();

        if (fId && parentGroupNode.data.chars.some(parent => parent.id.toString() === fId)) {
            const x = getCharXGlobal(parentGroupNode.id, fId);
            if (x !== undefined && !isNaN(x)) anchors.push(x);
        }

        if (mId && parentGroupNode.data.chars.some(parent => parent.id.toString() === mId)) {
            const x = getCharXGlobal(parentGroupNode.id, mId);
            if (x !== undefined && !isNaN(x)) anchors.push(x);
        }

        if (!anchors.length) return [parentGroupNode.x];

        const isProperPairNode = parentGroupNode.data?.id?.startsWith('PAIR:') && anchors.length === 2;
        if (isProperPairNode && !parentGroupNode.data?.isPolygamousPair) {
            return [(anchors[0] + anchors[1]) / 2];
        }

        return anchors;
    };

    const containerRef = useRef(null);
    const pointerDragRef = React.useRef({ isDragging: false, startX: 0, startY: 0 });
    const [zoom, setZoom] = useState(1);
    const zoomRef = React.useRef(1);
    const [scrollRatio, setScrollRatio] = useState(0);

    // Dynamic canvas size
    const CANVAS_WIDTH = (bounds.maxX - bounds.minX) + 400;
    const CANVAS_HEIGHT = Math.max(window.innerHeight, (bounds.maxY - bounds.minY) * 2);

    // Place the root node in the upper-middle of the canvas
    const offsetX = -bounds.minX + 200;
    const offsetY = 80;

    // Use a ref for pinch state to avoid stale closures
    const pinchRef = React.useRef(null); // { dist, zoom }

    // Keep zoomRef in sync
    React.useEffect(() => { zoomRef.current = zoom; }, [zoom]);

    // Ref for single-finger pan start position (to avoid React stale state in native listeners)
    const panStartRef = React.useRef({ x: 0, y: 0 });
    // Char ID to scroll to after the next re-render (set before filter change, consumed after)
    const scrollToCharRef = React.useRef(null);
    // Pivot for zoom stabilization
    const zoomPivotRef = React.useRef(null); // { unscaledX, unscaledY, mouseX, mouseY }

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
        newZoom = Math.min(2, Math.max(0.75, newZoom));
        const el = containerRef.current;
        if (!el) { setZoom(newZoom); zoomRef.current = newZoom; return; }
        
        const prevZoom = zoomRef.current;
        const mouseX = el.clientWidth / 2;
        const mouseY = el.clientHeight / 2;
        const unscaledX = (el.scrollLeft + mouseX) / prevZoom;
        const unscaledY = (el.scrollTop + mouseY) / prevZoom;

        zoomPivotRef.current = { unscaledX, unscaledY, mouseX, mouseY };
        setZoom(newZoom);
    };

    React.useLayoutEffect(() => {
        if (zoomPivotRef.current) {
            const el = containerRef.current;
            if (el) {
                const { unscaledX, unscaledY, mouseX, mouseY } = zoomPivotRef.current;
                el.scrollLeft = unscaledX * zoom - mouseX;
                el.scrollTop = unscaledY * zoom - mouseY;
            }
            zoomPivotRef.current = null;
        }
    }, [zoom]);

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
            const firstName = (char['First Name'] || '').toLowerCase();
            const houseName = (char['House'] || '').toLowerCase();
            const fullName = `${firstName} ${houseName}`.trim();
            return firstName.includes(lowerQuery) || houseName.includes(lowerQuery) || fullName.includes(lowerQuery);
        });

        const matchedHouses = Array.from(new Set(matchedCharsAll.map(c => c['House']).filter(Boolean)));

        // Find character matches only in VISIBLE data so we can pan to them
        const matchedCharsVisible = data.filter(char => {
            const firstName = (char['First Name'] || '').toLowerCase();
            const houseName = (char['House'] || '').toLowerCase();
            const fullName = `${firstName} ${houseName}`.trim();
            return firstName.includes(lowerQuery) || houseName.includes(lowerQuery) || fullName.includes(lowerQuery);
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

    const handleScroll = () => {
        const el = containerRef.current;
        if (!el) return;
        const maxScroll = el.scrollWidth - el.clientWidth;
        if (maxScroll > 0) {
            setScrollRatio(el.scrollLeft / maxScroll);
        }
    };

    const handleSliderChange = (e) => {
        const ratio = parseFloat(e.target.value);
        setScrollRatio(ratio);
        const el = containerRef.current;
        if (el) {
            const maxScroll = el.scrollWidth - el.clientWidth;
            el.scrollLeft = ratio * maxScroll;
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
                const zoomFactor = 1.1;
                const factor = delta > 0 ? 1 / zoomFactor : zoomFactor;
                let newZoom = prev * factor;
                newZoom = Math.min(Math.max(0.75, newZoom), 3);

                if (newZoom === prev) return prev;

                const rect = el.getBoundingClientRect();
                const mouseX = e.clientX - rect.left;
                const mouseY = e.clientY - rect.top;
                const unscaledX = (el.scrollLeft + mouseX) / prev;
                const unscaledY = (el.scrollTop + mouseY) / prev;

                zoomPivotRef.current = { unscaledX, unscaledY, mouseX, mouseY };
                return newZoom;
            });
        };
        el.addEventListener('wheel', handleWheel, { passive: false });
        // Also disable normal dragging so that trackpad swipe doesn't naturally trigger history gestures
        return () => el.removeEventListener('wheel', handleWheel);
    }, []);

    const onPointerDown = (e) => {
        // Don't pan if clicking a button, input, or any element marked with data-no-pan
        if (e.target.closest('button') || e.target.closest('input') || e.target.closest('[data-no-pan]')) return;

        pointerDragRef.current = {
            isDragging: true,
            startX: e.clientX,
            startY: e.clientY,
            startScrollLeft: containerRef.current?.scrollLeft || 0,
            startScrollTop: containerRef.current?.scrollTop || 0
        };

        if (containerRef.current) {
            containerRef.current.setPointerCapture(e.pointerId);
            containerRef.current.style.cursor = 'grabbing';
            containerRef.current.style.userSelect = 'none';
        }
    };

    const onPointerMove = (e) => {
        if (!pointerDragRef.current.isDragging || !containerRef.current) return;

        const dx = e.clientX - pointerDragRef.current.startX;
        const dy = e.clientY - pointerDragRef.current.startY;

        containerRef.current.scrollLeft = pointerDragRef.current.startScrollLeft - dx;
        containerRef.current.scrollTop = pointerDragRef.current.startScrollTop - dy;
    };

    const onPointerUp = (e) => {
        if (!pointerDragRef.current.isDragging) return;
        pointerDragRef.current.isDragging = false;

        if (containerRef.current) {
            try { containerRef.current.releasePointerCapture(e.pointerId); } catch (err) { }
            containerRef.current.style.cursor = 'grab';
            containerRef.current.style.userSelect = 'auto';
        }
    };

    // Single-finger pan via native listeners (no pinch)
    React.useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const onTouchStart = (e) => {
            if (e.touches.length === 1 && !e.target.closest('button') && !e.target.closest('input') && !e.target.closest('[data-no-pan]')) {
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
            onScroll={handleScroll}
            className={`w-full h-full overflow-auto ${theme.bg} text-black absolute inset-0 transition-colors duration-500 cursor-grab touch-none`}
        >
            <svg width={CANVAS_WIDTH * zoom} height={CANVAS_HEIGHT * zoom} className="mx-auto border-none outline-none overflow-hidden">
                <g style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
                    {/* Biological parent links */}
                    {root.descendants().flatMap((node) => {
                        if (node.id === 'WORLD_ROOT') return [];

                        return node.data.chars.flatMap((char) => {
                            const parentGroupIds = resolveParentGroupIds(char);
                            if (!parentGroupIds.length) return [];

                            return parentGroupIds.flatMap((parentGroupId) => {
                                const parentGroupNode = idToNode[parentGroupId];
                                if (!parentGroupNode || parentGroupNode.id === 'WORLD_ROOT') return [];

                                const targetX = getCharXGlobal(node.id, char.id.toString()) + offsetX;
                                const sourceY = parentGroupNode.y + 60 + offsetY;
                                const targetY = node.y - 60 + offsetY;
                                const stem = Math.min(24, Math.max(12, Math.abs(targetY - sourceY) / 4));
                                const midY = (sourceY + targetY) / 2;

                                return getParentAnchorGlobals(parentGroupNode, char).map((parentAnchorX, anchorIndex) => {
                                    const sourceX = parentAnchorX + offsetX;

                                    return (
                                        <path
                                            key={`bio-link-${parentGroupId}-${node.id}-${char.id}-${anchorIndex}`}
                                            className={`${theme.link} fill-none transition-all duration-300`}
                                            strokeWidth={2.5}
                                            d={`
                      M ${sourceX},${sourceY}
                      L ${sourceX},${sourceY + stem}
                      C ${sourceX},${midY}
                        ${targetX},${midY}
                        ${targetX},${targetY - stem}
                      L ${targetX},${targetY}
                    `}
                                        />
                                    );
                                });
                            }).filter(Boolean);
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
                                    const fatherLabel = getParentLabel(data, 'father');
                                    const motherLabel = getParentLabel(data, 'mother');
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
                                            data-no-pan
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
                                            {showDevMetadata && (
                                                <text x={85} y={15} fill={textSecondary} fontSize={9} fontFamily="monospace" textAnchor="end" opacity={0.8}>
                                                    #{data.id}
                                                </text>
                                            )}
                                            {showDevMetadata && node.data.blockHierarchyId && (
                                                <text x={-85} y={15} fill={textSecondary} fontSize={7} fontFamily="monospace" textAnchor="start" opacity={0.75}>
                                                    {node.data.blockHierarchyId}
                                                </text>
                                            )}

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
                                            {fatherLabel && (
                                                <>
                                                    <text x={-20} y={90} fill="#3b82f6" fontSize={9} textAnchor="end" fontWeight="500" opacity={0.8}>F:</text>
                                                    <text x={-15} y={90} fill={textPrimary} fontSize={9} fontWeight="bold" textAnchor="start">
                                                        {fatherLabel.length > 18 ? fatherLabel.substring(0, 15) + '...' : fatherLabel}
                                                    </text>
                                                </>
                                            )}

                                            {/* Mother Info */}
                                            {motherLabel && (
                                                <>
                                                    <text x={-20} y={105} fill="#e11d48" fontSize={9} textAnchor="end" fontWeight="500" opacity={0.8}>M:</text>
                                                    <text x={-15} y={105} fill={textPrimary} fontSize={9} fontWeight="bold" textAnchor="start">
                                                        {motherLabel.length > 18 ? motherLabel.substring(0, 15) + '...' : motherLabel}
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
                data-no-pan
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
                data-no-pan
                className={`fixed bottom-[112px] right-8 p-4 rounded-full shadow-2xl border backdrop-blur-md transition-all duration-300 hover:scale-110 active:scale-95 z-50 flex items-center justify-center ${isZoomOpen ? 'bg-blue-600 border-blue-400 text-white' : `${theme.cardBg} ${theme.border} ${theme.textPrimary}`}`}
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
                    <div data-no-pan className={`fixed bottom-[192px] right-8 z-50 flex flex-col items-center gap-2 p-3 rounded-2xl shadow-2xl border backdrop-blur-md ${theme.cardBg} ${theme.border}`}>
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

            <div className="fixed bottom-8 right-[112px] z-50 flex items-end flex-col gap-2" data-no-pan>
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

            {/* Horizontal Scroll Slider */}
            <div className={`fixed bottom-8 left-1/2 -translate-x-1/2 w-64 md:w-96 p-4 rounded-2xl shadow-2xl border backdrop-blur-md z-50 flex items-center gap-4 ${theme.cardBg} ${theme.border}`}>
                <svg className={`w-5 h-5 ${theme.textSecondary}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                </svg>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.001"
                    value={scrollRatio}
                    onChange={handleSliderChange}
                    className="flex-1 h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600 dark:bg-gray-700"
                    data-no-pan
                />
            </div>
        </div>
    );
};

export default FamilyTree;
