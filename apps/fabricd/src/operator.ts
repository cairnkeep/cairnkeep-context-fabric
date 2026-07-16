import { resolve } from "node:path";

import { CandidateStateSchema } from "@cairnkeep/context-contracts";
import type { ConnectorRegistration } from "@cairnkeep/connector-sdk";

import { loadFabricConfig } from "./config.js";
import type { CandidateExtractor } from "./extractor.js";
import type { CandidateReviewAction } from "./ledger.js";
import type { MemoryPromotionAdapter } from "./promotion.js";
import { FabricRuntime } from "./runtime.js";

function option(args: readonly string[], name: string, fallback?: string): string | undefined {
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

export async function runFabricOperator(
  args: readonly string[],
  registrations: readonly ConnectorRegistration[] = [],
  extractor?: CandidateExtractor,
  promotionAdapter?: MemoryPromotionAdapter,
): Promise<unknown> {
  const configPath = resolve(required(
    option(args, "--config", process.env.CAIRN_FABRIC_CONFIG),
    "--config or CAIRN_FABRIC_CONFIG",
  ));
  const config = loadFabricConfig(configPath, registrations);
  const runtime = new FabricRuntime(config, registrations, extractor, promotionAdapter);
  try {
    const [group, action] = args;
    if (group === "sources" && action === "list") return await runtime.sources();
    if (group === "sources" && action === "preview") {
      return await runtime.preview(required(option(args, "--source"), "--source"));
    }
    if (group === "ingest" && action === "--once") {
      return await runtime.ingestOnce(option(args, "--source"));
    }
    if (group === "evidence" && action === "list") {
      return runtime.evidence(args.includes("--include-inactive"));
    }
    if (group === "context" && action === "get") {
      return runtime.context({
        schemaVersion: 1,
        deploymentId: config.deploymentId,
        projectId: required(option(args, "--project"), "--project"),
        repository: required(option(args, "--repository"), "--repository"),
        taskRefs: [],
        changedPaths: [],
        queryIntent: option(args, "--query", "Retrieve current admissible evidence"),
        tokenBudget: Number.parseInt(option(args, "--budget", "2048") ?? "2048", 10),
      });
    }
    if (group === "candidates" && action === "propose") {
      const evidenceIds = required(option(args, "--evidence"), "--evidence")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return runtime.proposeCandidate({
        proposedScope: required(option(args, "--scope"), "--scope"),
        ...(option(args, "--project") === undefined ? {} : { proposedProjectId: option(args, "--project") }),
        proposedKey: required(option(args, "--key"), "--key"),
        proposedValue: required(option(args, "--value"), "--value"),
        evidenceIds,
        confidence: Number.parseFloat(option(args, "--confidence", "0.5") ?? "0.5"),
        rationale: required(option(args, "--rationale"), "--rationale"),
      });
    }
    if (group === "candidates" && action === "extract") {
      const evidenceIds = required(option(args, "--evidence"), "--evidence")
        .split(",")
        .map((value) => value.trim())
        .filter((value) => value.length > 0);
      return await runtime.extractCandidates(evidenceIds);
    }
    if (group === "candidates" && action === "list") {
      const rawStates = option(args, "--state");
      const states = rawStates === undefined
        ? undefined
        : rawStates.split(",").map((state) => CandidateStateSchema.parse(state.trim()));
      return runtime.candidates(states);
    }
    if (group === "candidates" && action === "review") {
      const reviewAction = required(option(args, "--action"), "--action");
      if (!["approve", "reject", "snooze"].includes(reviewAction)) {
        throw new Error("--action must be approve, reject, or snooze.");
      }
      return runtime.reviewCandidate(
        required(option(args, "--id"), "--id"),
        reviewAction as CandidateReviewAction,
      );
    }
    if (group === "candidates" && action === "edit") {
      const patch: Record<string, unknown> = {};
      const scope = option(args, "--scope");
      const key = option(args, "--key");
      const value = option(args, "--value");
      const evidence = option(args, "--evidence");
      const confidence = option(args, "--confidence");
      const rationale = option(args, "--rationale");
      if (scope !== undefined) patch.proposedScope = scope;
      const project = option(args, "--project");
      if (project !== undefined) patch.proposedProjectId = project;
      if (key !== undefined) patch.proposedKey = key;
      if (value !== undefined) patch.proposedValue = value;
      if (evidence !== undefined) {
        patch.evidenceIds = evidence.split(",").map((item) => item.trim()).filter(Boolean);
      }
      if (confidence !== undefined) patch.confidence = Number.parseFloat(confidence);
      if (rationale !== undefined) patch.rationale = rationale;
      return runtime.editCandidate(required(option(args, "--id"), "--id"), patch);
    }
    if (group === "candidates" && action === "promote") {
      return await runtime.promoteCandidate(required(option(args, "--id"), "--id"));
    }
    if (group === "promotions" && action === "list") return runtime.promotions();
    if (group === "promotions" && action === "reconcile") return await runtime.reconcilePromotions();
    throw new Error(
      "Usage: cairn-fabric sources list|sources preview|ingest --once|evidence list|context get|candidates propose|candidates extract|candidates list|candidates edit|candidates review|candidates promote|promotions list|promotions reconcile --config FILE [options]",
    );
  } finally {
    runtime.close();
  }
}
