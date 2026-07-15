# Initial Threat Model

## Assets

- raw source evidence and attachments;
- source authorization and retention state;
- compiled knowledge and candidate memories;
- Cairnkeep memory mappings;
- connector credentials and encryption keys;
- audit and reconciliation journals.

## Trust boundaries

- source system to connector;
- connector to evidence admission;
- evidence content to extraction runtime;
- fabric service to native harness client;
- fabric to Cairnkeep memory;
- one deployment security domain to another.

## Principal threats

| Threat | Required control |
|---|---|
| Source prompt injection | Treat payloads as data, structured output, no tools during extraction |
| Excessive collection | Explicit source allowlist and least privilege before ingestion |
| Replay or reordering | Stable delivery IDs, idempotency, monotonic source revision rules |
| Access revocation lag | Query-time access check and fail-closed invalidation |
| Stale source authentication | Persisted connector health; evidence withheld after any failed run |
| Source deletion leakage | Tombstones, index removal, dependent-claim reconciliation |
| Cross-deployment leakage | Separate credentials, keys, databases, indexes, and logs |
| Secret disclosure | Environment-backed secrets, redacted errors, package-content checks |
| Partial compilation | Journaled staged writes, verification, atomic publish, recovery |
| Memory poisoning | Human review by default and evidence-linked promotion |
| Prompt surveillance | Do not retain complete harness prompts by default |

## Initial exclusions

The walking skeleton accepts synthetic fixtures only. Live source credentials,
production connectors, remote model calls, historical backfills, and autonomous
promotion require separate review and rollout gates.
