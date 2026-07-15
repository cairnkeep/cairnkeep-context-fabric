import assert from "node:assert/strict";
import test from "node:test";

import { ContextFabricClient, ContextFabricError } from "./index.js";

test("rejects credential-bearing endpoint URLs", () => {
  assert.throws(
    () => new ContextFabricClient({ baseUrl: "https://user:secret@example.invalid" }),
    ContextFabricError,
  );
});

test("rejects cleartext remote endpoints by default", () => {
  assert.throws(
    () => new ContextFabricClient({ baseUrl: "http://192.0.2.10:8789" }),
    /require HTTPS/,
  );
});

test("sends bearer authentication without exposing it in errors", async () => {
  const token = "fixture-secret-token";
  let authorization = "";
  const mockFetch: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get("authorization") ?? "";
    return new Response("unavailable", { status: 503 });
  };
  const client = new ContextFabricClient({
    baseUrl: "http://127.0.0.1:8789",
    token,
    fetch: mockFetch,
  });

  await assert.rejects(
    client.capabilities(),
    (error: unknown) => {
      if (!(error instanceof ContextFabricError)) {
        return false;
      }
      assert.equal(error.status, 503);
      assert.equal(error.message.includes(token), false);
      return true;
    },
  );
  assert.equal(authorization, `Bearer ${token}`);
});

test("validates capability responses", async () => {
  const mockFetch: typeof fetch = async () => Response.json({ protocolVersion: "wrong" });
  const client = new ContextFabricClient({
    baseUrl: "http://127.0.0.1:8789",
    fetch: mockFetch,
  });
  await assert.rejects(client.capabilities());
});
