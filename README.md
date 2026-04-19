# TempMail Buzz

TempMail Buzz is the public frontend for the temporary email app. The backend API has been split into a separate private project so internal route structure is not exposed in this repository.

## Tech Stack

- React
- Vite
- Tailwind CSS

## About The Project

The main idea behind TempMail Buzz was to build a temporary email website that feels fast and simple to use. This repository now contains only the deployable frontend and expects a private API base URL through environment variables.

## Features

- Generate temporary email addresses
- View inbox messages through the web app
- Responsive frontend layout
- Vercel-friendly frontend deployment

## Deployment

This project is configured for Vercel hosting.

## Environment

Create a client environment file and point the app at your private backend URL.

- `VITE_PRIVATE_API_URL`

Do not commit private API URLs, local `.env` files, or secrets.
