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

**Gate = content hash, not a version/timestamp.** `build.mjs` hashes the catalog; the client re-downloads only when the hash differs ("different ⇒ adopt the published version"). No `updatedAt`/`contentVersion` bump to remember. (Per-profile `updatedAt` drives the per-preset "update available" check; `build.mjs` passes it through untouched **except** that it auto-bumps `updatedAt` on every profile inheriting a base provider whose hash changed — base providers carry no `updatedAt` of their own, so this is how a base-only edit nudges installed presets.)

### Maintenance flow (every change)

```
1. edit profiles/<provider>/<key>.json (or base-providers/*.json)   ← source only
2. node scripts/build.mjs       → regenerates index.json + catalog.json
3. node scripts/validate.mjs    → schema + hash-consistency (catches "forgot to rebuild")
4. git commit                   → commit sources + index.json + catalog.json together
```

Deploy order when the client fetch format changes: **registry first, client after** (per-file profiles stay published, so an older client still resolves).

PocketRisu v4 consumes this layout via a bundled snapshot inside `Risuai-NodeOnly/src/ts/preset/registry/bundled/`. Bundled copy mirrors the same `base-providers/` and `profiles/<baseId>/` paths; sync at release time.

### Deploy procedure for profile / base-provider additions (develop-first)

**Adding or changing a profile or base provider MUST go through `develop` before `main`.** The client's official channel is `main` (`OFFICIAL_BASE = …/pocketrisu-model-registry/main/`); `develop` is a staging channel reached only by users who manually enable the custom registry URL, so it never affects live users.

```
1. commit + push to `develop`           ← never commit a new profile straight to main
2. verify live in the app via custom registry URL:
   Settings → Model Preset → 커스텀 레지스트리 ON,
   레지스트리 URL = https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/develop/
   → sync, create a preset, send a REAL request (confirm the actual model call works)
3. request user confirmation                ← report the verification result and ask before going live
4. only after approval: merge develop → main, push main   ← now live to all users
```

Rationale: a broken profile on `main` reaches every user on their next menu entry and cannot be un-shipped, only re-fixed. `develop` lets the change be exercised against a real provider first. The "update available" banner is scoped to the official (`main`/bundled) registry on purpose, so custom-registry test profiles never nag users.

---

## Tier 0 — Provider model-listing APIs (enumeration + live spec)

**Before parsing any doc, hit the provider's own model-listing API.** It is the deterministic answer to "which models exist right now, when did they ship, and which knobs do they accept" — facts we used to *guess* from marketing pages. This is the registry-authoring equivalent of what dynamic provider-manager plugins do at runtime: we just consult the same endpoints at maintenance time instead of in code.

Coverage varies a lot. Some APIs return a full spec; others only enumerate IDs. **OpenRouter `/api/v1/models` is the linchpin** — it is public (no key), lists ~340 models across every vendor, and returns a near-complete ModelProfile per model. Use it as the primary cross-catalog; fall back to the direct provider API for ID/lifecycle truth and to Tier 1/2 for the exact wire keys OpenRouter normalizes away.

