# Simulated Data Documentation

This document provides a comprehensive overview of all simulated data types, their attributes, annotation domains, and calculation methods.

---

## Overview

The system generates data for 5 domains, each based on student achievement profiles (`high_achiever`, `average`, `low_achiever`):

| Domain | Simulator File | Annotation File | Primary Purpose |
|--------|---------------|-----------------|-----------------|
| **Sleep** | `sleepDataSimulator.js` | `sleepAnnotationService.js` | Sleep patterns & quality |
| **SRL** | `srlDataSimulator.js` | `srlAnnotationService.js` | Self-regulated learning questionnaire |
| **LMS** | `lmsDataSimulator.js` | `lmsAnnotationService.js` | Learning management system activity |
| **Screen Time** | `screenTimeDataSimulator.js` | `screenTimeAnnotationService.js` | Digital device usage |
| **Social Media** | `socialMediaDataSimulator.js` | `socialMediaAnnotationService.js` | Social platform engagement |

---

## 1. Sleep Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_sleep_minutes` | Total sleep duration | ~450 ± 30 min (~7.5h) | ~400 ± 60 min (~6.7h) | ~330 ± 60 min (~5.5h) |
| `time_in_bed_minutes` | Total time in bed | ~480 ± 20 min (~8h) | ~460 ± 40 min | ~420 ± 60 min |
| `bedtime_hour` | When sleep begins | 23:00 ± 30min | 23:30 ± 1.5h | 01:00 ± 2h |
| `wake_hour` | When waking up | 07:00 ± 30min | 07:30 ± 1h | 08:00 ± 1.5h |
| `awakenings_count` | Number of wake-ups | ~1 ± 1 | ~3 ± 2 | ~5 ± 3 |
| `awake_minutes` | Time awake during night | ~5 ± 5 min | ~15 ± 10 min | ~30 ± 15 min |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Anomaly chance | 10% (bad night) | 15% (random) | 8% (good night) |
| Weekend bedtime shift | +1 hour | +1.5 hours | +2.5 hours |
| Weekend wake shift | +1.5 hours | +2 hours | +3 hours |
| Recovery factor | 0.8 (fast) | 0.5 (medium) | 0.3 (slow) |

### Annotation Domains & Calculations

| Domain | Judgment | Condition | Severity |
|--------|----------|-----------|----------|
| **Duration** | `sleep_time_very_low` | < 75% of baseline | poor |
| | `sleep_time_low` | 75-90% of baseline | warning |
| | `sleep_time_sufficient` | 90-110% of baseline | ok |
| | `sleep_time_long` | > 110% of baseline | ok |
| **Continuity** | `sleep_continuous` | ≤2 awakenings AND <10 min awake | ok |
| | `sleep_minor_interruptions` | ≤5 awakenings AND ≤30 min awake | warning |
| | `sleep_multiple_awakenings` | >5 awakenings | poor |
| | `sleep_fragmented` | >30 min awake | poor |
| **Timing** | `schedule_consistent` | <30 min deviation from baseline | ok |
| | `timing_slightly_irregular` | 30-60 min deviation | warning |
| | `schedule_inconsistent` | >60 min deviation | poor |

---

## 2. SRL (Self-Regulated Learning) Data

### Simulated Attributes

Responses are generated for 14 concepts on a 1-5 Likert scale:

