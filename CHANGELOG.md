# Changelog

All notable changes to this project are documented here.

---

## [Unreleased] — feature/chatbot

### Breaking Changes

#### LMS Scoring Dimension: `action_mix` → `participation_variety`

The LMS concept's third scoring dimension has been renamed and its underlying metric replaced.

| | Old | New |
|---|---|---|
| Dimension key | `action_mix` | `participation_variety` |
| Metric | `active_percent` | `participation_score` |
| Formula | `(active_events / total_events) * 100` | `LEAST(quiz,3)/3×34 + LEAST(assign,2)/2×33 + LEAST(forum,2)/2×33` |
| Range | 0–100 (but always ~100% via REST APIs) | 0–100 (breadth-based) |

**Why:** `active_percent` computed via Moodle module REST APIs was always 100% because REST endpoints only expose active events — passive events (reading, watching) are not accessible without the event log. This gave the dimension zero variance, making it useless for PGMoE clustering.

**Impact on stored data:** Existing rows in `concept_scores.aspect_breakdown` contain `action_mix` keys. New rows written after this change contain `participation_variety` keys. The frontend tooltip lookup silently falls through for old keys (no visible error, but the domain-level breakdown tooltip is blank for historical scores).

**Migration:** No automated migration provided. Historical scores are display-only and will not be re-scored. New scores going forward use `participation_variety`.

---

### New Features

#### Moodle LMS Integration

- Real LMS data can now be synced from a Moodle instance via the Moodle REST API.
- New service: `backend/services/moodleService.js` — REST adapter for quizzes, assignments, and forum posts.
- New simulator: `backend/services/moodleEventSimulator.js` — generates synthetic Moodle-shaped data for test accounts using the same `aggregateToDaily()` pipeline as real syncs.
- New admin routes: `GET /api/lms/admin/status`, `POST /api/lms/admin/sync/:userId`, `POST /api/lms/admin/sync-all`.
- Environment variables: `MOODLE_BASE_URL`, `MOODLE_TOKEN` (optional — app starts without them; LMS routes return `503` if unconfigured).

#### AI Chatbot

- LLM-powered coaching chatbot with context from the student's actual scores, judgments, and questionnaire data.
- Session management with 10-day rolling summarization.
- Admin-editable system and alignment prompts stored in PostgreSQL.
- Alignment validation via LLM-as-Judge before every response is shown.

#### Admin Cluster Diagnostics Panel

- New admin UI panel showing per-concept PGMoE cluster run history (silhouette score, Davies-Bouldin index, selected K, cluster sizes).

#### PGMoE Scoring Pipeline

- Complete Parsimonious Gaussian Mixture of Experts implementation in `backend/services/scoring/pgmoeAlgorithm.js`.
- Nightly cron rescoring for all active users (`backend/services/cronService.js`).
- Percentile-based dial values (P5/P50/P95) per cluster stored in `peer_clusters`.

---

### Security Fixes

- **SEC-01**: `POST /api/auth/legacy-login` now returns `404` in `NODE_ENV=production`, preventing unauthenticated role-based admin access.
- **SEC-02/CQ-C1**: All SQL `INTERVAL` expressions are now parameterised (`$n * INTERVAL '1 day'`) — eliminated latent injection surface.
- **SEC-08**: `GET /api/chat/history` now verifies session ownership before returning messages (`WHERE id = $1 AND user_id = $2`), closing an IDOR vulnerability.

---

### Infrastructure

- CI pipeline expanded: backend job added (runs `npm audit`, `npm test --coverage`); triggers extended to `feature/**` branches and all pull requests.
- `compose.yml`: hardcoded secrets replaced with `${SESSION_SECRET}`, `${PGPASSWORD}`, `${MOODLE_TOKEN:-}` env var references.
- `envValidation.js`: weak-credential checks (`dev-secret`, `password`) now cause startup failure in production (`missing[]` instead of `warnings[]`).

---

### Removed / Deprecated

- `backend/services/annotators/index.js` — deleted (was a CommonJS barrel in an ESM package; `require()` would crash at runtime). Services are imported directly.
- `lmsDataSimulator.js` — superseded by `moodleEventSimulator.js`. File still exists but is no longer called by the simulation orchestrator. Removal tracked in backlog.
