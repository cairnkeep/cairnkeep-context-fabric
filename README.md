# Cairnkeep Context Fabric

Cairnkeep Context Fabric is a governed evidence and context pipeline for coding
harnesses. It collects explicitly permitted source events, preserves their
lifecycle and access constraints, compiles cited project knowledge, proposes
reviewable durable memories, and returns bounded context packets to native
harness sessions.

## Status

Pre-alpha walking skeleton. The repository currently defines protocol contracts,
an authenticated client, a connector SDK, synthetic fixtures, and a loopback-
first service boundary. It does not include production storage, live connectors,
model calls, autonomous memory promotion, or deployment credentials.

## Knowledge layers

The fabric keeps three products separate:

1. **Evidence** is source-faithful, access-controlled, and lifecycle-aware.
2. **Compiled knowledge** is a cited, versioned synthesis that accumulates over
   time without discarding contradictions.
3. **Durable memory** is a small set of reviewed operational facts stored by
   Cairnkeep.

Raw evidence never writes directly to durable memory.

## Safety defaults

- No connector is enabled by installation.
- No remote endpoint is discovered automatically.
- The service binds to loopback by default.
- Authenticated endpoints require an explicit bearer token.
- Context requests contain work metadata, not automatically captured prompts.
- Source deletion, expiry, and access revocation fail closed.
- Synthetic fixtures are the only accepted data during the initial spike.

## Repository structure

```text
packages/contracts       versioned evidence and context schemas
packages/client          authenticated context-fabric client
packages/connector-sdk   connector, cursor, and conformance contracts
apps/fabricd             service boundary and capability negotiation
tests/fixtures           synthetic lifecycle corpus
docs                     architecture, threat model, lifecycle, and ADRs
```

## Development

Node.js 22 or newer is required.

```bash
npm ci
npm run check
```

The workspace is private while the protocol is pre-alpha. Individual packages
will become publishable only after the vertical spike freezes their first
supported contract.

## Relationship to Cairnkeep

[Cairnkeep](https://github.com/cairnkeep/cairnkeep) remains the native-harness
CLI and durable memory service. This repository owns evidence ingestion,
compiled knowledge, candidate review, and context delivery. Deployments compose
the two products through versioned public contracts rather than patching either
one.

## License

Apache-2.0. See [LICENSE](LICENSE).
