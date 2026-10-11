# Container deployment

The repository has separate frontend and backend container images. The same
images can run locally with Docker Compose or deploy as Vercel Services.

## Run locally

Create a root `.env` file with these values:

```dotenv
CONNECTION=postgresql://user:password@host:5432/database
JWT_SECRET=replace-with-a-random-secret-at-least-32-characters-long
GEMINI_API_KEY=optional-gemini-key
```

`CONNECTION` must point to a reachable PostgreSQL/TimescaleDB database. The
backend converts the `postgresql://` scheme to the TimescaleDB SQLAlchemy
dialect. The database is intentionally external to Compose so its data remains
persistent.

Then build and start both apps:

```sh
docker compose up --build
```

Open <http://localhost:3000>. The frontend proxies API calls to the backend
container at `http://backend:8000`.

## Deploy both services to Vercel

Import the repository with its root directory set to the repository root, and
set the project's Framework Preset to **Services**. The root `vercel.json`
defines the frontend and backend container services and preserves the existing
API path mapping.

Set these environment variables in Vercel for each environment you deploy:

- `CONNECTION`: connection string for the managed PostgreSQL/TimescaleDB
  database.
- `JWT_SECRET`: random secret of at least 32 characters.
- `GEMINI_API_KEY`: optional; enables Gemini backed CPU agents and explanations.
- `FRONTEND_ORIGINS`: optional comma-separated allowed browser origins if the
  API is called cross-origin. Same-origin Vercel routing does not need it.

Deploy from the repository root using the connected Git deployment or Vercel
CLI. The API service receives requests at `/api/auth/*`, `/api/blackjack/*`,
and `/api/shop*`; the Vercel service routes translate these to the FastAPI
paths already used by the app.

## Runtime state note

Blackjack sessions currently live in a Python process dictionary. This works
for a single local backend container, but Vercel can recycle or scale backend
instances independently. A running game can therefore disappear or be missing
on a later request. Before relying on this deployment for active games, move
game sessions to shared durable storage such as Redis or PostgreSQL.
