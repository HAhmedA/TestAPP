# LMS Scoring Deep Dive

This document details the end-to-end calculation of the Learning Management System (LMS) score, starting from raw simulated data points to the final concept score.

## 1. Raw Data Generation (Simulator)
The `lmsDataSimulator.js` generates daily session records (`lms_sessions`).
**Key Metrics (per day):**
- `total_active_minutes`: Total time active in LMS.
- `total_events`: Sum of all actions (viewing, reading, posting, etc.).
- `number_of_sessions`: How many distinct login sessions occurred.
- `longest_session_minutes`: Duration of the single longest session.
- `exercise_practice_events`: Number of practice exercises attempted.
- `forum_posts`: Number of posts made.
- `days_active_in_period`: Always 1 for daily records.

## 2. Aggregation (Annotator)
The `lmsAnnotationService.js` aggregates these daily records over the **past 7 days**.

$$
\text{Active Days} = \text{Count of unique dates with activity in past 7 days}
$$

**Baselines:**
Each user has a baseline (e.g., from `lms_baselines`).
- `baseline_active_minutes` (Default: ~350 min/week)
- `baseline_sessions` (Default: ~4/week)

## 3. Aspect Scoring (0-100 Calculation)
The system evaluates **5 Domains**. Each domain gets a raw score from 0-100 based on specific rules.

### Domain A: Activity Volume
Measures total engagement volume against the active minutes.
- **Metric**: `total_events` (actions count).
- **Calculation**:
  $$
  \text{Score} = \min(100, \text{total\_events} \times 2)
  $$
- **Logic**: 50 events in a week reaches the max score of 100.

### Domain B: Distribution
Measures how spread out the learning was across the week.
- **Metric**: `activeDays` (1-7).
- **Calculation**:
  $$
  \text{Score} = \left( \frac{\text{Active Days}}{7} \right) \times 100
  $$
- **Logic**: 7 days = 100%, 1 day = ~14%.

### Domain C: Consistency
Measures adherence to a consistent schedule.
- **Metric**: `activeDays` (proxy for consistency).
- **Calculation**:
  $$
  \text{Score} = \min\left(100, \left( \frac{\text{Active Days}}{5} \right) \times 100\right)
  $$
- **Logic**: 5 days is considered "fully consistent" (100%). 3 days = 60%.

### Domain D: Action Mix
Measures the balance between passive learning (reading/watching) and active learning (practice/posting).
- **Metric**: `activePercent` (percentage of time NOT spent reading/watching).
- **Calculation**:
  $$
  \text{Score} = 50 + \left( \frac{\text{Active Percent}}{100} \right) \times 50
  $$
- **Logic**:
  - 0% active (all passive) = **50** (Minimum score).
  - 50% active = 75.
  - 100% active = **100**.

### Domain E: Session Quality
Measures the depth/focus of study sessions.
- **Metric**: `avgDuration` = `total_active_minutes / number_of_sessions`.
- **Calculation**:
  - If `avgDuration >= 30` min: **100**.
  - If `avgDuration >= 5` min:
    $$
    \text{Score} = 40 + (\text{avgDuration} - 5) \times \left(\frac{60}{25}\right)
    $$
    *(Scales linearly from 40 to 100 between 5 and 30 minutes)*
  - If `avgDuration < 5` min:
    $$
    \text{Score} = \text{avgDuration} \times 8
    $$
    *(Penalized heavily for micro-sessions)*

## 4. Overall LMS Score Calculation
The final LMS Concept Score is derived in `conceptScoreService.js`.

**Method**: **Unweighted Average** of the available domain scores.

$$
\text{LMS Overall Score} = \frac{\text{Score}_A + \text{Score}_B + \text{Score}_C + \text{Score}_D + \text{Score}_E}{N}
$$
*(Where N is the number of valid domains evaluated, usually 5)*

## 5. Judgment Generation Logic
The following tables list every possible hardcoded judgment output based on the rules defined in `THRESHOLDS`.

### Domain 1: Activity Volume
Based on `ratio = total_active_minutes / baseline.baseline_active_minutes`.

