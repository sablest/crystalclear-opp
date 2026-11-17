#!/usr/bin/env node
// Daily snapshot of the public Crystal Clear ledger. No dependencies; needs Node 18 or newer.
//
//   node tools/snapshot.mjs
//
// Settings come from the environment (the workflow .github/workflows/snapshot.yml sets them):
//   TARGET        demo | production — must match what the site says it serves (meta.dataset)
//   SITE          the website, e.g. https://demo.crystalclear.guide
//   SUPABASE_URL  the public API of the same deployment's database
//   SUPABASE_KEY  its publishable key: the public key every visitor's browser already receives
//   OUT           the folder to write, e.g. snapshots/demo
//
// It reads only what any visitor can read and writes three things into OUT:
//   ledger.json            the file from <SITE>/ledger/download, byte for byte as served. Rewritten only
//                          when the records changed (the file's own `generated_at` is ignored for that).
//   manifests/<sha256>.json  the exact text of every published guide manifest, named by its sha256 —
//                          the `subject_hash` of its `version_published` record.
//   texts/<sha256>.json    the exact `canonical_text` of every content revision, named by its sha256 —
//                          the `subject_hash` of its `content_updated` record.
// Files are only ever added, never changed or removed, so a manifest or text stays here after its guide
// is withdrawn and the database stops showing it. A day with no change writes nothing.
//
// Exit code: 0 = done; 1 = written, but a ledger record points to a manifest or text that is in neither
// the database nor this folder (worth a look); 2 = nothing written (wrong dataset, site or API down).

import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

function fail(message) {
  console.error(`Snapshot not written: ${message}`)
  process.exit(2)
}

const { TARGET, SITE, SUPABASE_URL, SUPABASE_KEY, OUT } = process.env
if (!['demo', 'production'].includes(TARGET)) fail('TARGET must be "demo" or "production".')
if (!SITE || !SUPABASE_URL || !SUPABASE_KEY || !OUT) fail('SITE, SUPABASE_URL, SUPABASE_KEY and OUT are required.')
console.log(`Target: ${TARGET} · ${SITE} · ${new URL(SUPABASE_URL).host} → ${OUT}`)

// ---------------------------------------------------------------------------------------------
// 1. The ledger, as the site serves it.

const response = await fetch(`${SITE}/ledger/download`)
if (!response.ok) fail(`${SITE}/ledger/download answered ${response.status}.`)
const served = Buffer.from(await response.arrayBuffer())
let ledger
try {
  ledger = JSON.parse(served.toString('utf8'))
} catch {
  fail('the ledger download is not JSON.')
}
if (!Array.isArray(ledger.events)) fail('the ledger download has no "events" list.')
// The guard that keeps demo and production apart: the site states which dataset it serves.
if (ledger.meta?.dataset !== TARGET) fail(`the site says it serves "${ledger.meta?.dataset}", this target is "${TARGET}".`)

// Same content = same file apart from the moment it was generated.
const comparable = (data) => JSON.stringify({ ...data, meta: { ...data.meta, generated_at: null } })
const ledgerPath = join(OUT, 'ledger.json')
mkdirSync(OUT, { recursive: true })
const previous = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : null
if (previous && comparable(previous) === comparable(ledger)) {
  console.log(`Ledger: unchanged (${ledger.events.length} records)`)
} else {
  writeFileSync(ledgerPath, served)
  console.log(`Ledger: ${previous ? 'updated' : 'first copy'} — ${ledger.events.length} records (was ${previous?.events?.length ?? 0})`)
}

// ---------------------------------------------------------------------------------------------
// 2. Manifests and texts, through the public API (row-level security shows published guides only).

async function readAll(table, column) {
  const rows = []
  const pageSize = 500
  for (let from = 0; ; from += pageSize) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${column}&${column}=not.is.null&order=id&limit=${pageSize}&offset=${from}`
    const r = await fetch(url, { headers: { apikey: SUPABASE_KEY } })
    if (!r.ok) fail(`reading ${table} answered ${r.status}: ${await r.text()}`)
    const page = await r.json()
    rows.push(...page.map((row) => row[column]))
    if (page.length < pageSize) return rows
  }
}

function archive(folder, texts) {
  const dir = join(OUT, folder)
  mkdirSync(dir, { recursive: true })
  let added = 0
  for (const text of texts) {
    const file = join(dir, `${sha256(text)}.json`)
    if (existsSync(file)) continue
    writeFileSync(file, text, 'utf8')
    added++
  }
  console.log(`${folder}: ${texts.length} readable now, ${added} new`)
}

archive('manifests', await readAll('guide_versions', 'manifest'))
archive('texts', await readAll('content_revisions', 'canonical_text'))

// ---------------------------------------------------------------------------------------------
// 3. Every author record must point to a file kept here (today's or an earlier day's).

const kept = (hash) => existsSync(join(OUT, 'manifests', `${hash}.json`)) || existsSync(join(OUT, 'texts', `${hash}.json`))
const subjects = ledger.events.filter((e) => e.kind === 'version_published' || e.kind === 'content_updated')
const missing = subjects.filter((e) => !kept(e.subject_hash))
console.log(`Ledger records with a manifest or text: ${subjects.length}, file kept for ${subjects.length - missing.length}`)
if (missing.length) {
  for (const e of missing.slice(0, 10)) console.log(`  missing: chain_seq ${e.chain_seq} ${e.kind} ${e.subject_hash}`)
  process.exit(1)
}
