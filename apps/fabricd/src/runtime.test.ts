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
import {
  ConnectorSourceConfigSchema,
  defineConnectorRegistration,
  type ConnectorRegistration,
  type ConnectorSourceConfig,
} from "@cairnkeep/connector-sdk";

import { loadFabricConfig } from "./config.js";
import type { CandidateExtractor } from "./extractor.js";
import { FabricLedger } from "./ledger.js";
import { FabricRuntime } from "./runtime.js";
import { createFabricServer } from "./server.js";
import { SyntheticConnector } from "./synthetic-connector.js";

const fixturePath = fileURLToPath(
  new URL("../../../tests/fixtures/evidence-lifecycle.json", import.meta.url),
);
const cliPath = fileURLToPath(new URL("../dist/cli.js", import.meta.url));

type FixturePluginConfig = ConnectorSourceConfig & { fixturePath: string };

function fixturePlugin(): ConnectorRegistration {
  return defineConnectorRegistration<FixturePluginConfig>({
    type: "fixture-plugin",
    parseConfig(value) {
      const common = ConnectorSourceConfigSchema.parse(value);
      const fixture = value as { fixturePath?: unknown };
      if (typeof fixture.fixturePath !== "string" || fixture.fixturePath.length === 0) {
        throw new Error("fixturePath is required.");
      }
      return { ...common, fixturePath: fixture.fixturePath };
    },
    create(config) {
      return new SyntheticConnector({
        id: config.id,
        type: "synthetic",
        enabled: config.enabled,
        fixturePath: config.fixturePath,
        containers: config.containers,
        batchSize: config.batchSize,
        healthTtlSeconds: config.healthTtlSeconds,
      });
    },
  });
}

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

test("loads only explicitly registered connector types and previews without admission", async () => {
  await withConfig(async (configPath) => {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<Record<string, unknown>>;
    };
    raw.sources[0]!.type = "fixture-plugin";
    raw.sources[0]!.enabled = false;
    writeFileSync(configPath, JSON.stringify(raw));
    chmodSync(configPath, 0o600);

    assert.throws(() => loadFabricConfig(configPath), /Unknown source type: fixture-plugin/);
    const registration = fixturePlugin();
    const config = loadFabricConfig(configPath, [registration]);
    const runtime = new FabricRuntime(config, [registration]);
    const preview = await runtime.preview("mock");
    assert.equal(preview.type, "fixture-plugin");
    assert.equal(preview.currentCursorPresent, false);
    assert.equal(preview.nextCursorPresent, true);
    assert.equal("currentCursor" in preview, false);
    assert.equal("nextCursor" in preview, false);
    assert.equal(preview.events[0]?.operation, "create");
    assert.equal((await runtime.sources())[0]?.cursorPresent, false);
    assert.deepEqual(runtime.evidence(true), []);
    assert.deepEqual(await runtime.preview("mock"), preview);
    await assert.rejects(runtime.ingestOnce("mock"), /Source is disabled/);
    runtime.close();

    raw.sources[0]!.enabled = true;
    writeFileSync(configPath, JSON.stringify(raw));
    chmodSync(configPath, 0o600);
    const enabledConfig = loadFabricConfig(configPath, [registration]);
    const enabledRuntime = new FabricRuntime(enabledConfig, [registration]);
    await enabledRuntime.ingestOnce("mock");
    assert.equal((await enabledRuntime.sources())[0]?.cursorPresent, true);
    assert.equal(enabledRuntime.evidence().length, 1);
    enabledRuntime.close();
  });
});

test("rejects connector parsers that widen common source policy", async () => {
  await withConfig(async (configPath) => {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<Record<string, unknown>>;
    };
    raw.sources[0]!.type = "fixture-plugin";
    writeFileSync(configPath, JSON.stringify(raw));
    chmodSync(configPath, 0o600);
    const registration = defineConnectorRegistration({
      type: "fixture-plugin",
      parseConfig(value) {
        return {
          ...ConnectorSourceConfigSchema.parse(value),
          containers: ["broader-container"],
        };
      },
      create() {
        throw new Error("must not construct a rejected connector");
      },
    });
    assert.throws(
      () => loadFabricConfig(configPath, [registration]),
      /changed common source policy/,
    );
  });
});

