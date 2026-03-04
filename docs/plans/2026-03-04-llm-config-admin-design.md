# LLM API Configuration Admin Panel — Design

**Date:** 2026-03-04

## Problem

LLM configuration (provider, base URL, model names, API key) is currently read from environment variables at server startup. Changing the LLM provider requires editing `.env` and restarting the server. Admins need to swap providers on the fly — the same way they already edit system prompts.

## Goals

- Admin can change LLM provider, base URL, model names, API key, and tuning params from the admin dashboard without a server restart.
- Admin can test a new config before saving it.
- API key is never exposed in plaintext in the UI.
- Env vars continue to work as the default/seed (no breaking change for existing deployments).

## Out of Scope

- Per-user or per-session LLM config.
- Multiple simultaneous LLM provider configs.
- Streaming responses.

---

## Design

### 1. Data Layer

**New migration:** `backend/migrations/1650000000018_llm_config.sql`

```sql
CREATE TABLE IF NOT EXISTS public.llm_config (
    id           SERIAL PRIMARY KEY,
    provider     VARCHAR(50)   NOT NULL,
    base_url     VARCHAR(500)  NOT NULL,
    main_model   VARCHAR(100)  NOT NULL,
    judge_model  VARCHAR(100)  NOT NULL,
    max_tokens   INT           NOT NULL DEFAULT 2000,
    temperature  DECIMAL(3,2)  NOT NULL DEFAULT 0.7,
    timeout_ms   INT           NOT NULL DEFAULT 30000,
    api_key      VARCHAR(500)  NOT NULL DEFAULT '',
    updated_by   UUID REFERENCES public.users(id) ON DELETE SET NULL,
    updated_at   TIMESTAMP     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_llm_config_updated_at ON public.llm_config (updated_at DESC);
```

INSERT-not-UPDATE pattern (same as `system_prompts`): every save creates a new row, preserving full audit history. Active config = `ORDER BY updated_at DESC LIMIT 1`.

**New service:** `backend/services/llmConfigService.js`

Exports `getLlmConfig()` — checks DB for a row; if found, returns it; otherwise falls back to env vars. This is called on each LLM request, so DB changes take effect immediately.

**Modified:** `backend/services/apiConnectorService.js`

Replace the static `const config = { process.env.LLM_PROVIDER ... }` object with a call to `getLlmConfig()` inside `chatCompletion()` and `checkAvailability()`. Env vars remain the bootstrap default.

---

### 2. Backend Routes

All endpoints added to `backend/routes/admin.js`, behind `requireAdmin`.

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/admin/llm-config` | Return current active config. `api_key` is masked as `"●●●●●●"` if set, empty string if not. |
| `PUT` | `/admin/llm-config` | Validate fields, INSERT new row, return masked config. If `api_key === "●●●●●●"`, preserve the existing key from DB. |
| `POST` | `/admin/llm-config/test` | Accept a config payload, ping `{baseUrl}/v1/models` with it, return `{ success, models, latencyMs, error }`. Does **not** save. If `api_key === "●●●●●●"`, resolve the real key from DB before testing. |

**Validation rules for PUT/POST:**
- `provider`: non-empty string
- `base_url`: valid URL format
- `main_model`, `judge_model`: non-empty strings
- `max_tokens`: integer 1–32000
- `temperature`: float 0.0–2.0
- `timeout_ms`: integer 1000–120000

---

### 3. Frontend

#### `src/api/llmConfig.ts`

Typed API module following the same pattern as `csvLog.ts`:

```typescript
export interface LlmConfig {
    provider: string
    baseUrl: string
    mainModel: string
    judgeModel: string
    maxTokens: number
    temperature: number
    timeoutMs: number
    apiKey: string          // "●●●●●●" if set, "" if not
    updatedAt: string | null
}

export interface TestResult {
    success: boolean
    models: string[]
    latencyMs: number
    error?: string
}

export const fetchLlmConfig = () => api.get<LlmConfig>('/admin/llm-config')
export const saveLlmConfig  = (cfg: Partial<LlmConfig>) => api.put<LlmConfig>('/admin/llm-config', cfg)
export const testLlmConfig  = (cfg: Partial<LlmConfig>) => api.post<TestResult>('/admin/llm-config/test', cfg)
```

#### Redux — extend `src/redux/admin.ts`

Add to `AdminState`:
```typescript
llmConfig: LlmConfig | null
llmConfigStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
llmTestResult: TestResult | null
llmTestStatus: 'idle' | 'loading' | 'succeeded' | 'failed'
```

Add thunks: `fetchLlmConfig`, `updateLlmConfig`, `testLlmConfig`.

#### `src/components/AdminLlmConfigPanel.tsx`

Collapsible panel (same pattern as `AdminClusterDiagnosticsPanel`).

**Layout:**
```
▶ LLM API Configuration          [last updated: Mar 4, 2026 14:32]
──────────────────────────────────────────────────────────────────
  Provider       [lmstudio ▼]   (lmstudio | openai | groq | other)
  Base URL       [https://...                                     ]
  Main Model     [gpt-4o-mini                                     ]
  Judge Model    [gpt-4o-mini                                     ]
  API Key        [●●●●●●●●●●●●●●●●]  [Show / Hide]

  Max Tokens [2000]   Temperature [0.7]   Timeout ms [30000]

  [Test Connection]
  → ✓ Connected — 5 models available (124ms)
  → ✗ Failed — connection refused

  [Save Configuration]
```

**Behaviour:**
- On mount: dispatch `fetchLlmConfig` to load current config into form.
- "Show/Hide" toggles the API key field between `type="password"` and `type="text"`.
- "Test Connection" calls `testLlmConfig` with current form state — shows inline result, does not save.
- "Save Configuration" calls `updateLlmConfig` — shows success/error inline below button.
- If api_key field is unchanged from the masked placeholder `"●●●●●●"`, it is sent as-is; backend detects and preserves the real key.

#### `src/pages/Home.tsx`

Add `<AdminLlmConfigPanel />` in the admin section, alongside `AdminCsvLogPanel` and `AdminClusterDiagnosticsPanel`.

---

## File Checklist

| File | Change |
|------|--------|
| `backend/migrations/1650000000018_llm_config.sql` | New |
| `backend/services/llmConfigService.js` | New |
| `backend/services/apiConnectorService.js` | Modified — dynamic config |
| `backend/routes/admin.js` | Modified — 3 new endpoints |
| `src/api/llmConfig.ts` | New |
| `src/redux/admin.ts` | Modified — llmConfig state + thunks |
| `src/components/AdminLlmConfigPanel.tsx` | New |
| `src/pages/Home.tsx` | Modified — add panel |
