#!/usr/bin/env node
/**
 * Validates the pocketrisu-model-registry v4 layout.
 *
 * Checks (matches Risu-workspace plan-v4 §15-2):
 *   1. index.json mirrors every base-providers/*.json and profiles/<base>/<key>.json
 *   2. Every ModelProfile.providerBaseId points to a real BaseProvider
 *   3. requestSchema[].key (BaseProvider) and schema[].key (Profile) are unique
 *   4. uiSchema.fields[].key references an existing schema field
 *   5. uiSchema.fields[].visibility is basic | advanced | hidden
 *   6. uiSchema.fields[].widget is in the v4 allowed widget set
 *   7. fieldSchema.mapsTo.target is body | header | query | auth | custom
 *   8. sourceUrls is a non-empty array
 *   9. profileTier === 'standard' (MVP)
 *
 * Zero deps. Run with `node scripts/validate.mjs` from the repo root.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')

const ALLOWED_ADAPTER_KIND = new Set(['openai-compatible', 'anthropic-messages', 'google-gemini'])
const ALLOWED_AUTH_KIND = new Set(['none', 'bearer', 'x-api-key', 'x-goog-api-key', 'query', 'google-service-account'])
const ALLOWED_ENDPOINT_KIND = new Set(['static', 'vertex-openai'])
const ALLOWED_FIELD_TYPE = new Set(['string', 'number', 'integer', 'boolean', 'json', 'stringArray', 'keyValue'])
const ALLOWED_WIDGET = new Set([
    'text',
    'secret',
    'textarea',
    'number-input',
    'slider',
    'select',
    'segmented',
    'toggle',
    'combobox',
    'string-array',
    'json',
    'key-value',
])
const ALLOWED_VISIBILITY = new Set(['basic', 'advanced', 'hidden'])
const ALLOWED_MAPS_TO_TARGET = new Set(['body', 'header', 'query', 'auth', 'custom'])
const ALLOWED_CAPABILITY = new Set(['streaming', 'vision', 'tools', 'json', 'reasoning'])
const ALLOWED_PROFILE_TIER = new Set(['standard'])
const ALLOWED_PROFILE_VISIBILITY = new Set(['popular', 'standard', 'advanced', 'legacy'])
const ALLOWED_LIFECYCLE = new Set(['recommended', 'current', 'legacy', 'deprecated', 'experimental'])
const ALLOWED_TOKENIZER = new Set(['tik', 'mistral', 'novelai', 'claude', 'llama', 'llama3', 'novellist', 'gemma', 'cohere', 'deepseek'])

const errors = []

function fail(file, message) {
    errors.push(`${relative(ROOT, file)}: ${message}`)
}

function readJson(file) {
    try {
        return JSON.parse(readFileSync(file, 'utf8'))
    } catch (err) {
        fail(file, `failed to parse JSON: ${err.message}`)
        return null
    }
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function walkJsonFiles(dir) {
    const entries = []
    if (!exists(dir)) return entries
    for (const name of readdirSync(dir)) {
        const full = join(dir, name)
        const st = statSync(full)
        if (st.isDirectory()) {
            entries.push(...walkJsonFiles(full))
        } else if (st.isFile() && name.endsWith('.json')) {
            entries.push(full)
        }
    }
    return entries
}

function exists(path) {
    try {
        statSync(path)
        return true
    } catch {
        return false
    }
}

function validateFieldSchema(file, field, path) {
    if (!isPlainObject(field)) {
        fail(file, `${path}: must be object`)
        return
    }
    if (typeof field.key !== 'string' || field.key.length === 0) fail(file, `${path}.key: must be non-empty string`)
    if (!ALLOWED_FIELD_TYPE.has(field.type)) fail(file, `${path}.type: invalid (${field.type})`)
    if (typeof field.label !== 'string' || field.label.length === 0) fail(file, `${path}.label: must be non-empty string`)
    validateI18nStringMap(file, field.descriptionI18n, `${path}.descriptionI18n`)
    if (field.mapsTo !== undefined) {
        if (!isPlainObject(field.mapsTo)) {
            fail(file, `${path}.mapsTo: must be object`)
        } else {
            if (!ALLOWED_MAPS_TO_TARGET.has(field.mapsTo.target)) {
                fail(file, `${path}.mapsTo.target: invalid (${field.mapsTo.target})`)
            }
            if (typeof field.mapsTo.path !== 'string' || field.mapsTo.path.length === 0) {
                fail(file, `${path}.mapsTo.path: must be non-empty string`)
            }
        }
    }
}

function validateUiSchema(file, ui, fieldKeys, path) {
    if (!isPlainObject(ui)) {
        fail(file, `${path}: must be object`)
        return
    }
    if (!Array.isArray(ui.groups)) fail(file, `${path}.groups: must be array`)
    if (!Array.isArray(ui.fields)) fail(file, `${path}.fields: must be array`)
    if (Array.isArray(ui.groups)) {
        for (let i = 0; i < ui.groups.length; i++) {
            const g = ui.groups[i]
            if (isPlainObject(g)) {
                validateI18nStringMap(file, g.labelI18n, `${path}.groups[${i}].labelI18n`)
            }
        }
    }
    if (!Array.isArray(ui.fields)) return

    for (let i = 0; i < ui.fields.length; i++) {
        const f = ui.fields[i]
        const fp = `${path}.fields[${i}]`
        if (!isPlainObject(f)) {
            fail(file, `${fp}: must be object`)
            continue
        }
        if (typeof f.key !== 'string') fail(file, `${fp}.key: must be string`)
        if (!ALLOWED_WIDGET.has(f.widget)) fail(file, `${fp}.widget: invalid (${f.widget})`)
        if (!ALLOWED_VISIBILITY.has(f.visibility)) fail(file, `${fp}.visibility: invalid (${f.visibility})`)
        if (fieldKeys && f.key && !fieldKeys.has(f.key)) {
            fail(file, `${fp}.key: references unknown schema field "${f.key}"`)
        }
    }
}

function validateCapabilities(file, caps, path) {
    if (caps === undefined) return
    if (!Array.isArray(caps)) {
        fail(file, `${path}: must be array`)
        return
    }
    for (const c of caps) {
        if (!ALLOWED_CAPABILITY.has(c)) fail(file, `${path}: invalid capability "${c}"`)
    }
}

function validateLimits(file, limits, path) {
    if (limits === undefined) return
    if (!isPlainObject(limits)) {
        fail(file, `${path}: must be object`)
        return
    }
    if (limits.known !== undefined && typeof limits.known !== 'boolean') {
        fail(file, `${path}.known: must be boolean`)
    }
    for (const key of ['contextWindowTokens', 'maxOutputTokens']) {
        if (limits[key] !== undefined && (!Number.isInteger(limits[key]) || limits[key] < 1)) {
            fail(file, `${path}.${key}: must be integer >= 1`)
        }
    }
    if (limits.sourceUrls !== undefined) {
        if (!Array.isArray(limits.sourceUrls)) {
            fail(file, `${path}.sourceUrls: must be array`)
        } else {
            for (const u of limits.sourceUrls) {
                if (typeof u !== 'string' || u.length === 0) fail(file, `${path}.sourceUrls: contains non-string entry`)
            }
        }
    }
    if (limits.notes !== undefined && typeof limits.notes !== 'string') {
        fail(file, `${path}.notes: must be string`)
    }
    validateI18nStringMap(file, limits.notesI18n, `${path}.notesI18n`)
}

function validateSourceUrls(file, urls) {
    if (!Array.isArray(urls) || urls.length === 0) {
        fail(file, `sourceUrls: must be non-empty array`)
    } else {
        for (const u of urls) {
            if (typeof u !== 'string' || u.length === 0) fail(file, `sourceUrls: contains non-string entry`)
        }
    }
}

function validateI18nStringMap(file, value, path) {
    if (value === undefined) return
    if (!isPlainObject(value)) {
        fail(file, `${path}: must be object`)
        return
    }
    for (const [locale, label] of Object.entries(value)) {
        if (typeof locale !== 'string' || locale.length === 0) {
            fail(file, `${path}: locale keys must be non-empty strings`)
        }
        if (typeof label !== 'string' || label.length === 0) {
            fail(file, `${path}.${locale}: must be non-empty string`)
        }
    }
}

function validateProfileMetadata(file, data) {
    validateI18nStringMap(file, data.displayNameI18n, 'displayNameI18n')
    validateI18nStringMap(file, data.descriptionI18n, 'descriptionI18n')
    if (data.visibility !== undefined && !ALLOWED_PROFILE_VISIBILITY.has(data.visibility)) {
        fail(file, `visibility: invalid (${data.visibility})`)
    }
    if (data.lifecycle !== undefined && !ALLOWED_LIFECYCLE.has(data.lifecycle)) {
        fail(file, `lifecycle: invalid (${data.lifecycle})`)
    }
    if (data.tags !== undefined) {
        if (!Array.isArray(data.tags)) {
            fail(file, 'tags: must be array')
        } else {
            for (const tag of data.tags) {
                if (typeof tag !== 'string' || tag.length === 0) fail(file, 'tags: entries must be non-empty strings')
            }
        }
    }
    if (data.sortOrder !== undefined && (!Number.isInteger(data.sortOrder))) {
        fail(file, 'sortOrder: must be integer')
    }
    if (data.recommendedTokenizer !== undefined && !ALLOWED_TOKENIZER.has(data.recommendedTokenizer)) {
        fail(file, `recommendedTokenizer: invalid (${data.recommendedTokenizer})`)
    }
}

function validateBaseProvider(file, baseProviderMap) {
    const data = readJson(file)
    if (!data) return
    if (typeof data.id !== 'string') fail(file, 'id: must be string')
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
        fail(file, 'version: must be integer >= 1')
    }
    if (typeof data.displayName !== 'string' || data.displayName.length === 0) {
        fail(file, 'displayName: must be non-empty string')
    }
    if (!ALLOWED_ADAPTER_KIND.has(data.adapterKind)) fail(file, `adapterKind: invalid (${data.adapterKind})`)

    if (!Array.isArray(data.authKinds) || data.authKinds.length === 0) {
        fail(file, 'authKinds: must be non-empty array')
    } else {
        for (const k of data.authKinds) {
            if (!ALLOWED_AUTH_KIND.has(k)) fail(file, `authKinds: invalid auth kind "${k}"`)
        }
    }

    if (!Array.isArray(data.endpointKinds) || data.endpointKinds.length === 0) {
        fail(file, 'endpointKinds: must be non-empty array')
    } else {
        for (const k of data.endpointKinds) {
            if (!ALLOWED_ENDPOINT_KIND.has(k)) fail(file, `endpointKinds: invalid endpoint kind "${k}"`)
        }
    }

    const requestKeys = new Set()
    if (!Array.isArray(data.requestSchema)) {
        fail(file, 'requestSchema: must be array')
    } else {
        for (let i = 0; i < data.requestSchema.length; i++) {
            const field = data.requestSchema[i]
            validateFieldSchema(file, field, `requestSchema[${i}]`)
            if (field && field.key) {
                if (requestKeys.has(field.key)) fail(file, `requestSchema: duplicate key "${field.key}"`)
                requestKeys.add(field.key)
            }
        }
        validateUiSchema(file, data.uiSchema, requestKeys, 'uiSchema')
    }

    validateCapabilities(file, data.capabilities, 'capabilities')
    validateLimits(file, data.limits, 'limits')
    validateSourceUrls(file, data.sourceUrls)

    if (typeof data.id === 'string') baseProviderMap.set(data.id, data)
    return data
}

function validateProfile(file, baseProviderMap) {
    const data = readJson(file)
    if (!data) return
    if (typeof data.id !== 'string' || !/^[a-z][a-z0-9-]*:[a-z][a-z0-9-]*$/.test(data.id)) {
        fail(file, `id: must match <baseId>:<profileKey> (got "${data.id}")`)
    }
    if (typeof data.version !== 'number' || !Number.isInteger(data.version) || data.version < 1) {
        fail(file, 'version: must be integer >= 1')
    }
    if (typeof data.displayName !== 'string' || data.displayName.length === 0) {
        fail(file, 'displayName: must be non-empty string')
    }
    validateProfileMetadata(file, data)

    const base = typeof data.providerBaseId === 'string' ? baseProviderMap.get(data.providerBaseId) : undefined
    if (!base) {
        fail(file, `providerBaseId: unknown base provider "${data.providerBaseId}"`)
    }

    if (!ALLOWED_PROFILE_TIER.has(data.profileTier)) {
        fail(file, `profileTier: must be one of [${[...ALLOWED_PROFILE_TIER].join(', ')}] (got "${data.profileTier}")`)
    }
    if (typeof data.modelId !== 'string') fail(file, 'modelId: must be string')

    if (!isPlainObject(data.endpoint)) {
        fail(file, 'endpoint: must be object')
    } else if (!ALLOWED_ENDPOINT_KIND.has(data.endpoint.kind)) {
        fail(file, `endpoint.kind: invalid (${data.endpoint.kind})`)
    } else if (base && Array.isArray(base.endpointKinds) && !base.endpointKinds.includes(data.endpoint.kind)) {
        fail(file, `endpoint.kind: "${data.endpoint.kind}" not declared in base provider "${base.id}".endpointKinds`)
    }

    if (!isPlainObject(data.auth)) {
        fail(file, 'auth: must be object')
    } else if (!ALLOWED_AUTH_KIND.has(data.auth.kind)) {
        fail(file, `auth.kind: invalid (${data.auth.kind})`)
    } else if (base && Array.isArray(base.authKinds) && !base.authKinds.includes(data.auth.kind)) {
        fail(file, `auth.kind: "${data.auth.kind}" not declared in base provider "${base.id}".authKinds`)
    }

    if (!isPlainObject(data.defaults)) fail(file, 'defaults: must be object')

    const profileKeys = new Set()
    if (!Array.isArray(data.schema)) {
        fail(file, 'schema: must be array')
    } else {
        for (let i = 0; i < data.schema.length; i++) {
            const field = data.schema[i]
            validateFieldSchema(file, field, `schema[${i}]`)
            if (field && field.key) {
                if (profileKeys.has(field.key)) fail(file, `schema: duplicate key "${field.key}"`)
                profileKeys.add(field.key)
            }
        }
    }

    const mergedKeys = new Set(profileKeys)
    if (base && Array.isArray(base.requestSchema)) {
        for (const field of base.requestSchema) {
            if (field && typeof field.key === 'string') mergedKeys.add(field.key)
        }
    }
    validateUiSchema(file, data.uiSchema, mergedKeys, 'uiSchema')

    validateCapabilities(file, data.capabilities, 'capabilities')
    validateLimits(file, data.limits, 'limits')
    validateSourceUrls(file, data.sourceUrls)

    return data
}

function expectedPathForBase(id) {
    return `base-providers/${id}.json`
}

function expectedPathForProfile(profileId) {
    const [baseId, profileKey] = profileId.split(':')
    return `profiles/${baseId}/${profileKey}.json`
}

function main() {
    const baseFiles = walkJsonFiles(join(ROOT, 'base-providers'))
    const profileFiles = walkJsonFiles(join(ROOT, 'profiles'))

    const baseProviderMap = new Map()
    const baseProviders = []
    for (const file of baseFiles) {
        const data = validateBaseProvider(file, baseProviderMap)
        if (data) baseProviders.push({ file, data })
    }

    const profiles = []
    for (const file of profileFiles) {
        const data = validateProfile(file, baseProviderMap)
        if (data) profiles.push({ file, data })
    }

    // index.json mirror check.
    const indexPath = join(ROOT, 'index.json')
    if (!exists(indexPath)) {
        fail(indexPath, 'missing index.json')
    } else {
        const index = readJson(indexPath)
        if (index) {
            if (index.schemaVersion !== 4) fail(indexPath, `schemaVersion: must be 4 (got ${index.schemaVersion})`)
            if (!Array.isArray(index.baseProviders)) fail(indexPath, 'baseProviders: must be array')
            if (!Array.isArray(index.profiles)) fail(indexPath, 'profiles: must be array')

            if (Array.isArray(index.baseProviders)) {
                const declared = new Set(index.baseProviders.map((b) => b && b.id))
                for (const { data } of baseProviders) {
                    if (!declared.has(data.id)) fail(indexPath, `missing baseProvider entry for "${data.id}"`)
                }
                for (const entry of index.baseProviders) {
                    if (!entry || typeof entry.id !== 'string') {
                        fail(indexPath, 'baseProviders[].id required')
                        continue
                    }
                    if (entry.url !== expectedPathForBase(entry.id)) {
                        fail(indexPath, `baseProviders["${entry.id}"].url: expected ${expectedPathForBase(entry.id)}, got ${entry.url}`)
                    }
                    if (!baseProviderMap.has(entry.id)) {
                        fail(indexPath, `baseProviders["${entry.id}"]: no matching base-providers/${entry.id}.json`)
                    }
                }
            }

            if (Array.isArray(index.profiles)) {
                const declared = new Set(index.profiles.map((p) => p && p.id))
                for (const { data } of profiles) {
                    if (!declared.has(data.id)) fail(indexPath, `missing profile entry for "${data.id}"`)
                }
                for (const entry of index.profiles) {
                    if (!entry || typeof entry.id !== 'string') {
                        fail(indexPath, 'profiles[].id required')
                        continue
                    }
                    if (entry.url !== expectedPathForProfile(entry.id)) {
                        fail(indexPath, `profiles["${entry.id}"].url: expected ${expectedPathForProfile(entry.id)}, got ${entry.url}`)
                    }
                }
            }
        }
    }

    if (errors.length > 0) {
        console.error(`Registry validation failed (${errors.length} error${errors.length === 1 ? '' : 's'}):`)
        for (const e of errors) console.error(`  - ${e}`)
        process.exit(1)
    }

    console.log(
        `Registry OK — ${baseProviders.length} base provider${baseProviders.length === 1 ? '' : 's'}, ` +
            `${profiles.length} profile${profiles.length === 1 ? '' : 's'}.`,
    )
}

main()
