import { EDGE_KINDS } from "../output/legend.ts";

export function run(_args: string[]): void {
  console.log(JSON.stringify({ edge_kinds: EDGE_KINDS }, null, 2));
}
