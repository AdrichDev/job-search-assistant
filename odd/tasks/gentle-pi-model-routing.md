# Gentle Pi / Gentle Shell model routing — NaN Builders + Anthropic + OpenAI

Scope: user-home Pi configuration (`~/.pi`). No repository source changes.
Providers allowed: `nan` (NaN Builders), `anthropic` (Claude subscription), `openai-codex` (ChatGPT subscription).
Providers forbidden: `openrouter` (any agent, profile, or fallback).

## Specs

S1 — `No utilizar OpenRouter en ningún agente, perfil ni fallback.`

S2 — `Priorizar NaN para tareas habituales y de alto volumen.`

S3 — `Reservar Anthropic y OpenAI para tareas de razonamiento complejo, arquitectura y revisiones críticas.`

S4 — `Aprovechar las suscripciones existentes, no las APIs de pago por consumo.`

S5 — `No modificar los prompts, las skills ni las funciones originales de Gentle AI.`

S6 — `Conservar una copia de seguridad de toda la configuración actual.`

S7 — Requested assignment table (verbatim, agent → model → effort):

```
orchestrator       nan/deepseek-v4-flash     medium
context-builder    nan/qwen3.8-flash         low
oracle             anthropic/claude-opus-5-5 high
planner            OpenAI GPT-6 Astra        high
researcher         nan/deepseek-v4-flash     medium
scout              nan/qwen3.8-flash         low
worker             nan/glm5.3-flash          high
reviewer           nan/glm5.3-flash          high
review-readability nan/glm5.3-flash          medium
review-reliability OpenAI GPT-6 Astra        high
review-resilience  nan/glm5.3-flash          xhigh (max en NaN)
review-risk        anthropic/claude-opus-5-5 high
review-refuter     anthropic/claude-opus-5-5 xhigh
gentle-ai-explore  nan/qwen3.8-flash         low
gentle-ai-worker   nan/glm5.3-flash          high
gentle-ai-verify   nan/glm5.3-flash          high
jd-fix-agent       nan/glm5.3-flash          high
jd-judge-a         anthropic/claude-opus-5-5 high
jd-judge-b         OpenAI GPT-6 Astra        xhigh
sdd-apply          nan/glm5.3-flash          medium
sdd-archive        nan/qwen3.8-flash         low
sdd-design         anthropic/claude-opus-5-5 high
sdd-explore        nan/qwen3.8-flash         low
sdd-init           nan/qwen3.8-flash         low
sdd-onboard        nan/qwen3.8-flash         low
sdd-proposal       nan/deepseek-v4-flash     medium
sdd-spec           OpenAI GPT-6 Astra        medium
sdd-status         nan/qwen3.8-flash         low
sdd-sync           nan/qwen3.8-flash         low
sdd-tasks          nan/deepseek-v4-flash     medium
sdd-verify         nan/glm5.3-flash          high
```

S8 — `Para GPT utiliza el identificador real disponible en mi cuenta, preferentemente openai-codex/gpt-6-astra, si está admitido. Si no lo está, selecciona el mejor modelo de razonamiento disponible mediante mi suscripción de ChatGPT, sin recurrir a la API de pago.`

S9 — `Los niveles de razonamiento de DeepSeek y Qwen se deben tratar como automáticos si el proveedor NaN no permite controlar efectivamente su profundidad. No simules control sobre parámetros que el proveedor ignore.`

S10 — Fallback priorities (verbatim):

```
Anthropic crítico: Claude Opus 5.5 → GPT de OpenAI → GLM 5.3 Flash
OpenAI crítico:    GPT de OpenAI → Claude Opus 5.5 → GLM 5.3 Flash
NaN normal:        DeepSeek V4 Flash → GLM 5.3 Flash → Qwen 3.8 Flash
Código:            GLM 5.3 Flash → DeepSeek V4 Flash
```

plus: `No cambies automáticamente de NaN a Anthropic u OpenAI para trabajos rutinarios.` and `El fallback debe activarse únicamente ante errores confirmados de cuota, límite de uso o indisponibilidad del modelo, no ante errores de código, herramientas o validación.`

S11 — `Si existe una funcionalidad oficial compatible, configúrala y pruébala. Si no existe, NO inventes propiedades de configuración ni modifiques código interno del framework.` Profiles to create: `mixto`, `solo-nan`, `revision-premium`, switchable via `/gentle:profiles`.

S12 — `Verifica que Anthropic y OpenAI estén configurados mediante las suscripciones autenticadas y no mediante claves API con facturación adicional.`

S13 — `Cuando las suscripciones estén agotadas, debe existir una forma clara de continuar trabajando únicamente con NaN.`

S14 — Validation list: effective routing per agent, models and reasoning levels, one request per provider, no OpenRouter anywhere, no inherited Claude where NaN was configured, saved profiles plus quota-recovery procedure, report which fallbacks are automatic vs manual, show final config and modified files.

S15 — `No des por realizada ninguna funcionalidad sin comprobarla. Conserva las configuraciones actuales si aparece una incompatibilidad.`

## Facts established by exploration

