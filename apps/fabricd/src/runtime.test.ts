import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { ContextFabricClient } from "@cairnkeep/context-client";
import { EvidenceEventSchema } from "@cairnkeep/context-contracts";

import { loadFabricConfig } from "./config.js";
import { FabricLedger } from "./ledger.js";
import { FabricRuntime } from "./runtime.js";
import { createFabricServer } from "./server.js";

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/evidence-lifecycle.json", import.meta.url),
);
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

function withConfig(run: (configPath: string) => Promise<void>): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), "cairn-fabric-runtime-"));
  const configPath = join(root, "fabric.json");
  writeFileSync(configPath, JSON.stringify({
    schemaVersion: 1,
    deploymentId: "fixture",
    mode: "shadow",
    principalId: "developer-a",
    dataDir: "state",
    sources: [{
      id: "mock",
      type: "synthetic",
      enabled: true,
      fixturePath,
      containers: ["project-alpha"],
      batchSize: 1,
    }],
  }));
  chmodSync(configPath, 0o600);
  return run(configPath).finally(() => rmSync(root, { recursive: true, force: true }));
}

function request() {
  return {
    schemaVersion: 1 as const,
    deploymentId: "fixture",
    projectId: "project-alpha",
    repository: "/fixture/project-alpha",
    taskRefs: [],
    changedPaths: [],
    queryIntent: "adapter interface",
    tokenBudget: 1024,
  };
}

test("rejects deployment configuration readable by other users", async () => {
  if (process.platform === "win32") return;
  await withConfig(async (configPath) => {
    chmodSync(configPath, 0o644);
    assert.throws(() => loadFabricConfig(configPath), /must not be accessible/);
  });
});

test("persists cursors and fails closed across the complete evidence lifecycle", async () => {
  await withConfig(async (configPath) => {
    const config = loadFabricConfig(configPath);
    let runtime = new FabricRuntime(config);
    assert.deepEqual(await runtime.sources(), [{
      id: "mock",
      type: "synthetic",
      enabled: true,
      containers: ["project-alpha"],
    }]);

    const created = await runtime.ingestOnce();
    assert.equal(created[0]?.batch.events[0]?.operation, "create");
    assert.match(runtime.context(request()).sections[0]?.content ?? "", /Use the stable adapter interface/);
    assert.equal(runtime.context(request(), "developer-b").sections.length, 1);
    runtime.close();

    runtime = new FabricRuntime(config);
    assert.equal((await runtime.sources())[0]?.cursor, "1");
    await runtime.ingestOnce();
    assert.match(
      runtime.context(request()).sections[0]?.content ?? "",
      /Use the reviewed adapter interface and validate inputs/,
    );

    await runtime.ingestOnce();
    assert.equal(runtime.context(request(), "developer-b").sections.length, 0);
    assert.equal(runtime.context(request(), "developer-a").sections.length, 1);

    await runtime.ingestOnce();
    assert.equal(runtime.context(request(), "developer-a").sections.length, 0);
    assert.deepEqual(runtime.evidence(true).map((item) => [item.state, item.accessible]), [["deleted", false]]);
    assert.equal((await runtime.sources())[0]?.cursor, "4");
    runtime.close();
  });
});

test("does not advance a cursor when payload integrity validation fails", async () => {
  await withConfig(async (configPath) => {
    const root = join(configPath, "..");
    const tamperedFixture = join(root, "tampered.json");
    copyFileSync(fixturePath, tamperedFixture);
    const fixture = JSON.parse(readFileSync(tamperedFixture, "utf8")) as {
      payloads: Record<string, string>;
    };
    fixture.payloads["fixture://payload/message-001/revision-1"] = "tampered";
    writeFileSync(tamperedFixture, JSON.stringify(fixture));
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<{ fixturePath: string }>;
    };
    config.sources[0]!.fixturePath = tamperedFixture;
    writeFileSync(configPath, JSON.stringify(config));
    chmodSync(configPath, 0o600);

    const runtime = new FabricRuntime(loadFabricConfig(configPath));
    await assert.rejects(runtime.ingestOnce(), /Payload integrity check failed/);
    assert.equal((await runtime.sources())[0]?.cursor, undefined);
    assert.deepEqual(runtime.evidence(true), []);
    runtime.close();
  });
});

test("replays committed events without fetching their payload again", async () => {
  await withConfig(async (configPath) => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      events: unknown[];
      payloads: Record<string, string>;
    };
    const event = EvidenceEventSchema.parse(fixture.events[0]);
    const ledger = new FabricLedger(join(configPath, "..", "replay.sqlite"));
    await ledger.admit([event], async (payloadRef) => fixture.payloads[payloadRef]!);
    await ledger.admit([event], async () => {
      throw new Error("replayed payload must not be fetched");
    });
    assert.equal(ledger.listEvidence("developer-a").length, 1);
    ledger.close();
  });
});

test("does not retrieve evidence after its retention expiry", async () => {
  await withConfig(async (configPath) => {
    const root = join(configPath, "..");
    const expiredFixture = join(root, "expired.json");
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      events: Array<{ retention: { class: string; expiresAt?: string } }>;
    };
    fixture.events = fixture.events.slice(0, 1);
    fixture.events[0]!.retention.expiresAt = "2025-01-01T00:00:00Z";
    writeFileSync(expiredFixture, JSON.stringify(fixture));
    const config = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<{ fixturePath: string }>;
    };
    config.sources[0]!.fixturePath = expiredFixture;
    writeFileSync(configPath, JSON.stringify(config));
    chmodSync(configPath, 0o600);

    const runtime = new FabricRuntime(loadFabricConfig(configPath));
    await runtime.ingestOnce();
    assert.equal(runtime.context(request()).sections.length, 0);
    assert.equal(runtime.evidence().length, 0);
    runtime.close();
  });
});

test("serves authenticated cited context from the durable runtime", async () => {
  await withConfig(async (configPath) => {
    const runtime = new FabricRuntime(loadFabricConfig(configPath));
    await runtime.ingestOnce();
    const server = createFabricServer({
      token: "fixture-token-with-32-characters",
      contextProvider: (value) => runtime.context(value),
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address() as AddressInfo;
    try {
      const client = new ContextFabricClient({
        baseUrl: `http://127.0.0.1:${address.port}/`,
        token: "fixture-token-with-32-characters",
      });
      assert.equal((await client.capabilities()).features.lifecycle, true);
      const packet = await client.context(request());
      assert.equal(packet.sections.length, 1);
      assert.equal(packet.citations.length, 1);
      assert.match(packet.citations[0]!.sourceLocator, /^mock:\/\/project-alpha\//);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
      runtime.close();
    }
  });
});

test("exposes the synthetic operator workflow through the CLI", async () => {
  await withConfig(async (configPath) => {
    const run = (...args: string[]): unknown => JSON.parse(execFileSync(
      process.execPath,
      [cliPath, ...args, "--config", configPath],
      { encoding: "utf8" },
    ));
    const sources = run("sources", "list") as Array<{ id: string; cursor?: string }>;
    assert.equal(sources[0]?.id, "mock");
    assert.equal(sources[0]?.cursor, undefined);
    run("ingest", "--once");
    const packet = run(
      "context",
      "get",
      "--project",
      "project-alpha",
      "--repository",
      "/fixture/project-alpha",
      "--query",
      "adapter",
    ) as { sections: unknown[]; citations: unknown[] };
    assert.equal(packet.sections.length, 1);
    assert.equal(packet.citations.length, 1);
  });
});
