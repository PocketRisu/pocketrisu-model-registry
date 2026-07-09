#!/usr/bin/env node
/**
 * Builds the published registry artifacts from the per-file sources.
 *
 *   profiles/<provider>/<key>.json  +  base-providers/*.json   (source of truth)
 *        │  node scripts/build.mjs
 *        ▼
 *   index.json    — tiny gate + manifest: { schemaVersion, hash, baseProviders[], profiles[] }
 *   catalog.json  — combined: all base providers + profiles inline, plus hash maps
 *
 * The gate is a CONTENT HASH (no updatedAt/version bump): the client re-downloads
 * the catalog only when index.hash differs from what it cached. Hashing is
 * deterministic — object keys are sorted recursively, array order is preserved —
 * so two runs over the same content produce the same hash. Per-item hashes live
 * in SEPARATE maps (not inside the profile objects) to avoid a self-reference.
 *
 * Per-file profiles stay published for forward use (differential download).
 * profileStatus is passed through untouched. updatedAt is passed through too,
 * EXCEPT when a base provider's content hash changes vs the last build: then
 * every profile inheriting that base gets updatedAt bumped to now, so the
 * per-preset "update available" badge (which reads profile updatedAt, not the
 * base) fires for base-only edits. See the base-change detection below.
 *
 * Zero deps. Run with `node scripts/build.mjs` from the repo root.
 */

import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Canonical form: recursively sort object keys; preserve array order. Used so
// the serialization (and thus the hash) is stable regardless of key order.
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical)
    if (value && typeof value === 'object') {
        const out = {}
        for (const key of Object.keys(value).sort()) out[key] = canonical(value[key])
        return out
    }
    return value
}

function hashOf(value) {
    return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex')
}

function readJson(file) {
    return JSON.parse(readFileSync(file, 'utf8'))
}

// ── base providers ────────────────────────────────────────────────────────
const baseDir = join(ROOT, 'base-providers')
const baseProviders = {}
const baseProviderHashes = {}
const baseIndex = []
for (const file of readdirSync(baseDir).filter((f) => f.endsWith('.json')).sort()) {
    const data = readJson(join(baseDir, file))
    if (!data || typeof data.id !== 'string') throw new Error(`base-providers/${file}: missing id`)
    const hash = hashOf(data)
    baseProviders[data.id] = data
    baseProviderHashes[data.id] = hash
    baseIndex.push({ id: data.id, url: `base-providers/${file}`, hash })
}

// ── base-provider change detection (updatedAt propagation) ──────────────────
// Base providers carry no `updatedAt`, but the per-preset "update available"
// badge in PocketRisu reads each *profile's* `updatedAt`. So when a base
// provider's content changes, every profile that inherits it renders different
// settings yet would go un-nudged. Diff this build's base hashes against the
// previously published catalog; any base whose hash moved marks its inheriting
// profiles for an `updatedAt` bump below. A no-op rebuild finds no diff and
// re-stamps nothing (the prior catalog already holds the current hash).
let prevBaseHashes = {}
try {
    prevBaseHashes = readJson(join(ROOT, 'catalog.json')).baseProviderHashes ?? {}
} catch {
    /* no prior catalog (first build) — nothing to diff against */
}
const changedBases = new Set(
    Object.keys(baseProviderHashes).filter(
        (id) => prevBaseHashes[id] !== undefined && prevBaseHashes[id] !== baseProviderHashes[id],
    ),
)
const stampTime = Date.now()

// Set updatedAt, inserting it right after `version` when absent to match the
// profile-file convention (else a plain assignment lands it last).
function withBumpedUpdatedAt(obj, ts) {
    if ('updatedAt' in obj) {
        obj.updatedAt = ts
        return obj
    }
    const out = {}
    for (const [k, v] of Object.entries(obj)) {
        out[k] = v
        if (k === 'version') out.updatedAt = ts
    }
    if (!('updatedAt' in out)) out.updatedAt = ts
    return out
}

// ── profiles (profiles/<provider>/<key>.json) ───────────────────────────────
const profilesDir = join(ROOT, 'profiles')
const profiles = {}
const profileHashes = {}
const profileIndex = []
let bumpedCount = 0
for (const provider of readdirSync(profilesDir).filter((d) => statSync(join(profilesDir, d)).isDirectory()).sort()) {
    const providerDir = join(profilesDir, provider)
    for (const file of readdirSync(providerDir).filter((f) => f.endsWith('.json')).sort()) {
        let data = readJson(join(providerDir, file))
        if (!data || typeof data.id !== 'string') throw new Error(`profiles/${provider}/${file}: missing id`)
        // Propagate a changed base provider into its inheriting profiles.
        if (changedBases.has(data.providerBaseId) && data.updatedAt !== stampTime) {
            data = withBumpedUpdatedAt(data, stampTime)
            writeFileSync(join(providerDir, file), JSON.stringify(data, null, 2) + '\n')
            bumpedCount++
        }
        const hash = hashOf(data)
        profiles[data.id] = data
        profileHashes[data.id] = hash
        profileIndex.push({ id: data.id, url: `profiles/${provider}/${file}`, hash })
    }
}
if (changedBases.size > 0) {
    console.log(
        `Base change detected (${[...changedBases].join(', ')}) — ` +
            `bumped updatedAt on ${bumpedCount} inheriting profile(s).`,
    )
}

// ── top hash ────────────────────────────────────────────────────────────────
// Derived from the per-item hash maps (base + profile), so it changes iff any
// item changes. Independent of file read order (canonical sorts keys).
const topHash = hashOf({
    schemaVersion: 4,
    baseProviders: baseProviderHashes,
    profiles: profileHashes,
})

const index = {
    schemaVersion: 4,
    hash: topHash,
    baseProviders: baseIndex,
    profiles: profileIndex,
}

const catalog = {
    schemaVersion: 4,
    hash: topHash,
    baseProviders,
    profiles,
    baseProviderHashes,
    profileHashes,
}

writeFileSync(join(ROOT, 'index.json'), JSON.stringify(index, null, 2) + '\n')
writeFileSync(join(ROOT, 'catalog.json'), JSON.stringify(catalog, null, 2) + '\n')

console.log(
    `Built index.json + catalog.json — ${profileIndex.length} profiles, ` +
        `${baseIndex.length} base providers, hash ${topHash.slice(0, 12)}…`,
)
