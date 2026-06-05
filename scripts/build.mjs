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
 * profileStatus / updatedAt inside profiles are passed through untouched — the
 * per-preset "update available" check still relies on updatedAt.
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

// ── profiles (profiles/<provider>/<key>.json) ───────────────────────────────
const profilesDir = join(ROOT, 'profiles')
const profiles = {}
const profileHashes = {}
const profileIndex = []
for (const provider of readdirSync(profilesDir).filter((d) => statSync(join(profilesDir, d)).isDirectory()).sort()) {
    const providerDir = join(profilesDir, provider)
    for (const file of readdirSync(providerDir).filter((f) => f.endsWith('.json')).sort()) {
        const data = readJson(join(providerDir, file))
        if (!data || typeof data.id !== 'string') throw new Error(`profiles/${provider}/${file}: missing id`)
        const hash = hashOf(data)
        profiles[data.id] = data
        profileHashes[data.id] = hash
        profileIndex.push({ id: data.id, url: `profiles/${provider}/${file}`, hash })
    }
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
