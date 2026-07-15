import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import { ContextFabricClient } from "@cairnkeep/context-client";

import { createFabricServer } from "./server.js";

const TOKEN = "fixture-token-with-32-characters";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createFabricServer({ token: TOKEN });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${address.port}/`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("health is available without disclosing capabilities", async () => {
  await withServer(async (baseUrl) => {
    const health = await fetch(new URL("healthz", baseUrl));
    assert.equal(health.status, 200);
    const capabilities = await fetch(new URL("v1/capabilities", baseUrl));
    assert.equal(capabilities.status, 401);
  });
});

test("negotiates capabilities through the authenticated client", async () => {
  await withServer(async (baseUrl) => {
    const client = new ContextFabricClient({ baseUrl, token: TOKEN });
    const result = await client.capabilities();
    assert.equal(result.protocolVersion, "0.1");
    assert.equal(result.serviceVersion, "0.4.0");
    assert.equal(result.features.lifecycle, false);
  });
});

test("returns a bounded empty packet without recording a prompt", async () => {
  await withServer(async (baseUrl) => {
    const client = new ContextFabricClient({ baseUrl, token: TOKEN });
    const packet = await client.context({
      schemaVersion: 1,
      deploymentId: "fixture",
      projectId: "project-alpha",
      repository: "/fixture/project-alpha",
      taskRefs: ["task-001"],
      changedPaths: ["src/example.ts"],
      queryIntent: "Implement the reviewed interface",
      tokenBudget: 1024,
    });
    assert.equal(packet.projectId, "project-alpha");
    assert.deepEqual(packet.sections, []);
    assert.equal(packet.warnings.length, 1);
  });
});

test("rejects short server tokens", () => {
  assert.throws(() => createFabricServer({ token: "short" }), /at least 16/);
});
