# SRL Learning Analytics Platform

A full-stack learning analytics platform that helps students improve their **self-regulated learning (SRL)** by tracking sleep, screen time, LMS engagement, and SRL questionnaire responses. It uses **AI-powered peer comparison**, **LLM-based chatbot coaching**, and **interactive dashboards** to provide personalized feedback.

---

## 🚀 Key Features

### 📊 Performance Dashboard
- **Gauge Visualizations** — SVG gauges showing per-concept scores (Sleep, Screen Time, LMS, SRL) with Today vs Yesterday needles
- **Peer Comparison** — Scores are computed via **Parsimonious Gaussian Mixture of Experts (PGMoE)** clustering, so students are compared against peers with similar behavioral patterns
- **Detailed Breakdowns** — Click any gauge to see domain-level scores, peer-group labels, and improving/declining/stable badges
- **Admin View** — Administrators can select any student and view their full dashboard

### 🤖 AI Chatbot
- **LLM-Powered Coaching** — Context-aware chatbot (Gemini / LMStudio) that references the student's actual data (scores, judgments, questionnaire trends)
- **Alignment Validation** — Every response passes through an LLM-as-Judge alignment check before being shown
- **Session Management** — Persistent chat sessions with 10-day rolling summarization
- **Customizable Prompts** — Admin-editable system and alignment prompts stored in the database

### 📈 Data Collection & Analysis
- **SRL Questionnaires** — 14-concept Likert-scale self-assessment (efficiency, motivation, anxiety, etc.) with trend analysis
- **Sleep Tracking** — Manual input via interactive slider component tracking bedtime, wake time, sleep quality, and awakenings
- **Screen Time Self-Report** — Daily questionnaire for total screen hours, longest session, and pre-sleep screen use
- **LMS Activity** — Real Moodle LMS data synced via REST API (quizzes, assignments, forum posts), or simulated data for test accounts. Metrics: active minutes, session quality, participation variety

### 🎲 Simulation Engine
- **Realistic Test Data** — Simulation orchestrator generates 7 days of correlated data across all domains for test accounts
- **Profile-Based** — Three achievement profiles (high achiever, average, low achiever) with anomaly days, weekend effects, carry-over, and daily variance
- **Automatic Scoring** — After simulation, PGMoE clustering + percentile scoring runs automatically with historical score seeding

### 🔐 Authentication & Roles
- **Session Auth** — Express sessions backed by PostgreSQL
- **Student / Admin Roles** — Students see their own dashboard + chatbot; admins can view any student's data and edit prompts

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│  Frontend (React 18 + TypeScript)                       │
│  ├── Dashboard (ScoreGauge, Home, MoodHistory)          │
│  ├── Chatbot (Chatbot.tsx)                              │
│  ├── Data Input (SleepSlider, ScreenTimeForm, Surveys)  │
│  └── Auth (Login, Register, Profile)                    │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTP (/api)
┌──────────────────────────▼──────────────────────────────┐
│  Backend (Node.js + Express)                            │
│  ├── Routes: auth, chat, scores, mood, surveys, admin   │
│  ├── Services:                                          │
│  │   ├── Simulators (sleep, screenTime, lms, srl)       │
│  │   ├── Annotators (rule-based judgments per domain)    │
│  │   ├── Scoring (PGMoE clustering, percentile scores)  │
│  │   ├── Chatbot (context, prompts, alignment, summary) │
│  │   └── Orchestrator (coordinates sim + scoring)       │
│  └── LLM Connector (Gemini / LMStudio / OpenAI)        │
└──────────────────────────┬──────────────────────────────┘
                           │
┌──────────────────────────▼──────────────────────────────┐
│  PostgreSQL 18                                          │
│  ├── Users, sessions, profiles                          │
│  ├── Data tables (sleep, screen_time, lms, srl)         │
│  ├── Judgments & annotations                            │
│  ├── Concept scores & score history                     │
│  ├── Peer clusters & user assignments                   │
│  └── Chat sessions, messages, summaries                 │
└─────────────────────────────────────────────────────────┘
```

---

## 🛠️ Technology Stack

| Layer | Technologies |
|-------|-------------|
| **Frontend** | React 18, TypeScript, Redux Toolkit, React Router v6, Recharts |
| **Surveys** | SurveyJS (Form Library, Creator, Analytics) |
| **Backend** | Node.js, Express, express-session, Helmet, Winston |
| **Database** | PostgreSQL 18, connect-pg-simple |
| **AI/LLM** | Gemini API, LMStudio, configurable via environment |
| **Containerization** | Docker, Docker Compose, Nginx |

---

## 🐳 Quick Start (Docker)

### Prerequisites
- Docker Desktop 4.30+
- (Optional) LMStudio running locally for chatbot features

### Setup

```bash
# Clone and start all services
docker compose up --build -d
```

### Access Points
| Service | URL |
|---------|-----|
| Web App | http://localhost:3000 |
| API | http://localhost:8080/api |
| PostgreSQL | localhost:5433 |

### Useful Commands
```bash
# View logs
docker compose logs -f web       # Frontend
docker compose logs -f backend   # Backend API

# Stop (preserves data)
docker compose down

