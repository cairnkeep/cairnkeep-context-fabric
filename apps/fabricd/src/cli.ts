#!/usr/bin/env node
import { resolve } from "node:path";

import { loadFabricConfig } from "./config.js";
import { FabricRuntime } from "./runtime.js";

function option(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return fallback;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${name} requires a value.`);
  return value;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.length === 0) throw new Error(`${name} is required.`);
  return value;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const configPath = resolve(required(
    option(args, "--config", process.env.CAIRN_FABRIC_CONFIG),
    "--config or CAIRN_FABRIC_CONFIG",
  ));
  const runtime = new FabricRuntime(loadFabricConfig(configPath));
  try {
    const [group, action] = args;
    if (group === "sources" && action === "list") {
      process.stdout.write(`${JSON.stringify(await runtime.sources(), null, 2)}\n`);
      return;
    }
    if (group === "ingest" && action === "--once") {
      const sourceId = option(args, "--source");
      process.stdout.write(`${JSON.stringify(await runtime.ingestOnce(sourceId), null, 2)}\n`);
      return;
    }
    if (group === "evidence" && action === "list") {
      process.stdout.write(`${JSON.stringify(runtime.evidence(args.includes("--include-inactive")), null, 2)}\n`);
      return;
    }
    if (group === "context" && action === "get") {
      const config = loadFabricConfig(configPath);
      const packet = runtime.context({
        schemaVersion: 1,
        deploymentId: config.deploymentId,
        projectId: required(option(args, "--project"), "--project"),
        repository: required(option(args, "--repository"), "--repository"),
        taskRefs: [],
        changedPaths: [],
        queryIntent: option(args, "--query", "Retrieve current admissible evidence"),
        tokenBudget: Number.parseInt(option(args, "--budget", "2048") ?? "2048", 10),
      });
      process.stdout.write(`${JSON.stringify(packet, null, 2)}\n`);
      return;
    }
    throw new Error(
      "Usage: cairn-fabric sources list|ingest --once|evidence list|context get --config FILE [options]",
    );
  } finally {
    runtime.close();
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
