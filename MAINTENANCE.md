# Maintenance Guide

This document lists the **source URLs we consult when refreshing the templates**, the **fetch reliability** we've observed, and the **refresh procedure** for future maintainers. Same cycle, same sources, less re-discovery.

---

## Per-provider source URLs

For each provider we keep three layers of sources. **Tier 1 (vendor docs)** is the ground truth when reachable. **Tier 2 (raw GitHub SDK)** is the most reliable fetch target since `raw.githubusercontent.com` doesn't gate. **Tier 3 (third-party plugins / upstream RisuAI)** is a sanity check against real, in-the-wild traffic.

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

### OpenAI Compatible (Custom)
- **No first-party source** — this template targets OpenAI's wire shape applied to third-party hosts (DeepInfra, Together, Groq, Fireworks, LiteLLM, vLLM, …). When OpenAI's spec changes, mirror the change here.

### Vertex AI (Gemini)
- **Tier 1 — Vendor docs:** ❌ `https://cloud.google.com/vertex-ai/...` redirects to `docs.cloud.google.com/...` which often loops or 404s
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/googleapis/python-genai/main/README.md` · `.../google/genai/types.py`
  - ✅ `https://raw.githubusercontent.com/GoogleCloudPlatform/generative-ai/main/gemini/getting-started/*` notebooks
- **Tier 3 — Cross-check:** upstream `Risuai-NodeOnly/src/ts/process/request/google.ts:574-585` confirms the `{region}-aiplatform.googleapis.com/v1/projects/{project}/locations/{region}/publishers/google/models/{model}:streamGenerateContent` pattern

### Vertex AI (Claude)
- **Tier 1 — Vendor docs:** ✅ `https://platform.claude.com/docs/en/build-with-claude/claude-on-vertex-ai` (Anthropic-side docs for Vertex Model Garden)
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/lib/vertex/_client.py` (Anthropic's official Vertex integration — confirms `publishers/anthropic`, `:streamRawPredict`, `anthropic_version: "vertex-2023-10-16"`)
- **Tier 3 — Cross-check:** archive `provider-preset-spec.md` §15-2 (workspace internal)

### AWS Bedrock
- **Tier 1 — Vendor docs:** ✅ `https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_InvokeModelWithResponseStream.html`
  - `.../userguide/model-parameters-anthropic-claude-messages.html` — body shape + `anthropic_version: "bedrock-2023-05-31"`
- **Tier 2 — Raw SDK:** ✅ `https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/src/anthropic/lib/bedrock/_client.py`
- **Tier 3 — Cross-check:** CPM `_temp/cpm-provider-aws.js` (if a deeper dive is needed)

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

When you sit down to update the templates:

1. **Decide the scope.** Pick one of:
   - **Routine refresh** — vendor released a new model, no wire changes. → edit `models[]` in the relevant `providers/*.json` and bump the file's `version`. Update `index.json`'s mirrored `version` and `updated` date.
   - **Wire change** — vendor changed an endpoint, header, request/response shape, or added a new feature flag. → likely affects `request`, `conditionals`, or `response`. Bump the file's `version` and `index.json`'s `contentVersion`. Test against a real request before publishing.
   - **New provider** — adding a JSON for a vendor we don't have. Add `providers/<id>.json`, add the entry to `index.json`, decide if `schema/provider-template.schema.json` needs a new enum value (e.g. a new SSE `style`).

2. **Pull recent upstream changes first** (always — they often pre-empt the vendor's own docs):
   ```sh
   cd Risuai-NodeOnly && git fetch upstream
   git log upstream/main --since="30 days ago" --oneline -- src/ts/model/ src/ts/process/request/
   ```
   Read every commit whose subject mentions a provider in your scope.

3. **Verify with the source URLs above.** For each provider you touch, hit Tier 1 first; if that fails, fall back to Tier 2 (raw GitHub). Quote the source in your PR description / commit.

4. **Run the cross-checks:**
   ```sh
   # JSON validity + cross-consistency (id/version/var/conditional/uiSchema refs)
   for f in index.json schema/*.json providers/*.json; do
     node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))"
   done
   # Then the cross-check script (see this repo's CI / commit history for the snippet)
   ```

5. **Commit, push, and update PocketRisu** — bumping `version` triggers an "update available" badge on installed presets, so users get the change on next sync.

---

## Source of truth — `providers/*.json` vs `index.json`

**`providers/*.json` is the source of truth.** That's where the wire-level spec lives (URL, body, conditionals, schema, etc.) and where contributor PRs land.

**`index.json` mirrors a subset for fast lookup.** It carries each provider's `id`, `name`, `description`, `url` (pointer to the file), `version`, and `updated` date. PocketRisu fetches `index.json` once at startup to know which templates exist and which versions are current; only when a per-preset `installedTemplateVersion` differs does it fetch the individual `providers/*.json`.

### Sync rules

- Every wire-level change must **bump `version` in the provider file AND in `index.json`** in the same commit. The cross-check script in CI rejects mismatches.
- If the two ever disagree, **the provider file wins** (treat `index.json` as stale and re-derive the mirrored fields from the provider file).
- `index.json`'s own `contentVersion` bumps when any provider in the list changes — it's a coarse "something in the registry moved" signal, separate from per-provider `version`.

The cross-check snippet that catches mismatches:

```sh
node -e '
const fs = require("fs"), path = require("path");
const idx = JSON.parse(fs.readFileSync("index.json", "utf8"));
for (const e of idx.providers) {
  const p = JSON.parse(fs.readFileSync(path.join("providers", e.id + ".json"), "utf8"));
  if (p.id !== e.id || p.version !== e.version) {
    console.error(e.id, "mismatch", e.version, "vs", p.version); process.exit(1);
  }
}
console.log("OK");
'
```

---

## Audit history

| Date | What was checked | Outcome |
|------|------------------|---------|
| 2026-05-22 | Initial v1 audit across 13 templates against vendor docs (where reachable), upstream RisuAI (last 30 days), CPM 1.30.18 analysis, Blessing 1.1.5, and archive spec §15. | 9 issues found and fixed across 4 commits. Vertex split into `vertex` (Gemini) and `vertex-claude` because the URL path, body shape, and required `anthropic_version` differ. See git log for `fix:` and `feat:` commits. |

When you do the next refresh, add a row.
