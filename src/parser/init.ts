import { Language, Parser } from "web-tree-sitter";
import { readWasm } from "./wasm.ts";

let initPromise: Promise<{ parser: Parser; language: Language }> | null = null;

export function getParser(): Promise<{ parser: Parser; language: Language }> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    try {
      await Parser.init({ wasmBinary: readWasm("web-tree-sitter.wasm") });
      const tsLanguage = await Language.load(readWasm("tree-sitter-typescript.wasm"));
      const parser = new Parser();
      parser.setLanguage(tsLanguage);
      return { parser, language: tsLanguage };
    } catch (err) {
      initPromise = null;
      throw err;
    }
  })();

  return initPromise;
}
