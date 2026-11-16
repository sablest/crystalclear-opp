# Open Proof Protocol, version 0.4 (`opp/0.4`)

**Status: frozen.** This file is the binding text of protocol version `opp/0.4`. It is not edited
after the protocol is activated: a change to the rules is a new protocol version with its own text.
The SHA-256 of this file (its exact bytes) is written into the ledger itself, in the
`protocol_activated` record of `opp/0.4` (section 8). Anyone can therefore check that the rules they
are reading are the rules the ledger was started with.

Everything needed to check a record is in this file. No other document is required.

## 1. What the ledger is

Crystal Clear publishes step-by-step guides. The ledger is one append-only list of records that says
what people who followed a guide reported (started, reached a checkpoint, succeeded, were refused,
stopped, found a problem) and what the guide said at the time (its structure and its texts).

Words used below:

- **Guide version**: the fixed structure of a guide: its stages (the checkpoints, in order), its
  materials and its paths (variants of the guide, for example by kind of applicant). The structure is
  described by a **manifest** (section 8).
- **Run**: one person's attempt at one guide version, on one path.
- **Participant**: the person doing a run. **Author**: the person who writes the guide.
- **Operator**: the service that runs the database. **System**: the database rules themselves, acting
  without a person (for example, writing the success record when the last checkpoint is recorded).

The database stops participants from forging records. It cannot stop the operator from tampering with
its own database. The protocol therefore makes tampering detectable instead: every record is hashed
together with the hash of the record before it, every hashed field is public, and copies of the
public record are kept outside the database. A record cannot be changed, removed or inserted in the
middle without breaking the hashes that follow.

The public record contains no names, emails, user ids, comments, files or salts.

## 2. Fields of a record

Each record has the 19 fields below, in this order, and a `hash` (section 5). A field that does not
apply to a record is empty.

| # | Field | Content |
| --- | --- | --- |
| 1 | `protocol_version` | `opp/0.4` |
| 2 | `chain_seq` | Position in the ledger: 1, 2, 3, … as a decimal number without leading zeros. |
| 3 | `prev_hash` | The `hash` of the record at `chain_seq` − 1. For `chain_seq` 1: the word `GENESIS`. |
| 4 | `kind` | What the record says (section 3). |
| 5 | `run_id` | Identifier of the run: a random UUID, lowercase, `8-4-4-4-12`. Empty on records without a run. |
| 6 | `guide_id` | UUID of the guide. Only on `version_published` and `content_updated`. |
| 7 | `guide_version_id` | UUID of the guide version. Only on `run_started` and `version_published`. |
| 8 | `path` | The path of the run (one of the paths in the manifest). Only on `run_started`; empty when the guide has no paths. |
| 9 | `is_author` | `true` when the run belongs to the guide's author, else `false`. Only on `run_started`. |
| 10 | `source` | `live` (a run done on the platform) or `historical` (a past experience imported by the operator). Only on `run_started`. |
| 11 | `page_id` | Identifier of a stage, a material or a content page: 1 to 64 characters from `A-Z a-z 0-9 _ -`. The same identifier the manifest uses. |
| 12 | `target_kind` | `checkpoint` or `material`. Only on `issue_reported`. |
| 13 | `lang` | Language tag of a text (`ru`, `en`, `pt-BR`, …): 2 or 3 lowercase letters, then up to three parts of 2 to 8 letters or digits, each after a `-`. Only on `content_updated`. |
| 14 | `reason_code` | One of: `not_eligible`, `authority_refused`, `document_rejected`, `info_outdated`, `guide_unclear`, `personal`, `other`. |
| 15 | `evidence_level` | `0`, `1` or `2` (section 7). Empty on records written by the system. |
| 16 | `evidence_hash` | Fingerprint of a proof file: 64 lowercase hexadecimal characters (section 7). |
| 17 | `subject_hash` | SHA-256 of a published text: 64 lowercase hexadecimal characters (section 8). |
| 18 | `occurred_at` | When the event happened (section 4). |
| 19 | `recorded_at` | When the record was written into the ledger (section 4). |

The operator may publish display fields next to these (for example a run alias, the guide's short
name, a version number). They are not part of the hash and prove nothing.

## 3. Kinds of record

