import { readFileSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";

import {
  ConnectorSourceConfigSchema,
  type ConnectorRegistration,
  type ConnectorSourceConfig,
} from "@cairnkeep/connector-sdk";
import { z } from "zod";

const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const InlineCredentialKey = /^(?:access[-_]?token|api[-_]?key|bearer[-_]?token|client[-_]?secret|password|private[-_]?key|secret|token)$/i;

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

export type SyntheticSourceConfig = z.infer<typeof SyntheticSourceSchema>;
export type FabricSourceConfig = SyntheticSourceConfig | ConnectorSourceConfig;
export type FabricConfig = Omit<z.infer<typeof FabricConfigSchema>, "sources"> & {
  sources: FabricSourceConfig[];
};

const FabricEnvelopeSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: IdentifierSchema,
  mode: z.literal("shadow"),
  principalId: z.string().min(1).max(256),
  dataDir: z.string().min(1),
  sources: z.array(z.unknown()).max(64),
}).strict();

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

function rejectInlineCredentials(value: unknown): void {
  if (Array.isArray(value)) {
    for (const item of value) rejectInlineCredentials(item);
    return;
  }
  if (value === null || typeof value !== "object") return;
  for (const [key, child] of Object.entries(value)) {
    if (InlineCredentialKey.test(key)) {
      throw new Error(`Inline credential field is not allowed: ${key}`);
    }
    rejectInlineCredentials(child);
  }
}

export function loadFabricConfig(
  path: string,
  registrations: readonly ConnectorRegistration[] = [],
): FabricConfig {
  const absolutePath = resolve(path);
  privateMode(absolutePath);
  const parsed = FabricEnvelopeSchema.parse(JSON.parse(readFileSync(absolutePath, "utf8")));
  const base = dirname(absolutePath);
  const registered = new Map<string, ConnectorRegistration>();
  for (const registration of registrations) {
    const type = IdentifierSchema.parse(registration.type);
    if (type === "synthetic") throw new Error("The synthetic source type is reserved by the core runtime.");
    if (registered.has(type)) throw new Error(`Duplicate connector registration: ${type}`);
    registered.set(type, registration);
  }
  const sources = parsed.sources.map((value): FabricSourceConfig => {
    rejectInlineCredentials(value);
    const identity = z.object({ type: IdentifierSchema }).passthrough().parse(value);
    if (identity.type === "synthetic") {
      const source = SyntheticSourceSchema.parse(value);
      return {
        ...source,
        fixturePath: configuredPath(source.fixturePath, base),
      };
    }
    const registration = registered.get(identity.type);
    if (registration === undefined) throw new Error(`Unknown source type: ${identity.type}`);
    const configuredCommon = ConnectorSourceConfigSchema.parse(value);
    const source = registration.parseConfig(value, { baseDir: base });
    const common = ConnectorSourceConfigSchema.parse(source);
    const policyFields = ["id", "type", "enabled", "batchSize"] as const;
    if (
      policyFields.some((field) => common[field] !== configuredCommon[field])
      || JSON.stringify(common.containers) !== JSON.stringify(configuredCommon.containers)
    ) {
      throw new Error(`Connector registration ${identity.type} changed common source policy.`);
    }
    return source;
  });
  const ids = new Set<string>();
  for (const source of sources) {
    if (ids.has(source.id)) throw new Error(`Duplicate source id: ${source.id}`);
    ids.add(source.id);
  }
  return {
    schemaVersion: parsed.schemaVersion,
    deploymentId: parsed.deploymentId,
    mode: parsed.mode,
    principalId: parsed.principalId,
    dataDir: configuredPath(parsed.dataDir, base),
    sources,
  };
}
