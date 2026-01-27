# Screen Time & Social Media Scoring Deep Dive

This document details the end-to-end calculation of **Screen Time** and **Social Media** scores, which are treated as two separate but correlated concepts.
**Note:** Scoring logic has been updated to use **Absolute Thresholds** rather than relative baselines, ensuring better alignment with text judgments (e.g., "High Usage" now consistently results in a lower score).

---

# Part 1: Screen Time Scoring

## 1. Raw Data Generation (Simulator)
The `screenTimeDataSimulator.js` generates daily session records (`screen_time_sessions`).
**Key Metrics (per day):**
- `total_screen_minutes`: Total daily screen time.
- `longest_continuous_session`: Duration of the single longest session.
- `late_night_screen_minutes`: Usage after 10 PM.

## 2. Aspect Scoring (0-100 Calculation)
The `screenTimeAnnotationService.js` calculates raw scores for **3 Domains**.
**Lower values are better**, so formulas are inverted. Scores are piecewise linear based on scientific/health guidelines.

### Domain A: Volume (Absolute)
Measures total daily screen time.
- **Metric**: `total_screen_minutes`
- **Calculation**:
  - `0 - 120` min (2h): **90-100** (Excellent)
  - `120 - 240` min (4h): **75-90** (Good)
  - `240 - 360` min (6h): **60-75** (Fair)
  - `360 - 480` min (8h): **40-60** (Poor)
  - `> 480` min: **< 40** (Very Poor)

### Domain B: Distribution (Session Length)
Measures session fragmentation vs. binges.
- **Metric**: `longest_continuous_session` (minutes).
- **Calculation**:
  - `0 - 30` min: **100** (Excellent - Frequent breaks)
  - `30 - 45` min: **85-100** (Good)
  - `45 - 90` min: **60-85** (Fair)
  - `> 90` min: **< 60** (Poor - Extended sessions)

### Domain C: Late Night
Measures usage after 10 PM.
- **Metric**: `late_night_screen_minutes`.
- **Calculation**:
  - `0 - 15` min: **90-100** (Minimal impact)
  - `15 - 45` min: **60-90** (Moderate impact)
  - `> 45` min: **< 60** (High impact)

---

# Part 2: Social Media Scoring

## 1. Raw Data Generation
The `socialMediaDataSimulator.js` generates:
- `total_social_minutes`: Total daily social media time.
- `number_of_social_sessions`: Number of checking events.
- `average_session_length`: Avg duration of a check.

## 2. Aspect Scoring (0-100 Calculation)

### Domain A: Volume (Absolute)
Measures total consumption.
- **Metric**: `total_social_minutes`.
- **Calculation**:
  - `0 - 30` min: **90-100** (Excellent)
  - `30 - 90` min: **60-90** (Good/Fair)
  - `90 - 180` min: **30-60** (Poor)
  - `> 180` min: **< 30** (Excessive)

### Domain B: Frequency (Checking)
Measures attention fragmentation.
- **Metric**: `number_of_checks`.
- **Calculation**:
  - `0 - 5` checks: **95-100** (Infrequent - High Focus)
  - `5 - 15` checks: **70-95** (Moderate)
  - `15 - 30` checks: **40-70** (Frequent - Fragmented)
  - `> 30` checks: **< 40** (Excessive)

### Domain C: Session Style (Doomscrolling)
Measures average session length.
- **Metric**: `avg_session_length` (minutes).
- **Calculation**:
  - `0 - 10` min: **90-100** (Controlled / Short Bursts)
  - `10 - 25` min: **60-90** (Moderate)
  - `> 25` min: **< 60** (Long / Scrolling Behavior)

---

## 3. Judgment Logic Alignment
The scoring thresholds now align with the text judgments.

| Domain | Judgment | Score Range | Label Logic |
| :--- | :--- | :--- | :--- |
| **Social Volume** | "Low" (<30m) | **90-100** | Aligned (Excellent) |
| | "Moderate" (<90m) | **60-90** | Aligned (Good/Fair) |
| | "High" (<180m) | **30-60** | Aligned (Poor) |
| | "Excessive" (>180m)| **< 30** | Aligned (Very Poor) |
| **SM Frequency** | "Infrequent" (<=5) | **95-100** | Aligned (Excellent) |
| | "Moderate" (<=15) | **70-95** | Aligned (Good) |
| | "Frequent" (>15) | **< 70** | Aligned (Poor/Fair) |

## 4. Overall Concept Scoring
**Method**: **Unweighted Average** of the 3 domains.
$$
\text{Concept Score} = \frac{\text{Score}_A + \text{Score}_B + \text{Score}_C}{3}
$$