| Kind | Meaning | Written by | Fields that carry a value (besides 1–4, 18, 19) |
| --- | --- | --- | --- |
| `protocol_activated` | This protocol version starts here. | System, once | `subject_hash` |
| `version_published` | A guide version was published. | System, when the author publishes | `guide_id`, `guide_version_id`, `subject_hash` |
| `content_updated` | The text of one page changed, in one language. | System, when the author publishes | `guide_id`, `page_id`, `lang`, `subject_hash` |
| `run_started` | A run began. | System, when the run is created | `run_id`, `guide_version_id`, `path` (if any), `is_author`, `source` |
| `checkpoint_done` | The participant reached a stage. | Participant | `run_id`, `page_id`, `evidence_level`, `evidence_hash` (level 2) |
| `outcome_succeeded` | The run ended in success. | System, after the last checkpoint | `run_id` |
| `outcome_failed` | The run ended in failure (for example a refusal). | Participant | `run_id`, `reason_code`, `evidence_level` |
| `abandoned` | The participant stopped. | Participant | `run_id`, `evidence_level`, `reason_code` (optional) |
| `issue_reported` | The participant reported a problem with a stage or a material; the run goes on. | Participant | `run_id`, `page_id`, `target_kind`, `reason_code`, `evidence_level` |

"Written by the system" means no person and no program of the operator can insert that kind
directly: the database writes it as a consequence of another event. Records marked "Participant" can
also be written by the operator for a `historical` run (section 7, level 0).

Three more kinds are reserved and cannot be written in `opp/0.4` (section 9): `record_corrected`,
`run_timed_out`, `run_flagged`.

## 4. Time

All times are UTC.

- **Day precision.** Every record that belongs to a run (`run_started`, `checkpoint_done`,
  `outcome_succeeded`, `outcome_failed`, `abandoned`, `issue_reported`) carries a calendar date only,
  in `occurred_at` and in `recorded_at`. The time of day is neither published nor hashed. The exact
  moment the record was written is kept privately by the operator and is not part of the protocol.
  Why: exact timestamps of a person's steps, next to a public guide, can help identify the person.
- **Exact time.** `protocol_activated`, `version_published` and `content_updated` carry the exact
  time of writing, to the microsecond. For these kinds `occurred_at` equals `recorded_at`, and both
  are the database clock.
- **Order** comes from `chain_seq`, never from the times. Within one day the dates say nothing about
  the order.
- `recorded_at` is always the database clock (its date, for day precision). `occurred_at` of
  `checkpoint_done`, `outcome_failed`, `abandoned` and `issue_reported` is stated by the participant
  and only bounded by the rules in section 6. `occurred_at` of `run_started` is the date the run
  began (for a `live` run: the database clock). `occurred_at` of `outcome_succeeded` is copied from
  the last checkpoint.

The public record may show a day-precision value as a plain date or as midnight UTC of that date
(`2026-11-27T00:00:00+00:00`). Both mean the date; the hash uses the date.

## 5. The hash

`hash` = SHA-256 of one text string, written as 64 lowercase hexadecimal characters. The string is
the 19 fields of section 2, in that order, joined with the character `|` (vertical bar), encoded as
UTF-8. No spaces, no quotes, nothing after the last field. An empty field contributes nothing between
its two bars.

Encoding of each field:

- `protocol_version`, `kind`, `source`, `target_kind`, `lang`, `reason_code`, `page_id`,
  `evidence_hash`, `subject_hash`, `prev_hash`: the text as is.
