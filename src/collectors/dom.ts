import type { Collector } from '../core/types.js';

function countNodes(root: Node): number {
  let count = 0;
  const walk = (node: Node) => {
    count++;
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) walk(children[i]!);
  };
  walk(root);
  return count;
}

function maxDepth(root: Node): number {
  let max = 0;
  const walk = (node: Node, depth: number) => {
    if (depth > max) max = depth;
    const children = node.childNodes;
    for (let i = 0; i < children.length; i++) walk(children[i]!, depth + 1);
  };
  walk(root, 1);
  return max;
}

export function createDomCollector(): Collector {
  return {
    name: "dom",
    start() {
      // sampled on interval (tracker tick runs outside Zone when present)
    },
    sample(ctx) {
      try {
        if (typeof document === "undefined" || !document.documentElement) return;
        const root = document.documentElement;
        ctx.setGauge("domNodeCount", countNodes(root));
        ctx.setGauge("domMaxDepth", maxDepth(root));
      } catch {
        // fail soft
      }
    },
    stop() {
      // nothing
    },
  };
}
