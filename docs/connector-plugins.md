# Connector plug-ins and preview

Live connector code belongs behind `@cairnkeep/connector-sdk` and is selected by
a deployment overlay. The public executable does not dynamically import a
package named in configuration.

## Registration

An overlay builds its tailored executable with an explicit registration:

```ts
import {
  ConnectorSourceConfigSchema,
  defineConnectorRegistration,
} from "@cairnkeep/connector-sdk";
import { runFabricOperator } from "@cairnkeep/fabricd";

const registration = defineConnectorRegistration({
  type: "collaboration-source",
  parseConfig(value, context) {
    const common = ConnectorSourceConfigSchema.parse(value);
    // The connector validates its additional fields and resolves safe paths
    // relative to context.baseDir.
    return common;
  },
  create(config, runtime) {
    return createDeploymentConnector(config, runtime);
  },
});

const result = await runFabricOperator(process.argv.slice(2), [registration]);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
```

The adapter must implement `pull()` and `payload()`. The runtime context passed
to `create()` supplies the deployment ID, principal ID, and private data
directory so an overlay does not duplicate or hardcode deployment identity.
Common configuration fixes the source ID, type, enabled state, explicit
container allowlist, maximum batch size, and a bounded health-lease duration.
Connector-specific parsing cannot change those fields. Both
`parseConfig()` and `create()` must be side-effect free: they do not authenticate,
contact a source, start background work, or resolve secret values. Only an
explicit `pull()` or `payload()` operation may contact the source. The adapter
emits normalized evidence events and must propagate updates, deletions, expiry,
and access changes from the source.

The runtime persists connector availability separately from evidence lifecycle.
Only a complete successful ingestion attempt marks a source available. Any pull,
validation, payload, admission, or cursor failure marks it unavailable and
immediately withholds its evidence and evidence-backed candidates. A later
successful attempt restores visibility without destroying candidates during a
transient outage. The default lease is 15 minutes and expires fail-closed if no
successful run renews it. Preview never changes availability.

Inline credential fields are rejected before connector-specific parsing. A
configuration may contain an environment-variable name or secret-store
reference, but the adapter resolves that reference only when an explicit source
operation begins.

## Preview gate

New sources start with `enabled: false`. An operator runs an explicit preview:

```bash
cairn-fabric sources preview --source SOURCE_ID --config PRIVATE_CONFIG
```

Preview contacts the source and fetches the next batch. It validates schemas,
deployment identity, container allowlists, duplicate identifiers, batch bounds,
and payload byte counts and SHA-256 digests. Output contains lifecycle metadata,
not source payload text. Preview never writes evidence and never advances the
durable cursor, even when validation fails.

## Deployment review

Before enabling ingestion, the overlay must independently verify:

- least-privilege read-only source permissions;
- immutable container identifiers and an explicit allowlist;
- credentials referenced from a secret store rather than tracked configuration;
- pagination, retry, rate-limit, replay, and monotonic revision behavior;
- an ingestion schedule comfortably shorter than the configured health lease;
- deletion, retention expiry, and access-revocation propagation;
- no payload, credential, or private identifier logging;
- preview volume and classification against deployment policy;
- rollback, reconciliation, and credential-revocation procedures.

Only the tailored overlay executable can parse and instantiate its registered
type. Running the neutral public CLI against that same config fails with an
unknown-source-type error.
