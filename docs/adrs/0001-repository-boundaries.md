# ADR 0001: Repository Boundaries

Status: accepted

## Context

Cairnkeep already owns the native-harness CLI and durable memory service. The
evidence pipeline has a different security surface, dependency graph, release
cadence, and deployment lifecycle.

## Decision

Keep the context fabric in a separate public repository. Publish small contracts,
client, and connector SDK packages from this workspace. Keep connector-specific
credentials and deployment policy in private overlays. Do not fork Cairnkeep or
an orchestration runtime.

## Consequences

- Existing Cairnkeep clients remain usable without the fabric.
- Protocol compatibility must be tested across repositories.
- Overlays pin exact versions of both products.
- Public releases cannot directly deploy into private environments.
- A private connector repository is created only when separate ownership,
  access, reuse, or release cadence becomes a real boundary.
