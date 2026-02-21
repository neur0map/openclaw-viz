import { generateId } from "@/lib/utils";
import { CodeGraph, GraphNode, GraphRelationship } from "../graph/types";

export const processStructure = (graph: CodeGraph, paths: string[]) => {
  for (const filePath of paths) {
    const segments = filePath.split('/');
    let accumulated = '';
    let prevId = '';

    let depth = 0;
    while (depth < segments.length) {
      const segment = segments[depth];
      const isTerminal = depth === segments.length - 1;
      const kind = isTerminal ? 'File' : 'Folder';

      accumulated = accumulated === '' ? segment : [accumulated, segment].join('/');

      const thisId = generateId(kind, accumulated);

      const entry: GraphNode = {
        id: thisId,
        label: kind,
        properties: {
          name: segment,
          filePath: accumulated,
        },
      };
      graph.addNode(entry);

      if (prevId !== '') {
        const linkId = generateId('CONTAINS', `${prevId}->${thisId}`);
        const link: GraphRelationship = {
          id: linkId,
          type: 'CONTAINS',
          sourceId: prevId,
          targetId: thisId,
          confidence: 1.0,
          reason: '',
        };
        graph.addRelationship(link);
      }

      prevId = thisId;
      depth++;
    }
  }
};
