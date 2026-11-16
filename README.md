# Crystal Clear — public ledger

This repository holds the public side of the Open Proof Protocol (OPP) used by
[Crystal Clear](https://crystalclear.guide):

- **`spec/`** — the binding text of each protocol version. Each file is frozen: a
  change to the rules is a new version with a new file.
- **`snapshots/`** — daily copies of the public ledger *(starts with the pilot)*.

## Check that the rules are the ones the ledger was started with

The first record of protocol version `opp/0.4` is `protocol_activated`. Its
`subject_hash` is the SHA-256 of `spec/opp-0.4.md`, byte for byte:

```
sha256sum spec/opp-0.4.md
# 4c3157740cf7c69c0e15ab5a7e29ca845b7104f93455bad91d558a876188f1b0
```

Compare it with the `subject_hash` of the `protocol_activated` record in the
ledger download at <https://crystalclear.guide/ledger>.

The full recipe for checking every record, worked examples and a checker
without dependencies are at <https://crystalclear.guide/ledger/verify>.
