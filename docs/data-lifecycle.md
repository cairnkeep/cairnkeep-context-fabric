# Data Lifecycle

## States

1. A connector emits an idempotent normalized source event.
2. Admission policy rejects, quarantines, redacts, or admits the event.
3. Admitted evidence becomes searchable under its current access state.
4. Extraction proposes claims and active-work links with evidence references.
5. A verified transaction updates affected compiled knowledge.
6. Retrieval can return admissible cited evidence and compiled knowledge.
7. A candidate enters human review.
8. Approval writes or supersedes Cairnkeep memory through its public API.
9. Update, deletion, expiry, or access revocation invalidates affected views.
10. Reconciliation proves indexes, graph, wiki, candidates, and mappings converge.

## Fail-closed invariants

- Evidence without a confirmed access decision is not retrievable.
- Evidence from a connector without a successful availability state is not retrievable.
- A revoked or deleted item is blocked before background reconciliation.
- A claim without an admissible evidence path is not returned as fact.
- Cursor advancement occurs only after the complete batch is durably admitted.
- Connector failure marks the source unavailable; only a later successful run restores it.
- A failed compilation does not publish a partial set of pages.

## Storage placement

Runtime data belongs in deployment-owned private data directories. It is not
written into application repositories or `.planning/wiki` automatically.
Reviewed, redacted export is a separate explicit operation.
