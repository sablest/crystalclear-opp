#!/usr/bin/env node
// Daily snapshot of the public Crystal Clear ledger. No dependencies; needs Node 18 or newer.
//
//   node tools/snapshot.mjs
//
// Settings come from the environment (the workflow .github/workflows/snapshot.yml sets them):
//   TARGET          demo | production — must match what the site says it serves (meta.dataset)
//   SITE            the website, e.g. https://demo.crystalclear.guide
//   SUPABASE_URL    the public API of the same deployment's database
//   SUPABASE_KEY    its publishable key: the public key every visitor's browser already receives
//   OUT             the folder to write, e.g. snapshots/demo
//   ACCEPT_REWRITE  "true" only when a person has decided that earlier records may differ (a demo reset)
//
// It reads only what any visitor can read and writes into OUT:
//   ledger.json              the file from <SITE>/ledger/download, byte for byte as served. Replaced only
//                            when the records changed (the file's own `generated_at` is ignored for that),
//                            and only if every record of the previous copy is still there, unchanged.
//   ledger-rejected.json     the download of a day on which earlier records changed or disappeared, kept
//                            as evidence; ledger.json then stays as it was and the run fails every day
//                            until a person looks.
//   manifests/<sha256>.json  the exact text of every guide manifest a `version_published` record points to,
//                            named by its sha256 (= that record's `subject_hash`).
//   texts/<sha256>.json      the exact `canonical_text` every `content_updated` record points to, named the
//                            same way.
// Manifests and texts are only ever added, never changed or removed, so they stay here after their guide
// is withdrawn and the database stops showing them. A day with no change writes nothing.
//
// Everything is downloaded before anything is written. Exit code:
//   0  done
//   1  written, but a ledger record points to a manifest or text that is in neither the database nor here
//   2  nothing written (wrong dataset, site or API down, any unexpected error)
//   3  earlier records changed or disappeared: ledger.json kept, the new download saved as ledger-rejected.json

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

class Refused extends Error {}

