import { add } from "./utils.ts";

export const VERSION = "1.0.0";

export function greet(name: string): string {
  return `Hello, ${name}! Sum: ${add(1, 2)}`;
}