| Condition | Internal Key | Main Label | Variation String |
| :--- | :--- | :--- | :--- |
| `ratio < 0.70` | `volume_low` | "LMS activity was low" | "LMS activities are sparse" |
| `ratio <= 1.10` | `volume_moderate` | "LMS activity was moderate" | "Moderate engagement with this subject" |
| `ratio > 1.10` | `volume_high` | "LMS activity was high" | "Substantial LMS activity" |

### Domain 2: Activity Distribution
Based on `number_of_sessions`, `longest_session_minutes`, and `avg_minutes`.

| Condition | Internal Key | Main Label | Variation String |
| :--- | :--- | :--- | :--- |
| `sessions <= 2` AND `longest >= 60` | `dist_condensed` | "LMS activity was condensed" | "Work occurred in one main block" |
| `sessions` in [3, 5] AND `longest < 60` | `dist_spread` | "LMS activity was spread out" | "Engagement was evenly distributed" |
| `sessions > 5` AND `avg < 10` | `dist_fragmented` | "LMS activity was fragmented" | "Many short study sessions" |
| *Default / Fallback* | `dist_spread` | "LMS activity was spread out" | "Engagement was distributed" |

### Domain 3: Consistency
Based on `days_active` (in 7-day period).

| Condition | Internal Key | Main Label | Variation String |
| :--- | :--- | :--- | :--- |
| `days >= 5` | `cons_consistent` | "LMS engagement was consistent" | "Engagement occurred on most days" |
| `days` in [3, 4] | `cons_somewhat` | "LMS engagement was somewhat inconsistent" | "Irregular engagement pattern" |
| `days <= 2` | `cons_inconsistent` | "LMS engagement was inconsistent" | "Few active days for this subject" |

### Domain 4: Action Mix
Evaluate balance between passive (read/watch) and active (practice/exercises).
**Thresholds**: `Passive Ratio` (> 0.85 = Passive), `Practice Events` (>= 1 = Active).

| Condition | Internal Key | Main Label |
| :--- | :--- | :--- |
| `passive_ratio > 0.85` AND `practice_events == 0` | `mix_passive` | "Engagement was mostly passive" |
| `practice_events >= 1` | `mix_active` | "Engagement included active practice" |
| `passive_ratio` in [0.50, 0.75] AND `practice_events >= 1` | `mix_balanced` | "Engagement was well balanced" |

#### Action Mix Sub-Judgments (Intensity)
These do not generate a top-level label but influence the sentence construction.

**Practice Intensity:**
| Condition | Internal Key | Label |
| :--- | :--- | :--- |
| `events >= 4` | `prac_high` | "Practice activity was high" |
| `events` in [1, 3] | `prac_moderate` | "Practice activity was moderate" |
| `events == 0` | `prac_low` | "Practice activity was low" |

**Discussion Participation:**
| Condition | Internal Key | Label |
| :--- | :--- | :--- |
| `posts >= 3` | `disc_high` | "Discussion participation was high" |
| `posts` in [1, 2] | `disc_moderate` | "Discussion participation was moderate" |
| `posts == 0` | `disc_low` | "Discussion participation was low" |

### Domain 5: Session Quality
Based on session length and focus.

| Condition | Internal Key | Main Label |
| :--- | :--- | :--- |
| `avg_min >= 25` AND `longest >= 45` | `qual_focused` | "Study sessions were focused" |
| `avg_min < 10` AND `sessions >= 5` | `qual_interrupted` | "Study sessions were interrupted" |
| `total < 45` AND `avg_min < 10` | `qual_short` | "Study sessions were short" |
| *Default* | `qual_standard` | "Study sessions were average length" |

## 6. Final Sentence Composition
The system creates two sentences by combining the variations above.

**Sentence 1:** `[Volume Variation] [Conditioned Conjunction] [Similarity Variation].`
- *Logic:* If consistency is "inconsistent" or "somewhat", it appends the **Consistency** variation (e.g., "and irregular engagement pattern"). Otherwise, it appends the **Distribution** variation (e.g., "and engagement was distributed").

**Sentence 2:** `[Action Mix Label], with [Mix Details].`
- *If Passive:* "...with little exercise practice or discussion activity"
- *If Active:* "...including regular exercise practice" (adds "and discussion participation" if discussion is not low).
- *If Balanced:* "...combining content review with active practice"
