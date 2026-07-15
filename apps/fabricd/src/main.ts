import { createFabricServer } from "./server.js";
import { loadFabricConfig } from "./config.js";
import { FabricRuntime } from "./runtime.js";

const host = process.env.CAIRN_FABRIC_HOST ?? "127.0.0.1";
const port = Number.parseInt(process.env.CAIRN_FABRIC_PORT ?? "8789", 10);
const token = process.env.CAIRN_FABRIC_HTTP_TOKEN;

if (!token) {
  process.stderr.write("CAIRN_FABRIC_HTTP_TOKEN is required.\n");
  process.exit(1);
}
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  process.stderr.write("CAIRN_FABRIC_PORT must be an integer between 1 and 65535.\n");
  process.exit(1);
}

const configPath = process.env.CAIRN_FABRIC_CONFIG;
const runtime = configPath === undefined ? undefined : new FabricRuntime(loadFabricConfig(configPath));
const server = createFabricServer({
  token,
  ...(runtime === undefined ? {} : { contextProvider: (request) => runtime.context(request) }),
});
server.listen(port, host, () => {
  process.stderr.write(`cairnkeep context fabric listening on ${host}:${port}\n`);
});

function close(): void {
  server.close(() => {
    runtime?.close();
    process.exit(0);
  });
}

process.on("SIGINT", close);
process.on("SIGTERM", close);
