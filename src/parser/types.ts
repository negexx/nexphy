export type SymbolKind =
  | "function"
  | "class"
  | "interface"
  | "type"
  | "const"
  | "enum"
  | "variable";

export interface ParsedSymbol {
  symbolId: string;       // "posix/path/file.ts#Name" — unique per file+name
  name: string;
  kind: SymbolKind;
  filePath: string;       // POSIX-normalized
  lineStart: number;
  lineEnd: number;
  signature: string | null;
  isEntry: boolean;       // true if exported at module level
}

export interface ParsedImport {
  fromFile: string;       // POSIX-normalized absolute path
  toSpecifier: string;    // raw import specifier e.g. "./utils" or "typescript"
  names: string[];        // ["default"] for default import, named imports otherwise
}

export interface ParsedFile {
  path: string;           // POSIX-normalized absolute path
  contentHash: string;    // SHA-1 of raw file content
  shapeHash: string;      // SHA-1 of sorted symbolIds (structural fingerprint)
  symbols: ParsedSymbol[];
  imports: ParsedImport[];
}