- `chain_seq`, `evidence_level`: decimal digits.
- `run_id`, `guide_id`, `guide_version_id`: lowercase UUID text with hyphens.
- `is_author`: `true` or `false`.
- `path`: first every `\` is replaced by `\\`, then every `|` by `\|`. It is the only field that can
  contain these characters.
- `occurred_at`, `recorded_at`:
  - day precision (kinds listed in section 4): `YYYY-MM-DD`, for example `2026-11-27`;
  - exact time (`protocol_activated`, `version_published`, `content_updated`):
    `YYYY-MM-DDTHH:MM:SS.UUUUUUZ`, always six digits after the point, for example
    `2026-11-20T09:15:02.481516Z`.

The string is unambiguous: every field is a fixed format, a value from a fixed list, a checked set
of characters, or escaped.

`prev_hash` of a record is the `hash` of the record before it, whatever protocol version that
earlier record has.

## 6. Rules a valid ledger follows

Rules 1 to 12 can be checked by anyone from the public record and the published manifests. Rule 13
lists what only the operator's database enforces.

1. **Chain.** `chain_seq` starts at 1 and grows by 1 with no gaps. `prev_hash` and `hash` are as in
   sections 2 and 5. Records are never changed or removed. (The public record leaves out guides that
   were never published; `chain_seq` then has gaps there, and a link across a gap cannot be checked
   from the public record alone.)
2. **Activation.** There is exactly one `protocol_activated` record with `opp/0.4`, and it is the
   first `opp/0.4` record in the ledger. In a ledger that begins with this version it is `chain_seq`
   1.
3. **Start of a run.** A run has exactly one `run_started` record, and it comes before every other
   record of that run. A run can start only on the latest published version of its guide: the
   version named by the guide's newest `version_published` record at that point of the chain.
4. **End of a run.** `outcome_succeeded`, `outcome_failed` and `abandoned` are final. A run has at
   most one final record and no record after it.
5. **Checkpoints.** The `page_id` of a `checkpoint_done` is a stage of the run's guide version that
   applies to the run's path. A stage is recorded at most once per run, and only when every earlier
   stage (lower position in the manifest) that applies to the path is already recorded in that run.
   Its `occurred_at` date is not earlier than the date of the run's previous checkpoint; the same
   date is allowed.
6. **Success.** When the last stage that applies to the path is recorded, the system writes
   `outcome_succeeded` for the run, with the same `occurred_at` as that checkpoint. Nobody else can
   write this kind.
7. **Date bounds.** For every record of a run, `occurred_at` is at most one day after `recorded_at`.
   In a `live` run, `occurred_at` of every record after `run_started` is at most one day before the
   `occurred_at` of the run's `run_started`. A `historical` run has no lower bound.
8. **Reasons.** `reason_code` is required on `outcome_failed` and `issue_reported`, optional on
   `abandoned`, and empty everywhere else. There is no free text in the ledger.
9. **Evidence.** Section 7. A `historical` run carries level 0 only; a `live` run never carries
   level 0. `evidence_hash` is present on level 2 and absent on levels 0 and 1. No record carries
   a level above 2.
10. **Issues.** `issue_reported` exists only in a `live` run that has no final record yet. Its
    `page_id` is a stage (`target_kind` = `checkpoint`) or a material (`target_kind` = `material`) of
    the run's guide version that applies to the run's path. A run gets at most 5 issue reports in any
    24 hours, so no more than 5 share one `recorded_at` date. The participant's comment is private
    and is not in the ledger.
11. **Author records.** A guide version has exactly one `version_published` record, written when it
    is published. Each new text of a page in a language gets one `content_updated` record.
12. **Reserved kinds.** No `opp/0.4` record has the kind `record_corrected`, `run_timed_out` or
    `run_flagged`.
13. **Enforced by the operator's database only** (the public record has no identities, so these
    cannot be re-checked from it): a participant writes only into their own runs; `is_author` is set
    from the operator's register of guide authors when the run starts; one person can start at most 3
    live runs of the same guide.

## 7. Evidence

`evidence_level` says what stands behind a participant's record:

- `0`: a past experience imported by the operator, as stated by the person. `historical` runs only.
- `1`: stated by the participant, no file.
- `2`: the participant holds a file (for example a photo of a document) and publishes a keyed
  fingerprint of it in `evidence_hash`. The file never leaves the participant's device.

There is no level 3 in `opp/0.4`. A level for evidence checked by the operator may come with a later
protocol version, which will have to define what such a check is. Until then the database refuses
level 3 from everyone, including the operator's own programs.

**Fingerprint at level 2.** For each proof the participant's device generates a fresh random salt of
16 to 64 bytes. Then

`evidence_hash` = HMAC-SHA256(key = the salt bytes, message = the file bytes)

written as 64 lowercase hexadecimal characters (HMAC as in RFC 2104, with SHA-256). The salt is
handled as raw bytes; where it is shown as text it is lowercase hexadecimal (32 to 128 characters).

Only the fingerprint is public. The salt is stored privately for the participant and is deleted with
their account. Without the salt nobody can test a guessed file against the fingerprint, and two
proofs of the same file do not look alike. To prove later that a file matches, the participant
reveals the salt and the file; anyone can then recompute the fingerprint:

`openssl dgst -sha256 -mac HMAC -macopt hexkey:<salt in hex> <file>`

## 8. Published texts and `subject_hash`

`subject_hash` is always the SHA-256 of the exact bytes (UTF-8) of a published text, never of a
re-formatted copy.

- `protocol_activated`: the text is **this file**.
- `version_published`: the text is the version's **manifest**, a JSON object with four lists:
  `paths` (the guide's paths); `stages` (each with `position`, `notion_page_id`, `paths`,
  `done_when`); `materials` (each with `notion_page_id`, `kind`, `paths`); `links` (each with
  `stage_notion_page_id`, `material_notion_page_id`, `position`). `notion_page_id` is the `page_id`
  used in records. A stage or material with an empty `paths` list applies to every path.
- `content_updated`: the text is the page's **canonical text**, a JSON object
  `{"body": …, "lang": …, "title": …}` (keys in this order, no extra whitespace) for the `page_id`
  and `lang` of the record.

The operator publishes every manifest. A canonical text is available to everyone who can read that
page of the guide, so that a reader can check that the text in front of them is the text the ledger
refers to.

## 9. Reserved kinds

`record_corrected`, `run_timed_out` and `run_flagged` are named now so that a later protocol version
can introduce them without changing the shape of a record. In `opp/0.4` the database refuses them
from everyone, including the operator's own programs. When a later version allows them, they will use
the same 19 fields, the same order and the same encodings, with day precision for both times, and:

- `record_corrected` states that an earlier record is wrong. `subject_hash` holds the `hash` of the
  record it corrects; `run_id` is that record's run, if it has one. The earlier record stays in the
  ledger unchanged.
- `run_timed_out` closes a run that received no final record for a long time. It carries `run_id`
  and is a final record, written by the system.
- `run_flagged` marks a run as doubtful. It carries `run_id` and a `reason_code`; the run is not
  closed by it.

Anything else about these kinds (who may write them, further fields, lists of reasons) is defined by
the version that first allows them.

## 10. Numbers computed from the ledger

Every public number is computed from the records alone:

- **Live starts**: `run_started` records with `is_author` = `false` and `source` = `live`.
- **Succeeded / failed / stopped**: those runs (matched by `run_id`) that have `outcome_succeeded` /
  `outcome_failed` / `abandoned`.
- **No final outcome yet**: live starts without a final record. Such a run is in progress or was
  left; `opp/0.4` has no timeout and never closes a run by itself.
- **Historical runs** (`source` = `historical`) are counted separately and never mixed into the live
  numbers. **Author runs** (`is_author` = `true`) are left out of both.

## 11. What the ledger does not prove

- That a participant told the truth. Levels 0 and 1 are statements; level 2 shows that a file existed
  and can later be matched, not what the file says.
- The time of day of a participant's record, or the order of events beyond `chain_seq`.
- That the operator was honest at the moment of writing. The operator's database could withhold a
  record or write one itself. What the protocol gives is that, once a record is in a published copy
  of the ledger, removing or changing it is detectable.
- Who a participant is. A run alias shown next to a record is a display name only; `run_id` is the
  identifier that is hashed.

## 12. Worked examples

The values are invented; the hashes are real and can be recomputed.

**A. `protocol_activated`**, first record of a ledger. `subject_hash` here is the SHA-256 of the
17-character text `example spec text`, standing in for the hash of this file.

```
opp/0.4|1|GENESIS|protocol_activated|||||||||||||77d3e49d9d23f2759d7e96a366dc5bde75e3c4cd3cf9509a10a38a03c1f98ed7|2026-11-20T09:15:02.481516Z|2026-11-20T09:15:02.481516Z
```

`hash` = `1f183763be8caf36879ebf466885836aeddcf3ebffc0a37d796a2f99b7bd5681`

**B. `run_started`**, a live run on the path `A|B` (escaped as `A\|B`), started on 27 November 2026.

```
opp/0.4|2|1f183763be8caf36879ebf466885836aeddcf3ebffc0a37d796a2f99b7bd5681|run_started|3f2b8c1e-7a4d-4e9b-9c6a-1d2e3f4a5b6c||779cf0ca-ef66-4886-8f5b-21cdb4571cab|A\|B|false|live||||||||2026-11-27|2026-11-27
```

`hash` = `d6c6f52834295c4f344104973ef2405cbf63721b13750996a302e5acf5be3f66`

**C. `checkpoint_done`** with a file (level 2), stated for 27 November and recorded on 28 November.

```
opp/0.4|3|d6c6f52834295c4f344104973ef2405cbf63721b13750996a302e5acf5be3f66|checkpoint_done|3f2b8c1e-7a4d-4e9b-9c6a-1d2e3f4a5b6c||||||3f45016e-3988-8127-ab81-f8acbf310b4c||||2|9163eb0d568a28e3994c969c9d5dfef181ccbbb0a8742b30464d4d200cbcb4f4||2026-11-27|2026-11-28
```

`hash` = `133e7197e8c15ebe5fd8ee8b7cae90b7427fd05c8d43512263a87fc50df25b92`

**D. Fingerprint.** Salt (hex) `000102030405060708090a0b0c0d0e0f`, file = the five bytes `hello`
(no line break):

`evidence_hash` = `9163eb0d568a28e3994c969c9d5dfef181ccbbb0a8742b30464d4d200cbcb4f4`

## 13. Earlier versions

Records with `protocol_version` `opp/0.2` or `opp/0.3` exist only in the demonstration dataset. They
follow their own recipes and are not part of this text.
