# Security Policy

## Supported versions

The project is pre-alpha. Security fixes are applied to the latest commit on
`main`; no production deployment is supported yet.

## Reporting

Do not open a public issue for a vulnerability or include source data, tokens,
private endpoints, tenant details, or exploit payloads in public discussions.
Use GitHub private vulnerability reporting for the repository.

## Security boundaries

- Source content is untrusted data and cannot issue instructions or tool calls.
- Authorization is checked when evidence is admitted and again when it is
  retrieved.
- Deletion, expiry, or revoked access makes dependent evidence unavailable
  before derived-artifact reconciliation completes.
- Personal and organizational deployments require separate credentials, keys,
  databases, indexes, compiled knowledge, and audit logs.
- Complete harness prompts are not retained by default.
- Secrets must come from environment-backed secret storage and must never be
  stored in project files, fixtures, logs, or error messages.

See [docs/threat-model.md](docs/threat-model.md) for the initial threat model.