| Provider | Endpoint | Auth | What it returns |
|---|---|---|---|
| **OpenRouter** (cross-catalog) | `GET https://openrouter.ai/api/v1/models` | **none (public)** | **Full spec** — `context_length`, `top_provider.max_completion_tokens`, `architecture.input_modalities`/`tokenizer`, `supported_parameters[]`, `default_parameters{}`, `pricing{}`, `created`, `knowledge_cutoff`, `expiration_date`, `canonical_slug` (versioned), **`reasoning{mandatory, default_enabled, supported_efforts[], default_effort}`** |
| **LLM Gateway** (cross-catalog) | `GET https://api.llmgateway.io/v1/models` | **none (public)** | ~238 models. OpenRouter-shaped, plus `providers[]` (which upstreams route this model, with per-provider `reasoning`/`vision`/`tools`). `supported_parameters[]` lists each family's **native** knob names (`effort` for Anthropic, `reasoning_effort` elsewhere) rather than a normalized set — useful for confirming per-family wire. |
| **Cerebras** | `GET https://api.cerebras.ai/public/v1/models` | **none (public)** | Full spec — `limits.{max_context_length,max_completion_tokens}`, `capabilities{}`, `supported_parameters{}`, `pricing{}`, `preview`, **`deprecated`** |
| **NeuralWatt** | `GET https://api.neuralwatt.com/v1/models` | **none (public)** | `metadata.{capabilities,limits,pricing,deprecated}` per model |
| **Vercel AI Gateway** | `GET https://ai-gateway.vercel.sh/v1/models` | **none (public)** | `context_window`, `max_tokens`, `tags[]`, `modalities{}`, `supported_parameters[]`, `pricing{}` |
| **Lightning AI** | `GET https://lightning.ai/api/v1/models` | **none (public)** | `context_length`, `max_tokens` (often `0` = unknown) |
| **NanoGPT** | `GET https://nano-gpt.com/api/v1/models` | **none (public)** | enumeration (~640 entries incl. community fine-tunes) |
| **Ollama Cloud** | `GET https://ollama.com/v1/models` | **none (public)** | enumeration only. **Incomplete** — see the caveat under the audit row for 2026-07-25. |
| Google AI Studio | `GET https://generativelanguage.googleapis.com/v1beta/models?key=…` | query key | `displayName`, `inputTokenLimit`, `outputTokenLimit`, `supportedGenerationMethods[]` |
| AWS Bedrock | `ListFoundationModels` | SigV4 | `modelId`, `providerName`, `inputModalities[]`/`outputModalities[]`, `responseStreamingSupported` |
| OpenAI | `GET https://api.openai.com/v1/models` | Bearer key | `id`, `created`, `owned_by` — **enumeration + lifecycle only** (no limits/caps) |
| Anthropic | `GET https://api.anthropic.com/v1/models` | `x-api-key` + `anthropic-version` | `id`, `display_name`, `created_at` — **enumeration + lifecycle only** |
| SQUARE1 (arca.live) | `GET https://api.wellspring.encrypt.gay/v1/models` | Bearer `sq-arca-…` | Full spec — `owned_by`, `supports_{tools,reasoning,images,embeddings}`, `max_input_tokens`, `max_output_tokens`, `rate_limit_rpm`. **The gateway host is not the dashboard domain**: the dashboard is `dash.square1.dev` (whose `/api/*` is a separate account API), while the LLM gateway kept the legacy Wellspring host. `GET /v1/usage` and `/v1/me` report quota and account. Key-gated, so this listing needs a member key — the public `https://dash.square1.dev/api/stats/models` gives IDs + health without one, but lists internal models absent from `/v1/models`. |

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

> **Update (2026-07-25): OpenRouter now ships the effort vocabulary.** Each model record carries a `reasoning` object — `{mandatory, default_enabled, supported_efforts[], default_effort}` — so the *reasoning-effort* enum no longer has to be reconstructed from SDK literals. It also distinguishes always-on thinking (`mandatory: true`, e.g. Claude Fable 5) from opt-out (`mandatory: false`), which is exactly the Fable-vs-Opus split the profiles encode. Prefer this for `effort` / `reasoning_effort` enums; the rest of this section still applies to every *other* constrained field (`verbosity`, `service_tier`, `response_format.type`, Anthropic `thinking.type`).

