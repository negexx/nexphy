import { Language, Parser } from "web-tree-sitter";
import { readWasm } from "./wasm.ts";

let parser: Parser | null = null;
let tsLanguage: Language | null = null;

export async function getParser(): Promise<{ parser: Parser; language: Language }> {
  if (parser && tsLanguage) return { parser, language: tsLanguage };

  await Parser.init({ wasmBinary: readWasm("web-tree-sitter.wasm") });
  tsLanguage = await Language.load(readWasm("tree-sitter-typescript.wasm"));
  parser = new Parser();
  parser.setLanguage(tsLanguage);

  return { parser, language: tsLanguage };
}
