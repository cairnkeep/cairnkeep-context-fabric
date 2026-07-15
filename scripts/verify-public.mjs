import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";

const root = new URL("../", import.meta.url).pathname;
const skippedDirectories = new Set([".git", "node_modules", "dist", "coverage"]);
const textExtensions = new Set([
  "",
  ".json",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
]);
const forbiddenPaths = [/(^|\/)\.env($|\.)/, /\.(db|sqlite)(-|$)/, /(^|\/)backups?(\/|$)/];
const forbiddenContent = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /npm_[A-Za-z0-9]{20,}/,
  /(?:api[_-]?key|access[_-]?token|bearer[_-]?token)\s*[:=]\s*["'][^"']{12,}["']/i,
];

const failures = [];

async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isDirectory() && skippedDirectories.has(entry.name)) {
      continue;
    }
    const path = join(directory, entry.name);
    const rel = relative(root, path).replaceAll("\\", "/");
    if (entry.isDirectory()) {
      await walk(path);
      continue;
    }
    if (!(await stat(path)).isFile()) {
      continue;
    }
    if (forbiddenPaths.some((pattern) => pattern.test(rel))) {
      failures.push(`${rel}: forbidden runtime or secret path`);
    }
    if (!textExtensions.has(extname(entry.name))) {
      continue;
    }
    const content = await readFile(path, "utf8");
    for (const pattern of forbiddenContent) {
      if (pattern.test(content)) {
        failures.push(`${rel}: matches forbidden secret pattern ${pattern}`);
      }
    }
  }
}

await walk(root);
if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("public repository guard passed\n");