```sh
curl -s https://openrouter.ai/api/v1/models \
  | jq -r '.data[] | select(.id|test("^anthropic/claude")) | .id + " -> " + ((.reasoning//{})|tostring)'
```

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
   - **Routine refresh** — vendor released a new model with no wire changes. → Update the relevant `ModelProfile.modelId` example or `capabilities`, set `updatedAt` to now (epoch millis) on the touched profile, and bump `version` on the touched file. (`index.json` / `catalog.json` are regenerated by `build.mjs` — never hand-edit them.)
   - **Wire change** — vendor changed endpoint, headers, request/response shape, or added a feature flag. → Likely affects `BaseProviderDefinition.requestSchema` / `defaultHeaders` / `defaultBody` / `capabilities`, or per-profile `endpoint` / `auth` / `bodyTemplate`. For per-profile edits, set `updatedAt` to now on every touched profile. For **base-provider** edits, leave the profiles alone — `build.mjs` detects the base's hash change and auto-bumps `updatedAt` on every inheriting profile. Bump `version` on every touched source file. Test against a real request before publishing.

   > **`updatedAt` is what users see.** Each `ModelProfile` carries `updatedAt` (precise epoch-millis timestamp). PocketRisu's per-preset "update available" hint compares a preset's recorded `profileUpdatedAt` against the current profile's `updatedAt` — **bump `updatedAt` on every revision** or installed presets won't be nudged. **Base-provider edits are handled automatically:** `build.mjs` bumps `updatedAt` on all inheriting profiles when a base's content hash changes (base providers have no `updatedAt`), so a base-only change still nudges installed presets — you only set `updatedAt` by hand for direct profile edits. `version` is retained per source file for record-keeping and the validator, but it no longer drives the update hint. (PocketRisu treats "update = a profile with the same id has a newer `updatedAt`"; a brand-new model is just a new profile id.)
   - **New profile** — adding a `ModelProfile` under an existing base. Create `profiles/<baseId>/<profileKey>.json` and ensure `providerBaseId` points at an existing base. `build.mjs` scans the directory and lists it in `index.json` automatically — no manual index edit.
   - **New base provider** — adding a `BaseProviderDefinition` for an adapter family we don't yet ship. Create `base-providers/<id>.json` (picked up by `build.mjs` automatically), decide whether `schema/base-provider.schema.json` needs a new enum value (new `adapterKind`, new `endpointKind`, …). Then create at least one profile under it.

