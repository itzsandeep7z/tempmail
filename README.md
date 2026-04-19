# TempMail Buzz

TempMail Buzz is a temporary email project built with React and Node.js. It creates disposable email addresses through a simple web interface and keeps the full frontend-to-backend flow in one project.

## Tech Stack

- React
- Vite
- Tailwind CSS
- Node.js
- Express

## About The Project

The main idea behind TempMail Buzz was to build a temporary email website that feels fast and simple to use. The frontend stays clean while the backend handles the main logic and requests, with a structure that is easy to manage for local development and Vercel deployment.

## Features

- Generate temporary email addresses
- View inbox messages through the web app
- Responsive frontend layout
- Backend handling for main mail operations
- Single project setup for frontend and backend

## Deployment

This project is configured for Vercel hosting.

## Environment

Use `server/.env.example` as the safe template for local development.

- `MAIL_TM_BASE_URL`
- `CLIENT_ORIGIN`
- `PORT`
- `SESSION_TTL_MS`
- `RATE_LIMIT_WINDOW_MS`
- `RATE_LIMIT_MAX_REQUESTS`

Do not commit local `.env` files or secrets.
