# Candidate review

The candidate queue is a durable staging boundary between governed evidence and
Cairnkeep memory. It is intentionally local and conservative in the current
vertical slice.

## Current behavior

- Operators create proposals explicitly through the CLI.
- Every proposal cites one or more current evidence identifiers.
- The ledger accepts only active, unexpired evidence readable by the configured
  principal.
- Candidates are visible and reviewable only by the principal that proposed
  them.
- Review transitions are `approve`, `reject`, and `snooze`.
- Approved and rejected states are final review decisions.
- A source update invalidates pending, snoozed, and approved candidates.
- An access change invalidates a candidate only while its owner remains
  authorized. Revocation, deletion, explicit expiry, or retention timeout purges
  dependent candidate content so the review queue cannot bypass source access
  or lifecycle controls.

Candidate data is stored in the same mode-0600 SQLite ledger under the configured
private XDG data directory. It is not written to a project repository.

## Promotion boundary

Approval does not call Cairnkeep and does not create durable memory. A future
promotion adapter must revalidate evidence and policy at the time of promotion,
write through a versioned Cairnkeep contract, persist the resulting mapping, and
support invalidation or supersession. Until that boundary exists and is tested,
reviewed candidates remain in this queue.

Automatic extraction, candidate editing, and a web review interface are also
future work. The current manual CLI makes the lifecycle and authorization
contract testable without introducing a model or external source connector.
