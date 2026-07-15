import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(256);
const Sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);

export const EvidenceOperationSchema = z.enum([
  "create",
  "update",
  "delete",
  "access-change",
  "expire",
]);

export const EvidenceAccessSchema = z.object({
  version: IdentifierSchema,
  readers: z.array(IdentifierSchema).max(256),
  denied: z.array(IdentifierSchema).max(256).default([]),
  classification: z.string().min(1).max(128).optional(),
}).strict();

export const EvidenceContentSchema = z.object({
  mimeType: z.string().min(1).max(255),
  sha256: Sha256Schema,
  payloadRef: z.string().min(1).max(2048),
  bytes: z.number().int().nonnegative().max(50 * 1024 * 1024),
}).strict();

export const EvidenceEventSchema = z.object({
  schemaVersion: z.literal(1),
  eventId: IdentifierSchema,
  deliveryId: IdentifierSchema,
  deploymentId: IdentifierSchema,
  source: z.object({
    connector: IdentifierSchema,
    container: IdentifierSchema,
    item: IdentifierSchema,
    revision: IdentifierSchema.optional(),
  }).strict(),
  operation: EvidenceOperationSchema,
  occurredAt: z.iso.datetime({ offset: true }),
  observedAt: z.iso.datetime({ offset: true }),
  authorId: IdentifierSchema.optional(),
  content: EvidenceContentSchema.optional(),
  access: EvidenceAccessSchema,
  retention: z.object({
    class: IdentifierSchema,
    expiresAt: z.iso.datetime({ offset: true }).optional(),
  }).strict(),
  metadata: z.record(z.string(), z.string()).default({}),
}).strict().superRefine((event, context) => {
  const contentRequired = event.operation === "create" || event.operation === "update";
  if (contentRequired && !event.content) {
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: `${event.operation} events require content metadata`,
    });
  }

  if (!contentRequired && event.content) {
    context.addIssue({
      code: "custom",
      path: ["content"],
      message: `${event.operation} events cannot introduce content`,
    });
  }
});

export type EvidenceOperation = z.infer<typeof EvidenceOperationSchema>;
export type EvidenceAccess = z.infer<typeof EvidenceAccessSchema>;
export type EvidenceContent = z.infer<typeof EvidenceContentSchema>;
export type EvidenceEvent = z.infer<typeof EvidenceEventSchema>;