| Concept | Short Name | Inverted? | High Achiever | Average | Low Achiever |
|---------|------------|-----------|---------------|---------|--------------|
| `efficiency` | Efficiency | No | 4-5 | 2-4 | 1-3 |
| `importance` | Perceived Importance | No | 4-5 | 2-4 | 1-3 |
| `tracking` | Progress Tracking | No | 4-5 | 2-4 | 1-3 |
| `clarity` | Task Clarity | No | 4-5 | 2-4 | 1-3 |
| `effort` | Effort | No | 4-5 | 2-4 | 1-3 |
| `focus` | Focus | No | 4-5 | 2-4 | 1-3 |
| `help_seeking` | Help Seeking | No | 4-5 | 2-4 | 1-3 |
| `community` | Peer Learning | No | 4-5 | 2-4 | 1-3 |
| `timeliness` | Timeliness | No | 4-5 | 2-4 | 1-3 |
| `motivation` | Motivation | No | 4-5 | 2-4 | 1-3 |
| `anxiety` | Anxiety | **Yes** | 1-2 | 2-4 | 3-5 |
| `enjoyment` | Enjoyment | No | 4-5 | 2-4 | 1-3 |
| `learning_from_feedback` | Learning from Feedback | No | 4-5 | 2-4 | 1-3 |
| `self_assessment` | Self Assessment | No | 4-5 | 2-4 | 1-3 |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Consistency factor | 0.85 | 0.75 | 0.70 |
| Anomaly chance | 5% | 12% | 10% |
| Anomaly shift | -1.5 | ±1 | +2 |
| Weekend effect | -0.3 | -0.5 | -0.8 |
| Weekly trend | +0.05 | 0 | -0.03 |

### Annotation Calculations

| Metric | Calculation Method |
|--------|-------------------|
| **Average Score** | Mean of all responses for concept in time window |
| **Trend** | Compare earlier half vs recent half (threshold: 0.5 change) |
| **Fluctuating** | ≥1 direction change AND range ≥2 |
| **Stable Level** | High: ≥4.0, Avg: 2.5-4.0, Low: <2.5 |
| **Data Sufficiency** | ≥3 distinct days in 7-day window |

### Trend Classifications

| Trend | Normal Concepts | Inverted (Anxiety) |
|-------|----------------|-------------------|
| `improving` | Score increasing | Score decreasing (good) |
| `declining` | Score decreasing | Score increasing (bad) |
| `fluctuating` | High variance oscillation | Same |
| `stable_high` | Avg ≥ 4.0 | Needs attention |
| `stable_avg` | Avg 2.5-4.0 | Moderate |
| `stable_low` | Avg < 2.5 | Good (low anxiety) |

---

## 3. LMS (Learning Management System) Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_active_minutes` | Total learning time | ~80 ± 20 min | ~50 ± 25 min | ~20 ± 15 min |
| `sessions_per_week` | Sessions count | ~6 ± 1 | ~4 ± 2 | ~2 ± 1 |
| `avg_session_length` | Average session | ~30 ± 10 min | ~20 ± 10 min | ~15 ± 10 min |
| `longest_session_minutes` | Longest session | Calculated | Calculated | Calculated |
| `passive_ratio` | Reading/watching % | ~0.60 ± 0.10 | ~0.75 ± 0.10 | ~0.90 ± 0.10 |
| `exercise_practice_events` | Practice activities | ~4 ± 2 | ~2 ± 2 | ~0 ± 1 |
| `forum_posts` | Discussion posts | ~2 ± 1 | ~1 ± 1 | ~0 ± 0 |

### Annotation Domains & Calculations

| Domain | Sub-domain | Judgment | Condition |
|--------|------------|----------|-----------|
| **Volume** | — | `volume_low` | < 70% of baseline |
| | | `volume_moderate` | 70-110% of baseline |
| | | `volume_high` | > 110% of baseline |
| **Distribution** | — | `dist_condensed` | ≤2 sessions AND ≥60 min longest |
| | | `dist_spread` | 3-5 sessions AND <60 min longest |
| | | `dist_fragmented` | >5 sessions AND <10 min avg |
| **Consistency** | — | `cons_consistent` | ≥5 days active |
| | | `cons_somewhat` | 3-4 days active |
| | | `cons_inconsistent` | ≤2 days active |
| **Action Mix** | Type | `mix_passive` | >85% passive AND 0 practice |
| | | `mix_active` | ≥1 practice events |
| | | `mix_balanced` | 50-75% passive AND ≥1 practice |
| | Practice | `prac_low` | 0 events |
| | | `prac_moderate` | 1-3 events |
| | | `prac_high` | ≥4 events |
| | Discussion | `disc_low` | 0 posts |
| | | `disc_moderate` | 1-2 posts |
| | | `disc_high` | ≥3 posts |
| **Session Quality** | — | `qual_focused` | ≥25 min avg AND ≥45 min longest |
| | | `qual_short` | <45 min total AND <10 min avg |
| | | `qual_interrupted` | <10 min avg AND ≥5 sessions |
| | | `qual_standard` | Default |

