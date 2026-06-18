export interface NexphyConfig {
  chunkSize: number;
  include: string[];
  exclude: string[];
}

export const CONFIG_DEFAULTS: NexphyConfig = {
  chunkSize: 200,
  include: ["**/*.ts"],
  exclude: ["node_modules/**", "dist/**", "**/*.test.ts", "**/*.spec.ts"],
};
