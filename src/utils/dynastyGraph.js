export const DEFAULT_EXCLUDED_DYNASTIES = [
  'Waters',
  'Sand',
  'Pyke',
  'Snow',
  'Flowers',
  'Rivers',
  'Storm',
  'Stone',
  'Hill'
];

export const normalizeDynastyName = (value) => (value || '')
  .replace(/^House\s+/i, '')
  .trim();

export const getDynastyKey = (value) => normalizeDynastyName(value).toLowerCase();

const createNode = (house) => ({
  id: getDynastyKey(house),
  name: normalizeDynastyName(house),
  rawHouse: house,
  members: 0,
  relations: 0
});

const createEdge = (source, target) => ({
  id: [source, target].sort().join('::'),
  source,
  target,
  weight: 0,
  marriages: 0,
  lineageLinks: 0,
  relationKinds: new Set()
});

export const buildDynastyGraph = (characters) => {
  const nodes = new Map();
  const edges = new Map();
  const charactersById = new Map();

  const ensureNode = (house) => {
    if (!house) return null;
    const key = getDynastyKey(house);
    if (!key) return null;
    if (!nodes.has(key)) {
      nodes.set(key, createNode(house));
    }
    return nodes.get(key);
  };

  const connect = (houseA, houseB, relation) => {
    const nodeA = ensureNode(houseA);
    const nodeB = ensureNode(houseB);

    if (!nodeA || !nodeB || nodeA.id === nodeB.id) return;

    const [source, target] = [nodeA.id, nodeB.id].sort((a, b) => a.localeCompare(b));
    const edgeId = `${source}::${target}`;
    if (!edges.has(edgeId)) {
      edges.set(edgeId, createEdge(source, target));
    }

    const edge = edges.get(edgeId);
    edge.weight += relation === 'marriage' ? 2 : 1;
    edge.relationKinds.add(relation);

    if (relation === 'marriage') {
      edge.marriages += 1;
    } else {
      edge.lineageLinks += 1;
    }
  };

  characters.forEach((character) => {
    if (!character?.id) return;
    charactersById.set(character.id.toString(), character);
    const node = ensureNode(character.House);
    if (node) {
      node.members += 1;
      if (!node.rawHouse && character.House) {
        node.rawHouse = character.House;
      }
    }
  });

  characters.forEach((character) => {
    if (!character) return;

    const father = character.FatherId ? charactersById.get(character.FatherId.toString()) : null;
    const mother = character.MotherId ? charactersById.get(character.MotherId.toString()) : null;

    if (father) connect(father.House, character.House, 'lineage');
    if (mother) connect(mother.House, character.House, 'lineage');
    if (father && mother) connect(father.House, mother.House, 'marriage');
  });

  edges.forEach((edge) => {
    const sourceNode = nodes.get(edge.source);
    const targetNode = nodes.get(edge.target);
    if (sourceNode) sourceNode.relations += edge.weight;
    if (targetNode) targetNode.relations += edge.weight;
  });

  return {
    nodes: [...nodes.values()].sort((a, b) => b.relations - a.relations || b.members - a.members || a.name.localeCompare(b.name)),
    edges: [...edges.values()].map((edge) => ({
      ...edge,
      relationKinds: [...edge.relationKinds]
    }))
  };
};
