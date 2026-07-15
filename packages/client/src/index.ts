import {
  CapabilitiesSchema,
  ContextPacketSchema,
  ContextRequestSchema,
  type Capabilities,
  type ContextPacket,
  type ContextRequest,
} from "@cairnkeep/context-contracts";

export class ContextFabricError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ContextFabricError";
    this.status = options.status;
  }
}

export type ContextFabricClientOptions = {
  baseUrl: string;
  token?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
  allowInsecureTransport?: boolean;
};

function isLoopback(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function validateBaseUrl(value: string, allowInsecureTransport: boolean): URL {
  const url = new URL(value);
  if (url.username || url.password) {
    throw new ContextFabricError("Context fabric URLs cannot contain credentials.");
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback(url.hostname))) {
    if (!allowInsecureTransport) {
      throw new ContextFabricError("Remote context fabric endpoints require HTTPS.");
    }
  }
  return url;
}

export class ContextFabricClient {
  readonly #baseUrl: URL;
  readonly #token: string | undefined;
  readonly #timeoutMs: number;
  readonly #fetch: typeof fetch;

  constructor(options: ContextFabricClientOptions) {
    this.#baseUrl = validateBaseUrl(options.baseUrl, options.allowInsecureTransport ?? false);
    this.#token = options.token;
    this.#timeoutMs = options.timeoutMs ?? 10_000;
    this.#fetch = options.fetch ?? globalThis.fetch;
  }

  async capabilities(signal?: AbortSignal): Promise<Capabilities> {
    const payload = await this.#request("v1/capabilities", { method: "GET" }, signal);
    return CapabilitiesSchema.parse(payload);
  }

  async context(request: ContextRequest, signal?: AbortSignal): Promise<ContextPacket> {
    const validated = ContextRequestSchema.parse(request);
    const payload = await this.#request(
      "v1/context",
      { method: "POST", body: JSON.stringify(validated) },
      signal,
    );
    return ContextPacketSchema.parse(payload);
  }

  async #request(path: string, init: RequestInit, signal?: AbortSignal): Promise<unknown> {
    const headers = new Headers(init.headers);
    headers.set("accept", "application/json");
    if (init.body !== undefined) {
      headers.set("content-type", "application/json");
    }
    if (this.#token) {
      headers.set("authorization", `Bearer ${this.#token}`);
    }

    const timeoutSignal = AbortSignal.timeout(this.#timeoutMs);
    const combinedSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let response: Response;
    try {
      response = await this.#fetch(new URL(path, this.#baseUrl), {
        ...init,
        headers,
        signal: combinedSignal,
      });
    } catch (error) {
      throw new ContextFabricError("Context fabric request failed.", { cause: error });
    }

    if (!response.ok) {
      throw new ContextFabricError(`Context fabric returned HTTP ${response.status}.`, {
        status: response.status,
      });
    }

    try {
      return await response.json();
    } catch (error) {
      throw new ContextFabricError("Context fabric returned invalid JSON.", {
        status: response.status,
        cause: error,
      });
    }
  }
}
