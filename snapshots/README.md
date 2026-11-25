# Ledger snapshots

Once a day a GitHub Action (`.github/workflows/snapshot.yml`) copies the public Crystal Clear
ledger here. It is a copy kept outside our database: if anyone — including us — changed or removed a
record later, the copy here, and its history in git, would show it.

## Where they are

| Folder | Branch | What it is |
| --- | --- | --- |
| `snapshots/production/` | `main` | The real ledger of [crystalclear.guide](https://www.crystalclear.guide). Starts at Genesis (the launch of the pilot). |
| `snapshots/demo/` | `demo` | **Demo data only** — simulated runs from [demo.crystalclear.guide](https://demo.crystalclear.guide), not real customer outcomes. It may be reset. |

Each folder holds:

- **`ledger.json`** — every public record, exactly as the site's "Download records (JSON)" serves it
  (`/ledger/download`). It is replaced only when new records arrive, and only if every record of the
  previous copy is still there, unchanged; `git log` on this file gives every earlier day.
- **`ledger-rejected.json`** — normally absent. It appears when a download no longer contains an
  earlier record unchanged: the job then keeps `ledger.json` as it was, saves that download here as
  evidence, and fails every day until a person looks.
- **`manifests/<sha256>.json`** — every version of a guide that the ledger records as published
  (its stages, paths, materials and links), exactly as stored. The file name is the file's own SHA-256, which is the
  `subject_hash` of the ledger's `version_published` record for that version.

Files are only ever added. A manifest stays here even after its guide is withdrawn from the site. A
day with no new records adds no commit.

**The texts of guide pages are not copied here.** The ledger records every change of a page text as
a `content_updated` record whose `subject_hash` is the SHA-256 of that text, so anyone who can read
the page can check that it is the text the ledger points to — but the text itself is shown only on
the site. (`snapshots/demo/texts/` on the `demo` branch is left over from before 2026-11-25, when
the demo snapshot still copied them; nothing is added there any more.)

## How to check a snapshot

You need [Node.js](https://nodejs.org) 18 or newer and nothing else. Nothing below needs our
database or an account.

**1. Check every record and the chain.** Run the checker on the snapshot. A copy of it is kept in
this repository (`tools/verify.mjs`); the site serves the same file at
<https://www.crystalclear.guide/ledger/verify.mjs>:

```
node tools/verify.mjs snapshots/production/ledger.json
```

It recomputes the hash of every record from the record's own fields, checks that each record points
to the hash of the one before it, and recounts the results. It ends with `All checks passed.`
when everything matches. `node tools/verify.mjs <ledger.json> --explain 12` shows, field by field, how the
hash of record 12 is built. The full recipe is at <https://www.crystalclear.guide/ledger/verify>.

**2. Check that a guide was built the way the ledger says.** Each manifest is named after its own
SHA-256, so it is enough to hash it:

```
cd snapshots/production
sha256sum manifests/*.json
```

Every line must show the same hash twice (as the hash and as the file name). Then pick a
`version_published` record in `ledger.json`: its `subject_hash` is the name of the file holding what
was published.

**3. Check that nothing was rewritten.** Compare today's `ledger.json` with an older one from git
history (`git log -p snapshots/production/ledger.json`): records are only ever added at the end.
A record that changed or disappeared between two snapshots is exactly what this copy is for.

Do not convert line endings or re-format these files: the hashes cover their exact bytes
(`.gitattributes` keeps git from touching them).
