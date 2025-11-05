[![Node.js CI](https://github.com/surveyjs/surveyjs-react-client/actions/workflows/build-node.js.yml/badge.svg)](https://github.com/surveyjs/surveyjs-react-client/actions/workflows/build-node.js.yml)

# SurveyJS React Application

This project is a client-side React application that uses [SurveyJS](https://surveyjs.io/) components. The application displays a list of surveys with the following buttons that perform actions on the surveys:

- **Run** - Uses the [SurveyJS Form Library](https://surveyjs.io/form-library/documentation/overview) component to run the survey.
- **Edit** - Uses the [Survey Creator](https://surveyjs.io/survey-creator/documentation/overview) component to configure the survey.
- **Results** - Uses the [SurveyJS Dashboard](https://surveyjs.io/dashboard/documentation/overview) component to display survey results as a table.
- **Remove** - Deletes the survey. 

![My Surveys App](https://user-images.githubusercontent.com/18551316/183420903-7fbcc043-5833-46fe-9910-5aa451045119.png)

You can integrate this project with a backend of your choice to create a full-cycle survey management service as shown in the following repos:

- [surveyjs-aspnet-mvc](https://github.com/surveyjs/surveyjs-aspnet-mvc)
- [surveyjs-nodejs](https://github.com/surveyjs/surveyjs-nodejs)
- [surveyjs-php](https://github.com/surveyjs/surveyjs-php)

## Dockerized Setup (Frontend + Backend + Postgres)

This fork adds a minimal Express backend and a Postgres database, wired via Docker Compose.

### Prerequisites
- Docker Desktop 4.30+
- Node 18+ (only if running locally outside Docker)

### One-time build and start
```bash
docker compose up --build -d
```

### URLs
- App: http://localhost:3000
- API: http://localhost:8080/api
- Postgres: localhost:5433 (user: postgres, password: password, db: postgres)

### Database seeding and persistence
- On the first run, Postgres executes SQL from `postgres/initdb/surveyjs.sql` and creates tables and seed rows.
- Data is persisted in a named volume `pgdata`. Do not use `docker compose down -v` unless you want to reset data.

### Useful commands
```bash
# Tail logs
docker compose logs -f web
docker compose logs -f backend
docker compose logs -f postgres

# Connect to the DB from host
psql -h localhost -p 5433 -U postgres -d postgres -c "SELECT 1;"

# Reset DB (re-seeds on next start)
docker compose down -v && docker compose up -d
```

### Notes
- Frontend build-time API base is controlled by `REACT_APP_API_BASE` in `compose.yml`.
- SPA refreshes are handled by `nginx.conf` (fallback to `index.html`).
- Session cookies are enabled cross-origin (3000 -> 8080) using axios `withCredentials` and CORS on the backend.

## Original Local Run (Frontend only)

```bash
git clone https://github.com/surveyjs/surveyjs-react-client.git
cd surveyjs-react-client
npm i
npm start
```