# Stop and reset database (DELETES ALL DATA)
docker compose down -v
```

---

## ⚙️ Environment Configuration

Copy `.env.example` to `.env` in the backend directory. Key settings:

| Variable | Description | Default |
|----------|-------------|---------|
| `LLM_PROVIDER` | LLM provider (`lmstudio`, `gemini`, `openai`) | `lmstudio` |
| `LLM_BASE_URL` | LLM API endpoint | `http://host.docker.internal:1234` |
| `LLM_MAIN_MODEL` | Model for chat responses | `hermes-3-llama-3.2-3b` |
| `LLM_JUDGE_MODEL` | Model for alignment validation | `qwen2.5-3b-instruct` |
| `LLM_CONTEXT_LIMIT` | Max context window tokens | `32768` |
| `SESSION_SECRET` | Express session secret | (must be set) |
| `MOODLE_BASE_URL` | Base URL of your Moodle instance (e.g. `http://localhost:8888/moodle501`) | (optional) |
| `MOODLE_TOKEN` | Moodle web service token for REST API access | (optional) |
| `SIMULATION_MODE` | Set to `"false"` to exclude test accounts from scoring | `"true"` |

---

## 🎓 Moodle LMS Integration

The platform can sync real LMS engagement data from a Moodle instance via its REST API.

### Setup

1. **Enable Moodle web services** — in Moodle admin: *Site Administration → Advanced Features → Enable web services*
2. **Create a web service token** — under *Site Administration → Plugins → Web services → Manage tokens*. The token needs the following functions:
   - `core_user_get_users_by_field`, `core_enrol_get_users_courses`
   - `mod_quiz_get_user_attempts`, `mod_assign_get_submissions`
   - `mod_forum_get_forum_discussions`, `mod_forum_get_discussion_posts`
3. **Set environment variables** in your `.env` (or Docker secret):
   ```bash
   MOODLE_BASE_URL=http://your-moodle-host/moodle
   MOODLE_TOKEN=your-webservice-token
   ```
4. **Associate users** — each platform user must have a matching Moodle account (same email). Use the Admin panel's *LMS Sync* tab to trigger per-student or bulk sync.

### What Gets Synced

| Moodle Activity | DB Column | LMS Dimension |
|---|---|---|
| Quiz attempts | `exercise_practice_events` | participation_variety |
| Assignment submissions | `assignment_work_events` | participation_variety |
| Forum posts | `forum_posts` | participation_variety |
| Active session minutes | `total_active_minutes` | volume |
| Session count | `number_of_sessions` | session_quality |

### Cold Start

PGMoE requires a minimum of **10 real users with LMS data** before it can fit a meaningful cluster model. Until that threshold is reached, the scoring service returns a `coldStart: true` flag and the dashboard displays a "not enough data yet" state.

### Limitations

- `reading_minutes` and `watching_minutes` are always 0 when using Moodle module-level REST APIs (the event log is not accessible via external tokens).
- Moodle forum posts fetched via `mod_forum_get_discussion_posts` require iterating one thread per request; bulk syncing many students is intentionally slow.

---

## 💻 Local Development (Frontend Only)

```bash
npm install
npm start
```

> **Note:** Features requiring API authentication, database, or LLM will not work without the backend services.

---

## 📁 Project Structure

```
├── src/                        # React frontend
│   ├── components/             # ScoreGauge, Chatbot, SleepSlider, etc.
│   ├── pages/                  # Home, Login, Register, MoodHistory, Profile, ScreenTimeForm
│   ├── redux/                  # Redux Toolkit slices (auth, surveys, etc.)
│   └── routes/                 # React Router configuration
├── backend/                    # Express API server
│   ├── routes/                 # API routes (auth, chat, scores, admin, mood, etc.)
│   ├── services/
│   │   ├── simulators/         # Data generators (sleep, screenTime, lms, srl)
│   │   ├── annotators/         # Rule-based judgment engines
│   │   └── scoring/            # PGMoE clustering, score computation, peer stats
│   ├── prompts/                # System & alignment prompt files
│   └── config/                 # Database, logging configuration
├── postgres/initdb/            # SQL schema initialization scripts
├── docs/                       # Detailed documentation
│   ├── annotation_pipeline.md
│   ├── peer_comparison_scoring_system.md
│   ├── simulated_data_documentation.md
│   ├── simulation_documentation.md
│   └── chatbot-flows.md
├── compose.yml                 # Docker Compose (web + backend + postgres)
└── Dockerfile                  # Frontend build + Nginx
```

---

## 📖 Documentation

Detailed documentation is available in the `docs/` directory:

- **[Annotation Pipeline](docs/annotation_pipeline.md)** — Full data flow from simulators → judgments → scores → frontend
- **[Peer Comparison & Scoring](docs/peer_comparison_scoring_system.md)** — PGMoE clustering, percentile scoring, gauge visualization
- **[Simulated Data](docs/simulated_data_documentation.md)** — All simulator attributes, thresholds, and annotation rules
- **[Simulation Architecture](docs/simulation_documentation.md)** — Orchestrator flow, simulator logic, annotator pipeline
- **[Chatbot Flows](docs/chatbot-flows.md)** — Greeting, messaging, alignment, and reset interaction flows
- **[Developer Guide](docs/DEVELOPER_GUIDE.md)** — Architecture, design patterns, naming conventions, and extension guide
