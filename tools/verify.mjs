#!/usr/bin/env node
// Crystal Clear public ledger checker. No dependencies; needs Node 18 or newer.
//
//   node verify.mjs ledger.json                 check a downloaded export
//   node verify.mjs ledger.json --explain 12    show how the hash of the record with chain_seq 12 is built
//
// The input is the file from "Download records (JSON)" on /ledger: { "meta": {...}, "events": [...] }.
// What it checks, and the exact hash recipe, are described at /ledger/verify. Everything here is plain
// arithmetic on the file: no network access, no database. It knows three protocol versions, each with
// its own recipe: opp/0.4 (current), opp/0.3 and opp/0.2 (earlier records of the demo ledger).

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// ---------------------------------------------------------------------------------------------
// The hash input

// Exact times are hashed as UTC with exactly six fractional digits and a trailing Z, e.g.
// 2026-10-21T12:00:00.000000Z. The export may spell the same instant as "...12:00:00+00:00" with
// trailing zeros of the fraction left out, so it is rewritten without going through Date (which only
// keeps milliseconds).
const TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}(?::?\d{2})?)$/

function timestamp(value) {
  const m = TIMESTAMP.exec(value)
  if (!m) throw new Error(`unrecognised timestamp "${value}"`)
  const [, year, month, day, hour, minute, second, fraction = '', zone] = m
  let offsetMinutes = 0
  if (zone !== 'Z') {
    const digits = zone.slice(1).replace(':', '')
    offsetMinutes = (zone[0] === '-' ? -1 : 1) * (Number(digits.slice(0, 2)) * 60 + Number(digits.slice(2, 4) || 0))
  }
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)) - offsetMinutes * 60000
  return `${new Date(ms).toISOString().slice(0, 19)}.${fraction.padEnd(6, '0')}Z`
}

// opp/0.4: a record that belongs to a run carries a UTC date only, hashed as YYYY-MM-DD. The export
// writes it as that date; the database view spells the same thing as midnight UTC. Anything with a
// time of day is refused: the hash would not cover it. The three kinds below say nothing about a
// person and keep the exact time.
const EXACT_TIME_KINDS = new Set(['protocol_activated', 'version_published', 'content_updated'])
const DATE = /^\d{4}-\d{2}-\d{2}$/

function date(value) {
  if (DATE.test(value)) return value
  const stamp = timestamp(value)
  if (!stamp.endsWith('T00:00:00.000000Z')) {
    throw new Error(`"${value}" has a time of day, which an opp/0.4 record of a run must not carry`)
  }
  return stamp.slice(0, 10)
}

// null -> empty text, booleans -> true/false, numbers -> plain decimal.
const text = (value) => (value === null || value === undefined ? '' : String(value))

