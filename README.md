# Cairnkeep Context Fabric

Cairnkeep Context Fabric is a governed evidence and context pipeline for coding
harnesses. It collects explicitly permitted source events, preserves their
lifecycle and access constraints, compiles cited project knowledge, proposes
reviewable durable memories, and returns bounded context packets to native
harness sessions.

## Status

Pre-alpha synthetic vertical slice. The repository defines protocol contracts,
an authenticated client, a connector SDK, a mode-0600 deployment configuration,
a durable SQLite evidence ledger, incremental synthetic ingestion, lifecycle-
aware authorization, cited context retrieval, an editable durable human-review
candidate queue, explicitly registered connector/extractor/promotion boundaries,
a replay-safe promotion outbox with lifecycle invalidation, non-admitting source
preview, and a loopback-first service.

It does not include bundled live connectors, schedulers, model clients, compiled
knowledge, scheduled candidate extraction, a web review interface, a memory
adapter, or deployment credentials. Synthetic fixtures are still the only
accepted source type.

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
- Extractors are deployment-owned, explicit, and unable to approve or promote
  their output.
- Approval never writes memory; promotion is a second explicit operator action.
- Promotion adapters are deployment-owned, idempotent, and lifecycle-aware.

## Repository structure

```text
packages/contracts       versioned evidence and context schemas
packages/client          authenticated context-fabric client
packages/connector-sdk   connector, cursor, and conformance contracts
apps/fabricd             service boundary and capability negotiation
tests/fixtures           synthetic lifecycle corpus
examples                 disabled-by-default deployment examples
docs                     architecture, threat model, lifecycle, and ADRs
```

## Development

Node.js 22 or newer is required.

```bash
npm ci
npm run check
```

Run the incremental synthetic lifecycle walkthrough in
[docs/synthetic-testing.md](docs/synthetic-testing.md). Source configuration and
the boundary between public schemas and private selections are documented in
[docs/source-configuration.md](docs/source-configuration.md).
Candidate review, editing, and the explicit promotion boundary are
documented in [docs/candidate-review.md](docs/candidate-review.md).
Deployment-owned connector registration and preview gates are documented in
[docs/connector-plugins.md](docs/connector-plugins.md).

Individual packages will become publishable only after the vertical spike
freezes their first supported contract.

## Relationship to Cairnkeep

[Cairnkeep](https://github.com/cairnkeep/cairnkeep) remains the native-harness
CLI and durable memory service. This repository owns evidence ingestion,
compiled knowledge, candidate review, and context delivery. Deployments compose
the two products through versioned public contracts rather than patching either
one.

## License

Apache-2.0. See [LICENSE](LICENSE).
