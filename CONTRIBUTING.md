# Contributing

## Before changing code

Open an issue or design discussion for protocol-breaking changes, new connector
permissions, storage backends, or changes to evidence lifecycle behavior.

## Checks

```bash
npm ci
npm run check
```

Tests must use synthetic data. Never attach real messages, mail, documents,
credentials, endpoints, tenant identifiers, or database snapshots.

## Protocol changes

- Prefer additive changes.
- Update schemas, inferred types, fixtures, tests, and documentation together.
- Explain compatibility and invalidation behavior.
- A breaking change requires a new protocol major version.

## Connector changes

Connectors emit normalized lifecycle events and maintain cursors. They do not
write durable memory, compile wiki pages, broaden their own source scope, or
decide authorization policy.
