# Annotation Pipeline — Full Data Flow

## Overall Architecture

```
Simulator ──► DB Session Tables ──► peerStatsService (getAllUserMetrics)
                   │                         │
                   ▼                         ▼
          Judgment Service            Z-Score Computation
          (computeJudgments)                 │
                   │                         ▼
                   ▼                  getRawScoresForScoring
          DB Judgment Tables ·····►  (attaches labels from judgments)
                                             │
                                             ▼
                                    conceptScoreService
                                    (computeAndStoreRawScore)
                                             │
                                             ▼
                                      concept_scores table
                                             │
                                             ▼
                                    Frontend (ScoreGauge + Home)
```

**Flow:** Simulators → DB → `peerStatsService` reads raw metrics → computes Z-scores → annotation service attaches judgment labels → `conceptScoreService` averages & stores → Frontend displays.

**Z-Score Thresholds:**
| Category | Z Range | Color | Internal Score |
|---|---|---|---|
| Requires Improvement | Z < -0.5 | `#86efac` | 25 |
| Good | -0.5 ≤ Z ≤ 0.5 | `#22c55e` | 50 |
| Very Good | Z > 0.5 | `#15803d` | 85 |

---

## 1. LMS

**Simulator:** `backend/services/simulators/lmsDataSimulator.js` → `lms_sessions`  
**Annotation:** `backend/services/annotators/lmsAnnotationService.js`  
**Aggregation:** SUM over 7 days (total weekly engagement)

| Domain | Metric Key | DB Column | Inverted? | Rationale |
|---|---|---|---|---|
| `volume` | `total_active_minutes` | `SUM(total_active_minutes)` | ❌ | More time on LMS = better |
| `consistency` | `days_active` | `COUNT(DISTINCT session_date)` | ❌ | More active days = better |
| `participation_variety` | `participation_score` | `LEAST(quiz,3)/3×34 + LEAST(assign,2)/2×33 + LEAST(forum,2)/2×33` | ❌ | Broader tool usage = better |
| `session_quality` | `avg_session_duration` | `SUM(active) / SUM(sessions)` | ❌ | Longer sessions = better |

> **Note:** LMS uses SUM intentionally — total weekly activity is the correct comparison metric for engagement. Students with fewer active days genuinely have less engagement.

**Labels from:** `lms_judgments.judgment_details` (JSON)

---

## 2. Sleep

**Simulator:** `backend/services/simulators/sleepDataSimulator.js` → `sleep_sessions`  
**Annotation:** `backend/services/annotators/sleepAnnotationService.js`  
**Aggregation:** AVG over 7 days

| Domain | Metric Key | DB Column | Inverted? | Rationale |
|---|---|---|---|---|
| `duration` | `sleep_minutes` | `AVG(total_sleep_minutes)` | ❌ | More sleep = better |
| `continuity` | `awakenings` | `AVG(awakenings_count)` | ✅ | Fewer wake-ups = better |
| `timing` | `bedtime_stddev` | `STDDEV_POP(bedtime_hour)` | ✅ | Lower variance = more consistent |

**Labels from:** `sleep_judgments.explanation` (joined via session ID)

---

## 3. Screen Time

**Simulator:** `backend/services/simulators/screenTimeDataSimulator.js` → `screen_time_sessions`  
**Annotation:** `backend/services/annotators/screenTimeAnnotationService.js`  
**Aggregation:** AVG over 7 days

| Domain | Metric Key | DB Column | Inverted? | Rationale |
|---|---|---|---|---|
| `volume` | `screen_minutes` | `AVG(total_screen_minutes)` | ✅ | Less screen time = better |
| `distribution` | `longest_session` | `AVG(longest_continuous_session)` | ✅ | Shorter sessions = better |
| `pre_sleep` | `late_night` | `AVG(late_night_screen_minutes)` | ✅ | Less pre-sleep use = better |

**Labels from:** `screen_time_judgments.explanation` (joined via session ID)

## 4. SRL (Self-Regulated Learning)

**Simulator:** `backend/services/simulators/srlDataSimulator.js` → questionnaire responses → `srl_annotations`  
**Annotation:** `backend/services/annotators/srlAnnotationService.js`  
**Aggregation:** Reads `avg_score` from `srl_annotations` directly

Each SRL concept is its own domain. Z-scores computed per concept across all users.

| Domain | Inverted? | Short Name |
|---|---|---|
| `efficiency` | ❌ | Efficiency |
| `importance` | ❌ | Perceived Importance |
| `tracking` | ❌ | Progress Tracking |
| `clarity` | ❌ | Task Clarity |
| `effort` | ❌ | Effort |
| `focus` | ❌ | Focus |
| `help_seeking` | ❌ | Help Seeking |
| `community` | ❌ | Peer Learning |
| `timeliness` | ❌ | Timeliness |
| `motivation` | ❌ | Motivation |
| `anxiety` | ✅ | Lower anxiety = better |
| `enjoyment` | ❌ | Enjoyment |
| `learning_from_feedback` | ❌ | Learning from Feedback |
| `self_assessment` | ❌ | Self Assessment |

**Labels from:** `srl_annotations.annotation_text`

---

## Key Files

| File | Role |
|---|---|
| `backend/services/scoring/peerStatsService.js` | Z-score computation for all concepts |
| `backend/services/scoring/scoreComputationService.js` | Orchestrates score computation |
| `backend/services/scoring/conceptScoreService.js` | Stores scores, computes trends |
| `backend/services/simulationOrchestratorService.js` | Runs all simulators + triggers scoring |
