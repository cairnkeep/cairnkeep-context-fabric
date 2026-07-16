# Candidate review

The candidate queue is a durable staging boundary between governed evidence and
Cairnkeep memory. It is intentionally local and conservative in the current
vertical slice.

## Current behavior

- Operators create proposals explicitly through the CLI or invoke a registered
  deployment-owned extractor for a selected evidence set.
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

## Extraction boundary

Candidate extraction is an explicit operator action:

```bash
cairn-fabric candidates extract \
  --evidence evidence-ONE,evidence-TWO \
  --config /path/to/private-fabric.json
```

The core runtime does not contain a model client or discover an endpoint. A
deployment must register an extractor adapter in process. Before calling it, the
runtime verifies that 1-32 selected evidence records are active, unexpired,
source-available, and readable by the current principal. Requests are capped at
512 KiB and contain only evidence IDs, payloads, MIME types, and occurrence
times.

Extractor output is untrusted. It must match the versioned draft schema, may
cite only the selected evidence, cannot choose its policy rule, and can create
only `pending` candidates. The complete batch is validated before any candidate
is inserted. The operator result contains candidate IDs and counts, not evidence
payloads or proposed values; use `candidates list` for deliberate review.

Source content must be treated as data, never as instructions. Deployment
adapters are responsible for structured-output prompting, endpoint allowlists,
credential isolation, timeouts, response-size limits, and audit logging that
does not include evidence content.

## Promotion boundary

Approval does not call Cairnkeep and does not create durable memory. A future
promotion adapter must revalidate evidence and policy at the time of promotion,
write through a versioned Cairnkeep contract, persist the resulting mapping, and
support invalidation or supersession. Until that boundary exists and is tested,
reviewed candidates remain in this queue.

Scheduled extraction, candidate editing, and a web review interface remain
future work. Extraction is manual and does not alter the promotion boundary.
