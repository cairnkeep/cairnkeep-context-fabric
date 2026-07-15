import { execFileSync } from "node:child_process";

const output = execFileSync(
  "npm",
  ["pack", "--workspaces", "--dry-run", "--json", "--ignore-scripts"],
  {
    encoding: "utf8",
    env: { ...process.env, npm_config_loglevel: "silent" },
  },
);
const manifests = JSON.parse(output);
const expected = new Set([
  "@cairnkeep/context-contracts",
  "@cairnkeep/context-client",
  "@cairnkeep/connector-sdk",
  "@cairnkeep/fabricd",
]);
const forbidden = [
  /(^|\/)src\//,
  /\.test\./,
  /\.tsbuildinfo$/,
  /(^|\/)tsconfig(?:\.[^.]+)?\.json$/,
];
const failures = [];

for (const manifest of manifests) {
  expected.delete(manifest.name);
  const paths = new Set(manifest.files.map((file) => file.path));
  if (!paths.has("package.json")) {
    failures.push(`${manifest.name}: package.json is missing`);
  }
  if (![...paths].some((path) => path.startsWith("dist/") && path.endsWith(".js"))) {
    failures.push(`${manifest.name}: compiled JavaScript is missing`);
  }
  for (const path of paths) {
    if (forbidden.some((pattern) => pattern.test(path))) {
      failures.push(`${manifest.name}: forbidden package artifact ${path}`);
    }
  }
}

for (const name of expected) {
  failures.push(`${name}: workspace package is missing from npm pack output`);
}

if (failures.length > 0) {
  process.stderr.write(`${failures.join("\n")}\n`);
  process.exit(1);
}
process.stdout.write("package content guard passed\n");
