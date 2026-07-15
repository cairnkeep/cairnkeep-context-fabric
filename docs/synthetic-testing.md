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
npm run fabric -- ingest --once --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- evidence list --config "$CAIRN_FABRIC_CONFIG"
npm run fabric -- context get \
  --config "$CAIRN_FABRIC_CONFIG" \
  --project project-alpha \
  --repository /fixture/project-alpha \
  --query "adapter interface"
```

The first ingestion admits a create event. The context packet contains one
evidence section and one citation. The second ingestion replaces it with the
updated payload.

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
- A failed batch does not advance its cursor.
- Cursors and current evidence survive process restart.
- Non-allowlisted containers fail admission.
- Revoked, expired, denied, and deleted evidence is not returned.
- Every returned evidence section has a source citation.
- Full harness prompts are not accepted by the context contract.
- No evidence is promoted into Cairnkeep memory.
