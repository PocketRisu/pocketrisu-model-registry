# Maintenance Guide

This document lists the **source URLs we consult when refreshing the registry**, the **fetch reliability** we've observed, and the **refresh procedure** for future maintainers. Same cycle, same sources, less re-discovery.

The registry follows **schema v4** (see `schema/base-provider.schema.json` and `schema/model-profile.schema.json`). v3 single-file `providers/*.json` templates were retired in the v4 transition; their wire-level data moved into the `base-providers/<id>.json` + `profiles/<baseId>/<key>.json` split.

---

## v4 layout summary

| Folder | What it holds |
|---|---|
| `base-providers/<id>.json` | `BaseProviderDefinition` — adapter/auth/endpoint primitives, default headers/body, shared request schema and UI schema. Consumed by every profile under this base. |
| `profiles/<baseId>/<profileKey>.json` | `ModelProfile` — concrete profile a user picks (e.g. `openai:gpt-55`). Has its own endpoint, auth wiring, `modelId`, profile status, and may extend the base's `schema`/`uiSchema`. |
| `schema/base-provider.schema.json` | JSON Schema for `BaseProviderDefinition`. |
| `schema/model-profile.schema.json` | JSON Schema for `ModelProfile`. |
| `index.json` | **Generated.** Tiny gate + manifest: `{ schemaVersion, hash, baseProviders[], profiles[] }`. The client fetches this every menu entry and re-downloads `catalog.json` only when `hash` differs. |
| `catalog.json` | **Generated.** The whole registry in one file (all base providers + profiles inline, plus `baseProviderHashes`/`profileHashes` maps). The client downloads this one file on a hash change — no per-file fan-out. |
| `scripts/build.mjs` | **Generator.** Reads the per-file sources → writes `index.json` + `catalog.json`. Deterministic (canonical key-sorted hashing). Zero deps. |
| `scripts/validate.mjs` | Cross-consistency validator + stale-artifact check (recomputes hashes; fails if `build.mjs` wasn't re-run). Run before every commit. Zero deps. |

**Source of truth = the per-file `base-providers/*.json` and `profiles/<baseId>/*.json`.** `index.json` and `catalog.json` are build artifacts — never hand-edit them.

**Gate = content hash, not a version/timestamp.** `build.mjs` hashes the catalog; the client re-downloads only when the hash differs ("different ⇒ adopt the published version"). No `updatedAt`/`contentVersion` bump to remember. (Per-profile `updatedAt` inside profiles is passed through untouched — the per-preset "update available" check still uses it.)

### Maintenance flow (every change)

```
1. edit profiles/<provider>/<key>.json (or base-providers/*.json)   ← source only
2. node scripts/build.mjs       → regenerates index.json + catalog.json
3. node scripts/validate.mjs    → schema + hash-consistency (catches "forgot to rebuild")
4. git commit                   → commit sources + index.json + catalog.json together
```

Deploy order when the client fetch format changes: **registry first, client after** (per-file profiles stay published, so an older client still resolves).

PocketRisu v4 consumes this layout via a bundled snapshot inside `Risuai-NodeOnly/src/ts/preset/registry/bundled/`. Bundled copy mirrors the same `base-providers/` and `profiles/<baseId>/` paths; sync at release time.

---

## Tier 0 — Provider model-listing APIs (enumeration + live spec)

**Before parsing any doc, hit the provider's own model-listing API.** It is the deterministic answer to "which models exist right now, when did they ship, and which knobs do they accept" — facts we used to *guess* from marketing pages. This is the registry-authoring equivalent of what dynamic provider-manager plugins do at runtime: we just consult the same endpoints at maintenance time instead of in code.

Coverage varies a lot. Some APIs return a full spec; others only enumerate IDs. **OpenRouter `/api/v1/models` is the linchpin** — it is public (no key), lists ~340 models across every vendor, and returns a near-complete ModelProfile per model. Use it as the primary cross-catalog; fall back to the direct provider API for ID/lifecycle truth and to Tier 1/2 for the exact wire keys OpenRouter normalizes away.

| Provider | Endpoint | Auth | What it returns |
|---|---|---|---|
| **OpenRouter** (cross-catalog) | `GET https://openrouter.ai/api/v1/models` | **none (public)** | **Full spec** — `context_length`, `top_provider.max_completion_tokens`, `architecture.input_modalities`/`tokenizer`, `supported_parameters[]`, `default_parameters{}`, `pricing{}`, `created`, `knowledge_cutoff`, `expiration_date`, `canonical_slug` (versioned) |
| Google AI Studio | `GET https://generativelanguage.googleapis.com/v1beta/models?key=…` | query key | `displayName`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods[]` |
| AWS Bedrock | `ListFoundationModels` | SigV4 | `modelId`, `providerName`, `inputModalities[]`/`outputModalities[]`, `responseStreamingSupported` |
| OpenAI | `GET https://api.openai.com/v1/models` | Bearer key | `id`, `created`, `owned_by` — **enumeration + lifecycle only** (no limits/caps) |
| Anthropic | `GET https://api.anthropic.com/v1/models` | `x-api-key` + `anthropic-version` | `id`, `display_name`, `created_at` — **enumeration + lifecycle only** |

OpenAI and Anthropic direct APIs are thin (ID + date), but OpenRouter carries their models at **full** spec — so cross-reference OpenRouter for limits/capabilities and use the direct API only to confirm the canonical model ID and ship date.

### Quick fetch — OpenRouter cross-catalog

```sh
# Full record for one model (no key needed)
curl -s https://openrouter.ai/api/v1/models \
  | jq '.data[] | select(.id=="openai/gpt-5.5")'

# Enumerate a family, newest first, with the fields we map into a profile
curl -s https://openrouter.ai/api/v1/models | jq -r '
  .data[] | select(.id|test("anthropic/claude")) 
  | [.created, .id, .context_length, .top_provider.max_completion_tokens,
     (.supported_parameters|join(","))] | @tsv' | sort -rn
```

### `supported_parameters` / `architecture` → our schema & capabilities

OpenRouter's `supported_parameters[]` is the authoritative "which knobs does this model take" list. Map it directly when authoring a `ModelProfile`:

| OpenRouter signal | Registry effect |
|---|---|
| `reasoning` / `include_reasoning` | `capabilities += "reasoning"`; add a reasoning field (`reasoning_effort` for OpenAI, `thinking` for Anthropic — **confirm exact wire per direct provider**) |
| `verbosity` | schema field `verbosity` (OpenAI GPT-5 family) |
| `tools` / `tool_choice` | `capabilities += "tools"`; schema `parallel_tool_calls`, `tool_choice` |
| `structured_outputs` / `response_format` | `capabilities += "json"`; schema `response_format` |
| `max_tokens` | schema max-output field — **OpenAI direct uses `max_completion_tokens` for reasoning models; OpenRouter flattens to `max_tokens`. Re-confirm via Tier 1/2 before setting `mapsTo.path`.** |
| `stop` / `seed` / `temperature` / `top_p` / `top_k` / `frequency_penalty` / `presence_penalty` / `logprobs` | standard schema fields (only include the ones present) |
| `architecture.input_modalities` includes `image`/`file` | `capabilities += "vision"` |
| `architecture.tokenizer` (`Claude`, `GPT`, `Gemini`, …) | `recommendedTokenizer` (`claude`, `tik`, `gemma`, …) |
| `context_length` / `top_provider.max_completion_tokens` | `limits.contextWindowTokens` / `limits.maxOutputTokens` (`known: true`) |
| `created` / `canonical_slug` | ship date + versioned slug → selection & `modelId` |

**Caveat:** OpenRouter exposes *its own* normalized wire (e.g. `max_tokens`, abstracted `reasoning`). It is the source of truth for **enumeration, limits, modalities, tokenizer, and the *set* of valid knobs** — but the exact body key/shape a direct provider expects (`max_completion_tokens`, the Anthropic `thinking` object) must still be confirmed against that provider's Tier 1 docs / Tier 2 SDK before writing `mapsTo`.

### What Tier 0 does NOT give you → go to Tier 2 SDK

`supported_parameters` tells you a knob *exists*, never its **allowed values**. There is no enum/constraint field in the model API. So for a field like `reasoning_effort`, Tier 0 says "this model takes reasoning" — but the set `low / medium / high / xhigh` comes from elsewhere:

1. **Tier 2 — SDK type literals (authoritative).** The provider's official SDK encodes allowed values as a `Literal[…]`, generated from the same internal spec the API validates against. e.g. OpenAI Python `src/openai/types/chat/completion_create_params.py` → `reasoning_effort: Optional[Literal["minimal","low","medium","high","xhigh"]]`. When the vendor adds a value, it lands here first. **This is where every `enum` in our `schema[]` should be sourced from.**
2. **Tier 1 — vendor docs.** Describe the values in prose; lag the SDK and drift, so cross-check.
3. **Runtime probe (last resort).** Send a bogus value; the API's `400` usually lists the valid set in the error. Use only to catch a brand-new value (`xhigh` before the SDK ships it) — not for routine authoring.

The same applies to any constrained field: `verbosity` (`low/medium/high`), `service_tier`, `response_format.type`, Anthropic `thinking.type`. **Rule of thumb: Tier 0 picks *which* fields go in the schema; Tier 2 SDK literals fill in each field's `enum`.**

This split is not unique to us — the dynamic Yumi Provider Manager plugin (which fetches model *lists* live) still hardcodes the value vocabularies as curated code constants (`["low","medium","high","xhigh","max"]`, etc.) plus per-model downgrade logic (`xhigh` → `high` when unsupported). It hits the same API gap and fills it by hand from the SDK. Our `schema[].enum` is the declarative equivalent — same source (Tier 2 SDK), stored as data per profile instead of as code branches.

### Selection rule (semi-automatic — replaces heuristic picking)

The "which profiles ship as `current`" decision used to be eyeballed. Ground it in Tier 0 instead, but keep the final call human:

1. **Enumerate** the family via the direct provider `/models` (+ OpenRouter for spec).
2. **Sort by `created` descending** — newest variants surface first; nothing is "current" by vibe.
3. **Propose candidates** with their Tier 0 specs (limits, supported params, modalities).
4. **Maintainer confirms** `profileStatus` per candidate (`current` / `outdated` / exclude). Judgment is retained — but it now starts from an API-verified list, not a doc-parsing guess. Record the cutoff in the audit-history row.

### Verified live-enumeration recipes (2026-06-05 refresh)

These are the exact "source of truth" calls used to author the OpenAI / Google / Anthropic profiles. **No source-of-truth fact was taken from a marketing/doc page that renders via JS** — the doc HTML carries model *codes* but not the spec numbers (token limits load client-side), so scraping them yields nothing. Hit the APIs.

The division of labour that held for every provider:

- **native model ID + lifecycle** ← the provider's own `/models` endpoint (authoritative; nothing else gets the exact ID string or the deprecation state right).
- **limits / modalities / `created` / `supported_parameters`** ← OpenRouter cross-catalog (`/api/v1/models`, public, full spec). It also *corrects registry drift* — this pass it fixed `gemini-2.5` output `65535 → 65536`, `claude-haiku-4.5` context `1,000,000 → 200,000`, `claude-sonnet-4.6` output `64,000 → 128,000`.
- **constrained-field value vocabulary** (enum sets) ← the vendor SDK type literals (Tier 2). The `/models` APIs say a knob *exists* (`thinking: true`, `supported_parameters` includes `reasoning`) but never its allowed values.

| Provider | Enumerate (native ID + lifecycle) | Auth | What it returns | Notes |
|---|---|---|---|---|
| **OpenRouter** | `curl -s https://openrouter.ai/api/v1/models` | **none** | full spec per model | IDs are OR slugs (dotted, `anthropic/claude-opus-4.8`) — **not** a provider native ID. Cross-catalog only. |
| **OpenAI** | `GET https://api.openai.com/v1/models` (needs Bearer) → we instead used OpenRouter `openai/gpt-5*` enum | Bearer / (OR none) | id, created | mini/nano ship only on *platform* releases (gpt-5, gpt-5.4), never the `.1/.2/.5` bumps. `*-pro`/`o3-pro` are Responses-API-only → excluded from the chat-completions adapter. reasoning_effort/verbosity enums from SDK `shared/reasoning_effort.py`. |
| **Google AI Studio** | `curl "https://generativelanguage.googleapis.com/v1beta/models?key=KEY&pageSize=1000"` | API key | name (native ID), inputTokenLimit, outputTokenLimit, supportedGenerationMethods[], temperature/maxTemperature/topP/topK, **`thinking` bool** | **This is the spec source** — limits live here, not in the docs. Gemma is Google-native (`gemma-4-*-it`, `generateContent`, `thinking:true`). Thinking knob differs by gen: `thinkingLevel`(3.x + gemma) vs `thinkingBudget`(2.5). |
| **Anthropic** | `curl https://api.anthropic.com/v1/models -H "x-api-key: KEY" -H "anthropic-version: 2023-06-01"` | x-api-key | **id, display_name, created_at only** (no limits) | Pair with OpenRouter for limits, SDK for thinking shapes. ID scheme is irregular: newest = bare alias (`claude-opus-4-8`), older = dated snapshot (`claude-opus-4-5-20251101`) — use the string the API returns. effort → `output_config.effort` (`low/medium/high/max`); SDK `thinking_config_{enabled,adaptive,disabled}_param.py`. |

**Keys are single-use, read-only, never stored.** A user-supplied Google/Anthropic key is used for one `/models` GET and then discarded (not written to any file, commit, or memory); advise the user to rotate it afterward.

---

## Per-provider source URLs

These Tier 1–3 sources back-fill what Tier 0 can't give (exact wire keys, request/response shape, feature flags). For each provider we keep three layers. **Tier 1 (vendor docs)** is the ground truth when reachable. **Tier 2 (raw GitHub SDK)** is the most reliable fetch target since `raw.githubusercontent.com` doesn't gate. **Tier 3 (third-party plugins / upstream RisuAI)** is a sanity check against real, in-the-wild traffic.

Markers: ✅ fetch tends to work · ⚠️ partial / sometimes blocked · ❌ blocked by Cloudflare/Fern/auth wall during the v1 audit (re-try with a different path).

### OpenAI
- **Tier 1 — Vendor docs:** ❌ `https://platform.openai.com/docs/api-reference/chat` (returns 403 to plain fetchers)
- **Tier 2 — Raw SDK:**
  - ✅ `https://raw.githubusercontent.com/openai/openai-python/main/src/openai/types/chat/completion_create_params.py` — current request schema
  - ✅ `https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml` — official OpenAPI spec (large, grep)
  - ✅ `https://raw.githubusercontent.com/openai/openai-cookbook/main/examples/` — `Reasoning_*` notebooks for reasoning_effort/verbosity
- **Tier 3 — Cross-check:** `developers.openai.com/api/docs/guides/{reasoning,priority-processing,prompt-caching}` (via search index)

### Anthropic
- **Tier 1 — Vendor docs:** ✅ `https://platform.claude.com/docs/en/api/messages` (was `docs.anthropic.com`, now redirects)
  - `.../build-with-claude/extended-thinking` — thinking object shape
  - `.../build-with-claude/prompt-caching` — `extended-cache-ttl-*` beta header
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/types/message_create_params.py`
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/model/providers/anthropic.ts`

### Google AI Studio (Gemini)
- **Tier 1 — Vendor docs:** ⚠️ `https://ai.google.dev/api/generate-content` (works) · `https://ai.google.dev/gemini-2/docs/thinking` (was 404 during v1 audit)
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/googleapis/python-genai/main/google/genai/types.py`
  - ✅ `https://raw.githubusercontent.com/google-gemini/cookbook/main/quickstarts/Get_started_thinking.ipynb`
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/process/request/google.ts`

### DeepSeek
- **Tier 1 — Vendor docs:** ✅ `https://api-docs.deepseek.com/api/create-chat-completion` · `/guides/thinking_mode` · `/guides/reasoning_model`
- **Tier 2 — Raw SDK:** there isn't a first-party SDK we found — fall back to upstream code
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/model/modellist.ts` (DeepSeek entries — confirmed `/beta/chat/completions` for all models incl. V4)

### OpenRouter
- **Tier 1 — Vendor docs:** ❌ `https://openrouter.ai/docs/*` (everything 303-redirects into Fern hosting which then 404s for plain fetchers)
- **Tier 2 — Raw SDK:** ✅ Vercel AI provider — `https://raw.githubusercontent.com/vercel/ai/main/packages/openrouter-provider/` (or community providers)
- **Tier 3 — Cross-check:**
  - upstream `Risuai-NodeOnly/src/ts/model/modellist.ts` (OpenRouter entry)
  - CPM analysis §3-6 (`Risu-workspace/.agent/notes/cpm-analysis.md`)
  - Blessing line ~2220 (`Risu-workspace/_temp/Blessing-1.1.5.js`)
- **Search fallback:** `openrouter.ai/docs/guides/best-practices/reasoning-tokens` · `/guides/routing/provider-selection` (via search snippets)

### NanoGPT
- **Tier 1 — Vendor docs:** ✅ `https://nano-gpt.com/docs` (plain HTML page, easy to fetch)
- **Tier 2 — None first-party**
- **Tier 3 — Cross-check:** CPM analysis §3-7

### Vercel AI Gateway
- **Tier 1 — Vendor docs:** ✅ `https://vercel.com/docs/ai-gateway/sdks-and-apis/openai-chat-completions/chat-completions` · `.../models-and-providers`
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/vercel/ai/main/packages/gateway/`
- **Tier 3 — Cross-check:** CPM §3-7

### Ollama (self-hosted)
- **Tier 1 — Vendor docs:** ✅ `https://raw.githubusercontent.com/ollama/ollama/main/docs/openai.md` (OpenAI-compat endpoint) · `.../api.md` (native endpoint)
- **Tier 2 — Same as Tier 1** (Ollama publishes its docs in-repo)
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/process/request/request.ts` (ollama dispatch)

### Ollama Cloud
- **Tier 1 — Vendor docs:** ⚠️ `https://ollama.com/` (marketing page, no API reference directly)
- **Tier 2 — None**
- **Tier 3 — Cross-check (primary):** upstream `Risuai-NodeOnly/src/ts/process/request/request.ts` — search for `ollama.com`. This is where we confirmed the cloud endpoint, headers, and three message-format variants (`/v1/chat/completions`, `/v1/responses`, `/v1/messages`).
- **v4 status:** no profile shipped in the v4 skeleton. The `ollama` base provider covers self-hosted; an `ollama:cloud` profile can be added when there is demand.

### OpenAI Compatible (Custom)
- **No first-party source** — this template targets OpenAI's wire shape applied to third-party hosts (DeepInfra, Together, Groq, Fireworks, LiteLLM, vLLM, …). When OpenAI's spec changes, mirror the change here.

### Vertex AI (Gemini)
- **Tier 1 — Vendor docs:** ❌ `https://cloud.google.com/vertex-ai/...` redirects to `docs.cloud.google.com/...` which often loops or 404s
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/googleapis/python-genai/main/README.md` · `.../google/genai/types.py`
  - ✅ `https://raw.githubusercontent.com/GoogleCloudPlatform/generative-ai/main/gemini/getting-started/*` notebooks
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/process/request/google.ts:574-585` confirms the `{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:streamGenerateContent` pattern
- **Model-list policy — Vertex follows Google AI Studio.** Vertex's served catalog is project-specific (Model Garden) and listing it requires a *billing-enabled* project + OAuth (`{loc}-aiplatform.googleapis.com/v1beta1/publishers/google/models`); a free AI-Studio service account returns `403 billing required`, so there is no universal enumeration. We therefore do **not** independently curate Vertex models: the `vertex-openai` base `modelId` combobox mirrors the `google:*` profile set with a `google/` publisher prefix (e.g. `google/gemini-3.5-flash`). When the Google provider's model list changes, update this enum to match. Note `modelId` is a free-text combobox, so the enum is only a suggestion list — exact Vertex availability/version is the user's project's concern. The `vertex-openai` adapter is `openai-compatible`, so it carries **no** native `thinkingConfig` (the `thinkingLevel`-vs-`thinkingBudget` split that separates `google` profiles does **not** apply here); thinking control on Vertex, if needed, goes through `reasoning_effort` via additional parameters.

### Vertex AI (Claude)
- **Tier 1 — Vendor docs:** ✅ `https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai` (Anthropic-side docs for Vertex Model Garden)
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/lib/vertex/_client.py` (Anthropic's official Vertex integration — confirms `publishers/anthropic`, `:streamRawPredict`, `anthropic_version: "vertex-2023-10-16"`)
- **Tier 3 — Cross-check:** archive `provider-preset-spec.md` §15-2 (workspace internal)
- **v4 status:** intentionally excluded (plan-v4 §5-3). Vertex support in v4 routes through `vertex-openai:standard`. Sources kept here for reference if Anthropic publishes a stable Vertex OpenAI-compatible endpoint.

### AWS Bedrock (native)
- **Tier 1 — Vendor docs:** ✅ `https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html`
  - `.../userguide/model-parameters-anthropic-claude-messages.html` — body shape + `anthropic_version: "bedrock-2023-05-31"`
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/lib/bedrock/_client.py`
- **Tier 3 — Cross-check:** CPM `_temp/cpm-provider-aws.js` (if a deeper dive is needed)
- **v4 status:** native SigV4 / Messages path is MVP-excluded (plan-v4 §5-4). v4 only ships `bedrock:openai-compatible`, sourced from `https://docs.aws.amazon.com/bedrock/latest/userguide/inference-chat-completions-mantle.html`. Native sources stay here in case demand warrants a follow-up adapter.

---

## Cross-vendor reference sources (always worth a second pass)

These are not provider-specific but contain a wealth of wire-level information that maintainers should consult when something looks off:

1. **upstream RisuAI (`Risuai-NodeOnly` repo)** — most authoritative for any provider already shipping there, since the code runs in production. Useful files:
   - `src/ts/model/modellist.ts` — model IDs, endpoints, flags
   - `src/ts/model/providers/{openai,anthropic,google}.ts` — per-vendor model lists
   - `src/ts/process/request/request.ts` — dispatch (URL switching, header injection)
   - `src/ts/process/request/{openAI,anthropic,google}.ts` — body/response handling
   - **Tip:** `git log upstream/main --since="30 days ago" -- src/ts/model/ src/ts/process/request/` catches recent model/provider changes between refreshes.

2. **CPM analysis** — `Risu-workspace/.agent/notes/cpm-analysis.md`. CPM 1.30.18 covers 9 providers with 148 user-facing args. §3-1..§3-8 has per-provider deep dives, §5-7 has every endpoint URL we extracted.

3. **Blessing plugin** — `Risu-workspace/_temp/Blessing-1.1.5.js`. Single-file plugin with provider modules at known line offsets (custom-openai @857, anthropic @962, google-ai @1127, custom-google @1299, custom-claude @1451, vertex @1618, openai-compat-presets @2220, registry @2635, catalogs @2693).

4. **Archive spec** — `Risu-workspace/.agent/archive/provider-preset-spec.md` §15. Two complete worked examples (Anthropic Direct, Vertex AI) that this registry's templates were originally derived from.

---

## Refresh procedure

When you sit down to update the registry:

0. **Pull the Tier 0 catalog first.** Hit the provider's `/models` API and the OpenRouter cross-catalog (above) before reading any doc. This gives you the authoritative model list, ship dates, limits, modalities, tokenizer, and `supported_parameters` — the skeleton of every profile you're about to touch, and the input to the selection rule. Doc-parsing (Tier 1/2) is now only for the exact wire keys Tier 0 can't express.

1. **Decide the scope.** Pick one of:
   - **Routine refresh** — vendor released a new model with no wire changes. → Update the relevant `ModelProfile.modelId` example or `capabilities`, set `updatedAt` to now (epoch millis) on the touched profile, bump `version` on the touched file, mirror the new `version` in `index.json`.
   - **Wire change** — vendor changed endpoint, headers, request/response shape, or added a feature flag. → Likely affects `BaseProviderDefinition.requestSchema` / `defaultHeaders` / `defaultBody` / `capabilities`, or per-profile `endpoint` / `auth` / `bodyTemplate`. Set `updatedAt` to now on every touched profile, bump `version` on every touched file plus `index.json.contentVersion`. Test against a real request before publishing.

   > **`updatedAt` is what users see.** Each `ModelProfile` carries `updatedAt` (precise epoch-millis timestamp). PocketRisu's per-preset "update available" hint compares a preset's recorded `profileUpdatedAt` against the current profile's `updatedAt` — **bump `updatedAt` on every revision** or installed presets won't be nudged. `version` is retained for the `index.json` mirror and the validator, but it no longer drives the update hint. (PocketRisu treats "update = a profile with the same id has a newer `updatedAt`"; a brand-new model is just a new profile id.)
   - **New profile** — adding a `ModelProfile` under an existing base. Create `profiles/<baseId>/<profileKey>.json`, add it to `index.json.profiles`, ensure `providerBaseId` points at an existing base.
   - **New base provider** — adding a `BaseProviderDefinition` for an adapter family we don't yet ship. Create `base-providers/<id>.json`, add it to `index.json.baseProviders`, decide whether `schema/base-provider.schema.json` needs a new enum value (new `adapterKind`, new `endpointKind`, …). Then create at least one profile under it.

2. **Pull recent upstream changes first** (always — they often pre-empt the vendor's own docs):
   ```sh
   cd Risuai-NodeOnly && git fetch upstream
   git log upstream/main --since="30 days ago" --oneline -- src/ts/model/ src/ts/process/request/
   ```
   Read every commit whose subject mentions a provider in your scope.

3. **Verify with the source URLs above.** For each provider you touch, hit Tier 1 first; if that fails, fall back to Tier 2 (raw GitHub). Quote the source in your PR description / commit.

4. **Run the cross-checks:**
   ```sh
   node scripts/validate.mjs
   ```
   The validator enforces every plan-v4 §15-2 rule: index mirror, `providerBaseId` references, schema key uniqueness, `uiSchema.fields[].key` references, allowed `visibility` / `widget` / `mapsTo.target` values, non-empty `sourceUrls`, and `profileStatus` in `current | outdated | deprecated`.

5. **Sync the PocketRisu bundle.** v4 bundles a snapshot of `base-providers/` and `profiles/` into `Risuai-NodeOnly/src/ts/preset/registry/bundled/`. After any registry change you intend to ship, copy the touched files into the NodeOnly bundle, run `pnpm run check && pnpm test src/ts/preset` over there, and land both commits together.

6. **Commit, push, and update PocketRisu** — a newer `updatedAt` on a profile triggers the "update available" badge on installed snapshot ModelPresets, so users get the change on next sync. (Always bump `updatedAt`; `version`/`index.json` are still mirrored for the catalog + validator.)

---

## Source of truth — `base-providers/` + `profiles/` vs `index.json`

**`base-providers/*.json` and `profiles/<baseId>/<profileKey>.json` are the source of truth.** That's where the wire-level spec lives (adapter, auth, endpoint, schema, UI schema, defaults) and where contributor PRs land.

**`index.json` mirrors a subset for fast lookup.** It carries a top-level `updatedAt`, each base provider's `id`, `displayName`, `url`, `version`, and each profile's `id`, `displayName`, `providerBaseId`, `profileStatus`, `url`, `version`. PocketRisu fetches `index.json` when the user opens the Model Preset menu (debounced); when its top-level `updatedAt` differs from the last synced value it **eagerly re-downloads all referenced base-provider/profile files** and rebuilds its registry cache. (The files are small and few, so a full refresh on change is simpler than lazy per-profile fetching — the per-profile `updatedAt` lives in the full profile and drives both the per-preset update badge and the catalog "new/updated models" notice.)

### Sync rules

- **`index.json.updatedAt` (epoch millis) is the client's change gate — bump it on EVERY publish** (new model, profile edit, wire change, anything). If you forget, clients won't re-download and users won't see the change. This is the single value PocketRisu compares to decide whether to refresh.
- Every wire-level change must **bump `version` in the source file AND in `index.json`** in the same commit. `scripts/validate.mjs` rejects mismatches.
- If the two ever disagree, **the source file wins** (treat `index.json` as stale and re-derive the mirrored fields from the source files).
- `index.json`'s own `contentVersion` bumps when any base provider or profile in the list changes — it's a coarse "something in the registry moved" signal, separate from per-file `version`. (Note: `contentVersion` only tracks wire-level catalog moves; `updatedAt` is the broader gate that must bump on routine `updatedAt`-only refreshes too.)

The validator handles mismatch detection — there is no separate snippet to maintain. Run `node scripts/validate.mjs` from the repo root before every commit.

---

## Audit history

| Date | What was checked | Outcome |
|------|------------------|---------|
| 2026-05-22 | Initial v1 audit across 13 v3 templates against vendor docs (where reachable), upstream RisuAI (last 30 days), CPM 1.30.18 analysis, Blessing 1.1.5, and archive spec §15. | 9 issues found and fixed across 4 commits. Vertex split into `vertex` (Gemini) and `vertex-claude` because the URL path, body shape, and required `anthropic_version` differ. See git log for `fix:` and `feat:` commits. |
| 2026-05-24 | v4 schema transition. v3 `providers/*.json` retired; replaced with 12 `BaseProviderDefinition` files and 12 `ModelProfile` files. Vertex Claude excluded per plan-v4 §5-3. Bedrock native excluded per §5-4; `bedrock:openai-compatible` profile shipped instead. `scripts/validate.mjs` added. | First v4 skeleton landed alongside NodeOnly `feature/model-preset-v4`. Schemas detailed enough to host migration snapshots; full per-vendor `requestSchema` (reasoning, thinking, cache, etc.) is follow-up work. |
| 2026-05-31 | Model preset UX audit and official-doc refresh for OpenAI / Anthropic / Google profiles. | Decision: remove heuristic profile grouping (`profileTier`, profile-level `visibility`, `lifecycle`) and keep one explicit `profileStatus` axis: `current`, `outdated`, `deprecated`. Temporal tags (`latest`, `recommended`, `legacy`, etc.) are banned. The shipped current set is narrowed to GPT-5.5 / GPT-5.4 / GPT-5.3 Codex, Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5, and one `google:gemini-3` profile; legacy Gemini/OpenAI/o-series/older Claude profiles were removed before first release. |
| 2026-06-03 | Added **Tier 0 — provider model-listing APIs** as the primary source of truth for profile authoring, after studying the dynamic-discovery approach in Yumi Provider Manager v1.5.2. | OpenRouter `/api/v1/models` (public, full spec) adopted as cross-catalog; per-provider `/models` table + `supported_parameters`/`architecture` → schema/capabilities mapping documented. Selection of the `current` set moved from eyeballed picking to a semi-automatic rule (API enumerate → sort by `created` → maintainer confirms). No profile data changed this pass — guidance only. |
| 2026-06-05 | First full live-enumeration refresh of OpenAI / Google / Anthropic via the recipes now recorded under "Verified live-enumeration recipes". OpenRouter (no key), Google AI Studio `/v1beta/models` (user key), Anthropic `/v1/models` (user key); limits cross-checked against OpenRouter; enum vocab from SDK Tier 2. | Provider profiles flattened (one model = one profile) and expanded: **OpenAI 3→15** (current 9 gpt-5.x / outdated 6 gpt-4.x+o3; codex removed; Responses-only `*-pro`/`o3-pro` excluded), **Google 1→9** (current gemini-3.x + Gemma 4 / outdated gemini-2.5; merged `gemini-3` split; `thinkingLevel` vs `thinkingBudget`), **Anthropic 3→10** (current ≥4.6 / outdated <4.6; adaptive-effort vs budget). Registry 19→46 profiles. **`profileStatus` curation rule = "major one below current → outdated", per-provider threshold** (OpenAI gpt-5 line current; Google gemini-3 current; Anthropic ≥4.6 current). OpenRouter corrected three limit errors (see recipes). Bundled snapshot synced into NodeOnly; 305 preset tests green. |

When you do the next refresh, add a row.
