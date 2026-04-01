# Temporary Mail Website

A full-stack temporary email website using:

- React + Vite + Tailwind CSS
- Node.js + Express
- a third-party email provider handled entirely through the backend
- In-memory session storage
- Railway-ready single repository setup

## Project Structure

```text
.
├─ client/   # React frontend
├─ server/   # Express backend
├─ package.json
└─ railway.json
```

## Local Development

1. Install dependencies from the project root:

```bash
npm install
```

2. Create environment files:

```bash
cp server/.env.example server/.env
cp client/.env.example client/.env
```

If you are on Windows PowerShell, use:

```powershell
Copy-Item server/.env.example server/.env
Copy-Item client/.env.example client/.env
```

3. Update values if you want custom settings:

Server example in `server/.env`:

```env
PORT=8080
MAIL_TM_BASE_URL=https://api.mail.tm
SESSION_TTL_MS=2700000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
CLIENT_ORIGIN=http://localhost:5173
```

Client example in `client/.env`:

```env
VITE_API_BASE_URL=http://localhost:8080
```

4. Start both apps:

```bash
npm run dev
```

5. Open the frontend:

```text
http://localhost:5173
```

## Production Build

```bash
npm run build
npm start
```

The Express server serves the built React app from `client/dist` in production.

## Railway Deployment

1. Push this repository to GitHub.
2. Create a new Railway project from the repo.
3. Railway should detect the root `package.json` and `railway.json`.
4. Add optional environment variables in Railway:

```env
PORT=8080
MAIL_TM_BASE_URL=https://api.mail.tm
SESSION_TTL_MS=2700000
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX_REQUESTS=60
CLIENT_ORIGIN=https://your-railway-domain.up.railway.app
```

5. Deploy.

## How It Works

1. The frontend calls your Express backend only.
2. `POST /generate` creates a mailbox and stores the access token in memory.
3. The backend returns a safe `sessionId` to the browser.
4. The frontend uses that `sessionId` to fetch inbox messages and message details.
5. In production, Express also serves the built React app from `client/dist`.

## API Routes

- `POST /generate` creates a new temporary email account
- `GET /messages?sessionId=...` fetches inbox messages
- `GET /message/:id?sessionId=...` fetches the full email content

## Notes

- Tokens are stored only in memory on the server.
- Restarting the backend clears all temporary sessions.
- The frontend never calls the email provider directly.
