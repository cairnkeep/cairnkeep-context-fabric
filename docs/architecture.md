# Architecture

## Decision

The context fabric surrounds Cairnkeep rather than proxying every harness prompt
or replacing native coding CLIs.

```text
permitted sources -> connector adapters -> evidence ledger
                                            |
                                            v
                                      policy and linking
                                       /             \
                              active-work graph   compiled wiki
                                       \             /
                                        candidate queue
                                              |
                                        human review
                                              |
                                      Cairnkeep memory

native harness -> context client -> bounded cited context packet
```

## Components

### Evidence ledger

The ledger records idempotent source events, provenance, access snapshots,
retention, and lifecycle state. Search indexes are derived and rebuildable.

### Active-work graph

The graph links repositories, branches, work items, changes, code symbols,
documents, people, and source threads. Every inferred edge retains an admissible
evidence path and validity interval.

### Compiled wiki

The wiki accumulates cited project synthesis. Mutations use plan, validate,
lease, snapshot, stage, re-read, lint, atomic publish, and journal. Concurrent
semantic edits become contested rather than being silently overwritten.

### Candidate review

The current vertical slice accepts deliberate manual proposals. Review can
approve, reject, or snooze them; extraction and editing remain future work.
Free-form communication is never automatically promoted to durable memory.

### Context packets

Packets are bounded by token budget and separate durable memory, compiled
knowledge, current evidence, contradictions, and citations. Requests contain
deliberate work metadata rather than automatically recorded full prompts.

## Deployment boundary

The public service supplies contracts and safe implementations. A deployment
overlay selects connectors, credentials, source allowlists, retention,
approved model endpoints, storage topology, and rollout policy. Installing the
public packages does not enroll a machine or discover a remote service.

Connector implementations are registered in code by a deployment-owned
executable. Configuration never names a module to import, so editing a source
file cannot turn data configuration into arbitrary code loading.
