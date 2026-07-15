# Source configuration

## Current support

The neutral `cairn-fabric` executable accepts only `synthetic` sources. It does
not discover, scrape, dynamically load code, or authenticate to any account
after installation. The runtime can accept additional source types only when a
deployment-owned executable explicitly registers their implementations through
the connector SDK.

Collaboration, mail, work-item, and source-control connectors remain absent from
the public executable. Installing the public package cannot enroll an account or
activate a connector supplied by somebody else's overlay.

Runtime configuration is strict JSON. On Unix, the file must not be accessible
by group or other users. Unknown fields, duplicate source identifiers, unknown
source types, and containers outside the explicit allowlist are rejected.

```json
{
  "schemaVersion": 1,
  "deploymentId": "fixture",
  "mode": "shadow",
  "principalId": "developer-a",
  "dataDir": "${XDG_DATA_HOME}/cairnkeep-context-fabric/synthetic",
  "sources": [
    {
      "id": "mock",
      "type": "synthetic",
      "enabled": true,
      "fixturePath": "../tests/fixtures/evidence-lifecycle.json",
      "containers": ["project-alpha"],
      "batchSize": 1,
      "healthTtlSeconds": 900
    }
  ]
}
```

`HOME` and `XDG_DATA_HOME` are the only supported path variables. Relative paths
resolve from the configuration file. Runtime databases belong under private XDG
data storage, never in a project repository.

`healthTtlSeconds` bounds how long evidence remains usable after a complete
successful source run. It defaults to 900 seconds and must be between 60 seconds
and 24 hours. Schedule ingestion more frequently than the lease; an expired
lease withholds that source until a successful run renews it.

## Future deployment ownership

The public fabric will define connector schemas and generic implementations.
A private overlay will own actual account registration, credential references,
source identifiers, allowlists, retention, redaction, and rollout mode.

For a collaboration or mail connector, configuration will require explicit
immutable source identifiers. Display-name patterns and tenant-wide discovery
will not enable a source. Historical backfill will remain a separate operation
with preview, volume limit, retention validation, and confirmation.

Credentials will be referenced through a deployment secret store. They will not
be accepted inline in a tracked source configuration.

See [connector-plugins.md](connector-plugins.md) for the registration contract
and the mandatory non-admitting preview gate.
