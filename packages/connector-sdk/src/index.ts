import { createHash } from "node:crypto";

import {
  EvidenceEventSchema,
  type EvidenceEvent,
} from "@cairnkeep/context-contracts";
import { z } from "zod";

const CursorSchema = z.string().min(1).max(8192);
const IdentifierSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);

export const ConnectorSourceConfigSchema = z.object({
  id: IdentifierSchema,
  type: IdentifierSchema,
  enabled: z.boolean().default(false),
  containers: z.array(z.string().min(1).max(256)).min(1).max(128),
  batchSize: z.number().int().min(1).max(1000).default(100),
}).passthrough();

export type ConnectorSourceConfig = z.infer<typeof ConnectorSourceConfigSchema>;

export type ConnectorConfigContext = {
  baseDir: string;
};

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

export interface EvidenceConnectorAdapter extends ConnectorAdapter {
  payload(payloadRef: string, signal?: AbortSignal): Promise<string>;
}

export type ConnectorRegistration = {
  readonly type: string;
  parseConfig(value: unknown, context: ConnectorConfigContext): ConnectorSourceConfig;
  create(config: ConnectorSourceConfig): EvidenceConnectorAdapter;
};

type TypedConnectorRegistration<TConfig extends ConnectorSourceConfig> = {
  readonly type: string;
  parseConfig(value: unknown, context: ConnectorConfigContext): TConfig;
  create(config: TConfig): EvidenceConnectorAdapter;
};

export function defineConnectorRegistration<TConfig extends ConnectorSourceConfig>(
  registration: TypedConnectorRegistration<TConfig>,
): ConnectorRegistration {
  const type = IdentifierSchema.parse(registration.type);
  return {
    type,
    parseConfig(value, context) {
      const parsed = registration.parseConfig(value, context);
      const common = ConnectorSourceConfigSchema.parse(parsed);
      if (common.type !== type) {
        throw new Error(`Connector registration ${type} returned type ${common.type}.`);
      }
      return common as TConfig;
    },
    create(config) {
      return registration.create(config as TConfig);
    },
  };
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

export type ConnectorPullOptions = {
  connector: ConnectorAdapter;
  cursor?: string;
  limit?: number;
  signal?: AbortSignal;
};

export async function pullConnectorBatch(options: ConnectorPullOptions): Promise<ConnectorBatch> {
  const connectorId = IdentifierSchema.parse(options.connector.id);
  const request: ConnectorPullRequest = {
    limit: z.number().int().min(1).max(1000).parse(options.limit ?? 100),
  };
  if (options.cursor !== undefined) request.cursor = CursorSchema.parse(options.cursor);
  if (options.signal !== undefined) request.signal = options.signal;

  const pulled = z.object({
    events: z.array(EvidenceEventSchema).max(request.limit),
    nextCursor: CursorSchema.optional(),
    caughtUp: z.boolean(),
  }).strict().parse(await options.connector.pull(request));
  const eventIds = new Set<string>();
  const deliveryIds = new Set<string>();
  for (const event of pulled.events) {
    if (event.source.connector !== connectorId) {
      throw new Error(`Connector ${connectorId} emitted an event for ${event.source.connector}.`);
    }
    if (eventIds.has(event.eventId) || deliveryIds.has(event.deliveryId)) {
      throw new Error(`Connector ${connectorId} emitted duplicate identifiers in one batch.`);
    }
    eventIds.add(event.eventId);
    deliveryIds.add(event.deliveryId);
  }
  const result: ConnectorBatch = { events: pulled.events, caughtUp: pulled.caughtUp };
  if (pulled.nextCursor !== undefined) result.nextCursor = pulled.nextCursor;
  return result;
}

export async function verifyConnectorPayloads(
  connector: EvidenceConnectorAdapter,
  events: readonly EvidenceEvent[],
  signal?: AbortSignal,
): Promise<void> {
  for (const event of events) {
    if (event.content === undefined) continue;
    const payload = await connector.payload(event.content.payloadRef, signal);
    const bytes = Buffer.byteLength(payload);
    const sha256 = createHash("sha256").update(payload).digest("hex");
    if (bytes !== event.content.bytes || sha256 !== event.content.sha256) {
      throw new Error(`Payload integrity check failed for ${event.eventId}.`);
    }
  }
}

export async function runConnectorOnce(options: ConnectorRunOptions): Promise<ConnectorBatch> {
  const connectorId = IdentifierSchema.parse(options.connector.id);
  const cursor = await options.cursors.get(connectorId);
  const pulled = await pullConnectorBatch({
    connector: options.connector,
    ...(cursor === undefined ? {} : { cursor }),
    ...(options.limit === undefined ? {} : { limit: options.limit }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });
  const nextCursor = pulled.nextCursor;
  await options.admit(pulled.events);
  if (nextCursor !== undefined) {
    await options.cursors.set(connectorId, nextCursor);
  }

  const result: ConnectorBatch = { events: pulled.events, caughtUp: pulled.caughtUp };
  if (nextCursor !== undefined) {
    result.nextCursor = nextCursor;
  }
  return result;
}
