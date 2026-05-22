# PocketRisu Model Registry

Official provider template registry for [PocketRisu](https://github.com/PocketRisu/PocketRisu) (Risuai-NodeOnly).

[한국어](#한국어) | [English](#english)

---

## English

### Purpose

This repository hosts declarative JSON templates that describe how PocketRisu connects to LLM providers (OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock, OpenRouter, NanoGPT, Vercel AI Gateway, Ollama, DeepSeek, …).

Each template defines, in pure JSON:

- Auth method (bearer / x-api-key / query / google-service-account / aws-v4)
- Message format (`openai` / `anthropic` / `google`)
- Field schema (JSON Schema draft-07) + UI hints (uiSchema)
- Recommended model list
- HTTP request template (URL, headers, body) with `{{var}}` substitution
- Conditional rules (e.g. thinking mode toggles)
- Response parsing (SSE style, JSON paths, done sentinel)

PocketRisu fetches `index.json` at startup, then loads referenced `providers/*.json` files. Users select a template, fill in their API key and options through a generated form, and start chatting. No app update needed to add a new provider.

### How PocketRisu uses this

```
PocketRisu boot
  ↓
  fetch https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main/index.json
  ↓
  fetch each providers/*.json on demand (when user installs a template)
  ↓
  generate form from schema + uiSchema → user fills in → ModelPreset is created
  ↓
  user chats → PocketRisu renders request template → vendor API
```

If the fetch fails, PocketRisu falls back to a build-time snapshot baked into the app binary. The registry is the source of truth at runtime; the snapshot is a safety net.

### Repository layout

```
pocketrisu-model-registry/
├── index.json            # list of all available provider templates
├── providers/
│   ├── openai.json
│   ├── anthropic.json
│   ├── google-ais.json
│   ├── vertex.json
│   ├── bedrock.json
│   ├── openrouter.json
│   ├── nanogpt.json
│   ├── vercel.json
│   ├── ollama.json
│   └── deepseek.json
├── schema/
│   └── provider-template.schema.json   # JSON Schema describing a provider template
├── README.md
└── LICENSE               # CC0 1.0
```

### Template versioning

Each `providers/*.json` carries an integer `version`. Increment it whenever the template's wire-level behavior changes (new fields, changed defaults, fixed paths). `index.json` mirrors the per-provider `version` and bumps its own `contentVersion`.

PocketRisu compares each installed preset's `installedTemplateVersion` against the registry's `version`. If they differ, the user sees an "update available" badge. The user reviews the diff and confirms before the embedded template is replaced; user-entered values are preserved.

### Contributing

PRs that add or update **official, first-party** vendor templates are welcome. Please:

1. Open an issue first if it's a new provider, so we can agree on the `id` and naming.
2. Match the style of existing templates (`anthropic.json` is a good reference).
3. Bump `version` and update `index.json`.
4. Test by pointing PocketRisu at your fork via `db.presetRegistrySources`.

### Terms of service for PRs

This is a **curated** registry. Templates targeting third-party proxies, unofficial reverse-engineered endpoints, jailbreak gateways, or bypass routes will be rejected. Such templates belong in a community registry that users can opt into; they do not belong in the official source.

Specifically rejected:

- Templates that point at unofficial / leaked / scraped endpoints.
- Templates designed to bypass a vendor's auth, rate limit, or geographic restriction.
- Templates that route through opaque proxy services without a publicly documented API.
- Templates whose primary purpose is to enable terms-of-service violations.

Accepted templates target vendor-documented APIs (OpenAI's `api.openai.com`, Anthropic's `api.anthropic.com`, Vercel's AI Gateway, etc.) or self-hostable open-source servers (Ollama).

### License

CC0 1.0 (public domain). See [LICENSE](./LICENSE).

---

## 한국어

### 목적

이 저장소는 [PocketRisu](https://github.com/PocketRisu/PocketRisu)(Risuai-NodeOnly)가 각 LLM 공급자(OpenAI, Anthropic, Gemini, Vertex AI, AWS Bedrock, OpenRouter, NanoGPT, Vercel AI Gateway, Ollama, DeepSeek 등)에 어떻게 접속하는지를 선언적으로 기술하는 JSON 템플릿을 호스팅합니다.

각 템플릿은 순수 JSON으로 다음을 정의합니다:

- 인증 방식 (bearer / x-api-key / query / google-service-account / aws-v4)
- 메시지 포맷 (`openai` / `anthropic` / `google`)
- 필드 스키마 (JSON Schema draft-07) + UI 힌트 (uiSchema)
- 추천 모델 목록
- `{{var}}` 치환을 사용하는 HTTP 요청 템플릿 (URL, 헤더, 바디)
- 조건부 규칙 (예: thinking 모드 토글)
- 응답 파싱 (SSE 스타일, JSON 경로, 종료 sentinel)

PocketRisu는 시작 시 `index.json`을 가져온 뒤, 참조된 `providers/*.json`을 필요할 때 로드합니다. 사용자는 템플릿을 선택하고 자동 생성된 폼에서 API 키와 옵션을 입력한 뒤 바로 채팅을 시작합니다. 새 공급자를 추가할 때 앱 업데이트가 필요 없습니다.

### PocketRisu의 사용 흐름

```
PocketRisu 부팅
  ↓
  https://raw.githubusercontent.com/PocketRisu/pocketrisu-model-registry/main/index.json fetch
  ↓
  사용자가 템플릿 설치 시 providers/*.json fetch
  ↓
  schema + uiSchema → 폼 자동 생성 → 사용자 입력 → ModelPreset 생성
  ↓
  사용자 채팅 → PocketRisu가 요청 템플릿을 렌더 → vendor API
```

fetch가 실패하면 앱 빌드 시점에 동결된 스냅샷으로 fallback합니다. 평시에는 레지스트리가 source of truth이고, 스냅샷은 안전망입니다.

### 저장소 구조

`index.json` (전체 목록) + `providers/*.json` (각 공급자) + `schema/provider-template.schema.json` (JSON Schema 메타).

### 템플릿 버전 관리

각 `providers/*.json`은 정수 `version`을 가집니다. wire-level 동작이 바뀔 때마다 증가시킵니다. `index.json`은 공급자별 `version`을 미러링하고 자체 `contentVersion`도 증가시킵니다.

PocketRisu는 각 설치된 프리셋의 `installedTemplateVersion`을 레지스트리의 `version`과 비교합니다. 다르면 "업데이트 가능" 뱃지가 표시됩니다. 사용자가 diff를 검토하고 확인하면 임베드된 템플릿이 교체되며, 입력 값은 유지됩니다.

### 기여

**공식 1차 vendor 템플릿**의 추가/갱신 PR을 환영합니다. 작업 전:

1. 새 공급자라면 먼저 이슈를 열어 `id` 명명을 합의합니다.
2. 기존 템플릿 스타일을 따르세요 (`anthropic.json` 참고).
3. `version`을 올리고 `index.json`도 갱신하세요.
4. 본인의 fork URL을 `db.presetRegistrySources`에 넣어 PocketRisu에서 테스트하세요.

### PR 정책 (Terms of Service)

이 레지스트리는 **큐레이션된** 공식 소스입니다. 다음과 같은 PR은 거절됩니다:

- 비공식/유출/스크레이핑한 엔드포인트를 가리키는 템플릿
- vendor의 인증, 레이트 리밋, 지역 제한을 우회하기 위해 설계된 템플릿
- 공개 문서가 없는 불투명한 프록시 서비스로 라우팅하는 템플릿
- 주된 목적이 vendor 약관 위반인 템플릿

vendor가 공식 문서화한 API(`api.openai.com`, `api.anthropic.com`, Vercel AI Gateway 등) 또는 자체 호스팅 가능한 오픈소스 서버(Ollama)를 가리키는 템플릿만 수락합니다.

비공식/우회 템플릿은 사용자가 선택적으로 추가하는 커뮤니티 레지스트리에 적합하며, 이 공식 소스의 범위가 아닙니다.

### 라이선스

CC0 1.0 (퍼블릭 도메인). [LICENSE](./LICENSE) 참조.
