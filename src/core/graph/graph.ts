import { GraphNode, GraphRelationship, CodeGraph } from './types'

/* Factory for a deduplicated in-memory code graph */
export const createCodeGraph = (): CodeGraph => {
  const vertexStore: Record<string, GraphNode> = Object.create(null);
  const edgeStore: Record<string, GraphRelationship> = Object.create(null);
  let vertexCount = 0;
  let edgeCount = 0;

  const insertNode = (node: GraphNode): void => {
    if (vertexStore[node.id] !== undefined) return;
    vertexStore[node.id] = node;
    vertexCount += 1;
  };

  const insertRelationship = (rel: GraphRelationship): void => {
    if (edgeStore[rel.id] !== undefined) return;
    edgeStore[rel.id] = rel;
    edgeCount += 1;
  };

  const collectNodes = (): GraphNode[] => {
    const result: GraphNode[] = [];
    for (const key in vertexStore) {
      result.push(vertexStore[key]);
    }
    return result;
  };

  const collectRelationships = (): GraphRelationship[] => {
    const result: GraphRelationship[] = [];
    for (const key in edgeStore) {
      result.push(edgeStore[key]);
    }
    return result;
  };

  return {
    get nodes() {
      return collectNodes();
    },

    get relationships() {
      return collectRelationships();
    },

    get nodeCount() {
      return vertexCount;
    },

    get relationshipCount() {
      return edgeCount;
    },

    addNode: insertNode,
    addRelationship: insertRelationship,
  };
};
