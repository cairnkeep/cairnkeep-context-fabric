import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

const SyntheticSourceSchema = z.object({
  id: IdentifierSchema,
  type: z.literal("synthetic"),
  enabled: z.boolean().default(false),
  fixturePath: z.string().min(1),
  containers: z.array(z.string().min(1).max(256)).min(1).max(128),
  batchSize: z.number().int().min(1).max(1000).default(1),
}).strict();

export const FabricConfigSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: IdentifierSchema,
  mode: z.literal("shadow"),
  principalId: z.string().min(1).max(256),
  dataDir: z.string().min(1),
  sources: z.array(SyntheticSourceSchema).max(64),
}).strict().superRefine((config, context) => {
  const ids = new Set<string>();
  for (const [index, source] of config.sources.entries()) {
    if (ids.has(source.id)) {
      context.addIssue({
        code: "custom",
        path: ["sources", index, "id"],
        message: `duplicate source id: ${source.id}`,
      });
    }
    ids.add(source.id);
  }
});

export type FabricConfig = z.infer<typeof FabricConfigSchema>;
export type SyntheticSourceConfig = z.infer<typeof SyntheticSourceSchema>;

function configuredPath(value: string, base: string): string {
  const home = process.env.HOME;
  const xdgDataHome = process.env.XDG_DATA_HOME ?? (home === undefined ? undefined : resolve(home, ".local/share"));
  let expanded = value;
  if (home !== undefined) expanded = expanded.replaceAll("${HOME}", home);
  if (xdgDataHome !== undefined) expanded = expanded.replaceAll("${XDG_DATA_HOME}", xdgDataHome);
  if (expanded.includes("${")) throw new Error(`Unsupported variable in configured path: ${value}`);
  if (expanded.startsWith("~/")) {
    if (home === undefined) throw new Error("HOME is required to expand configured paths.");
    expanded = resolve(home, expanded.slice(2));
  }
  return isAbsolute(expanded) ? resolve(expanded) : resolve(base, expanded);
}

function privateMode(path: string): void {
  if (process.platform === "win32") return;
  const stat = statSync(path);
  const mode = stat.mode & 0o777;
  if ((mode & 0o077) !== 0) {
    throw new Error(`Fabric config must not be accessible by group or other users: ${path}`);
  }
  const uid = process.getuid?.();
  if (uid !== undefined && stat.uid !== uid) {
    throw new Error(`Fabric config must be owned by the current user: ${path}`);
  }
}

export function loadFabricConfig(path: string): FabricConfig {
  const absolutePath = resolve(path);
  privateMode(absolutePath);
  const parsed = FabricConfigSchema.parse(JSON.parse(readFileSync(absolutePath, "utf8")));
  const base = dirname(absolutePath);
  return {
    ...parsed,
    dataDir: configuredPath(parsed.dataDir, base),
    sources: parsed.sources.map((source) => ({
      ...source,
      fixturePath: configuredPath(source.fixturePath, base),
    })),
  };
}
