import {
  EvidenceEventSchema,
  type EvidenceEvent,
} from "@cairnkeep/context-contracts";
import { z } from "zod";

const CursorSchema = z.string().min(1).max(8192);

export type ConnectorPullRequest = {
  cursor?: string;
  limit: number;
  signal?: AbortSignal;
};

export type ConnectorBatch = {
  events: EvidenceEvent[];
  nextCursor?: string;
  caughtUp: boolean;
};

export interface ConnectorAdapter {
  readonly id: string;
  pull(request: ConnectorPullRequest): Promise<ConnectorBatch>;
}

export interface CursorStore {
  get(connectorId: string): Promise<string | undefined>;
  set(connectorId: string, cursor: string): Promise<void>;
  clear(connectorId: string): Promise<void>;
}

export class InMemoryCursorStore implements CursorStore {
  readonly #cursors = new Map<string, string>();

  async get(connectorId: string): Promise<string | undefined> {
    return this.#cursors.get(connectorId);
  }

  async set(connectorId: string, cursor: string): Promise<void> {
    this.#cursors.set(connectorId, CursorSchema.parse(cursor));
  }

  async clear(connectorId: string): Promise<void> {
    this.#cursors.delete(connectorId);
  }
}

export type ConnectorRunOptions = {
  connector: ConnectorAdapter;
  cursors: CursorStore;
  admit: (events: readonly EvidenceEvent[]) => Promise<void>;
  limit?: number;
  signal?: AbortSignal;
};

export async function runConnectorOnce(options: ConnectorRunOptions): Promise<ConnectorBatch> {
  const connectorId = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/).parse(options.connector.id);
  const cursor = await options.cursors.get(connectorId);
  const request: ConnectorPullRequest = {
    limit: z.number().int().min(1).max(1000).parse(options.limit ?? 100),
  };
  if (cursor !== undefined) {
    request.cursor = CursorSchema.parse(cursor);
  }
  if (options.signal !== undefined) {
    request.signal = options.signal;
  }

  const pulled = z.object({
    events: z.array(EvidenceEventSchema).max(request.limit),
    nextCursor: CursorSchema.optional(),
    caughtUp: z.boolean(),
  }).strict().parse(await options.connector.pull(request));
  const events = pulled.events;
  const eventIds = new Set<string>();
  const deliveryIds = new Set<string>();
  for (const event of events) {
    if (event.source.connector !== connectorId) {
      throw new Error(`Connector ${connectorId} emitted an event for ${event.source.connector}.`);
    }
    if (eventIds.has(event.eventId) || deliveryIds.has(event.deliveryId)) {
      throw new Error(`Connector ${connectorId} emitted duplicate identifiers in one batch.`);
    }
    eventIds.add(event.eventId);
    deliveryIds.add(event.deliveryId);
  }

  const nextCursor = pulled.nextCursor === undefined
    ? undefined
    : CursorSchema.parse(pulled.nextCursor);
  await options.admit(events);
  if (nextCursor !== undefined) {
    await options.cursors.set(connectorId, nextCursor);
  }

  const result: ConnectorBatch = { events, caughtUp: pulled.caughtUp };
  if (nextCursor !== undefined) {
    result.nextCursor = nextCursor;
  }
  return result;
}