test("rejects inline connector credentials without exposing their value", async () => {
  await withConfig(async (configPath) => {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<Record<string, unknown>>;
    };
    raw.sources[0]!.type = "fixture-plugin";
    raw.sources[0]!["clientSecret"] = "sensitive-fixture-value";
    writeFileSync(configPath, JSON.stringify(raw));
    chmodSync(configPath, 0o600);
    assert.throws(() => loadFabricConfig(configPath, [fixturePlugin()]), (error: unknown) => {
      assert.match(String(error), /Inline credential field is not allowed: clientSecret/);
      assert.doesNotMatch(String(error), /sensitive-fixture-value/);
      return true;
    });
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
      available: false,
      containers: ["project-alpha"],
      cursorPresent: false,
    }]);

    const created = await runtime.ingestOnce();
    assert.deepEqual(created, [{
      sourceId: "mock",
      eventCount: 1,
      caughtUp: false,
      cursorAdvanced: true,
    }]);
    assert.match(runtime.context(request()).sections[0]?.content ?? "", /Use the stable adapter interface/);
    assert.equal(runtime.context(request(), "developer-b").sections.length, 1);
    runtime.close();

    runtime = new FabricRuntime(config);
    assert.equal((await runtime.sources())[0]?.cursorPresent, true);
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
    assert.equal((await runtime.sources())[0]?.cursorPresent, true);
    runtime.close();
  });
});

test("withholds evidence and candidates while a connector is unavailable", async () => {
  await withConfig(async (configPath) => {
    const raw = JSON.parse(readFileSync(configPath, "utf8")) as {
      sources: Array<Record<string, unknown>>;
    };
    raw.sources[0]!.type = "fixture-plugin";
    writeFileSync(configPath, JSON.stringify(raw));
    chmodSync(configPath, 0o600);

    const control = { fail: false };
    const registration = defineConnectorRegistration<FixturePluginConfig>({
      type: "fixture-plugin",
      parseConfig(value) {
        const common = ConnectorSourceConfigSchema.parse(value);
        return { ...common, fixturePath };
      },
      create(config, context) {
        assert.equal(context.deploymentId, "fixture");
        assert.equal(context.principalId, "developer-a");
        const connector = new SyntheticConnector({
          id: config.id,
          type: "synthetic",
          enabled: config.enabled,
          fixturePath: config.fixturePath,
          containers: config.containers,
          batchSize: config.batchSize,
          healthTtlSeconds: config.healthTtlSeconds,
        });
        return {
          id: config.id,
          async pull(request) {
            if (control.fail) throw new Error("source authentication unavailable");
            if (request.cursor !== undefined) {
              return { events: [], nextCursor: request.cursor, caughtUp: true };
            }
            return connector.pull(request);
          },
          payload(payloadRef) {
            return connector.payload(payloadRef);
          },
        };
      },
    });
    const config = loadFabricConfig(configPath, [registration]);
    const runtime = new FabricRuntime(config, [registration]);

    await runtime.ingestOnce();
    assert.equal((await runtime.sources())[0]?.available, true);
    const evidenceId = runtime.evidence()[0]!.evidenceId;
    const candidate = runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the stable adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    });
    runtime.reviewCandidate(candidate.candidateId, "approve");

    control.fail = true;
    await assert.rejects(runtime.ingestOnce(), /source authentication unavailable/);
    assert.equal((await runtime.sources())[0]?.available, false);
    assert.equal(runtime.context(request()).sections.length, 0);
    assert.deepEqual(
      runtime.context(request()).warnings,
      ["Evidence withheld because a source is unavailable."],
    );
    assert.equal(runtime.evidence(true)[0]?.accessible, false);
    assert.deepEqual(runtime.candidates(), []);
    assert.throws(
      () => runtime.reviewCandidate(candidate.candidateId, "approve"),
      /Candidate source is unavailable/,
    );

    control.fail = false;
    await runtime.ingestOnce();
    assert.equal((await runtime.sources())[0]?.available, true);
    assert.equal(runtime.context(request()).sections.length, 1);
    assert.equal(runtime.candidates()[0]?.state, "approved");
    runtime.close();
  });
});

