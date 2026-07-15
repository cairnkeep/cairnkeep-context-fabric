import { z } from "zod";

const IdentifierSchema = z.string().min(1).max(256);

export const ClaimStatusSchema = z.enum([
  "active",
  "contested",
  "invalid",
  "needs-review",
]);

export const ClaimSchema = z.object({
  schemaVersion: z.literal(1),
  claimId: IdentifierSchema,
  deploymentId: IdentifierSchema,
  statement: z.string().min(1).max(16_384),
  evidenceIds: z.array(IdentifierSchema).min(1).max(128),
  confidence: z.number().min(0).max(1),
  status: ClaimStatusSchema,
  validFrom: z.iso.datetime({ offset: true }),
  validUntil: z.iso.datetime({ offset: true }).optional(),
  supersedes: IdentifierSchema.optional(),
}).strict();

export const CandidateStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "snoozed",
  "invalid",
]);

export const MemoryCandidateSchema = z.object({
  schemaVersion: z.literal(1),
  candidateId: IdentifierSchema,
  deploymentId: IdentifierSchema,
  proposedScope: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  proposedKey: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).max(256),
  proposedValue: z.string().min(1).max(32_768),
  evidenceIds: z.array(IdentifierSchema).min(1).max(128),
  claimIds: z.array(IdentifierSchema).max(128).default([]),
  confidence: z.number().min(0).max(1),
  rationale: z.string().min(1).max(4096),
  policyRule: IdentifierSchema,
  state: CandidateStateSchema,
  createdAt: z.iso.datetime({ offset: true }),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
}).strict();

export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type CandidateState = z.infer<typeof CandidateStateSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
