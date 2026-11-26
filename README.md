# Crystal Clear — public ledger

This repository holds the public side of the Open Proof Protocol (OPP) used by
[Crystal Clear](https://crystalclear.guide):

- **`spec/`** — the binding text of each protocol version. Each file is frozen: a
  change to the rules is a new version with a new file.
- **`snapshots/`** — daily copies of the public ledger and of every published guide
  manifest, kept outside our database (the texts of guide pages are not copied). Production starts with the pilot on
  `main`; demo data lives only on the `demo` branch. How to check them:
  [`snapshots/README.md`](snapshots/README.md).
- **`tools/snapshot.mjs`** and **`.github/workflows/snapshot.yml`** — the daily job that
  writes them. It reads only public data.
- **`tools/verify.mjs`** — a copy of the site's ledger checker (`/ledger/verify.mjs`), used by
  the job and by anyone checking a snapshot. Update it when the site's checker changes.

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