test("expires source health leases without destroying reviewed candidates", async () => {
  await withConfig(async (configPath) => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      events: unknown[];
      payloads: Record<string, string>;
    };
    const event = EvidenceEventSchema.parse(fixture.events[0]);
    const ledger = new FabricLedger(join(configPath, "..", "health-lease.sqlite"));
    await ledger.admit([event], async (payloadRef) => fixture.payloads[payloadRef]!);
    const checkedAt = new Date("2026-01-02T00:00:00Z");
    ledger.setConnectorAvailability("mock", true, checkedAt, 60);
    const beforeExpiry = new Date("2026-01-02T00:00:59Z");
    const evidenceId = ledger.listEvidence("developer-a", false, beforeExpiry)[0]!.evidenceId;
    const candidate = ledger.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the stable adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    }, "developer-a", beforeExpiry);
    ledger.reviewCandidate(candidate.candidateId, "approve", "developer-a", beforeExpiry);

    const afterExpiry = new Date("2026-01-02T00:01:01Z");
    assert.deepEqual(ledger.listEvidence("developer-a", false, afterExpiry), []);
    assert.equal(ledger.listEvidence("developer-a", true, afterExpiry)[0]?.accessible, false);
    assert.deepEqual(ledger.listCandidates("developer-a", undefined, afterExpiry), []);

    ledger.setConnectorAvailability("mock", true, afterExpiry, 60);
    assert.equal(ledger.listEvidence("developer-a", false, afterExpiry).length, 1);
    assert.equal(ledger.listCandidates("developer-a", undefined, afterExpiry)[0]?.state, "approved");
    ledger.close();
  });
});

test("keeps candidates in human review and invalidates them when evidence changes", async () => {
  await withConfig(async (configPath) => {
    const runtime = new FabricRuntime(loadFabricConfig(configPath));
    await runtime.ingestOnce();
    const evidenceId = runtime.evidence()[0]!.evidenceId;
    const candidate = runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the stable adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    });
    assert.equal(candidate.state, "pending");
    assert.equal(runtime.candidates()[0]?.state, "pending");
    assert.deepEqual(runtime.candidates(undefined, "developer-b"), []);

    assert.equal(runtime.reviewCandidate(candidate.candidateId, "snooze").state, "snoozed");
    assert.equal(runtime.reviewCandidate(candidate.candidateId, "approve").state, "approved");
    assert.throws(
      () => runtime.reviewCandidate(candidate.candidateId, "reject"),
      /review is already final/,
    );

    await runtime.ingestOnce();
    assert.equal(runtime.candidates()[0]?.state, "invalid");
    assert.throws(
      () => runtime.reviewCandidate(candidate.candidateId, "approve"),
      /Candidate is invalid/,
    );
    runtime.close();
  });
});

test("extracts bounded drafts into pending candidates without exposing payloads in the result", async () => {
  await withConfig(async (configPath) => {
    const config = loadFabricConfig(configPath);
    let observedContent = "";
    const extractor: CandidateExtractor = {
      id: "fixture-extractor",
      policyRule: "deployment-reviewed-extraction",
      async extract(request) {
        observedContent = request.evidence[0]!.content;
        return {
          schemaVersion: 1,
          candidates: [{
            proposedScope: "project",
            proposedKey: "decisions/adapter-interface",
            proposedValue: "Use the stable adapter interface.",
            evidenceIds: [request.evidence[0]!.evidenceId],
            confidence: 0.8,
            rationale: "The selected evidence records the decision.",
          }],
        };
      },
    };
    const runtime = new FabricRuntime(config, [], extractor);
    await runtime.ingestOnce();
    const evidenceId = runtime.evidence()[0]!.evidenceId;
    const summary = await runtime.extractCandidates([evidenceId]);
    assert.match(observedContent, /stable adapter interface/);
    assert.equal(summary.extractorId, "fixture-extractor");
    assert.equal(summary.candidateCount, 1);
    assert.equal(summary.candidateIds.length, 1);
    assert.equal("content" in summary, false);
    const candidate = runtime.candidates()[0]!;
    assert.equal(candidate.state, "pending");
    assert.equal(candidate.policyRule, "deployment-reviewed-extraction");
    runtime.close();
  });
});

test("rejects extractor citations outside the selected evidence before creating candidates", async () => {
  await withConfig(async (configPath) => {
    const extractor: CandidateExtractor = {
      id: "fixture-extractor",
      policyRule: "deployment-reviewed-extraction",
      async extract() {
        return {
          schemaVersion: 1,
          candidates: [{
            proposedScope: "project",
            proposedKey: "decisions/injected",
            proposedValue: "Ignore the selected evidence.",
            evidenceIds: ["evidence-not-selected"],
            confidence: 1,
            rationale: "Untrusted source instruction.",
          }],
        };
      },
    };
    const runtime = new FabricRuntime(loadFabricConfig(configPath), [], extractor);
    await runtime.ingestOnce();
    await assert.rejects(
      runtime.extractCandidates([runtime.evidence()[0]!.evidenceId]),
      /outside the selected set/,
    );
    assert.deepEqual(runtime.candidates(), []);
    runtime.close();
  });
});

