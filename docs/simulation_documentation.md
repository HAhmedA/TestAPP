# Simulation System Architecture

This document details the architecture of the Simulation System, explaining how the **Simulation Orchestrator**, **Simulators**, and **Annotators** interact to generate student profiles, simulate realistic data, and produce judgments.

## 1. High-Level Orchestration Flow

The **Simulation Orchestrator** (`simulationOrchestratorService.js`) is the central coordinator. It is responsible for assigning a consistent student profile (High, Average, or Low Achiever) and triggering parallel data generation for all domains.

```mermaid
graph TD
    User((User/Student))
    Orch[Simulation Orchestrator]
    DB[(Database)]
    
    User -- Registers/Resets --> Orch
    
    subgraph "1. Profile Management"
        Orch -- Checks/Assigns --> Profile{Student Profile}
        Profile -- High/Ang/Low --> DB
    end
    
    subgraph "2. Parallel Simulation"
        Orch -- Trigger --> SleepSim[Sleep Simulator]
        Orch -- Trigger --> SRLSim[SRL Simulator]
        Orch -- Trigger --> ScreenSim[Screen Time Sim]
        Orch -- Trigger --> LMSSim[LMS Simulator]
        
        ScreenSim -- Dependency --> SocialSim[Social Media Sim]
    end
    
    subgraph "3. Scoring Aggregation"
        SleepSim -- Complete --> Scores[Compute All Scores]
        SRLSim -- Complete --> Scores
        SocialSim -- Complete --> Scores
        LMSSim -- Complete --> Scores
        Scores -- Updates --> DB
    end
```

## 2. Simulator Logic (Example: Sleep Simulator)

Each simulator (e.g., `sleepDataSimulator.js`) generates realistic time-series data based on the student's assigned profile. It uses statistical models with variance, anomalies, and correlations.

```mermaid
flowchart LR
    Input[Orchestrator Request] --> GetProfile{Get Profile}
    DB[(Database)]
    Input --> DB
    
    GetProfile -- "High/Avg/Low" --> SelectPattern[Select Pattern Config]
    
    SelectPattern --> LoopDays[Loop: Past 7 Days]
    
    subgraph "Daily Generation Logic"
        LoopDays --> CheckWeekend{Is Weekend?}
        LoopDays --> CheckAnomaly{Anomaly Check?}
        LoopDays --> CalcCarryOver{Calc Carry-Over}
        
        CheckWeekend & CheckAnomaly & CalcCarryOver --> BaseValues[Base Pattern Values]
        BaseValues --> AddVariance[Add Random Variance]
        AddVariance --> GenMetrics[Generate Metrics]
        
        GenMetrics -- "Bedtime, Wake, Duration, Awakenings" --> SessionData
    end
    
    SessionData --> InsertDB[Insert Raw Session Data]
    InsertDB --> Recompute[Recompute Baseline]
    Recompute --> TriggerAnnotator[Trigger Annotator]
```

### Key Concepts:
- **Profile-Based Patterns**: Different baseline values for High, Average, and Low achievers.
- **Modifiers**:
    - **Weekend Effect**: Shifts bedtimes/wake times on weekends.
    - **Anomaly Nights**: Random "bad" nights for good sleepers, or "good" nights for poor sleepers.
    - **Carry-Over**: A bad night influences the next night's parameters.
- **Triggers**: The simulator **explicitly calls** the annotator service after generating data.

## 3. Annotator & Judgment Logic (Example: Sleep Annotator)

The Annotator (e.g., `sleepAnnotationService.js`) analyzes the raw data against the student's personal baseline to generate human-readable judgments and scores.

```mermaid
flowchart TD
    Trigger[Simulator Trigger] --> FetchSession[Fetch Raw Session Data]
    Trigger --> FetchBaseline[Fetch/Update User Baseline]
    
    subgraph "Analysis Domains"
        FetchSession & FetchBaseline --> EvalDur[Evaluate Duration]
        FetchSession & FetchBaseline --> EvalTime[Evaluate Timing]
        FetchSession & FetchBaseline --> EvalCont[Evaluate Continuity]
        
        EvalDur -- "Rule: < 75% Baseline" --> JudgDur[Duration Judgment]
        EvalTime -- "Rule: > 60min Deviation" --> JudgTime[Timing Judgment]
        EvalCont -- "Rule: > 5 Awakenings" --> JudgCont[Continuity Judgment]
    end
    
    JudgDur & JudgTime & JudgCont --> InsertJudgments[Insert Judgments to DB]
    InsertJudgments --> GenLLM[Generate LLM Explanation]
    
    subgraph "Scoring Adapter"
        InsertJudgments --> RawScores[Calculate 0-100 Scores]
        RawScores --> ScoringService[Scoring Service]
    end
```

### Key Concepts:
- **Baselines**: Dynamic value (e.g., "User usually sleeps 7 hours"). Judgments are relative to *this user*, not just global averages.
- **Rule-Based Judgments**: Deterministic logic (if X < 0.9 * Y then "Warning").
- **LLM Explanation**: Pre-generated text strings explaining the judgment, ready for the chatbot to use.

## 4. Full End-to-End Data Flow

How a specific data point travels from generation to the final score/judgment used by the Chatbot.

```mermaid
sequenceDiagram
    participant O as Orchestrator
    participant S as Sleep Simulator
    participant DB as Postgres DB
    participant A as Sleep Annotator
    participant SC as Scoring Service
    
    O->>S: generateStudentData(userId, profile)
    S->>DB: Get Profile (e.g., "average")
    
    loop For 7 Days
        S->>S: Generate Random Session (Bedtime, Wake...)
        S->>DB: INSERT into sleep_sessions
    end
    
    S->>A: recomputeBaseline(userId)
    A->>DB: UPDATE sleep_baselines
    
    loop For Each New Session
        S->>A: computeJudgments(sessionId)
        A->>DB: SELECT session + baseline
        A->>A: Run Rules (Duration, Timing, Continuity)
        A->>DB: INSERT into sleep_judgments
    end
    
    O->>SC: computeAllScores(userId)
    SC->>A: getRawScoresForScoring(userId)
    A-->>SC: Returns [{domain: 'duration', score: 85}, ...]
    SC->>SC: Aggregate & Weight Scores
    SC->>DB: INSERT into concept_scores
```
