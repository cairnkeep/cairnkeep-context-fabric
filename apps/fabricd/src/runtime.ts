import { chmodSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  CandidateExtractionRequestSchema,
  CandidateExtractionResultSchema,
  ContextRequestSchema,
  type CandidateState,
  type ContextPacket,
  type ContextRequest,
  type MemoryCandidate,
} from "@cairnkeep/context-contracts";
import {
  pullConnectorBatch,
  runConnectorOnce,
  verifyConnectorPayloads,
  type ConnectorBatch,
  type ConnectorRegistration,
  type EvidenceConnectorAdapter,
} from "@cairnkeep/connector-sdk";

import type { FabricConfig, FabricSourceConfig, SyntheticSourceConfig } from "./config.js";
import { validateCandidateExtractor, type CandidateExtractor } from "./extractor.js";
import {
  FabricLedger,
  type CandidateProposal,
  type CandidateReviewAction,
  type EvidenceSummary,
} from "./ledger.js";
import { SyntheticConnector } from "./synthetic-connector.js";

type SourceRuntime = {
  config: FabricSourceConfig;
  connector: EvidenceConnectorAdapter;
};

export type SourceStatus = {
  id: string;
  type: string;
  enabled: boolean;
  available: boolean;
  containers: string[];
  cursorPresent: boolean;
  checkedAt?: string;
  healthExpiresAt?: string;
};

export type SourcePreview = {
  sourceId: string;
  type: string;
  caughtUp: boolean;
  currentCursorPresent: boolean;
  nextCursorPresent: boolean;
  events: Array<{
    eventId: string;
    operation: string;
    container: string;
    item: string;
    revision?: string;
    occurredAt: string;
    bytes?: number;
  }>;
};

export type SourceIngestResult = {
  sourceId: string;
  eventCount: number;
  caughtUp: boolean;
  cursorAdvanced: boolean;
};

export type CandidateExtractionSummary = {
  extractorId: string;
  candidateCount: number;
  candidateIds: string[];
};

function syntheticSource(source: FabricSourceConfig): source is SyntheticSourceConfig {
  return source.type === "synthetic" && "fixturePath" in source;
}

export class FabricRuntime {
  readonly #config: FabricConfig;
  readonly #ledger: FabricLedger;
  readonly #sources: Map<string, SourceRuntime>;
  readonly #extractor: CandidateExtractor | undefined;

