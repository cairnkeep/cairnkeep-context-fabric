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
- Pending and snoozed candidates can be edited by their owner. Editing
  revalidates every cited evidence record and returns the candidate to
  `pending`; approved, rejected, and invalid candidates are immutable.
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

## Editing

```bash
cairn-fabric candidates edit \
  --id candidate-ID \
  --value "Corrected durable fact" \
  --rationale "The selected evidence states the corrected fact." \
  --config /path/to/private-fabric.json
```

Scope, target project identity, key, value, evidence IDs, confidence, and
rationale are editable. The candidate ID, deployment, policy rule, and creation
time are immutable. When all cited evidence uses one container, the ledger
derives that container as the initial project identity; the reviewer must verify
or correct it before promotion.

## Promotion boundary

Approval does not call Cairnkeep and does not create durable memory. Promotion
is a separate explicit action and is disabled unless the deployment executable
registers a provider-neutral `MemoryPromotionAdapter`:

```bash
cairn-fabric candidates promote --id candidate-ID --config /path/to/private-fabric.json
cairn-fabric promotions list --config /path/to/private-fabric.json
cairn-fabric promotions reconcile --config /path/to/private-fabric.json
```

At promotion time the ledger revalidates ownership, approval, evidence access,
retention, and source availability. It then commits a minimal promotion mapping
and an apply task to the SQLite outbox before calling the adapter. Failed calls
remain retryable; adapter operations must be idempotent by promotion ID. The
ledger stores only a fixed failure diagnostic, never arbitrary adapter exception
text that could contain deployment details.

Source updates, source outages, access revocation, deletion, and retention
expiry atomically enqueue invalidation before candidate content can be purged.
The mapping retains only deployment/principal/project routing, adapter ID,
scope, key, state, and timestamps. Proposed values are removed from the outbox
when an unapplied candidate becomes invalid.

The deployment adapter must use a durable memory contract that supports both
idempotent apply and tombstoned invalidation. Invalidation of an unseen ID must
prevent a delayed apply from resurrecting stale memory. The public repository
does not bundle an endpoint, credentials, or a deployment adapter.

Scheduled extraction and a web review interface remain future work. Extraction,
review, editing, and promotion are operator actions.
