import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(256);

export const ContextRequestSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: IdentifierSchema,
  projectId: IdentifierSchema,
  repository: z.string().min(1).max(2048),
  branch: z.string().min(1).max(512).optional(),
  taskRefs: z.array(IdentifierSchema).max(32).default([]),
  changedPaths: z.array(z.string().min(1).max(2048)).max(512).default([]),
  queryIntent: z.string().min(1).max(2048).optional(),
  tokenBudget: z.number().int().min(128).max(32_768),
}).strict();

export const CitationSchema = z.object({
  citationId: IdentifierSchema,
  evidenceId: IdentifierSchema,
  sourceLocator: z.string().min(1).max(2048),
  sourceUpdatedAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

export const ContextSectionSchema = z.object({
  kind: z.enum(["memory", "compiled-knowledge", "evidence", "contradiction"]),
  title: z.string().min(1).max(512),
  content: z.string().min(1).max(65_536),
  citationIds: z.array(IdentifierSchema).max(128).default([]),
  tokenEstimate: z.number().int().nonnegative(),
}).strict();

export const ContextPacketSchema = z.object({
  schemaVersion: z.literal(1),
  packetId: IdentifierSchema,
  generatedAt: z.iso.datetime({ offset: true }),
  projectId: IdentifierSchema,
  sections: z.array(ContextSectionSchema).max(128),
  citations: z.array(CitationSchema).max(512),
  totalTokenEstimate: z.number().int().nonnegative(),
  truncated: z.boolean(),
  warnings: z.array(z.string().min(1).max(2048)).max(64).default([]),
}).strict();

export type ContextRequest = z.infer<typeof ContextRequestSchema>;
export type Citation = z.infer<typeof CitationSchema>;
export type ContextSection = z.infer<typeof ContextSectionSchema>;
export type ContextPacket = z.infer<typeof ContextPacketSchema>;
