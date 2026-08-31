# TronIDE → TronBox public handoff contract

Every exported project contains `tronide-export.json`. Its public JSON Schema is
[`tronide-export.schema.json`](../../../src/app/tabs/runTab/model/tronide-export.schema.json),
and this directory contains a deterministic v1 example plus the Recorder scenario
that produced it.

## Versioning and compatibility

- Consumers must check `kind` and `schemaVersion` before reading other fields.
- A v1 consumer accepts schema version `1`, ignores additive unknown v1 fields,
  and rejects higher schema versions rather than guessing their meaning.
- Breaking field or semantic changes require a new `schemaVersion` and fixture.
- `compatibility.testedTronbox` records the published CLI version exercised by
  the required handoff gate; it is a tested baseline, not a browser dependency.
- `compatibility.apiBoundary` is always `generated-project-files`: TronIDE emits
  normal project files and the gate invokes public TronBox CLI commands. No
  TronBox private API is imported or called by the exporter.

## Metadata scope

The v1 document contains the TronIDE generator version, normalized solc version,
an honest network summary, scenario origin, transaction count, and tested TronBox
baseline. It deliberately does not copy accounts, private keys, transaction
arguments, source text, or the scenario journal into the metadata document.

The exported Solidity sources and migration remain normal project files and must
still be reviewed before migration. Compatibility failure blocks the Recorder →
TronBox handoff workflow only; it does not disable other TronIDE workflows.

Run the shared fixture and failure report with:

```shell
pnpm test:tronbox-handoff
```
