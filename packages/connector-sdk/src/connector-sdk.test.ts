import assert from "node:assert/strict";
import test from "node:test";

import type { EvidenceEvent } from "@cairnkeep/context-contracts";

import {
  InMemoryCursorStore,
  runConnectorOnce,
  type ConnectorAdapter,
} from "./index.js";

function fixtureEvent(overrides: Partial<EvidenceEvent> = {}): EvidenceEvent {
  return {
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
    operation: "create",
    occurredAt: "2026-01-01T10:00:00Z",
    observedAt: "2026-01-01T10:00:01Z",
    content: {
      mimeType: "text/plain",
      sha256: "a".repeat(64),
      payloadRef: "fixture://payload/message-001",
      bytes: 12,
    },
    access: { version: "acl-1", readers: ["developer-a"], denied: [] },
    retention: { class: "fixture" },
    metadata: {},
    ...overrides,
  };
}

test("advances the cursor only after admission succeeds", async () => {
  const cursors = new InMemoryCursorStore();
  const connector: ConnectorAdapter = {
    id: "mock",
    async pull() {
      return { events: [fixtureEvent()], nextCursor: "cursor-2", caughtUp: true };
    },
  };

  await assert.rejects(
    runConnectorOnce({
      connector,
      cursors,
      async admit() {
        throw new Error("fixture admission failure");
      },
    }),
    /admission failure/,
  );
  assert.equal(await cursors.get("mock"), undefined);

  await runConnectorOnce({ connector, cursors, admit: async () => undefined });
  assert.equal(await cursors.get("mock"), "cursor-2");
});

test("rejects mixed connector identities", async () => {
  const connector: ConnectorAdapter = {
    id: "mock",
    async pull() {
      return {
        events: [fixtureEvent({ source: { connector: "other", container: "x", item: "y" } })],
        caughtUp: true,
      };
    },
  };
  await assert.rejects(
    runConnectorOnce({
      connector,
      cursors: new InMemoryCursorStore(),
      admit: async () => undefined,
    }),
    /emitted an event for other/,
  );
});

test("rejects duplicate identifiers within one batch", async () => {
  const event = fixtureEvent();
  const connector: ConnectorAdapter = {
    id: "mock",
    async pull() {
      return { events: [event, { ...event }], caughtUp: true };
    },
  };
  await assert.rejects(
    runConnectorOnce({
      connector,
      cursors: new InMemoryCursorStore(),
      admit: async () => undefined,
    }),
    /duplicate identifiers/,
  );
});

test("rejects batches larger than the requested limit", async () => {
  const connector: ConnectorAdapter = {
    id: "mock",
    async pull() {
      return {
        events: [
          fixtureEvent(),
          fixtureEvent({ eventId: "event-002", deliveryId: "delivery-002" }),
        ],
        caughtUp: false,
      };
    },
  };
  await assert.rejects(
    runConnectorOnce({
      connector,
      cursors: new InMemoryCursorStore(),
      admit: async () => undefined,
      limit: 1,
    }),
  );
});
