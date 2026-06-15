export interface FTNode {
  name: string;
  path: string;   // original path for files; normalized for dirs
  type: "file" | "dir";
  children: FTNode[];
}

function insert(nodes: FTNode[], parts: string[], original: string, depth: number): void {
  const name = parts[depth];
  const isFile = depth === parts.length - 1;
  let node = nodes.find((n) => n.name === name);
  if (!node) {
    node = {
      name,
      path: isFile ? original : parts.slice(0, depth + 1).join("/"),
      type: isFile ? "file" : "dir",
      children: [],
    };
    nodes.push(node);
  }
  if (!isFile) insert(node.children, parts, original, depth + 1);
}

function sort(nodes: FTNode[]): FTNode[] {
  return nodes
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.name.localeCompare(b.name);
    })
    .map((n) => ({ ...n, children: sort(n.children) }));
}

export function buildFileTree(paths: string[]): FTNode[] {
  const roots: FTNode[] = [];
  for (const p of paths) {
    const parts = p.replace(/\\/g, "/").split("/");
    insert(roots, parts, p, 0);
  }
  return sort(roots);
}

export function getFilePaths(node: FTNode): string[] {
  if (node.type === "file") return [node.path];
  return node.children.flatMap(getFilePaths);
}
