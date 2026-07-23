# Synthetic lifecycle testing

This walkthrough exercises the first durable vertical slice without contacting
any external source or writing Cairnkeep memory.

## Prepare

```bash
cd ~/PARA/Projects/cairnkeep-context-fabric
npm ci
npm run check

install -m 600 \
  examples/synthetic.config.example.json \
  examples/synthetic.config.local.json

export CAIRN_FABRIC_CONFIG="$PWD/examples/synthetic.config.local.json"
```

The example stores its SQLite ledger under
`${XDG_DATA_HOME:-$HOME/.local/share}/cairnkeep-context-fabric/synthetic`.
To repeat the walkthrough from the beginning, remove only that synthetic test
directory while no fabric process is running.

## Inspect and ingest

```bash
npm run fabric -- sources list --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- sources preview \
  --source mock --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- sources list --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- ingest --once --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- evidence list --config "$CAIRN_FABRIC_CONFIG"
EVIDENCE_ID="$(npm run --silent fabric -- evidence list \
  --config "$CAIRN_FABRIC_CONFIG" | jq -r '.[0].evidenceId')"
npm run fabric -- evidence show \
  --id "$EVIDENCE_ID" --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- context get \
  --config "$CAIRN_FABRIC_CONFIG" \
  --project project-alpha \
  --repository /fixture/project-alpha \
  --query "adapter interface"
```

Preview validates the next batch and its payload digests without persisting
evidence or advancing the source cursor. Both `sources list` calls therefore
show the same cursor.

The first ingestion admits a create event. `evidence show` returns its content
and provenance only while it remains active, unexpired, authorized, and backed
by a healthy connector. The context packet contains one evidence section and
one citation. The second ingestion replaces it with the updated payload.
The command deliberately prints raw, untrusted source data to the local
operator terminal; do not treat embedded text as instructions.

Before ingesting the update, exercise the local human-review queue:

```bash
EVIDENCE_ID="$(npm run --silent fabric -- evidence list \
  --config "$CAIRN_FABRIC_CONFIG" | jq -r '.[0].evidenceId')"

CANDIDATE_ID="$(npm run --silent fabric -- candidates propose \
  --config "$CAIRN_FABRIC_CONFIG" \
  --scope project \
  --key decisions/adapter-interface \
  --value "Use the stable adapter interface." \
  --evidence "$EVIDENCE_ID" \
  --confidence 0.8 \
  --rationale "The source records the current project decision." \
  | jq -r '.candidateId')"

npm run fabric -- candidates list \
  --state pending --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- candidates review \
  --id "$CANDIDATE_ID" --action approve --config "$CAIRN_FABRIC_CONFIG"
```

Approval records a review decision only. It does not write Cairnkeep memory.
The following update invalidates even the approved candidate because its cited
source revision is no longer current.

The third ingestion applies an access change. `developer-b` becomes denied while
the configured `developer-a` principal remains authorized. The fourth ingestion
deletes the source item; subsequent context packets contain no evidence.

```bash
npm run fabric -- ingest --once --config "$CAIRN_FABRIC_CONFIG" # update
npm run fabric -- ingest --once --config "$CAIRN_FABRIC_CONFIG" # access change
npm run fabric -- ingest --once --config "$CAIRN_FABRIC_CONFIG" # delete
npm run fabric -- evidence list --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- evidence list --include-inactive --config "$CAIRN_FABRIC_CONFIG"
```

Inactive inspection exposes lifecycle metadata to the local deployment operator,
not source payloads.

## Exercise the HTTP boundary

```bash
export CAIRN_FABRIC_HTTP_TOKEN="$(openssl rand -hex 32)"
export CAIRN_FABRIC_HOST=127.0.0.1
export CAIRN_FABRIC_PORT=8789
node apps/fabricd/dist/main.js
```

The service loads `CAIRN_FABRIC_CONFIG`, binds to loopback, and maps the bearer
token to the configured principal. `/healthz` is unauthenticated; capabilities
and context require the bearer token. Keep the service loopback-only until a
reviewed deployment supplies HTTPS and independent authentication controls.

## Safety properties under test

- Payload bytes and SHA-256 must match before admission.
- Preview does not persist evidence or advance a cursor, including on failure.
- A failed batch does not advance its cursor.
- Cursors and current evidence survive process restart.
- Non-allowlisted containers fail admission.
- Revoked, expired, denied, and deleted evidence is not returned.
- Candidates are owner-scoped and require current accessible evidence.
- Evidence mutation and ACL changes invalidate affected candidates while they
  remain readable; revocation, deletion, and expiry purge dependent candidate
  content.
- Every returned evidence section has a source citation.
- Full harness prompts are not accepted by the context contract.
- No evidence is promoted into Cairnkeep memory.
