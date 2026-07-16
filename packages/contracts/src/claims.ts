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
  proposedProjectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
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

export const CandidateDraftSchema = MemoryCandidateSchema.pick({
  proposedScope: true,
  proposedProjectId: true,
  proposedKey: true,
  proposedValue: true,
  evidenceIds: true,
  confidence: true,
  rationale: true,
}).strict();

export const CandidatePatchSchema = CandidateDraftSchema.partial().refine(
  (patch) => Object.keys(patch).length > 0,
  { message: "Candidate patch must change at least one field." },
);

export const MemoryPromotionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  promotionId: IdentifierSchema,
  deploymentId: IdentifierSchema,
  principalId: IdentifierSchema,
  scope: z.string().regex(/^[a-z0-9][a-z0-9-]*$/),
  projectId: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/).optional(),
  key: z.string().regex(/^[a-z0-9][a-z0-9/-]*$/).max(256),
  value: z.string().min(1).max(32_768),
}).strict();

export const MemoryInvalidationRequestSchema = MemoryPromotionRequestSchema.omit({
  value: true,
}).extend({
  reason: z.enum(["evidence-changed", "evidence-unavailable", "access-revoked", "retention-expired"]),
}).strict();

export const CandidateExtractionEvidenceSchema = z.object({
  evidenceId: IdentifierSchema,
  content: z.string().min(1).max(262_144),
  mimeType: z.string().min(1).max(256).optional(),
  occurredAt: z.iso.datetime({ offset: true }),
}).strict();

export const CandidateExtractionRequestSchema = z.object({
  schemaVersion: z.literal(1),
  deploymentId: IdentifierSchema,
  principalId: IdentifierSchema,
  extractorId: IdentifierSchema,
  evidence: z.array(CandidateExtractionEvidenceSchema).min(1).max(32),
}).strict();

export const CandidateExtractionResultSchema = z.object({
  schemaVersion: z.literal(1),
  candidates: z.array(CandidateDraftSchema).max(32),
}).strict();

export type ClaimStatus = z.infer<typeof ClaimStatusSchema>;
export type Claim = z.infer<typeof ClaimSchema>;
export type CandidateState = z.infer<typeof CandidateStateSchema>;
export type MemoryCandidate = z.infer<typeof MemoryCandidateSchema>;
export type CandidateDraft = z.infer<typeof CandidateDraftSchema>;
export type CandidatePatch = z.infer<typeof CandidatePatchSchema>;
export type MemoryPromotionRequest = z.infer<typeof MemoryPromotionRequestSchema>;
export type MemoryInvalidationRequest = z.infer<typeof MemoryInvalidationRequestSchema>;
export type CandidateExtractionEvidence = z.infer<typeof CandidateExtractionEvidenceSchema>;
export type CandidateExtractionRequest = z.infer<typeof CandidateExtractionRequestSchema>;
export type CandidateExtractionResult = z.infer<typeof CandidateExtractionResultSchema>;
