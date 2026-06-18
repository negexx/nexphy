export const NODE_KINDS: Record<string, string> = {
  function: "callable declaration",
  class: "class declaration",
  interface: "TypeScript interface",
  type: "type alias",
  enum: "enum declaration",
  variable: "const/let/var declaration",
  namespace: "module or namespace",
};

export const EDGE_KINDS: Record<string, string> = {
  imports: "static import of a module member",
  calls: "direct function or method invocation",
  extends: "class or interface inheritance",
  implements: "class implements interface",
  references: "type or value reference not covered above",
};

export const LEGEND = { node_kinds: NODE_KINDS, edge_kinds: EDGE_KINDS };
