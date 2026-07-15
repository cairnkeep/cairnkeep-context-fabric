# Source configuration

## Current support

The pre-alpha runtime accepts only `synthetic` sources. It does not discover,
scrape, or authenticate to any account after installation. Collaboration, mail,
work-item, and source-control connectors remain disabled until the synthetic
lifecycle and authorization gates are complete.

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
      "batchSize": 1
    }
  ]
}
```

`HOME` and `XDG_DATA_HOME` are the only supported path variables. Relative paths
resolve from the configuration file. Runtime databases belong under private XDG
data storage, never in a project repository.

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