---

## 4. Screen Time Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_screen_minutes` | Daily screen time | ~180 ± 40 min (~3h) | ~300 ± 60 min (~5h) | ~420 ± 80 min (~7h) |
| `late_night_screen_minutes` | After 10 PM | ~15 ± 10 min | ~30 ± 15 min | ~60 ± 30 min |
| `longest_continuous_session` | Max unbroken session | ~40 ± 15 min | ~60 ± 25 min | ~90 ± 35 min |
| `number_of_screen_sessions` | Session count | ~8 ± 3 | ~12 ± 4 | ~16 ± 5 |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Anomaly chance | 10% | 15% | 8% |
| Weekend increase | +60 min | +90 min | +120 min |
| Recovery factor | 0.8 | 0.5 | 0.3 |

### Annotation Domains & Calculations

| Domain | Judgment | Condition | Severity |
|--------|----------|-----------|----------|
| **Volume** | `screen_time_low` | < 70% of baseline | ok |
| | `screen_time_moderate` | 70-110% of baseline | ok |
| | `screen_time_high` | 110-140% of baseline | warning |
| | `screen_time_excessive` | ≥ 140% of baseline | poor |
| **Distribution** | `screen_usage_balanced` | Longest < 45 min | ok |
| | `screen_usage_moderate_sessions` | Longest 45-90 min | warning |
| | `screen_usage_extended` | Longest > 90 min | poor |
| **Late Night** | `late_night_minimal` | < 15 min after 10 PM | ok |
| | `late_night_some` | 15-45 min after 10 PM | warning |
| | `late_night_high` | > 45 min after 10 PM | poor |

---

## 5. Social Media Data

### Simulated Attributes

| Attribute | Description | High Achiever | Average | Low Achiever |
|-----------|-------------|---------------|---------|--------------|
| `total_social_minutes` | Daily social media | ~25 ± 10 min | ~60 ± 25 min | ~150 ± 45 min |
| `number_of_social_sessions` | Check-ins count | ~5 ± 2 | ~10 ± 4 | ~20 ± 6 |
| `average_session_length` | Avg session duration | ~5 ± 2 min | ~8 ± 4 min | ~12 ± 5 min |
| `late_night_social_minutes` | After 10 PM | ~5 ± 3 min | ~15 ± 10 min | ~35 ± 20 min |

### Behavioral Modifiers

| Modifier | High Achiever | Average | Low Achiever |
|----------|---------------|---------|--------------|
| Anomaly chance | 10% | 15% | 8% |
| Weekend increase | +15 min | +30 min | +50 min |
| Recovery factor | 0.8 | 0.5 | 0.3 |

### Annotation Domains & Calculations

| Domain | Judgment | Condition | Severity |
|--------|----------|-----------|----------|
| **Volume** | `social_low` | < 30 min/day | ok |
| | `social_moderate` | 30-90 min/day | ok |
| | `social_high` | 90-180 min/day | warning |
| | `social_excessive` | > 180 min/day | poor |
| **Frequency** | `checking_infrequent` | ≤ 5 sessions | ok |
| | `checking_moderate` | 6-15 sessions | warning |
| | `checking_frequent` | > 15 sessions | poor |
| **Session Style** | `sessions_controlled` | Avg < 10 min | ok |
| | `sessions_moderate` | Avg 10-25 min | ok |
| | `sessions_long` | Avg > 25 min | warning |

---

## Severity Levels Reference

| Severity | Meaning | Chatbot Treatment |
|----------|---------|-------------------|
| `ok` | Healthy/normal behavior | Positive reinforcement |
| `warning` | Minor concerns | Gentle suggestions |
| `poor` | Significant issues | Areas needing attention |

---

## Profile Assignment

Profiles are assigned by the **Simulation Orchestrator** and stored in `student_profiles.simulated_profile`. All simulators read this profile and generate correlated data patterns.
