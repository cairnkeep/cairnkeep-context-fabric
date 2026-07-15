import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ContextRequestSchema,
  EvidenceEventSchema,
  MemoryCandidateSchema,
} from "./index.js";

const baseEvent = {
  schemaVersion: 1,
  eventId: "event-001",
  deliveryId: "delivery-001",
  deploymentId: "fixture",
  source: {
    connector: "mock",
    container: "project-alpha",
    item: "message-001",
    revision: "1",
  },
  occurredAt: "2026-01-01T10:00:00Z",
  observedAt: "2026-01-01T10:00:01Z",
  access: { version: "acl-1", readers: ["developer-a"], denied: [] },
  retention: { class: "fixture" },
  metadata: {},
} as const;

test("create evidence requires content metadata", () => {
  const result = EvidenceEventSchema.safeParse({ ...baseEvent, operation: "create" });
  assert.equal(result.success, false);
});

test("delete evidence cannot introduce new content", () => {
  const result = EvidenceEventSchema.safeParse({
    ...baseEvent,
    operation: "delete",
    content: {
      mimeType: "text/plain",
      sha256: "a".repeat(64),
      payloadRef: "fixture://payload/message-001",
      bytes: 12,
    },
  });
  assert.equal(result.success, false);
});

test("context requests reject captured full prompts", () => {
  const result = ContextRequestSchema.safeParse({
    schemaVersion: 1,
    deploymentId: "fixture",
    projectId: "project-alpha",
    repository: "/fixture/project-alpha",
    tokenBudget: 1024,
    prompt: "This field must never be accepted",
  });
  assert.equal(result.success, false);
});

test("communication candidates require evidence", () => {
  const result = MemoryCandidateSchema.safeParse({
    schemaVersion: 1,
    candidateId: "candidate-001",
    deploymentId: "fixture",
    proposedScope: "project",
    proposedKey: "decisions/example",
    proposedValue: "Use the reviewed interface.",
    evidenceIds: [],
    claimIds: [],
    confidence: 0.9,
    rationale: "Fixture rationale",
    policyRule: "human-review",
    state: "pending",
    createdAt: "2026-01-01T10:01:00Z",
  });
  assert.equal(result.success, false);
});

test("synthetic lifecycle fixtures conform to the evidence contract", () => {
  const fixtureUrl = new URL("../../../tests/fixtures/evidence-lifecycle.json", import.meta.url);
  const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as { events?: unknown[] };
  assert.ok(Array.isArray(fixture.events));
  const events = fixture.events.map((event) => EvidenceEventSchema.parse(event));
  assert.deepEqual(
    events.map((event) => event.operation),
    ["create", "update", "access-change", "delete"],
  );
});