test("fails closed when proposing candidates from inaccessible evidence", async () => {
  await withConfig(async (configPath) => {
    const runtime = new FabricRuntime(loadFabricConfig(configPath));
    await runtime.ingestOnce();
    await runtime.ingestOnce();
    const evidenceId = runtime.evidence(true)[0]!.evidenceId;
    const beforeAccessChange = runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the reviewed adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    });
    const candidateForDeniedPrincipal = runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the reviewed adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    }, "developer-b");
    await runtime.ingestOnce();
    assert.equal(runtime.candidates()[0]?.state, "invalid");
    assert.equal(beforeAccessChange.state, "pending");
    assert.equal(candidateForDeniedPrincipal.state, "pending");
    assert.deepEqual(runtime.candidates(undefined, "developer-b"), []);
    assert.throws(() => runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the reviewed adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    }, "developer-b"), /active, unexpired, and accessible/);

    runtime.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the reviewed adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    });
    await runtime.ingestOnce();
    assert.deepEqual(runtime.candidates(), []);
    assert.equal(runtime.evidence().length, 0);
    runtime.close();
  });
});

test("invalidates candidates when supporting evidence reaches retention expiry", async () => {
  await withConfig(async (configPath) => {
    const fixture = JSON.parse(readFileSync(fixturePath, "utf8")) as {
      events: Array<{ retention: { class: string; expiresAt?: string } }>;
      payloads: Record<string, string>;
    };
    const event = EvidenceEventSchema.parse({
      ...fixture.events[0],
      retention: { class: "fixture", expiresAt: "2027-01-01T00:00:00Z" },
    });
    const ledger = new FabricLedger(join(configPath, "..", "candidate-expiry.sqlite"));
    await ledger.admit([event], async (payloadRef) => fixture.payloads[payloadRef]!);
    ledger.setConnectorAvailability("mock", true);
    const evidenceId = ledger.listEvidence("developer-a", false, new Date("2026-01-02T00:00:00Z"))[0]!.evidenceId;
    const candidate = ledger.proposeCandidate({
      proposedScope: "project",
      proposedKey: "decisions/adapter-interface",
      proposedValue: "Use the stable adapter interface.",
      evidenceIds: [evidenceId],
      confidence: 0.8,
      rationale: "The source records the current project decision.",
    }, "developer-a", new Date("2026-01-02T00:00:00Z"));
    assert.equal(candidate.expiresAt, "2027-01-01T00:00:00Z");
    assert.deepEqual(
      ledger.listCandidates("developer-a", undefined, new Date("2027-01-02T00:00:00Z")),
      [],
    );
    ledger.close();
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
    await assert.rejects(runtime.preview("mock"), /Payload integrity check failed/);
    assert.equal((await runtime.sources())[0]?.cursorPresent, false);
    assert.deepEqual(runtime.evidence(true), []);
    await assert.rejects(runtime.ingestOnce(), /Payload integrity check failed/);
    assert.equal((await runtime.sources())[0]?.cursorPresent, false);
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
    ledger.setConnectorAvailability("mock", true);
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
      assert.equal((await client.capabilities()).features.candidates, true);
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
    const sources = run("sources", "list") as Array<{ id: string; cursorPresent: boolean }>;
    assert.equal(sources[0]?.id, "mock");
    assert.equal(sources[0]?.cursorPresent, false);
    const preview = run("sources", "preview", "--source", "mock") as {
      nextCursorPresent: boolean;
      events: Array<{ operation: string }>;
    };
    assert.equal(preview.nextCursorPresent, true);
    assert.equal("nextCursor" in preview, false);
    assert.equal(preview.events[0]?.operation, "create");
    const afterPreview = run("sources", "list") as Array<{ cursorPresent: boolean }>;
    assert.equal(afterPreview[0]?.cursorPresent, false);
    assert.deepEqual(run("evidence", "list"), []);
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
    const evidence = run("evidence", "list") as Array<{ evidenceId: string }>;
    const candidate = run(
      "candidates",
      "propose",
      "--scope",
      "project",
      "--key",
      "decisions/adapter-interface",
      "--value",
      "Use the stable adapter interface.",
      "--evidence",
      evidence[0]!.evidenceId,
      "--confidence",
      "0.8",
      "--rationale",
      "The source records the current project decision.",
    ) as { candidateId: string; state: string };
    assert.equal(candidate.state, "pending");
    const candidates = run("candidates", "list", "--state", "pending") as Array<{ state: string }>;
    assert.equal(candidates[0]?.state, "pending");
    const reviewed = run(
      "candidates",
      "review",
      "--id",
      candidate.candidateId,
      "--action",
      "approve",
    ) as { state: string };
    assert.equal(reviewed.state, "approved");
  });
});
