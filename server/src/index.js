import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const app = express();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const clientDistPath = path.resolve(__dirname, '../../client/dist');

const PORT = Number(process.env.PORT || 8080);
const MAIL_TM_BASE_URL = process.env.MAIL_TM_BASE_URL;
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS;
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60 * 1000);
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS || 60);
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN;

app.set('trust proxy', 1);
app.use(express.json());
app.use(
  cors({
    origin: CLIENT_ORIGIN,
    credentials: false,
  }),
);

// Session data lives only in memory so the backend stays simple and stateless to deploy.
const sessions = new Map();
// Small in-memory rate limiting protects the free provider from bursts.
const rateLimitStore = new Map();

function getClientKey(request) {
  return request.ip || request.headers['x-forwarded-for'] || 'unknown';
}

function rateLimiter(request, response, next) {
  const key = getClientKey(request);
  const now = Date.now();
  const currentEntry = rateLimitStore.get(key);

  if (!currentEntry || currentEntry.resetAt <= now) {
    rateLimitStore.set(key, {
      count: 1,
      resetAt: now + RATE_LIMIT_WINDOW_MS,
    });

    response.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
    response.setHeader('X-RateLimit-Remaining', RATE_LIMIT_MAX_REQUESTS - 1);
    return next();
  }

  currentEntry.count += 1;
  const remaining = Math.max(RATE_LIMIT_MAX_REQUESTS - currentEntry.count, 0);
  response.setHeader('X-RateLimit-Limit', RATE_LIMIT_MAX_REQUESTS);
  response.setHeader('X-RateLimit-Remaining', remaining);

  if (currentEntry.count > RATE_LIMIT_MAX_REQUESTS) {
    return response.status(429).json({
      error: 'Too many requests. Please wait a moment and try again.',
    });
  }

  return next();
}

app.use(rateLimiter);

function createRandomString(length = 12) {
  const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
}

function createSessionId() {
  return `${Date.now().toString(36)}-${createRandomString(18)}`;
}

function createMailboxCredentials(domain) {
  const username = createRandomString(10);
  const password = `${createRandomString(18)}A1`;
  return {
    address: `${username}@${domain}`,
    password,
  };
}

function isJsonContentType(contentType) {
  return contentType.includes('application/json') || contentType.includes('+json');
}

async function mailTmRequest(endpoint, options = {}) {
  const response = await fetch(`${MAIL_TM_BASE_URL}${endpoint}`, options);
  const contentType = response.headers.get('content-type') || '';
  const payload = isJsonContentType(contentType) ? await response.json() : await response.text();

  if (!response.ok) {
    const errorMessage =
      typeof payload === 'object' && payload !== null
        ? payload.detail || payload.message || 'Email service request failed'
        : 'Email service request failed';

    const error = new Error(errorMessage);
    error.statusCode = response.status;
    throw error;
  }

  return payload;
}

async function getAvailableDomain() {
  const domainsPayload = await mailTmRequest('/domains?page=1');
  const domains = domainsPayload['hydra:member'] || [];
  const firstDomain =
    domains.find((domain) => {
      const isActive = domain.isActive !== false;
      const isPrivate = domain.isPrivate === true;
      return Boolean(domain.domain) && isActive && !isPrivate;
    }) || domains.find((domain) => Boolean(domain.domain));

  if (!firstDomain?.domain) {
    const error = new Error('No email domains are available right now.');
    error.statusCode = 503;
    throw error;
  }

  return firstDomain.domain;
}

function getSessionOrThrow(sessionId) {
  if (!sessionId) {
    const error = new Error('Missing sessionId.');
    error.statusCode = 400;
    throw error;
  }

  const session = sessions.get(sessionId);
  if (!session) {
    const error = new Error('Session not found. Generate a new email address.');
    error.statusCode = 404;
    throw error;
  }

  if (session.expiresAt <= Date.now()) {
    sessions.delete(sessionId);
    const error = new Error('Session expired. Generate a new email address.');
    error.statusCode = 410;
    throw error;
  }

  session.lastUsedAt = Date.now();
  return session;
}

function formatMessageList(messagePayload) {
  const messages = messagePayload['hydra:member'] || [];

  return messages.map((message) => ({
    id: message.id,
    subject: message.subject,
    intro: message.intro,
    seen: message.seen,
    flagged: message.flagged,
    isDeleted: message.isDeleted,
    createdAt: message.createdAt,
    from: message.from,
    to: message.to,
  }));
}

app.get('/health', (_request, response) => {
  response.json({ ok: true });
});

app.post('/generate', async (_request, response, next) => {
  try {
    const domain = await getAvailableDomain();
    const credentials = createMailboxCredentials(domain);

    await mailTmRequest('/accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const tokenPayload = await mailTmRequest('/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(credentials),
    });

    const sessionId = createSessionId();
    const createdAt = Date.now();

    sessions.set(sessionId, {
      token: tokenPayload.token,
      address: credentials.address,
      createdAt,
      expiresAt: createdAt + SESSION_TTL_MS,
      lastUsedAt: createdAt,
    });

    response.status(201).json({
      sessionId,
      address: credentials.address,
      createdAt,
      expiresAt: createdAt + SESSION_TTL_MS,
    });
  } catch (error) {
    next(error);
  }
});

app.get('/messages', async (request, response, next) => {
  try {
    const session = getSessionOrThrow(request.query.sessionId);
    const messagePayload = await mailTmRequest('/messages?page=1', {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    response.json({
      address: session.address,
      messages: formatMessageList(messagePayload),
    });
  } catch (error) {
    next(error);
  }
});

app.get('/message/:id', async (request, response, next) => {
  try {
    const session = getSessionOrThrow(request.query.sessionId);
    const message = await mailTmRequest(`/messages/${request.params.id}`, {
      headers: {
        Authorization: `Bearer ${session.token}`,
      },
    });

    response.json({ message });
  } catch (error) {
    next(error);
  }
});

app.use((error, _request, response, _next) => {
  const statusCode = error.statusCode || 500;
  const message =
    statusCode === 500 ? 'Something went wrong while processing the request.' : error.message;

  if (statusCode >= 500) {
    console.error(error);
  }

  response.status(statusCode).json({
    error: message,
  });
});

app.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

// Only serve static files and handle client-side routing if not on Vercel
if (!process.env.VERCEL) {
  // Periodic cleanup prevents expired sessions and old limiter entries from piling up.
  const cleanupTimer = setInterval(() => {
    const now = Date.now();

    for (const [sessionId, session] of sessions.entries()) {
      if (session.expiresAt <= now) sessions.delete(sessionId);
    }

    for (const [key, entry] of rateLimitStore.entries()) {
      if (entry.resetAt <= now) rateLimitStore.delete(key);
    }
  }, Math.min(SESSION_TTL_MS, 10 * 60 * 1000));

  cleanupTimer.unref();

  app.use(express.static(clientDistPath));

  app.get('*', (request, response, next) => {
    // Exclude API routes from serving index.html
    if (
      request.path.startsWith('/message') ||
      request.path === '/messages' ||
      request.path === '/generate' ||
      request.path === '/health' // Added /health to the exclusion list
    ) {
      return next();
    }

    // For all other routes, serve the client's index.html
    return response.sendFile(path.join(clientDistPath, 'index.html'));
  });
}
