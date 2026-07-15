import { readFileSync } from "node:fs";

import { EvidenceEventSchema, type EvidenceEvent } from "@cairnkeep/context-contracts";
import type { ConnectorAdapter, ConnectorBatch, ConnectorPullRequest } from "@cairnkeep/connector-sdk";
import { z } from "zod";

import type { SyntheticSourceConfig } from "./config.js";

const FixtureSchema = z.object({
  fixtureVersion: z.literal(1),
  description: z.string().min(1),
  payloads: z.record(z.string(), z.string()),
  events: z.array(EvidenceEventSchema),
}).strict();

export class SyntheticConnector implements ConnectorAdapter {
  readonly id: string;
  readonly #events: EvidenceEvent[];
  readonly #payloads: Readonly<Record<string, string>>;

  constructor(config: SyntheticSourceConfig) {
    this.id = config.id;
    const fixture = FixtureSchema.parse(JSON.parse(readFileSync(config.fixturePath, "utf8")));
    const containers = new Set(config.containers);
    this.#events = fixture.events.filter((event) => containers.has(event.source.container));
    for (const event of this.#events) {
      if (event.source.connector !== this.id) {
        throw new Error(`Fixture event ${event.eventId} does not belong to connector ${this.id}.`);
      }
    }
    this.#payloads = fixture.payloads;
  }

  async pull(request: ConnectorPullRequest): Promise<ConnectorBatch> {
    const start = request.cursor === undefined ? 0 : Number.parseInt(request.cursor, 10);
    if (!Number.isSafeInteger(start) || start < 0 || start > this.#events.length) {
      throw new Error(`Invalid synthetic cursor: ${request.cursor ?? ""}`);
    }
    const events = this.#events.slice(start, start + request.limit);
    const next = start + events.length;
    return {
      events,
      nextCursor: String(next),
      caughtUp: next >= this.#events.length,
    };
  }

  async payload(payloadRef: string): Promise<string> {
    const payload = this.#payloads[payloadRef];
    if (payload === undefined) throw new Error(`Fixture payload is missing: ${payloadRef}`);
    return payload;
  }
}
