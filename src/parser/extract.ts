import { createHash } from "node:crypto";
import type { Node } from "web-tree-sitter";
import { getParser } from "./init.ts";
import type { ParsedFile, ParsedImport, ParsedSymbol, SymbolKind } from "./types.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

function stripProjectRoot(absPath: string, projectRoot: string): string {
  const norm = posix(absPath);
  const root = posix(projectRoot).replace(/\/$/, "");
  if (root === "" || root === "/") {
    // No explicit project root — strip one leading path segment so
    // "/project/src/index.ts" → "src/index.ts". This matches the
    // convention that absPath is always rooted at a project directory.
    const withoutLeadingSlash = norm.startsWith("/") ? norm.slice(1) : norm;
    const firstSlash = withoutLeadingSlash.indexOf("/");
    return firstSlash >= 0 ? withoutLeadingSlash.slice(firstSlash + 1) : withoutLeadingSlash;
  }
  return norm.startsWith(`${root}/`) ? norm.slice(root.length + 1) : norm;
}

function kindOf(nodeType: string): SymbolKind | null {
  switch (nodeType) {
    case "function_declaration":
    case "function":
      return "function";
    case "class_declaration":
      return "class";
    case "interface_declaration":
      return "interface";
    case "type_alias_declaration":
      return "type";
    case "enum_declaration":
      return "enum";
    case "lexical_declaration":
    case "variable_declaration":
      return "const";
    default:
      return null;
  }
}

function getName(node: Node): string | null {
  // Direct name field (function, class, interface, type alias, enum)
  const nameNode = node.childForFieldName("name");
  if (nameNode) return nameNode.text;

  // lexical_declaration: const foo = ... → variable_declarator → name
  const declarator = node.children.find((c) => c !== null && c.type === "variable_declarator");
  if (declarator) {
    const n = declarator.childForFieldName("name");
    if (n) return n.text;
  }

  return null;
}

function isTypeOnlyImport(node: Node): boolean {
  // `import type { Foo } from "..."` — the `type` keyword is a direct child
  // of the import_statement, immediately after the `import` keyword
  for (const child of node.children) {
    if (!child) continue;
    if (child.type === "type") return true;
    if (child.type === "import_clause") break;
  }
  return false;
}

function extractImports(root: Node, absPath: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  for (const child of root.children) {
    if (!child) continue;
    if (child.type !== "import_statement") continue;

    // Skip type-only imports — they carry no runtime dependency
    if (isTypeOnlyImport(child)) continue;

    const sourceNode = child.children.find((c) => c !== null && c.type === "string");
    if (!sourceNode) continue;
    const specifier = sourceNode.text.replace(/^["']|["']$/g, "");

    const names: string[] = [];
    const clause = child.children.find((c) => c !== null && c.type === "import_clause");
    if (clause) {
      // Named imports: { foo, bar }
      const named = clause.children.find((c) => c !== null && c.type === "named_imports");
      if (named) {
        for (const spec of named.children) {
          if (!spec) continue;
          if (spec.type === "import_specifier") {
            const n = spec.childForFieldName("name")?.text;
            if (n) names.push(n);
          }
        }
      }
      // Default import: import foo from "..."
      const defaultImport = clause.children.find((c) => c !== null && c.type === "identifier");
      if (defaultImport) names.push("default");
    }

    imports.push({ fromFile: posix(absPath), toSpecifier: specifier, names });
  }
  return imports;
}

export async function extractFile(
  absPath: string,
  source: string,
  projectRoot = "/",
): Promise<ParsedFile> {
  const { parser } = await getParser();
  const tree = parser.parse(source);
  if (!tree) throw new Error(`Failed to parse file: ${absPath}`);

  try {
    const root = tree.rootNode;

    const relPath = stripProjectRoot(absPath, projectRoot);
    const symbols: ParsedSymbol[] = [];
    const usedNames = new Map<string, number>();

    for (const child of root.children) {
      if (!child) continue;
      let decl = child;
      let isEntry = false;

      if (child.type === "export_statement") {
        isEntry = true;
        const inner = child.children.find((c) => c !== null && kindOf(c.type) !== null);
        if (!inner) continue;
        decl = inner;
      }

      const kind = kindOf(decl.type);
      if (!kind) continue;
      const name = getName(decl);
      if (!name) continue;

      const count = usedNames.get(name) ?? 0;
      usedNames.set(name, count + 1);
      const symbolId =
        count === 0 ? `${relPath}#${name}` : `${relPath}#${name}_${decl.startPosition.row + 1}`;

      const sigLine = decl.text.split("\n")[0];
      symbols.push({
        symbolId,
        name,
        kind,
        filePath: posix(absPath),
        lineStart: decl.startPosition.row + 1,
        lineEnd: decl.endPosition.row + 1,
        // Spread to code points so multi-byte chars (emoji, CJK) aren't split mid-surrogate
        signature: [...sigLine].slice(0, 200).join(""),
        isEntry,
      });
    }

    const imports = extractImports(root, absPath);

    const contentHash = createHash("sha1").update(source).digest("hex");
    const shapeHash = createHash("sha1")
      .update(
        symbols
          .map((s) => s.symbolId)
          .sort()
          .join("\n"),
      )
      .digest("hex");

    return { path: posix(absPath), contentHash, shapeHash, symbols, imports };
  } finally {
    tree.delete();
  }
}
