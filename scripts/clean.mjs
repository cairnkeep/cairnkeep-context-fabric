import { rm } from "node:fs/promises";
import { join } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const workspaces = [
  "packages/contracts",
  "packages/client",
  "packages/connector-sdk",
  "apps/fabricd",
];

for (const workspace of workspaces) {
  await Promise.all([
    rm(join(root, workspace, "dist"), { recursive: true, force: true }),
    rm(join(root, workspace, "test-dist"), { recursive: true, force: true }),
    rm(join(root, workspace, ".tsbuildinfo"), { force: true }),
  ]);
}