- `nan` = NaN Builders (`https://api.nan.builders/v1`), registered by gentle-pi `lib/nan-provider.ts`, auth = `api_key`. Models: `deepseek-v4-flash`, `gemma4`, `glm5.3`, `glm5.3-flash`, `mimo-v2.6-flash`, `qwen3.6`, `qwen3.8-flash`.
- Adaptive-reasoning NaN models (provider ignores depth): `deepseek-v4-flash`, `qwen3.8-flash`, `mimo-v2.6-flash`.
- GLM 5.3 / 5.3 Flash exposed levels: low, medium, high, max (`off`, `minimal`, `xhigh` hidden).
- `anthropic/claude-opus-5-5` and `openai-codex/gpt-6-astra` both expose `xhigh`; both authenticated via OAuth (subscription), smoke-tested OK.
- Real routable roster: 22 discoverable agents (`~/.pi/agent/agents`) + provider review roles `review-refuter`, `review-validator` + reserved `orchestrator`. There is no `context-builder`, `oracle`, `planner`, `researcher`, `scout`, `worker`, `reviewer` agent: those are conceptual roles expressed through the real roster.
- Profiles live at `~/.pi/gentle-ai/profiles.json`; global routing at `~/.pi/gentle-ai/models.json`; materialized routing at `~/.pi/agent/subagents.json` (`model_profiles`). Agent frontmatter carries `anthropic/claude-sonnet-5-5`, so an omitted role inherits Claude — profiles must be complete snapshots.
- No automatic per-agent/per-provider fallback exists in pi 1.3.0 or gentle-pi (only a startup `modelFallbackMessage`). Fallback is therefore manual via profile binding.

## Tasks

| ID | Spec | Route | Status |
|----|------|-------|--------|
| T1 | S6 | inline: timestamped backup of settings.json, subagents.json, models.json, profiles.json, agent frontmatter; auth.json sha256 recorded | done |
| T2 | S7,S9,S11 | inline: `~/.pi/gentle-ai/profiles.json` (mixto, solo-nan, revision-premium; active=mixto; `current`/`OpenSource` preserved) | done |
| T3 | S7,S9 | inline: `~/.pi/gentle-ai/models.json` = mixto routing (24 roles) | done |
| T4 | S1,S2,S4,S7 | inline: settings.json defaults → nan/deepseek-v4-flash/medium; `enabledModels` limited to the three providers; legacy `subagents.agentOverrides` removed | done |
| T5 | S1,S7,S14-5 | inline: `subagents.json` model_profiles reconciled to mixto for the 22 discoverable agents; 7 ghost agents dropped | done |
| T6 | S14,S15 | inline scripts: 30 structural checks + runtime probes per profile | done |
| T7 | S14 | inline: final report | done |

## Log

L1 — `Quiero optimizar mi configuración de Gentle Shell / Gentle Pi para trabajar exclusivamente con NaN Builders, Anthropic y OpenAI.` (full request text carried into `## Specs` above; verbatim per section).

L2 — Decision: no auto-fallback feature exists → implement the three official profiles and document the manual quota procedure; do not invent config keys.

L3 — Evidence: `nan/glm5.3` (full) answers `401 {"message":"This API key does not have access to the requested model.","type":"auth_error","param":"model"}`. Entitled NaN models verified by live request: `deepseek-v4-flash`, `qwen3.8-flash`, `glm5.3-flash`, `gemma4`, `mimo-v2.6-flash`, `qwen3.6`. Not entitled: `glm5.3`.

L4 — User correction: `es gml 5.3 flash`. All eight `nan/glm5.3` roles in `solo-nan` were replaced with `nan/glm5.3-flash`; the profile still uses only entitled models.

L5 — Evidence: ad-hoc subagent dispatch is gated. Allowed probes: `gentle-ai-explore`, `gentle-ai-worker`, `jd-judge-a`, `jd-judge-b`. Refused by guard: `review-*`, `sdd-*`, `gentle-ai-verify`. Runtime probes therefore cover one allowed role per profile plus direct per-provider smoke tests.

L6 — Runtime evidence (parent session model, child routing):

```
mixto             orchestrator deepseek-v4-flash; gentle-ai-explore -> nan/qwen3.8-flash (frozen:global)
solo-nan          jd-judge-a -> nan/glm5.3-flash high (frozen:global)
revision-premium  jd-judge-b -> openai-codex/gpt-6-astra xhigh (frozen:global)
```

L7 — Precedence audit: no clone-local pin, no repository declaration; global `active` is the only default layer. Sessions are frozen at startup, so sessions started before this change keep profile `current` (Opus) until a new session starts or `Enter` binds `mixto` in `/gentle:profiles`.

L8 — Pre-existing profiles `current` (Opus routing + `orchestrator: anthropic/claude-opus-4-8`) and `OpenSource` (empty) were preserved, not deleted. They are inert unless applied or bound.

L9 — OpenRouter logged out. No CLI logout exists (`/logout` is TUI-only; `pi auth` exposes print-api-key / print-bearer-token / check), so the `openrouter` entry was removed from `~/.pi/agent/auth.json` (backup: `<backup>/auth.json.before-openrouter-logout`, mode 600). Post-check: `pi auth check --provider openrouter` → `{"status":"not_ready","reason":"credentials_not_configured"}`; `anthropic`, `openai`, `openai-codex` stay `ready`/oauth; `nan` answers live requests. Providers used by the profiles: `nan`, `anthropic`, `openai-codex` only. Credential type removed was an access-token-only entry (no refresh token), i.e. an OpenRouter API key, unrecoverable locally without pasting a new key.

L10 — User authorized the Opus effort reduction recommended by the verification. Kept `xhigh` only at `review-refuter`. Changed to `high`: `mixto.review-validator`, `revision-premium.review-validator`, `revision-premium.review-risk`, `revision-premium.sdd-design`; synchronized global `models.json.review-validator`. Backups: `<backup>/profiles.json.before-opus-effort-2026-10-21T12-20-18` and corresponding `models.json`. Targeted validation passes. The older whole-config checker reports exactly one expected stale assertion because it compares `auth.json` to its pre-OpenRouter-logout hash; no routing assertion fails.
