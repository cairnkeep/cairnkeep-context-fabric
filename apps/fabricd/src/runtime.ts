import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  ContextRequestSchema,
  type CandidateState,
  type ContextPacket,
  type ContextRequest,
  type MemoryCandidate,
} from "@cairnkeep/context-contracts";
import { runConnectorOnce, type ConnectorBatch } from "@cairnkeep/connector-sdk";

import type { FabricConfig, SyntheticSourceConfig } from "./config.js";
import {
  FabricLedger,
  type CandidateProposal,
  type CandidateReviewAction,
  type EvidenceSummary,
} from "./ledger.js";
import { SyntheticConnector } from "./synthetic-connector.js";

type SourceRuntime = {
  config: SyntheticSourceConfig;
  connector: SyntheticConnector;
};

export type SourceStatus = {
  id: string;
  type: "synthetic";
  enabled: boolean;
  containers: string[];
  cursor?: string;
};

export class FabricRuntime {
  readonly #config: FabricConfig;
  readonly #ledger: FabricLedger;
  readonly #sources: Map<string, SourceRuntime>;

  constructor(config: FabricConfig) {
    this.#config = config;
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    chmodSync(config.dataDir, 0o700);
    this.#ledger = new FabricLedger(join(config.dataDir, "fabric.sqlite"));
    this.#sources = new Map(config.sources.map((source) => [source.id, {
      config: source,
      connector: new SyntheticConnector(source),
    }]));
  }

  close(): void {
    this.#ledger.close();
  }

  async sources(): Promise<SourceStatus[]> {
    const statuses: SourceStatus[] = [];
    for (const source of this.#sources.values()) {
      const status: SourceStatus = {
        id: source.config.id,
        type: source.config.type,
        enabled: source.config.enabled,
        containers: [...source.config.containers],
      };
      const cursor = await this.#ledger.get(source.config.id);
      if (cursor !== undefined) status.cursor = cursor;
      statuses.push(status);
    }
    return statuses.sort((left, right) => left.id.localeCompare(right.id));
  }

  async ingestOnce(sourceId?: string): Promise<Array<{ sourceId: string; batch: ConnectorBatch }>> {
    const selected = sourceId === undefined
      ? [...this.#sources.values()].filter((source) => source.config.enabled)
      : [this.#source(sourceId)];
    const results: Array<{ sourceId: string; batch: ConnectorBatch }> = [];
    for (const source of selected) {
      if (!source.config.enabled) throw new Error(`Source is disabled: ${source.config.id}`);
      const allowed = new Set(source.config.containers);
      const batch = await runConnectorOnce({
        connector: source.connector,
        cursors: this.#ledger,
        limit: source.config.batchSize,
        admit: async (events) => {
          for (const event of events) {
            if (event.deploymentId !== this.#config.deploymentId) {
              throw new Error(`Source ${source.config.id} emitted a different deployment id.`);
            }
            if (!allowed.has(event.source.container)) {
              throw new Error(`Source ${source.config.id} emitted a non-allowlisted container.`);
            }
          }
          await this.#ledger.admit(events, (payloadRef) => source.connector.payload(payloadRef));
        },
      });
      results.push({ sourceId: source.config.id, batch });
    }
    return results;
  }

  context(request: ContextRequest, principalId = this.#config.principalId): ContextPacket {
    const parsed = ContextRequestSchema.parse(request);
    if (parsed.deploymentId !== this.#config.deploymentId) {
      throw new Error("Context request deployment does not match this fabric.");
    }
    return this.#ledger.context(parsed, principalId);
  }

  evidence(includeInactive = false, principalId = this.#config.principalId): EvidenceSummary[] {
    return this.#ledger.listEvidence(principalId, includeInactive);
  }

  proposeCandidate(
    proposal: CandidateProposal,
    principalId = this.#config.principalId,
  ): MemoryCandidate {
    return this.#ledger.proposeCandidate(proposal, principalId);
  }

  candidates(
    states?: readonly CandidateState[],
    principalId = this.#config.principalId,
  ): MemoryCandidate[] {
    return this.#ledger.listCandidates(principalId, states);
  }

  reviewCandidate(
    candidateId: string,
    action: CandidateReviewAction,
    principalId = this.#config.principalId,
  ): MemoryCandidate {
    return this.#ledger.reviewCandidate(candidateId, action, principalId);
  }

  #source(id: string): SourceRuntime {
    const source = this.#sources.get(id);
    if (source === undefined) throw new Error(`Unknown source: ${id}`);
    return source;
  }
}
