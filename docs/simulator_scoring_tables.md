# Simulator Scoring Reference Tables

## 1. LMS (Learning Management System)

| Domain | Metrics Used | Scoring Logic |
|:-------|:-------------|:--------------|
| **Volume** | `total_active_minutes`, `baseline_active_minutes` | Compares active time to baseline. Below 70% = Low; Between 70-110% = Moderate; Above 110% = High |
| **Distribution** | `number_of_sessions`, `longest_session_minutes` | Few long sessions = Condensed; Several medium sessions = Spread; Many short sessions = Fragmented |
| **Consistency** | `activeDays` (count in 7 days) | 5+ days active = Consistent; 3-4 days = Somewhat; 1-2 days = Inconsistent |
| **Action Mix** | `reading_minutes`, `watching_minutes`, `exercise_practice_events`, `forum_posts` | Mostly reading/watching = Passive; Active exercises = Active; Mix of both = Balanced |
| **Session Quality** | `avg_session_length`, `longest_session_minutes` | Long focused sessions = Focused; Many interruptions = Interrupted; Very short = Short |

---

## 2. Screen Time

| Domain | Metrics Used | Scoring Logic |
|:-------|:-------------|:--------------|
| **Volume** | `total_screen_minutes` | Under 2h = Excellent; 2-4h = Good; 4-6h = Fair; 6-8h = Poor; Over 8h = Very Poor |
| **Distribution** | `longest_continuous_session` | Under 30min = Excellent; 30-45min = Good; 45-90min = Fair; Over 90min = Poor |
| **Late Night** | `late_night_screen_minutes` | Under 15min = Minimal; 15-45min = Moderate; Over 45min = High |

---

## 3. Social Media

| Domain | Metrics Used | Scoring Logic |
|:-------|:-------------|:--------------|
| **Volume** | `total_social_minutes` | Under 30min = Low; 30-90min = Moderate; 90-180min = High; Over 180min = Excessive |
| **Frequency** | `number_of_social_sessions` | Under 5 checks = Infrequent; 5-15 checks = Moderate; 15-30 checks = Frequent; Over 30 = Excessive |
| **Session Style** | `average_session_length` | Under 10min avg = Short bursts; 10-25min = Moderate; Over 25min = Long scrolling sessions |

---

## 4. Sleep

| Domain | Metrics Used | Scoring Logic |
|:-------|:-------------|:--------------|
| **Duration** | `total_sleep_minutes`, `baseline_sleep_minutes` | Under 6h = Poor; 6-7h = Fair; 7-9h = Good; Over 9h = Oversleep |
| **Continuity** | `number_of_awakenings` | 0-1 awakenings = Excellent; 2-3 = Good; 4+ = Fragmented |
| **Timing** | `sleep_onset_time`, `wake_time` | Within 30min of usual = Good; Shifted over 1h = Poor |

---

## 5. SRL (Self-Regulated Learning)

SRL is based on **questionnaire responses** (1-5 scale), not simulated behavioral data.

| Domain (Concept) | Metrics Used | Scoring Logic |
|:-----------------|:-------------|:--------------|
| **Efficiency** | `score` (1-5) | Higher score = better efficiency. 5 = Excellent, 1 = Poor |
| **Importance** | `score` (1-5) | Higher = stronger perceived importance of learning |
| **Tracking** | `score` (1-5) | Higher = better progress tracking habits |
| **Clarity** | `score` (1-5) | Higher = clearer understanding of tasks |
| **Effort** | `score` (1-5) | Higher = more effort invested |
| **Focus** | `score` (1-5) | Higher = better focus during study |
| **Help Seeking** | `score` (1-5) | Higher = more proactive in seeking help |
| **Community** | `score` (1-5) | Higher = more peer learning engagement |
| **Timeliness** | `score` (1-5) | Higher = better time management |
| **Motivation** | `score` (1-5) | Higher = more motivated |
| **Anxiety** ⚠️ | `score` (1-5) | **Inverted**: Lower score = better (less anxiety). 1 = Excellent, 5 = Poor |
| **Enjoyment** | `score` (1-5) | Higher = more enjoyment in learning |
| **Learning from Feedback** | `score` (1-5) | Higher = better use of feedback |
| **Self Assessment** | `score` (1-5) | Higher = better self-evaluation skills |

**Trend Calculation:** Compares earlier responses vs. recent responses. Increasing trend = Improving; Decreasing = Declining; No change = Stable.