2. **Pull recent upstream changes first** (always — they often pre-empt the vendor's own docs):
   ```sh
   cd Risuai-NodeOnly && git fetch upstream
   git log upstream/main --since="30 days ago" --oneline -- src/ts/model/ src/ts/process/request/
   ```
   Read every commit whose subject mentions a provider in your scope.

3. **Verify with the source URLs above.** For each provider you touch, hit Tier 1 first; if that fails, fall back to Tier 2 (raw GitHub). Quote the source in your PR description / commit.

4. **Rebuild artifacts, then run the cross-checks:**
   ```sh
   node scripts/build.mjs      # regenerates index.json + catalog.json; auto-bumps inheriting profiles on a base change
   node scripts/validate.mjs
   ```
   The validator enforces every plan-v4 §15-2 rule: index mirror, `providerBaseId` references, schema key uniqueness, `uiSchema.fields[].key` references, allowed `visibility` / `widget` / `mapsTo.target` values, non-empty `sourceUrls`, and `profileStatus` in `current | outdated | deprecated`.

5. **Sync the PocketRisu bundle.** v4 bundles a snapshot of `base-providers/` and `profiles/` into `Risuai-NodeOnly/src/ts/preset/registry/bundled/`. After any registry change you intend to ship, copy the touched files into the NodeOnly bundle, run `pnpm run check && pnpm test src/ts/preset` over there, and land both commits together.

6. **Commit, push, and update PocketRisu** — a newer `updatedAt` on a profile triggers the "update available" badge on installed snapshot ModelPresets, so users get the change on next sync. (Set `updatedAt` by hand on direct profile edits; `build.mjs` does it for you on base-provider edits. `index.json` / `catalog.json` are regenerated, not hand-maintained.)

---

## Source of truth — `base-providers/` + `profiles/` vs `index.json`

**`base-providers/*.json` and `profiles/<baseId>/<profileKey>.json` are the source of truth.** That's where the wire-level spec lives (adapter, auth, endpoint, schema, UI schema, defaults) and where contributor PRs land.

**`index.json` is the lightweight gate.** It carries `schemaVersion`, a top-level content `hash`, and `baseProviders[]` / `profiles[]` lists of `{ id, url, hash }`. PocketRisu fetches `index.json` when the user opens the Model Preset menu (debounced); when the top-level `hash` differs from the last synced value it downloads `catalog.json` (the whole registry inline) and rebuilds its registry cache. The per-profile `updatedAt` lives in the full profile and drives both the per-preset update badge and the catalog "new/updated models" notice.

### Sync rules

- **Never hand-edit `index.json` / `catalog.json`.** Run `node scripts/build.mjs` after every source edit; it regenerates both from the per-file sources and recomputes all hashes. The top-level `hash` is the client's change gate and moves automatically whenever any base provider or profile content changes — nothing to bump by hand.
- **`updatedAt` is the user-facing signal** behind the per-preset "update available" badge. Set it by hand on direct profile edits; `build.mjs` sets it automatically on profiles inheriting a changed base. `version` is retained per source file for record-keeping and the validator (`version >= 1`), but it no longer drives client behavior.
- If the artifacts ever disagree with the sources, **the source files win** — just re-run `build.mjs`. `scripts/validate.mjs` recomputes the hashes and fails if the artifacts are stale (i.e. you forgot to rebuild).

---

## Audit history

| Date | What was checked | Outcome |
|------|------------------|---------|
| 2026-05-22 | Initial v1 audit across 13 v3 templates against vendor docs (where reachable), upstream RisuAI (last 30 days), CPM 1.30.18 analysis, Blessing 1.1.5, and archive spec §15. | 9 issues found and fixed across 4 commits. Vertex split into `vertex` (Gemini) and `vertex-claude` because the URL path, body shape, and required `anthropic_version` differ. See git log for `fix:` and `feat:` commits. |
| 2026-05-24 | v4 schema transition. v3 `providers/*.json` retired; replaced with 12 `BaseProviderDefinition` files and 12 `ModelProfile` files. Vertex Claude excluded per plan-v4 §5-3. Bedrock native excluded per §5-4; `bedrock:openai-compatible` profile shipped instead. `scripts/validate.mjs` added. | First v4 skeleton landed alongside NodeOnly `feature/model-preset-v4`. Schemas detailed enough to host migration snapshots; full per-vendor `requestSchema` (reasoning, thinking, cache, etc.) is follow-up work. |
| 2026-05-31 | Model preset UX audit and official-doc refresh for OpenAI / Anthropic / Google profiles. | Decision: remove heuristic profile grouping (`profileTier`, profile-level `visibility`, `lifecycle`) and keep one explicit `profileStatus` axis: `current`, `outdated`, `deprecated`. Temporal tags (`latest`, `recommended`, `legacy`, etc.) are banned. The shipped current set is narrowed to GPT-5.5 / GPT-5.4 / GPT-5.3 Codex, Claude Opus 4.8 / Sonnet 4.6 / Haiku 4.5, and one `google:gemini-3` profile; legacy Gemini/OpenAI/o-series/older Claude profiles were removed before first release. |
| 2026-06-03 | Added **Tier 0 — provider model-listing APIs** as the primary source of truth for profile authoring, after studying the dynamic-discovery approach in Yumi Provider Manager v1.5.2. | OpenRouter `/api/v1/models` (public, full spec) adopted as cross-catalog; per-provider `/models` table + `supported_parameters`/`architecture` → schema/capabilities mapping documented. Selection of the `current` set moved from eyeballed picking to a semi-automatic rule (API enumerate → sort by `created` → maintainer confirms). No profile data changed this pass — guidance only. |
| 2026-06-05 | First full live-enumeration refresh of OpenAI / Google / Anthropic via the recipes now recorded under "Verified live-enumeration recipes". OpenRouter (no key), Google AI Studio `/v1beta/models` (user key), Anthropic `/v1/models` (user key); limits cross-checked against OpenRouter; enum vocab from SDK Tier 2. | Provider profiles flattened (one model = one profile) and expanded: **OpenAI 3→15** (current 9 gpt-5.x / outdated 6 gpt-4.x+o3; codex removed; Responses-only `*-pro`/`o3-pro` excluded), **Google 1→9** (current gemini-3.x + Gemma 4 / outdated gemini-2.5; merged `gemini-3` split; `thinkingLevel` vs `thinkingBudget`), **Anthropic 3→10** (current ≥4.6 / outdated <4.6; adaptive-effort vs budget). Registry 19→46 profiles. **`profileStatus` curation rule = "major one below current → outdated", per-provider threshold** (OpenAI gpt-5 line current; Google gemini-3 current; Anthropic ≥4.6 current). OpenRouter corrected three limit errors (see recipes). Bundled snapshot synced into NodeOnly; 305 preset tests green. |

| 2026-06-10 | Add **Claude Fable 5** (`claude-fable-5`, GA 2026-06-09). Verified real via platform.claude.com models overview + introducing-fable-5 page; Tier 0 live-confirmed on OpenRouter (`anthropic/claude-fable-5`, canonical `anthropic/claude-5-fable-20260609`, ctx 1M) and Vercel AI Gateway (`anthropic/claude-fable-5`). Specs: 1M ctx / 128k out / $10·$50; adaptive thinking **always on** (`thinking:{type:"disabled"}` rejected); effort low–max (xhigh/max Fable-tier); `thinking.display` omitted by default; Covered Model (30-day retention). | Added 4 profiles + 1 base provider (110→113 profiles, 14→15 bases): `anthropic:fable-5` (clone of opus-48, service_tier kept per request, **current**), `openrouter:claude-fable-5`, `vercel:claude-fable-5`. **New base `bedrock-anthropic`** (adapterKind `anthropic-messages` + `x-api-key`/bearer → `bedrock-mantle.{region}.api.aws/anthropic/v1/messages`) with `bedrock-anthropic:custom` profile — supersedes the §5-4 *SigV4* native-Bedrock exclusion (the bearer path needs no SigV4). `anthropic-compatible` base modelId → combobox with first-party Claude IDs incl. Fable 5 (v1→v2; 2 inheriting profiles auto-bumped). Opus 4.8 left **current** (per request; matches existing multi-version-current pattern). Bedrock OAI-compatible + `bedrock:openai-compatible` left unchanged. Bundle sync into NodeOnly pending. |

| 2026-06-19 | Add **NeuralWatt** (`api.neuralwatt.com`) — energy-metered OpenAI-compatible gateway for open models (GLM / Kimi / Qwen). Tier 0 live-enumerated via public `GET /v1/models` (full spec: per-model `metadata.{capabilities,limits,pricing}`, OpenRouter-class). Curated to the clean public IDs. | Added 1 base (`neuralwatt`) + 8 profiles (159 total, 19 bases): catch-all `neuralwatt:openai-compatible` + 7 named (`glm-52`, `glm-51`, `kimi-k25` [`moonshotai/Kimi-K2.5`], `kimi-k26`, `kimi-k27-code`, `qwen35-397b`, `qwen36-35b`). Context windows from `/v1/models` (GLM 1048560 / Kimi+Qwen397 262128 / Qwen35 131056); `max_output_tokens` null upstream → Max Tokens is a number input. `reasoning_effort` (GLM-only; `none` disables thinking) enum left at `none/low/medium/high` — **exact set unconfirmed** (Tier 0 gives no enum; no API key to probe). Excluded the 3 GLM **private-test/canary** entries (`zai-org/GLM-5.1-FP8` internal dup; the `glm-5.1`/`glm-5.2` IDs whose descriptions read "PRIVATE TEST"/"canary" were kept as the community-facing IDs). `*-fast` (thinking-off) variants reachable via catch-all, not pinned. **Shipped develop→main without the usual live-request gate** per user direction (no API key to test); real-world RisuAI use is community-confirmed in the source post, which mitigates the untested-`system_role:false` risk. Bundle sync into NodeOnly deferred to next app release (live channel = main already serves it; bundle is fetch-failure fallback). |

| 2026-07-25 | Full refresh. Reconciled the `main`/`develop` split left by PR #3 landing straight on `main`; post-merge audit of PR #3 (Cerebras) and PR #4 (GPT-5.6); Tier 0 sweep for new models across every provider; **first live-catalog cross-check of all 160 pinned `modelId`s**. Sources: OpenRouter (public), Google AI Studio `/v1beta/models` (maintainer key, single use, discarded), platform.claude.com model overview + fast-mode docs, and the public listings of Cerebras / NeuralWatt / Vercel / Lightning AI / NanoGPT / Ollama Cloud / LLM Gateway. | Registry **165 → 241 profiles, 20 → 21 bases**. **New models:** Claude Opus 5 (`claude-opus-5`) + Sonnet 5 (`claude-sonnet-5`), both 1M/128k, adaptive-thinking + `output_config.effort` (clones of `opus-48`, *not* Fable 5's always-on shape); Gemini 3.6 Flash + 3.5 Flash-Lite (dateless IDs, 1048576/65536, confirmed via AI Studio); Kimi K3, GLM 5.2, MiniMax M3, Grok 4.5, Qwen3.7 Max/Plus; GPT-5.6 Sol/Terra/Luna mirrored onto 4 gateways. **New base `llmgateway`** (`api.llmgateway.io`, openai-compatible, catch-all + 17 pinned) — **shipped without a live request** (no key), same call as NeuralWatt 2026-06-19. **Curation:** Opus 4.6/4.7 → `outdated` (4.8, Sonnet 4.6, Fable 5 stay `current` per maintainer); Opus 4.1 → `deprecated` (retires 2026-08-05). **Bugs fixed:** `cerebras:gemma-4-31b` limits were 8192/4096 vs the vendor's 131072/40960 (shipped live via PR #3); `lightning-ai:nemotron-3-ultra` and `nanogpt:gemma-4-31b` carried modelIds that resolve to nothing — both predate this pass and would have failed on request. **Drift:** `neuralwatt:glm-51`/`kimi-k25` and `lightning-ai:glm-5`/`kimi-k25` are gone from their providers → `deprecated`; 9 models those gateways serve were missing → added. Added `cerebras:openai-compatible` catch-all (the `cerebras` base carries only `apiKey`, so the catch-all supplies its own schema). Excluded: Claude Mythos 5 (invitation-only) and Anthropic fast mode (`speed:"fast"` + `fast-mode-2026-02-01` beta — a request parameter, not a model ID, and access-gated). No first-party base for MiniMax/xAI/Moonshot/Z.ai this pass. Bundle sync into NodeOnly deferred to the next app release (it is also still missing `neuralwatt` from 2026-06-19). |

| 2026-08-14 | Targeted refresh driven by the **Gemini 3.7 Flash** GA (2026-08-13). Tier 0 sweep across OpenRouter (412 models, up from ~340) + the keyless listings of Cerebras / NeuralWatt / Vercel / Lightning AI / NanoGPT / Ollama Cloud / LLM Gateway; re-ran the pinned-`modelId` cross-check over all 241 profiles; `git log upstream/main --since=2026-07-20 -- src/ts/model/ src/ts/process/request/`. **No Google AI Studio key this pass** — the 3.7 spec was instead confirmed by two independent sources agreeing (Google's own model page and OpenRouter). | Registry **241 → 247 profiles, 21 bases**. **New model — Gemini 3.7 Flash** (`gemini-3.7-flash`, 1048576/65536, GA 2026-08-13, canonical `google/gemini-3.7-flash-20260813`) added to 6 profiles + 1 base enum: `google`, `vertex-gemini-native`, `openrouter`, `vercel`, `llmgateway`, `nanogpt`, and the `vertex-openai` base `modelId` enum (per the Vertex-follows-AI-Studio policy). **It is not a 3.6 clone:** `thinking_level` **drops `minimal`** — setting it returns a validation error — so the enum is `low`/`medium`/`high` (default `medium`), matching OpenRouter `supported_efforts`. **Wire fix — Gemini 3.x rejects penalties.** Upstream dropped `presence_penalty`/`frequency_penalty` from the 3.5/3.6 Flash family in `fa265685` (2026-07-24) and OpenRouter lists no penalty in `supported_parameters` for *any* `gemini-3.x`. Removed both fields from `google:gemini-{35-flash,35-flash-lite,36-flash}` (they own a full `schema`). `vertex-gemini-native` inherits its schema from the base and **`mergeSchemas` has no subtraction** (override-by-key + append only) — so those profiles instead override the two `uiSchema` fields to `visibility: "hidden"`, which is the strongest per-profile expression available without stripping penalties from the 2.5 profiles that still accept them. Scoped to the Flash family per maintainer; 3.0/3.1 left alone. **Bugs fixed (user-visible failures):** `anthropic:opus-4` and `anthropic:sonnet-4` were `outdated` but **retired 2026-06-15**, and `anthropic:opus-41`'s 2026-08-05 retirement has now passed — all three hard-fail on request; `vercel:gpt-51-instant`, `neuralwatt:kimi-k26` and `neuralwatt:qwen35-397b` vanished from their providers' catalogs → all `deprecated` with a note naming the replacement. Every non-deprecated pin now resolves. **Curation:** Opus 4.8 / Sonnet 4.6 stay `current` per maintainer even though platform.claude.com moved them into its "Legacy models" accordion; all Gemini 3.x stay `current` (3.7 over 3.6 is a minor bump, and the multi-version-current pattern holds). **Deferred:** Grok 4.6, Qwen3.8 Max and Qwen3.7 Flash are live on 3–4 gateways but not pinned; NeuralWatt/Ollama Cloud additions (`kimi-k3`, `minimax-m2.7`, `nemotron-3-super`, …) not taken. Bundle sync into NodeOnly still deferred to the next app release (also still missing `neuralwatt` from 2026-06-19). |

| 2026-09-03 | Targeted refresh driven by the **Gemini 3.8 Flash** GA (2026-09-02). Tier 0: OpenRouter (424 models) — `google/gemini-3.8-flash`, canonical `google/gemini-3.8-flash-20260902`, `created` 2026-09-02T15:14Z, 1048576/65536, `reasoning{mandatory:true, supported_efforts:[high,medium,low], default_effort:medium}`, per-endpoint `supported_parameters` identical to 3.7 on both the "Google AI Studio" and "Google" (Vertex) endpoints; the keyless Vercel (`google/gemini-3.8-flash`, 1000000/65536), LLM Gateway (`gemini-3.8-flash`, 1048576/65536, routed via `google-vertex` only so far) and NanoGPT (`google/gemini-3.8-flash`) listings all already carry it. Google's model page (`gemini-3.8-flash`, input 1,048,576 / output 65,536, "Thinking Supported (low, medium, high) — minimal is not supported and returns an error", Latest update September 2026, $0.75 / $3.75 intro pricing through 2026-12-31) and the `latest-model` migration guide. Re-ran the pinned-`modelId` cross-check over all 249 pre-existing profiles (OpenRouter / Vercel / LLM Gateway / NanoGPT / Lightning AI / Cerebras / NeuralWatt). `git log upstream/main --since=2026-08-14 -- src/ts/model/ src/ts/process/request/` — upstream has no 3.8 yet. **No Google AI Studio key this pass** — spec confirmed by Google's model page and OpenRouter agreeing, as on 2026-08-14. | Registry **249 → 255 profiles, 22 bases**. **New model — Gemini 3.8 Flash** (`gemini-3.8-flash`) added to the same 6 profiles + 1 base enum as 3.7: `google`, `vertex-gemini-native`, `openrouter`, `vercel`, `llmgateway`, `nanogpt`, and the `vertex-openai` base `modelId` enum (v7 → v8; `vertex-openai:standard` auto-bumped by `build.mjs`). **Wire-identical to 3.7 Flash** — same limits, same `thinking_level` vocabulary (`low`/`medium`/`high`, default `medium`, `minimal` rejected), same OpenRouter `supported_parameters` — so every 3.8 profile is a straight clone of its 3.7 sibling with only id / modelId / sortOrder / sourceUrls / `updatedAt` changed. **Not positively confirmed: `generateContent`.** The 3.8 model page names no API and the migration guide's examples are Interactions API only (`client.interactions.create`); OpenRouter's "Google AI Studio" endpoint does serve it. Shipped without a live request per maintainer policy — one real request through `google:gemini-38-flash` is still owed. **Watch — sampling params.** The migration guide now says "Remove deprecated sampling parameters: Strip `temperature`, `top_p`, and `top_k` from generation configs", but OpenRouter still lists `temperature`/`top_p` for the AI Studio endpoint exactly as for 3.7, and the Gemini 3 guide phrases it as a strong recommendation (keep 1.0), not a rejection — sliders kept; revisit if a real request 400s. **Curation:** 3.7 stays `current` ("Gemini 3.7 Flash remains fully supported"); multi-version-current pattern holds. **Drift found, deliberately NOT fixed this pass (scoped to 3.8):** `vercel:grok-45` (`xai/grok-4.5`) — Vercel renamed the vendor prefix `xai/` → `spacexai/` (`spacexai/grok-4.5` is live); `nanogpt:glm-51` / `nanogpt:glm-52` (`zai-org/…`) — NanoGPT now lists `z-ai/glm-5.1` / `z-ai/glm-5.2`; `lightning-ai:nemotron-3-nano-omni` — gone from Lightning AI (only `lightning-ai/nemotron-3-ultra-550b-a55b` remains); `cerebras:zai-glm-47` (`zai-glm-4.7`) — absent from `api.cerebras.ai/public/v1/models`, which returned only `gemma-4-31b` + `gpt-oss-120b` (confirm the listing is complete before deprecating). All five are `current` and hard-fail on request today. Bundle sync into NodeOnly deferred to the next app release (bundle is at 3.7). |

**Watch item recorded 2026-08-14 — the Gemini Interactions API.** It went GA 2026-06-22 and is now Google's recommended front door; new agent-tier features ship there only. `generateContent` (what every `google:*` and `vertex-gemini-native:*` profile targets) "remains fully supported and will continue to receive new mainline Gemini models" — Gemini 3.7 Flash duly landed on it — so **no wire change is needed yet**. Re-check each pass: the trigger to act is a mainline Gemini model that ships *without* `generateContent` support. **Re-checked 2026-09-03 (Gemini 3.8 Flash):** the model page names no API and Google's migration guide shows Interactions-only examples; OpenRouter's AI Studio endpoint serves it, but `supportedGenerationMethods` could not be read (no key). Not treated as the trigger, but it is the first mainline release where `generateContent` was not positively confirmed — read it from `/v1beta/models/gemini-3.8-flash` the next time a key is available.

**Caveat recorded 2026-08-14 — exclude `ollama-cloud` from the pinned-`modelId` cross-check.** All 13 pins read as missing because `ollama.com/v1/models` enumerates **bare** names (`glm-5.1`, `gpt-oss:120b`) while the direct API requires the suffixed form (`glm-5.1:cloud`, `gpt-oss:120b-cloud`). The suffix is correct and was verified against a real user config in `aaecf91`; Ollama's own cloud doc shows the bare form only for the *local daemon* proxy path. Treat a full-provider miss here as a format mismatch, not drift.

**Caveat recorded 2026-07-25 — `ollama.com/v1/models` is not a complete catalog.** `ollama-cloud:gemini-3-flash` (`gemini-3-flash-preview:cloud`) is absent from that listing, but `ollama.com/library/gemini-3-flash-preview` returns 200 while a bogus slug 404s. The profile was therefore left `current`. Treat a miss in Ollama's `/v1/models` as inconclusive and confirm against the library page before deprecating anything.

**Worth repeating every pass — cross-check pinned `modelId`s against the live listings.** Eight providers publish keyless model lists, so this is cheap and it is what caught both broken profiles above:

```sh
# for each provider with a public listing, assert every pinned modelId still resolves.
# filter out deprecated pins up front so the output is actionable, not a known-misses list.
curl -s https://openrouter.ai/api/v1/models | jq -r '.data[].id' | sort > /tmp/live.txt
jq -r 'select(.modelId != "" and .profileStatus != "deprecated") | .modelId' \
  profiles/openrouter/*.json | sort -u > /tmp/ours.txt
comm -23 /tmp/ours.txt /tmp/live.txt   # anything printed is a profile that will fail
```

Anything printed is either a typo or provider drift — both are user-visible failures. Two known exceptions produce false positives: **`ollama-cloud`** (bare-vs-suffixed ID format, see the caveat above — skip the provider entirely) and a single miss on Ollama's incomplete catalog (confirm against the library page before deprecating).

When you do the next refresh, add a row.