// '\' becomes '\\' and '|' becomes '\|' (only `path` can contain them).
const escapePath = (value) => (value === null || value === undefined ? '' : value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|'))

/** The fields of the hash input, in order, as [name, text]. Joined with '|' they are what gets hashed. */
function hashFields(e) {
  if (e.protocol_version === 'opp/0.4' || e.protocol_version === 'opp/0.3') {
    // The same 19 fields in both versions. Only the two times differ: opp/0.3 wrote them in full for
    // every kind; opp/0.4 writes a date for records of a run and the exact time for the other kinds.
    const time = e.protocol_version === 'opp/0.3' || EXACT_TIME_KINDS.has(e.kind) ? timestamp : date
    return [
      ['protocol_version', text(e.protocol_version)],
      ['chain_seq', text(e.chain_seq)],
      ['prev_hash', text(e.prev_hash)],
      ['kind', text(e.kind)],
      ['run_id', text(e.run_id)],
      ['guide_id', text(e.guide_id)],
      ['guide_version_id', text(e.guide_version_id)],
      ['path', escapePath(e.path)],
      ['is_author', text(e.is_author)],
      ['source', text(e.source)],
      ['page_id', text(e.page_id)],
      ['target_kind', text(e.target_kind)],
      ['lang', text(e.lang)],
      ['reason_code', text(e.reason_code)],
      ['evidence_level', text(e.evidence_level)],
      ['evidence_hash', text(e.evidence_hash)],
      ['subject_hash', text(e.subject_hash)],
      ['occurred_at', time(e.occurred_at)],
      ['recorded_at', time(e.recorded_at)],
    ]
  }
  if (e.protocol_version === 'opp/0.2') {
    // Legacy formula. The database joined these with concat_ws, which leaves a NULL out altogether
    // (no empty field), so run_id and evidence_level are skipped when they are null.
    const fields = [
      ['chain_seq', text(e.chain_seq)],
      ['prev_hash', text(e.prev_hash)],
      ['run_id', e.run_id ?? null],
      ['step_id', text(e.step_id)],
      ['kind', text(e.kind)],
      ['evidence_level', e.evidence_level ?? null],
      ['evidence_hash', text(e.evidence_hash)],
      ['occurred_at', timestamp(e.occurred_at)],
      ['recorded_at', timestamp(e.recorded_at)],
    ]
    return fields.filter(([, value]) => value !== null).map(([name, value]) => [name, String(value)])
  }
  return null
}

const canonical = (fields) => fields.map(([, value]) => value).join('|')

// ---------------------------------------------------------------------------------------------
// Results: the same rules as "Results so far" on the guide page.

const MIN_FINISHED_FOR_SHARE = 5

function wilson(successes, n) {
  const z = 1.96
  const p = successes / n
  const denominator = 1 + (z * z) / n
  const centre = (p + (z * z) / (2 * n)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator
  return { share: p, low: Math.max(0, centre - half), high: Math.min(1, centre + half) }
}

/** Per guide: live runs of participants only (is_author = false, source = 'live'), counted by run_id. */
function results(events) {
  const guideOfRun = new Map()
  for (const e of events) {
    if (e.kind === 'run_started' && e.run_id && e.is_author === false && e.source === 'live') guideOfRun.set(e.run_id, e.guide_slug)
  }
  const perGuide = new Map()
  const entry = (slug) => {
    if (!perGuide.has(slug)) perGuide.set(slug, { started: new Set(), succeeded: new Set(), refused: new Set(), stopped: new Set() })
    return perGuide.get(slug)
  }
  for (const [runId, slug] of guideOfRun) entry(slug).started.add(runId)
  for (const e of events) {
    const slug = guideOfRun.get(e.run_id)
    if (!slug) continue
    if (e.kind === 'outcome_succeeded') entry(slug).succeeded.add(e.run_id)
    else if (e.kind === 'outcome_failed') entry(slug).refused.add(e.run_id)
    else if (e.kind === 'abandoned') entry(slug).stopped.add(e.run_id)
  }
  return perGuide
}

const percent = (x) => Math.round(x * 100)

// ---------------------------------------------------------------------------------------------

function fail(message) {
  console.error(message)
  process.exit(2)
}

function main() {
  const args = process.argv.slice(2)
  const explainAt = args.indexOf('--explain')
  const explain = explainAt >= 0 ? Number(args[explainAt + 1]) : null
  const file = args.find((a, i) => !a.startsWith('--') && !(explainAt >= 0 && i === explainAt + 1))
  if (!file || (explainAt >= 0 && !Number.isInteger(explain))) {
    fail('Usage: node verify.mjs ledger.json [--explain <chain_seq>]')
  }

  let data
  try {
    data = JSON.parse(readFileSync(file, 'utf8'))
  } catch (error) {
    fail(`Cannot read ${file} as JSON: ${error.message}`)
  }
  const events = Array.isArray(data) ? data : data.events
  if (!Array.isArray(events)) fail('Expected the export format { "meta": {...}, "events": [...] }.')

  if (explain !== null) {
    const e = events.find((x) => x.chain_seq === explain)
    if (!e) fail(`No event with chain_seq ${explain} in this file.`)
    const fields = hashFields(e)
    if (!fields) fail(`Unknown protocol_version "${e.protocol_version}".`)
    const computed = sha256(canonical(fields))
    console.log(`Event ${e.chain_seq} (${e.protocol_version}, ${e.kind})`)
    for (const [name, value] of fields) console.log(`  ${name.padEnd(17)} ${value === '' ? '(empty)' : value}`)
    console.log(`\nCanonical string:\n${canonical(fields)}\n`)
    console.log(`SHA-256 of that string: ${computed}`)
    console.log(`hash stored in file:    ${e.hash}  ${computed === e.hash ? '(match)' : '(DIFFERENT)'}`)
    process.exit(computed === e.hash ? 0 : 1)
  }

  let ok = true
  const meta = Array.isArray(data) ? null : data.meta
  console.log(`Ledger file: ${file}`)
  if (meta) {
    console.log(`Dataset: ${meta.dataset}${meta.notice ? ` — ${meta.notice}` : ''}`)
    console.log(`Generated: ${meta.generated_at}`)
  }

  const byProtocol = {}
  for (const e of events) byProtocol[e.protocol_version] = (byProtocol[e.protocol_version] ?? 0) + 1
  console.log(`\nEvents: ${events.length} (${Object.entries(byProtocol).map(([p, n]) => `${p}: ${n}`).join(', ')})`)

  // 1. Every hash recomputed from the event's own fields.
  let recomputed = 0
  let unknown = 0
  let firstMismatch = null
  for (const e of events) {
    let fields = null
    try {
      fields = hashFields(e)
    } catch (error) {
      firstMismatch ??= `chain_seq ${e.chain_seq}: ${error.message}`
      continue
    }
    if (!fields) {
      unknown++
      firstMismatch ??= `chain_seq ${e.chain_seq}: unknown protocol_version "${e.protocol_version}"`
      continue
    }
    if (sha256(canonical(fields)) === e.hash) recomputed++
    else firstMismatch ??= `chain_seq ${e.chain_seq}: recomputed ${sha256(canonical(fields))}, file says ${e.hash}`
  }
  // never round a failure up to 100%
  const share = events.length ? Math.floor((recomputed / events.length) * 1000) / 10 : 0
  console.log(`Hashes recomputed correctly: ${recomputed} of ${events.length} (${share}%)${recomputed === events.length ? '  OK' : '  PROBLEM'}`)
  if (firstMismatch) {
    ok = false
    console.log(`  First problem — ${firstMismatch}${unknown ? ` (${unknown} event(s) with an unknown protocol_version)` : ''}`)
  }

  // 2. Continuity: each event names the hash of the one before it; the first names GENESIS.
  let links = 0
  let gaps = 0
  const missing = []
  let firstBreak = null
  for (let i = 0; i < events.length; i++) {
    const e = events[i]
    const previous = events[i - 1]
    if (i === 0 && e.chain_seq === 1) {
      links++
      if (e.prev_hash !== 'GENESIS') firstBreak ??= `chain_seq 1 should start from GENESIS, says ${e.prev_hash}`
    } else if (previous && e.chain_seq === previous.chain_seq + 1) {
      links++
      if (e.prev_hash !== previous.hash) firstBreak ??= `chain_seq ${e.chain_seq}: prev_hash does not equal the hash of chain_seq ${previous.chain_seq}`
    } else if (previous && e.chain_seq <= previous.chain_seq) {
      firstBreak ??= `chain_seq ${e.chain_seq} comes after ${previous.chain_seq}: the file is not in order`
    } else {
      gaps++ // records of other (never published) guides, or a filtered download: not an error, just not checkable
      missing.push(previous ? `${previous.chain_seq + 1}–${e.chain_seq - 1}` : `1–${e.chain_seq - 1}`)
    }
  }
  console.log(`Chain continuity: ${firstBreak ? 'PROBLEM' : 'OK'} — ${links} link(s) checked${gaps ? `, ${gaps} gap(s) in chain_seq (links across a gap cannot be checked)` : ''}`)
  if (gaps) console.log(`  Missing chain_seq: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ', ...' : ''}`)
  if (firstBreak) {
    ok = false
    console.log(`  First problem — ${firstBreak}`)
  }

  // 3. Protocol activation: opp/0.4 starts with one protocol_activated record, which carries the
  // sha256 of the protocol text. Printed so it can be compared with the published text.
  const current = events.filter((e) => e.protocol_version === 'opp/0.4')
  const activations = current.filter((e) => e.kind === 'protocol_activated')
  if (current.length && activations.length === 0) {
    console.log('Protocol activation (opp/0.4): not in this file (a download filtered to one guide leaves it out)')
  } else if (activations.length > 1 || (activations.length === 1 && current[0] !== activations[0])) {
    ok = false
    console.log('Protocol activation (opp/0.4): PROBLEM — it must be the first opp/0.4 record and the only one')
  } else if (activations.length === 1) {
    console.log(`Protocol activation (opp/0.4): OK — chain_seq ${activations[0].chain_seq}, the first opp/0.4 record`)
    console.log(`  sha256 of the protocol text (opp-0.4-spec.md): ${activations[0].subject_hash}`)
  }

  // 4. Results.
  console.log('\nResults recomputed from the events (live runs of participants; author runs, historical imports and opp/0.2 events are not counted):')
  const perGuide = results(events)
  if (perGuide.size === 0) console.log('  No live participant runs in this file.')
  for (const [slug, r] of perGuide) {
    const finished = r.succeeded.size + r.refused.size + r.stopped.size
    console.log(`  ${slug}`)
    console.log(`    started ${r.started.size} · succeeded ${r.succeeded.size} · refused ${r.refused.size} · stopped ${r.stopped.size} · no final outcome ${r.started.size - finished}`)
    if (finished >= MIN_FINISHED_FOR_SHARE) {
      const w = wilson(r.succeeded.size, finished)
      console.log(`    success share ${percent(w.share)}% (95% range ${percent(w.low)}–${percent(w.high)}%) among ${finished} finished runs`)
    } else {
      console.log(`    success share not shown: fewer than ${MIN_FINISHED_FOR_SHARE} finished runs`)
    }
  }

  if (ok && gaps) {
    console.log(
      '\nPassed, with a warning: the records listed as missing are not in this file. The ledger leaves out guides that were never published, and a download filtered to one guide has gaps; any other missing record should be asked for.'
    )
  } else {
    console.log(`\n${ok ? 'All checks passed.' : 'CHECKS FAILED — see above.'}`)
  }
  process.exit(ok ? 0 : 1)
}

main()
