import { z } from "zod";

export const CONTEXT_PROTOCOL_VERSION = "0.1" as const;

export const CapabilitiesSchema = z.object({
  protocolVersion: z.literal(CONTEXT_PROTOCOL_VERSION),
  serviceVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/),
  evidenceSchemaVersions: z.array(z.literal(1)).min(1),
  contextPacketVersions: z.array(z.literal(1)).min(1),
  features: z.object({
    lifecycle: z.boolean(),
    compiledWiki: z.boolean(),
    candidates: z.boolean(),
    invalidation: z.boolean(),
    activeWorkGraph: z.boolean(),
  }).strict(),
  limits: z.object({
    eventBytes: z.number().int().positive(),
    batchSize: z.number().int().positive(),
    packetTokens: z.number().int().positive(),
  }).strict(),
}).strict();

export type Capabilities = z.infer<typeof CapabilitiesSchema>;
