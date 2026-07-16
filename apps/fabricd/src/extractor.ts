import { z } from "zod";

import type { CandidateExtractionRequest } from "@cairnkeep/context-contracts";

const ExtractorIdSchema = z.string().regex(/^[a-z][a-z0-9-]{1,63}$/);
const PolicyRuleSchema = z.string().min(1).max(256);

export type CandidateExtractor = {
  readonly id: string;
  readonly policyRule: string;
  extract(request: CandidateExtractionRequest): Promise<unknown>;
};

export function validateCandidateExtractor(extractor: CandidateExtractor): CandidateExtractor {
  ExtractorIdSchema.parse(extractor.id);
  PolicyRuleSchema.parse(extractor.policyRule);
  return extractor;
}
