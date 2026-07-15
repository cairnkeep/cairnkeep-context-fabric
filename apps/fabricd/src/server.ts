import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import {
  CONTEXT_PROTOCOL_VERSION,
  ContextRequestSchema,
  type Capabilities,
  type ContextPacket,
  type ContextRequest,
} from "@cairnkeep/context-contracts";

const MAX_REQUEST_BYTES = 128 * 1024;

export type FabricServerOptions = {
  token: string;
  serviceVersion?: string;
  contextProvider?: (request: ContextRequest) => ContextPacket | Promise<ContextPacket>;
};

function sendJson(response: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

function authorized(request: IncomingMessage, token: string): boolean {
  const header = request.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return false;
  }
  const supplied = Buffer.from(header.slice("Bearer ".length));
  const expected = Buffer.from(token);
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_REQUEST_BYTES) {
      throw new Error("request-too-large");
    }
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

export function capabilities(serviceVersion = "0.3.0", storageEnabled = false): Capabilities {
  return {
    protocolVersion: CONTEXT_PROTOCOL_VERSION,
    serviceVersion,
    evidenceSchemaVersions: [1],
    contextPacketVersions: [1],
    features: {
      lifecycle: storageEnabled,
      compiledWiki: false,
      candidates: storageEnabled,
      invalidation: storageEnabled,
      activeWorkGraph: false,
    },
    limits: {
      eventBytes: 50 * 1024 * 1024,
      batchSize: 1000,
      packetTokens: 32_768,
    },
  };
}

export function createFabricServer(options: FabricServerOptions): Server {
  if (options.token.length < 16) {
    throw new Error("Fabric server token must contain at least 16 characters.");
  }
  const serviceVersion = options.serviceVersion ?? "0.3.0";

  return createServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    if (request.method === "GET" && url.pathname === "/healthz") {
      sendJson(response, 200, { status: "ok" });
      return;
    }

    if (!authorized(request, options.token)) {
      sendJson(response, 401, { error: "unauthorized" });
      return;
    }

    if (request.method === "GET" && url.pathname === "/v1/capabilities") {
      sendJson(response, 200, capabilities(serviceVersion, options.contextProvider !== undefined));
      return;
    }

    if (request.method === "POST" && url.pathname === "/v1/context") {
      try {
        const parsed = ContextRequestSchema.parse(await readJson(request));
        const packet: ContextPacket = options.contextProvider === undefined
          ? {
              schemaVersion: 1,
              packetId: randomUUID(),
              generatedAt: new Date().toISOString(),
              projectId: parsed.projectId,
              sections: [],
              citations: [],
              totalTokenEstimate: 0,
              truncated: false,
              warnings: ["Context fabric storage is not enabled in the walking skeleton."],
            }
          : await options.contextProvider(parsed);
        sendJson(response, 200, packet);
      } catch (error) {
        const status = error instanceof Error && error.message === "request-too-large" ? 413 : 400;
        sendJson(response, status, { error: status === 413 ? "request-too-large" : "invalid-request" });
      }
      return;
    }

    sendJson(response, 404, { error: "not-found" });
  });
}
