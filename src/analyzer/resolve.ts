// src/analyzer/resolve.ts
import * as ts from "typescript";
import type { ParsedFile } from "../parser/types.ts";
import type { ResolvedEdge } from "./types.ts";

function posix(p: string): string {
  return p.replace(/\\/g, "/");
}

export async function resolveEdges(
  files: ParsedFile[],
  projectRoot: string,
): Promise<ResolvedEdge[]> {
  const tsconfig = ts.findConfigFile(projectRoot, ts.sys.fileExists, "tsconfig.json");
  const configFile = tsconfig ? ts.readConfigFile(tsconfig, ts.sys.readFile) : { config: {} };
  const parsedConfig = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    projectRoot,
    { noEmit: true, plugins: [] }, // always disable plugins (security)
  );

  const program = ts.createProgram({
    rootNames: files.map((f) => f.path.replace(/\//g, process.platform === "win32" ? "\\" : "/")),
    options: parsedConfig.options,
  });

  const checker = program.getTypeChecker();
  const edges: ResolvedEdge[] = [];

  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.isDeclarationFile) continue;
    const filePath = posix(sourceFile.fileName);
    if (!files.some((f) => posix(f.path) === filePath)) continue;

    ts.forEachChild(sourceFile, function visit(node) {
      // Import edges
      if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
        const resolved = checker.getSymbolAtLocation(node.moduleSpecifier);
        const decls = resolved?.declarations;
        if (decls?.length) {
          const dstFile = posix(decls[0].getSourceFile().fileName);
          edges.push({
            srcSymbolId: `${filePath}#<module>`,
            dstSymbolId: `${dstFile}#<module>`,
            kind: "imports",
            key: null,
          });
        }
      }

      // Call expression edges
      if (ts.isCallExpression(node)) {
        const sym = checker.getSymbolAtLocation(node.expression);
        const decls = sym?.declarations;
        if (decls?.length) {
          const decl = decls[0];
          const dstFile = posix(decl.getSourceFile().fileName);
          const dstName = sym?.name ?? "unknown";
          edges.push({
            srcSymbolId: `${filePath}#<module>`,
            dstSymbolId: `${dstFile}#${dstName}`,
            kind: "calls",
            key: null,
          });
        }
      }

      // Heritage edges (extends / implements)
      if (ts.isHeritageClause(node)) {
        for (const expr of node.types) {
          const sym = checker.getSymbolAtLocation(expr.expression);
          const decls = sym?.declarations;
          if (decls?.length) {
            const dstFile = posix(decls[0].getSourceFile().fileName);
            const kind = node.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements";
            edges.push({
              srcSymbolId: `${filePath}#<module>`,
              dstSymbolId: `${dstFile}#${sym?.name ?? "unknown"}`,
              kind,
              key: null,
            });
          }
        }
      }

      ts.forEachChild(node, visit);
    });
  }

  // Allow GC of the program before returning (infomap constraint)
  return edges;
}
