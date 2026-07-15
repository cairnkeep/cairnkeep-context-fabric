# Releasing

The workspace is pre-alpha and all packages are private. Do not publish packages
or containers until the vertical spike has frozen protocol `0.1`, completed its
security evaluation, and produced compatibility evidence.

Before a future release:

1. run the full Node.js runtime matrix;
2. verify schema compatibility and migration behavior;
3. verify the packed package contents contain no runtime data or secrets;
4. generate checksums and an SBOM;
5. publish through protected CI with provenance;
6. create reviewed dependency-pin changes in deployment overlays;
7. require each overlay's own canary and rollout approval.

Public release automation must never deploy directly into a private environment.
