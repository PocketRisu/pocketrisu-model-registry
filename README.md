# PocketRisu Model Registry

Official model profile registry for [PocketRisu](https://github.com/PocketRisu/PocketRisu) (Risuai-NodeOnly).

[한국어](#한국어) | [English](#english)

---

## English

### Purpose

This repository hosts declarative JSON definitions that describe how PocketRisu connects to LLM providers (OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock, OpenRouter, NanoGPT, Vercel AI Gateway, Ollama, DeepSeek, DeepInfra, …).

Schema v4 splits the older single-file template into two layers:

| Layer | Purpose |
|---|---|
| `BaseProviderDefinition` (`base-providers/<id>.json`) | adapter family + auth/endpoint primitives, default headers/body, shared request schema and UI schema. |
| `ModelProfile` (`profiles/<baseId>/<profileKey>.json`) | concrete profile a user picks (e.g. `openai:gpt-5`, `openrouter:openai-compatible`). Pins endpoint, auth wiring, `modelId`, and may extend the base's schema/UI. MVP only ships `profileTier: 'standard'`. |

Each definition uses pure JSON and declares:

- Adapter kind (`openai-compatible` / `anthropic-messages` / `google-gemini`)
- Auth kind (`none` / `bearer` / `x-api-key` / `x-goog-api-key` / `query` / `google-service-account`)
- Endpoint kind (`static` / `vertex-openai`)
- Field schema + UI hints (`requestSchema`, `uiSchema`) — drives the form PocketRisu renders
- Default headers / body
- Capabilities (`streaming`, `reasoning`, `vision`, `tools`, `json`)
- Source URLs used to verify the wire shape

### How PocketRisu uses this

```
PocketRisu boot
  ↓
  fetch https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main/index.json
  ↓
  fetch base-providers/<id>.json + profiles/<baseId>/<key>.json on demand (when user picks a profile)
  ↓
  resolve a ResolvedModelProfileSnapshot (merge BaseProvider + ModelProfile)
  ↓
  user fills the form generated from schema + uiSchema → ModelPreset is created (owns its snapshot copy)
  ↓
  user chats → adapter renders request from snapshot + userValues → vendor API
```

A build-time snapshot of this registry is bundled inside PocketRisu (`Risuai-NodeOnly/src/ts/preset/registry/bundled/`). When the network fetch fails or has not yet run, the bundled copy is the fallback. At runtime the live registry is source of truth, but ModelPresets carry their own immutable snapshot — registry edits do not silently mutate existing presets.

### Repository layout

```
pocketrisu-model-registry/
├── index.json                        # mirror of every base provider + profile
├── base-providers/
│   ├── openai.json
│   ├── anthropic.json
│   ├── google.json
│   ├── openai-compatible.json
│   ├── openrouter.json
│   ├── nanogpt.json
│   ├── ollama.json
│   ├── deepseek.json
│   ├── deepinfra.json
│   ├── vercel.json
│   ├── bedrock.json
│   └── vertex-openai.json
├── profiles/
│   ├── openai/standard.json
│   ├── anthropic/standard.json
│   ├── google/standard.json
│   ├── openai-compatible/custom.json
│   ├── openrouter/openai-compatible.json
│   ├── nanogpt/openai-compatible.json
│   ├── ollama/openai-compatible-local.json
│   ├── deepseek/openai-compatible.json
│   ├── deepinfra/openai-compatible.json
│   ├── vercel/openai-compatible.json
│   ├── bedrock/openai-compatible.json
│   └── vertex-openai/standard.json
├── schema/
│   ├── base-provider.schema.json     # JSON Schema for BaseProviderDefinition
│   └── model-profile.schema.json     # JSON Schema for ModelProfile
├── scripts/
│   └── validate.mjs                  # cross-consistency validator (zero deps)
├── MAINTENANCE.md
├── README.md
└── LICENSE                           # CC0 1.0
```

### Versioning

Each base provider and profile carries an integer `version`. Increment it whenever wire-level behavior changes (new fields, changed defaults, fixed paths). `index.json` mirrors the per-file `version` and bumps its own `contentVersion` when anything changes.

PocketRisu compares each installed ModelPreset's snapshot version against the registry's latest. When they differ, the user sees an "update available" badge, can view the diff, and confirms before snapshot replacement. User-entered values (`userValues`) survive updates; fields that disappear move to `orphanValues` for inspection.

### Validation

Run `node scripts/validate.mjs` from the repo root before every commit. The validator enforces:

1. `index.json` mirrors every `base-providers/*.json` and `profiles/<baseId>/<key>.json`.
2. Every `ModelProfile.providerBaseId` points to a real `BaseProviderDefinition`.
3. Schema `key` values are unique within a file.
4. `uiSchema.fields[].key` references an existing schema field.
5. `visibility` ∈ {`basic`, `advanced`, `hidden`}.
6. `widget` is in the v4 allowed set.
7. `mapsTo.target` ∈ {`body`, `header`, `query`, `auth`, `custom`}.
8. `sourceUrls` is non-empty.
9. `profileTier === 'standard'` (MVP).

Zero dependencies, runs on any Node ≥ 18.

### Contributing

PRs that add or update **official, first-party** profiles are welcome. Please:

1. Open an issue first if it's a new base provider, so we can agree on the `id` and naming.
2. Match the style of existing files (`anthropic.json` is a good reference for a clean base; `openai-compatible.json` for a custom-endpoint base).
3. Bump `version` and update `index.json`.
4. Run `node scripts/validate.mjs` and confirm it prints `Registry OK`.
5. Test by pointing PocketRisu at your fork via the bundled snapshot (`Risuai-NodeOnly/src/ts/preset/registry/bundled/`).

### Terms of service for PRs

This is a **curated** registry. Profiles targeting third-party proxies, unofficial reverse-engineered endpoints, jailbreak gateways, or bypass routes will be rejected. Such profiles belong in a community registry that users can opt into; they do not belong in the official source.

Specifically rejected:

- Profiles pointing at unofficial / leaked / scraped endpoints.
- Profiles designed to bypass a vendor's auth, rate limit, or geographic restriction.
- Profiles routing through opaque proxy services without a publicly documented API.
- Profiles whose primary purpose is to enable terms-of-service violations.

Accepted profiles target vendor-documented APIs (OpenAI's `api.openai.com`, Anthropic's `api.anthropic.com`, Vercel's AI Gateway, etc.) or self-hostable open-source servers (Ollama).

### License

CC0 1.0 (public domain). See [LICENSE](./LICENSE).

---

## 한국어

### 목적

이 저장소는 [PocketRisu](https://github.com/PocketRisu/PocketRisu)(Risuai-NodeOnly)가 각 LLM 공급자(OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock, OpenRouter, NanoGPT, Vercel AI Gateway, Ollama, DeepSeek, DeepInfra 등)에 어떻게 접속하는지를 선언적으로 기술하는 JSON 정의를 호스팅합니다.

스키마 v4는 기존의 단일 템플릿을 두 계층으로 분리했습니다:

| 계층 | 역할 |
|---|---|
| `BaseProviderDefinition` (`base-providers/<id>.json`) | adapter family + auth/endpoint primitive, 기본 header/body, 공통 request/UI schema. |
| `ModelProfile` (`profiles/<baseId>/<profileKey>.json`) | 사용자가 직접 고르는 단위 (예: `openai:gpt-5`). endpoint, auth 와이어링, `modelId` 고정. base의 schema/UI를 확장 가능. MVP는 `profileTier: 'standard'`만 발행. |

각 정의는 순수 JSON으로 다음을 선언합니다:

- Adapter kind (`openai-compatible` / `anthropic-messages` / `google-gemini`)
- Auth kind (`none` / `bearer` / `x-api-key` / `x-goog-api-key` / `query` / `google-service-account`)
- Endpoint kind (`static` / `vertex-openai`)
- 필드 schema + UI 힌트 (`requestSchema`, `uiSchema`) — PocketRisu가 렌더하는 폼을 결정
- 기본 header / body
- Capabilities (`streaming`, `reasoning`, `vision`, `tools`, `json`)
- wire 형태 검증에 사용한 출처 URL

### PocketRisu의 사용 흐름

```
PocketRisu 부팅
  ↓
  https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main/index.json fetch
  ↓
  사용자가 profile 선택 시 base-providers/<id>.json + profiles/<baseId>/<key>.json fetch
  ↓
  ResolvedModelProfileSnapshot 생성 (BaseProvider + ModelProfile merge)
  ↓
  schema + uiSchema → 폼 자동 생성 → 사용자 입력 → ModelPreset 생성 (snapshot copy를 소유)
  ↓
  사용자 채팅 → adapter가 snapshot + userValues로 요청 렌더 → vendor API
```

PocketRisu 빌드에는 이 레지스트리의 스냅샷이 동봉되어 있습니다(`Risuai-NodeOnly/src/ts/preset/registry/bundled/`). 네트워크 fetch가 실패하거나 아직 동작하지 않은 시점에는 동봉 스냅샷이 fallback 역할을 합니다. 평시에는 라이브 레지스트리가 source of truth이지만, 각 ModelPreset은 자체 불변 snapshot을 가지므로 레지스트리 편집이 기존 preset을 조용히 변경하지 않습니다.

### 저장소 구조

`index.json` (전체 mirror) + `base-providers/*.json` + `profiles/<baseId>/<key>.json` + `schema/{base-provider,model-profile}.schema.json` + `scripts/validate.mjs`.

상세 트리는 English 섹션을 참조.

### 버전 관리

각 base provider와 profile은 정수 `version`을 가집니다. wire-level 동작이 바뀔 때마다 증가시킵니다. `index.json`은 파일별 `version`을 미러링하고, 무엇이라도 바뀌면 `contentVersion`을 올립니다.

PocketRisu는 설치된 각 ModelPreset의 snapshot version을 레지스트리 최신 version과 비교합니다. 다르면 "업데이트 가능" 뱃지가 표시되고, 사용자가 diff를 검토하고 확인하면 snapshot이 교체됩니다. 사용자 입력값(`userValues`)은 유지되며, 사라진 필드는 검사용으로 `orphanValues`로 이동합니다.

### 검증

모든 커밋 전에 repo 루트에서 `node scripts/validate.mjs`를 실행합니다. 검증 항목:

1. `index.json`이 모든 `base-providers/*.json`과 `profiles/<baseId>/<key>.json`과 mirror 됨
2. 모든 `ModelProfile.providerBaseId`가 실제 `BaseProviderDefinition`을 가리킴
3. schema `key` 값이 파일 내에서 중복 없음
4. `uiSchema.fields[].key`가 실제 schema field를 참조
5. `visibility` ∈ {`basic`, `advanced`, `hidden`}
6. `widget`이 v4 허용값
7. `mapsTo.target` ∈ {`body`, `header`, `query`, `auth`, `custom`}
8. `sourceUrls`가 비어있지 않음
9. `profileTier === 'standard'` (MVP)

dep 없음. Node ≥ 18에서 동작.

### 기여

**공식 1차 vendor 프로파일**의 추가/갱신 PR을 환영합니다. 작업 전:

1. 새 base provider라면 먼저 이슈를 열어 `id` 명명을 합의합니다.
2. 기존 파일 스타일을 따르세요 (`anthropic.json`은 깔끔한 base, `openai-compatible.json`은 custom-endpoint base 참고).
3. `version`을 올리고 `index.json`도 갱신하세요.
4. `node scripts/validate.mjs`를 돌려 `Registry OK`를 확인하세요.
5. 본인의 fork를 PocketRisu 동봉 스냅샷(`Risuai-NodeOnly/src/ts/preset/registry/bundled/`)에 반영해 테스트합니다.

### PR 정책 (Terms of Service)

이 레지스트리는 **큐레이션된** 공식 소스입니다. 다음과 같은 PR은 거절됩니다:

- 비공식/유출/스크레이핑한 엔드포인트를 가리키는 profile
- vendor의 인증, 레이트 리밋, 지역 제한을 우회하기 위해 설계된 profile
- 공개 문서가 없는 불투명한 프록시 서비스로 라우팅하는 profile
- 주된 목적이 vendor 약관 위반인 profile

vendor가 공식 문서화한 API(`api.openai.com`, `api.anthropic.com`, Vercel AI Gateway 등) 또는 자체 호스팅 가능한 오픈소스 서버(Ollama)를 가리키는 profile만 수락합니다.

비공식/우회 profile은 사용자가 선택적으로 추가하는 커뮤니티 레지스트리에 적합하며, 이 공식 소스의 범위가 아닙니다.

### 라이선스

CC0 1.0 (퍼블릭 도메인). [LICENSE](./LICENSE) 참조.
