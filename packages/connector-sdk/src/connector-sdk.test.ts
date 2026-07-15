import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { EvidenceEvent } from "@cairnkeep/context-contracts";

import {
  ConnectorSourceConfigSchema,
  InMemoryCursorStore,
  defineConnectorRegistration,
  pullConnectorBatch,
  runConnectorOnce,
  verifyConnectorPayloads,
  type ConnectorAdapter,
  type EvidenceConnectorAdapter,
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

test("pulls a validated batch without owning cursor persistence", async () => {
  const connector: ConnectorAdapter = {
    id: "mock",
    async pull(request) {
      assert.equal(request.cursor, "cursor-1");
      return { events: [fixtureEvent()], nextCursor: "cursor-2", caughtUp: true };
    },
  };
  const batch = await pullConnectorBatch({ connector, cursor: "cursor-1", limit: 1 });
  assert.equal(batch.nextCursor, "cursor-2");
  assert.equal(batch.events.length, 1);
});

test("verifies payload bytes and digest before preview or admission", async () => {
  const payload = "reviewed source payload";
  const event = fixtureEvent({
    content: {
      mimeType: "text/plain",
      sha256: createHash("sha256").update(payload).digest("hex"),
      payloadRef: "fixture://payload/message-001",
      bytes: Buffer.byteLength(payload),
    },
  });
  const connector: EvidenceConnectorAdapter = {
    id: "mock",
    async pull() {
      return { events: [event], caughtUp: true };
    },
    async payload() {
      return payload;
    },
  };
  await verifyConnectorPayloads(connector, [event]);
  await assert.rejects(
    verifyConnectorPayloads({ ...connector, payload: async () => "tampered" }, [event]),
    /Payload integrity check failed/,
  );
});

test("defines registrations with validated common source configuration", () => {
  let receivedDeployment: string | undefined;
  const registration = defineConnectorRegistration({
    type: "fixture-plugin",
    parseConfig(value) {
      return ConnectorSourceConfigSchema.parse(value);
    },
    create(config, context) {
      receivedDeployment = context.deploymentId;
      return {
        id: config.id,
        async pull() {
          return { events: [], caughtUp: true };
        },
        async payload() {
          throw new Error("no payload");
        },
      };
    },
  });
  const config = registration.parseConfig({
    id: "fixture-source",
    type: "fixture-plugin",
    containers: ["project-alpha"],
  }, { baseDir: "/fixture" });
  assert.equal(config.enabled, false);
  assert.equal(config.batchSize, 100);
  assert.equal(config.healthTtlSeconds, 900);
  assert.equal(registration.create(config, {
    deploymentId: "fixture",
    principalId: "developer-a",
    dataDir: "/fixture/state",
  }).id, "fixture-source");
  assert.equal(receivedDeployment, "fixture");
  assert.throws(() => registration.parseConfig({
    id: "fixture-source",
    type: "other-plugin",
    containers: ["project-alpha"],
  }, { baseDir: "/fixture" }), /returned type other-plugin/);
});