async function main() {
  const { TARGET, SITE, SUPABASE_URL, SUPABASE_KEY, OUT } = process.env
  const acceptRewrite = process.env.ACCEPT_REWRITE === 'true'
  if (!['demo', 'production'].includes(TARGET)) throw new Refused('TARGET must be "demo" or "production".')
  if (!SITE || !SUPABASE_URL || !SUPABASE_KEY || !OUT) throw new Refused('SITE, SUPABASE_URL, SUPABASE_KEY and OUT are required.')
  console.log(`Target: ${TARGET} · ${SITE} · ${new URL(SUPABASE_URL).host} → ${OUT}`)

  // -------------------------------------------------------------------------------------------
  // 1. Download everything first.

  const response = await fetch(`${SITE}/ledger/download`)
  if (!response.ok) throw new Refused(`${SITE}/ledger/download answered ${response.status}.`)
  const served = Buffer.from(await response.arrayBuffer())
  let ledger
  try {
    ledger = JSON.parse(served.toString('utf8'))
  } catch {
    throw new Refused('the ledger download is not JSON.')
  }
  if (!Array.isArray(ledger.events)) throw new Refused('the ledger download has no "events" list.')
  // Keeps demo and production apart: the site states which dataset it serves. (The database side is
  // covered below: only files whose hash is in this ledger are kept.)
  if (ledger.meta?.dataset !== TARGET) throw new Refused(`the site says it serves "${ledger.meta?.dataset}", this target is "${TARGET}".`)

  async function readAll(table, column) {
    const rows = []
    const pageSize = 500
    for (let from = 0; ; from += pageSize) {
      const url = `${SUPABASE_URL}/rest/v1/${table}?select=${column}&${column}=not.is.null&order=id&limit=${pageSize}&offset=${from}`
      const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } })
      if (!r.ok) throw new Refused(`reading ${table} answered ${r.status}: ${await r.text()}`)
      const page = await r.json()
      rows.push(...page.map((row) => row[column]))
      if (page.length < pageSize) return rows
    }
  }
  const manifests = await readAll('guide_versions', 'manifest')
  const texts = await readAll('content_revisions', 'canonical_text')

  // -------------------------------------------------------------------------------------------
  // 2. The ledger: replaced only if every earlier record is still there, unchanged.

  mkdirSync(OUT, { recursive: true })
  const ledgerPath = join(OUT, 'ledger.json')
  const rejectedPath = join(OUT, 'ledger-rejected.json')
  const previous = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null
  // Same content = same file apart from the moment it was generated.
  const comparable = (data) => JSON.stringify({ ...data, meta: { ...data.meta, generated_at: null } })

  const now = new Map(ledger.events.map((e) => [e.chain_seq, e.hash]))
  const changed = (previous?.events ?? []).filter((e) => now.get(e.chain_seq) !== e.hash)
  let historyChanged = false

  if (changed.length && !acceptRewrite) {
    historyChanged = true
    console.log(`Ledger: PROBLEM — ${changed.length} earlier record(s) changed or disappeared since the last snapshot:`)
    for (const e of changed.slice(0, 10)) {
      console.log(`  chain_seq ${e.chain_seq}: was ${e.hash}, now ${now.has(e.chain_seq) ? now.get(e.chain_seq) : 'missing'}`)
    }
    console.log('  ledger.json is kept as it was; today\'s download is saved as ledger-rejected.json.')
    console.log('  If this is a deliberate reset of the demo database, run the workflow by hand with "accept_rewrite".')
    const sameAsRejected = existsSync(rejectedPath) && comparable(JSON.parse(readFileSync(rejectedPath, 'utf8'))) === comparable(ledger)
    if (!sameAsRejected) writeFileSync(rejectedPath, served)
  } else {
    if (changed.length) console.log(`Ledger: ${changed.length} earlier record(s) differ — accepted by hand (accept_rewrite).`)
    if (previous && comparable(previous) === comparable(ledger)) {
      console.log(`Ledger: unchanged (${ledger.events.length} records)`)
    } else {
      writeFileSync(ledgerPath, served)
      console.log(`Ledger: ${previous ? 'updated' : 'first copy'} — ${ledger.events.length} records (was ${previous?.events?.length ?? 0})`)
    }
    rmSync(rejectedPath, { force: true })
  }

  // -------------------------------------------------------------------------------------------
  // 3. Manifests and texts the ledger points to. A file whose hash is not in the ledger is not kept:
  //    it is either newer than the download (kept tomorrow) or from another database.

  const subjects = ledger.events.filter((e) => e.kind === 'version_published' || e.kind === 'content_updated')
  const wanted = new Set(subjects.map((e) => e.subject_hash))

  function archive(folder, list) {
    const dir = join(OUT, folder)
    mkdirSync(dir, { recursive: true })
    let added = 0
    let other = 0
    for (const text of list) {
      const hash = sha256(text)
      if (!wanted.has(hash)) {
        other++
        continue
      }
      const file = join(dir, `${hash}.json`)
      if (existsSync(file)) continue
      writeFileSync(file, text, 'utf8')
      added++
    }
    console.log(`${folder}: ${list.length} readable now, ${added} new${other ? `, ${other} not in this ledger (not kept)` : ''}`)
  }
  archive('manifests', manifests)
  archive('texts', texts)

  // -------------------------------------------------------------------------------------------
  // 4. Every author record must point to a file kept here (today's or an earlier day's).

  const kept = (hash) => existsSync(join(OUT, 'manifests', `${hash}.json`)) || existsSync(join(OUT, 'texts', `${hash}.json`))
  const missing = subjects.filter((e) => !kept(e.subject_hash))
  console.log(`Ledger records with a manifest or text: ${subjects.length}, file kept for ${subjects.length - missing.length}`)
  for (const e of missing.slice(0, 10)) console.log(`  missing: chain_seq ${e.chain_seq} ${e.kind} ${e.subject_hash}`)

  if (historyChanged) return 3
  return missing.length ? 1 : 0
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(`Snapshot not written: ${error instanceof Refused ? error.message : error.stack ?? error}`)
    process.exit(2)
  }
)
