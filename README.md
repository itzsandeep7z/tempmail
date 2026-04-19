# TempMail Buzz

TempMail Buzz is a temporary email app built with React and Node.js. The repo is safe to keep public because real runtime values stay in deployment environment variables, while the tracked `.env.example` files use placeholders only.

## Tech Stack

- React
- Vite
- Tailwind CSS
- Node.js
- Express
- Railway-ready monorepo deployment

## Features

- Generate temporary email addresses
- View inbox messages through the web app
- Responsive frontend layout
- Backend handling for main mail operations
- Single project setup for frontend and backend

## Notes

- Private configuration is stored in environment variables.
- Do not commit secrets or local `.env` files.
- `client/.env.example` and `server/.env.example` are templates only.
- When deploying publicly, set the real backend values in Railway or your hosting dashboard.