  constructor(
    config: FabricConfig,
    registrations: readonly ConnectorRegistration[] = [],
    extractor?: CandidateExtractor,
  ) {
    this.#config = config;
    const registered = new Map<string, ConnectorRegistration>();
    for (const registration of registrations) {
      if (registered.has(registration.type)) {
        throw new Error(`Duplicate connector registration: ${registration.type}`);
      }
      registered.set(registration.type, registration);
    }
    const sources = new Map(config.sources.map((source) => {
      const connector = syntheticSource(source)
        ? new SyntheticConnector(source)
        : registered.get(source.type)?.create(source, {
          deploymentId: config.deploymentId,
          principalId: config.principalId,
          dataDir: config.dataDir,
        });
      if (connector === undefined) throw new Error(`No connector registered for source type: ${source.type}`);
      if (connector.id !== source.id) {
        throw new Error(`Connector for source ${source.id} returned id ${connector.id}.`);
      }
      return [source.id, { config: source, connector }];
    }));
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    chmodSync(config.dataDir, 0o700);
    this.#ledger = new FabricLedger(join(config.dataDir, "fabric.sqlite"));
    this.#sources = sources;
    this.#extractor = extractor === undefined ? undefined : validateCandidateExtractor(extractor);
    for (const source of sources.values()) {
      if (!source.config.enabled) this.#ledger.setConnectorAvailability(source.config.id, false);
    }
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
        available: false,
        containers: [...source.config.containers],
        cursorPresent: false,
      };
      const health = this.#ledger.connectorAvailability(source.config.id);
      status.available = health.available;
      if (health.checkedAt !== undefined) status.checkedAt = health.checkedAt;
      if (health.expiresAt !== undefined) status.healthExpiresAt = health.expiresAt;
      const cursor = await this.#ledger.get(source.config.id);
      status.cursorPresent = cursor !== undefined;
      statuses.push(status);
    }
    return statuses.sort((left, right) => left.id.localeCompare(right.id));
  }

  async ingestOnce(sourceId?: string): Promise<SourceIngestResult[]> {
    const selected = sourceId === undefined
      ? [...this.#sources.values()].filter((source) => source.config.enabled)
      : [this.#source(sourceId)];
    const results: SourceIngestResult[] = [];
    for (const source of selected) {
      if (!source.config.enabled) throw new Error(`Source is disabled: ${source.config.id}`);
      const allowed = new Set(source.config.containers);
      try {
        const batch = await runConnectorOnce({
          connector: source.connector,
          cursors: this.#ledger,
          limit: source.config.batchSize,
          admit: async (events) => {
            this.#validateEvents(source, events, allowed);
            await this.#ledger.admit(events, (payloadRef) => source.connector.payload(payloadRef));
          },
        });
        this.#ledger.setConnectorAvailability(
          source.config.id,
          true,
          new Date(),
          source.config.healthTtlSeconds,
        );
        results.push({
          sourceId: source.config.id,
          eventCount: batch.events.length,
          caughtUp: batch.caughtUp,
          cursorAdvanced: batch.nextCursor !== undefined,
        });
      } catch (error) {
        this.#ledger.setConnectorAvailability(source.config.id, false);
        throw error;
      }
    }
    return results;
  }

  async preview(sourceId: string): Promise<SourcePreview> {
    const source = this.#source(sourceId);
    const currentCursor = await this.#ledger.get(source.config.id);
    const batch = await pullConnectorBatch({
      connector: source.connector,
      ...(currentCursor === undefined ? {} : { cursor: currentCursor }),
      limit: source.config.batchSize,
    });
    this.#validateEvents(source, batch.events, new Set(source.config.containers));
    await verifyConnectorPayloads(source.connector, batch.events);
    const preview: SourcePreview = {
      sourceId: source.config.id,
      type: source.config.type,
      caughtUp: batch.caughtUp,
      currentCursorPresent: currentCursor !== undefined,
      nextCursorPresent: batch.nextCursor !== undefined,
      events: batch.events.map((event) => ({
        eventId: event.eventId,
        operation: event.operation,
        container: event.source.container,
        item: event.source.item,
        ...(event.source.revision === undefined ? {} : { revision: event.source.revision }),
        occurredAt: event.occurredAt,
        ...(event.content === undefined ? {} : { bytes: event.content.bytes }),
      })),
    };
    return preview;
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

  async extractCandidates(
    evidenceIds: readonly string[],
    principalId = this.#config.principalId,
  ): Promise<CandidateExtractionSummary> {
    if (this.#extractor === undefined) {
      throw new Error("No candidate extractor is registered for this deployment.");
    }
    const evidence = this.#ledger.extractionEvidence(evidenceIds, principalId);
    if (evidence.some((item) => item.deploymentId !== this.#config.deploymentId)) {
      throw new Error("Candidate extraction evidence belongs to a different deployment.");
    }
    const request = CandidateExtractionRequestSchema.parse({
      schemaVersion: 1,
      deploymentId: this.#config.deploymentId,
      principalId,
      extractorId: this.#extractor.id,
      evidence: evidence.map(({ deploymentId: _deploymentId, ...item }) => item),
    });
    const result = CandidateExtractionResultSchema.parse(await this.#extractor.extract(request));
    const allowedEvidence = new Set(evidenceIds);
    const signatures = new Set<string>();
    for (const draft of result.candidates) {
      if (draft.evidenceIds.some((id) => !allowedEvidence.has(id))) {
        throw new Error("Candidate extractor cited evidence outside the selected set.");
      }
      if (new Set(draft.evidenceIds).size !== draft.evidenceIds.length) {
        throw new Error("Candidate extractor returned duplicate evidence citations.");
      }
      const signature = JSON.stringify(draft);
      if (signatures.has(signature)) {
        throw new Error("Candidate extractor returned duplicate proposals.");
      }
      signatures.add(signature);
    }
    const candidates = result.candidates.map((draft) => this.#ledger.proposeCandidate({
      ...draft,
      policyRule: this.#extractor!.policyRule,
    }, principalId));
    return {
      extractorId: this.#extractor.id,
      candidateCount: candidates.length,
      candidateIds: candidates.map((candidate) => candidate.candidateId),
    };
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

  #validateEvents(
    source: SourceRuntime,
    events: readonly ConnectorBatch["events"][number][],
    allowed: ReadonlySet<string>,
  ): void {
    for (const event of events) {
      if (event.deploymentId !== this.#config.deploymentId) {
        throw new Error(`Source ${source.config.id} emitted a different deployment id.`);
      }
      if (!allowed.has(event.source.container)) {
        throw new Error(`Source ${source.config.id} emitted a non-allowlisted container.`);
      }
    }
  }
}
