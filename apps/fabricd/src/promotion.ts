import {
  MemoryInvalidationRequestSchema,
  MemoryPromotionRequestSchema,
  type MemoryInvalidationRequest,
  type MemoryPromotionRequest,
} from "@cairnkeep/context-contracts";

export type MemoryPromotionAdapter = {
  id: string;
  apply(request: MemoryPromotionRequest): Promise<void>;
  invalidate(request: MemoryInvalidationRequest): Promise<void>;
};

export function validateMemoryPromotionAdapter(adapter: MemoryPromotionAdapter): MemoryPromotionAdapter {
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(adapter.id)) {
    throw new Error("Memory promotion adapter id must be a kebab-case identifier.");
  }
  if (typeof adapter.apply !== "function" || typeof adapter.invalidate !== "function") {
    throw new Error("Memory promotion adapter must implement apply and invalidate.");
  }
  return {
    id: adapter.id,
    async apply(request) {
      await adapter.apply(MemoryPromotionRequestSchema.parse(request));
    },
    async invalidate(request) {
      await adapter.invalidate(MemoryInvalidationRequestSchema.parse(request));
    },
  };
}
