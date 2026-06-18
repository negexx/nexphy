import * as ts from "typescript";
import type { EdgeKind, ResolvedEdge } from "./types.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

// Returns the "best" declaration for a symbol: value declaration first (deterministic
// for overloaded/merged symbols), then first non-.d.ts decl, then first decl.
function preferredDecl(sym: ts.Symbol): ts.Declaration | undefined {
  if (sym.valueDeclaration) return sym.valueDeclaration;
  const decls = sym.declarations;
  if (!decls?.length) return undefined;
  return decls.find((d) => !d.getSourceFile().isDeclarationFile) ?? decls[0];
}

// Unwrap import aliases so we get the original exported symbol, not the local binding.
// import { Foo as Bar } → getAliasedSymbol returns Foo's declaration, not Bar's.
function resolveAlias(checker: ts.TypeChecker, sym: ts.Symbol): ts.Symbol {
  return sym.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(sym) : sym;
}

// True when the declaration lives at module (file) scope, not inside a function or block.
// Prevents emitting "calls" edges to local closures, parameters, and inner functions.
function isModuleScoped(decl: ts.Node): boolean {
  let parent = decl.parent;
  while (parent) {
    if (ts.isSourceFile(parent)) return true;
    if (ts.isFunctionLike(parent) || ts.isBlock(parent)) return false;
    parent = parent.parent;
  }
  return false;
}

export function resolveEdges(filePaths: string[], projectRoot: string): ResolvedEdge[] {
  const tsconfig = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  const configFile = tsconfig ? ts.readConfigFile(tsconfig, ts.sys.readFile) : { config: {} };
  if ((configFile as { error?: ts.Diagnostic }).error) {
    const msg = ts.flattenDiagnosticMessageText(
      (configFile as { error: ts.Diagnostic }).error.messageText,
      "\n",
    );
    console.warn(`tsgraph: tsconfig read error: ${msg}`);
  }
  const parsedConfig = ts.parseJsonConfigFileContent(configFile.config, ts.sys, projectRoot, {
    noEmit: true,
    plugins: [],
  });
  for (const e of parsedConfig.errors) {
    console.warn(`tsgraph: tsconfig: ${ts.flattenDiagnosticMessageText(e.messageText, "\n")}`);
  }

  const program = ts.createProgram({
    rootNames: filePaths.map((p) => p.replace(/\//g, process.platform === "win32" ? "\\" : "/")),
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();

  // Map lowercase absolute path → relative path so symbolIds match Phase 1's convention
  // (Phase 1 strips projectRoot and stores e.g. "src/foo.ts#Bar").
  // Lowercase comparison because TypeScript may normalize Windows drive letters differently
  // from what process.cwd() / path.resolve returns (c:/ vs C:/).
  const projectRootPosix = posix(projectRoot).replace(/\/$/, "");
  const absToRel = new Map<string, string>();
  for (const fp of filePaths) {
    const abs = posix(fp);
    const rel = abs.startsWith(`${projectRootPosix}/`)
      ? abs.slice(projectRootPosix.length + 1)
      : abs;
    absToRel.set(abs.toLowerCase(), rel);
  }

  const edges: ResolvedEdge[] = [];
  // NUL (\0) cannot appear in file paths or TS identifiers — safe dedup delimiter.
  const seenEdges = new Set<string>();

  function push(src: string, dst: string, kind: EdgeKind): void {
    const key = `${src}\0${dst}\0${kind}`;
    if (seenEdges.has(key)) return;
    seenEdges.add(key);
    edges.push({ srcSymbolId: src, dstSymbolId: dst, kind, key: null });
  }

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const filePath = posix(sourceFile.fileName);
    const srcRel = absToRel.get(filePath.toLowerCase());
    if (!srcRel) continue; // outside the analyzed project
    const srcModule = `${srcRel}#<module>`;

    ts.forEachChild(sourceFile, function visit(node) {
      // import { ... } from "..."  /  import type { ... } from "..."
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const sym = checker.getSymbolAtLocation(node.moduleSpecifier);
        const decl = sym ? preferredDecl(sym) : undefined;
        if (decl) {
          const sf = decl.getSourceFile();
          if (!sf.isDeclarationFile) {
            const dstRel = absToRel.get(posix(sf.fileName).toLowerCase());
            if (dstRel) {
              const kind: EdgeKind = node.importClause?.isTypeOnly ? "uses-type" : "imports";
              push(srcModule, `${dstRel}#<module>`, kind);
            }
          }
        }
        return; // no need to recurse — imports are not nested
      }

      // export { ... } from "..."  /  export * from "..."
      if (
        ts.isExportDeclaration(node) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      ) {
        const sym = checker.getSymbolAtLocation(node.moduleSpecifier);
        const decl = sym ? preferredDecl(sym) : undefined;
        if (decl) {
          const sf = decl.getSourceFile();
          if (!sf.isDeclarationFile) {
            const dstRel = absToRel.get(posix(sf.fileName).toLowerCase());
            if (dstRel) {
              push(srcModule, `${dstRel}#<module>`, "re-exports");
            }
          }
        }
        return;
      }

      // foo()  /  obj.method()
      if (ts.isCallExpression(node)) {
        const rawSym = checker.getSymbolAtLocation(node.expression);
        if (rawSym) {
          const sym = resolveAlias(checker, rawSym);
          const decl = preferredDecl(sym);
          if (decl) {
            const sf = decl.getSourceFile();
            if (!sf.isDeclarationFile && isModuleScoped(decl)) {
              const dstRel = absToRel.get(posix(sf.fileName).toLowerCase());
              if (dstRel) {
                push(srcModule, `${dstRel}#${sym.name}`, "calls");
              }
            }
          }
        }
      }

      // class Foo extends Bar  /  class Foo implements IBar
      if (ts.isHeritageClause(node)) {
        for (const expr of node.types) {
          const rawSym = checker.getSymbolAtLocation(expr.expression);
          if (!rawSym) continue;
          const sym = resolveAlias(checker, rawSym);
          const decl = preferredDecl(sym);
          if (decl) {
            const sf = decl.getSourceFile();
            if (!sf.isDeclarationFile) {
              const dstRel = absToRel.get(posix(sf.fileName).toLowerCase());
              if (dstRel) {
                const kind: EdgeKind =
                  node.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
                push(srcModule, `${dstRel}#${sym.name}`, kind);
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  return edges;
}
