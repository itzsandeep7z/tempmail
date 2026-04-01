import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const POLL_INTERVAL_MS = 5000;
const SESSION_STORAGE_KEY = 'tempmail-buzz-session';

const THEMES = {
  light: {
    label: 'Light',
    dark: false,
    pageText: 'text-slate-900',
    shell: 'border-slate-200/80 bg-white/78',
    panel: 'border-slate-200 bg-white/88',
    muted: 'text-slate-500',
    strongMuted: 'text-slate-600',
    button: 'border-slate-200 bg-white text-slate-900 hover:bg-slate-50',
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    primary: 'from-sky-500 via-blue-500 to-indigo-500',
    selected: 'bg-sky-50',
  },
  dark: {
    label: 'Dark',
    dark: true,
    pageText: 'text-slate-100',
    shell: 'border-white/10 bg-slate-950/55',
    panel: 'border-white/10 bg-white/[0.04]',
    muted: 'text-slate-400',
    strongMuted: 'text-slate-300',
    button: 'border-white/10 bg-white/5 text-white hover:bg-white/10',
    badge: 'border-cyan-400/20 bg-cyan-500/10 text-cyan-200',
    primary: 'from-cyan-400 via-sky-500 to-indigo-500',
    selected: 'bg-white/[0.04]',
  },
};

function classNames(...values) {
  return values.filter(Boolean).join(' ');
}

function formatDate(dateValue) {
  if (!dateValue) return 'Unknown time';
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(dateValue));
}

function isJsonContentType(contentType) {
  return contentType.includes('application/json') || contentType.includes('+json');
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = isJsonContentType(contentType) ? await response.json() : await response.text();

  if (!response.ok) {
    const message =
      typeof payload === 'object' && payload !== null ? payload.error || 'Request failed' : 'Request failed';
    throw new Error(message);
  }

  return payload;
}

function App() {
  const [themeKey, setThemeKey] = useState(() => localStorage.getItem('theme') || 'light');
  const [session, setSession] = useState(() => {
    const storedSession = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!storedSession) return null;
    try {
      return JSON.parse(storedSession);
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
  });
  const [messages, setMessages] = useState([]);
  const [selectedMessageId, setSelectedMessageId] = useState(null);
  const [selectedMessage, setSelectedMessage] = useState(null);
  const [messageCache, setMessageCache] = useState({});
  const [loadingGenerate, setLoadingGenerate] = useState(false);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(() => !document.hidden);
  const intervalRef = useRef(null);

  const theme = THEMES[themeKey] || THEMES.light;

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme.dark);
    document.documentElement.style.colorScheme = theme.dark ? 'dark' : 'light';
    localStorage.setItem('theme', themeKey);
  }, [theme.dark, themeKey]);

  useEffect(() => {
    if (session) {
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
      return;
    }
    localStorage.removeItem(SESSION_STORAGE_KEY);
  }, [session]);

  useEffect(() => {
    function handleVisibilityChange() {
      setIsVisible(!document.hidden);
    }
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, []);

  const selectedPreview = useMemo(() => {
    if (!selectedMessage) return null;
    const firstHtmlPart = Array.isArray(selectedMessage.html) ? selectedMessage.html.find(Boolean) : '';
    return {
      text:
        selectedMessage.text?.trim() ||
        selectedMessage.intro?.trim() ||
        'This message does not include a plain text body.',
      html: firstHtmlPart || '',
    };
  }, [selectedMessage]);

  async function loadMessages(sessionId, { silent = false } = {}) {
    if (!sessionId) return;
    if (!silent) setLoadingInbox(true);

    try {
      const data = await request(`/messages?sessionId=${encodeURIComponent(sessionId)}`);
      const nextMessages = data.messages || [];
      setMessages(nextMessages);
      if (!selectedMessageId && nextMessages.length) {
        setSelectedMessageId(nextMessages[0].id);
      }
      setError('');
    } catch (requestError) {
      if (
        requestError.message.includes('Session not found') ||
        requestError.message.includes('Session expired')
      ) {
        setSession(null);
        setMessages([]);
        setSelectedMessage(null);
        setSelectedMessageId(null);
        setMessageCache({});
      }
      setError(requestError.message);
    } finally {
      if (!silent) setLoadingInbox(false);
    }
  }

  async function handleGenerateEmail() {
    setLoadingGenerate(true);
    setError('');
    setCopied(false);
    setSelectedMessage(null);
    setSelectedMessageId(null);
    setMessages([]);
    setMessageCache({});

    try {
      const data = await request('/generate', { method: 'POST' });
      setSession(data);
      await loadMessages(data.sessionId);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingGenerate(false);
    }
  }

  async function handleCopyEmail() {
    if (!session?.address) return;
    try {
      await navigator.clipboard.writeText(session.address);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setError('Copy failed. Please copy the email manually.');
    }
  }

  async function handleSelectMessage(messageId) {
    if (!session?.sessionId || !messageId) return;
    setSelectedMessageId(messageId);

    if (messageCache[messageId]) {
      setSelectedMessage(messageCache[messageId]);
      return;
    }

    setLoadingMessage(true);
    try {
      const data = await request(
        `/message/${encodeURIComponent(messageId)}?sessionId=${encodeURIComponent(session.sessionId)}`,
      );
      setMessageCache((currentCache) => ({ ...currentCache, [messageId]: data.message }));
      setSelectedMessage(data.message);
      setError('');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setLoadingMessage(false);
    }
  }

  useEffect(() => {
    if (!session?.sessionId) return;
    loadMessages(session.sessionId);
  }, [session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId || !selectedMessageId) return;
    handleSelectMessage(selectedMessageId);
  }, [selectedMessageId, session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId || !isVisible) {
      if (intervalRef.current) clearInterval(intervalRef.current);
      return undefined;
    }

    intervalRef.current = window.setInterval(() => {
      loadMessages(session.sessionId, { silent: true });
    }, POLL_INTERVAL_MS);

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isVisible, session?.sessionId]);

  useEffect(() => {
    if (!session?.sessionId) return;
    if (!messages.length) {
      setSelectedMessageId(null);
      setSelectedMessage(null);
      return;
    }
    const stillExists = messages.some((message) => message.id === selectedMessageId);
    if (!stillExists) {
      setSelectedMessageId(messages[0].id);
      setSelectedMessage(null);
    }
  }, [messages, selectedMessageId, session?.sessionId]);

  return (
    <div className={classNames('relative min-h-screen overflow-hidden transition-colors duration-300', theme.pageText)}>
      <div className="soft-grid pointer-events-none absolute inset-0 opacity-70 dark:opacity-20" />
      <div className="pointer-events-none absolute left-[-8rem] top-[-8rem] h-72 w-72 rounded-full bg-sky-300/20 blur-3xl dark:bg-sky-500/10" />

      <main className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <header className={classNames('mb-6 rounded-[2rem] border p-5 backdrop-blur-2xl sm:p-6', theme.shell)}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4 sm:items-center">
              <div className="shrink-0">
                <LogoMark />
              </div>
              <div className="min-w-0">
                <p className={classNames('text-xs font-semibold uppercase tracking-[0.34em]', theme.dark ? 'text-cyan-300' : 'text-sky-700')}>
                  TempMail Buzz
                </p>
                <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">Temporary email, done properly.</h1>
                <p className={classNames('mt-2 text-sm leading-7', theme.muted)}>
                  Generate an address, keep it across refresh, and read messages in one clean interface.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {Object.entries(THEMES).map(([key, value]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setThemeKey(key)}
                  className={classNames(
                    'rounded-full border px-4 py-2 text-sm font-medium transition',
                    themeKey === key ? value.badge : theme.button,
                  )}
                >
                  {value.label}
                </button>
              ))}
            </div>
          </div>
        </header>

        {error ? (
          <div className={classNames('mb-5 rounded-2xl border px-4 py-3 text-sm', theme.dark ? 'border-rose-400/30 bg-rose-500/10 text-rose-100' : 'border-rose-200 bg-rose-50 text-rose-700')}>
            {error}
          </div>
        ) : null}

        <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="grid gap-4">
            <section className={classNames('rounded-[2rem] border p-5 backdrop-blur-2xl', theme.shell)}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <p className={classNames('text-xs font-semibold uppercase tracking-[0.3em]', theme.muted)}>Current Address</p>
                  <div className={classNames('mt-3 rounded-[1.4rem] border p-4', theme.panel)}>
                    <p className="break-all text-base font-semibold leading-8 sm:text-xl">{session?.address || 'Generate an email address to begin'}</p>
                  </div>
                </div>

                <div className="grid w-full gap-2 sm:grid-cols-3 lg:w-auto lg:min-w-[220px] lg:grid-cols-1">
                  <PrimaryButton gradient={theme.primary} disabled={loadingGenerate} onClick={handleGenerateEmail}>
                    {loadingGenerate ? 'Generating...' : 'Generate Email'}
                  </PrimaryButton>
                  <SecondaryButton disabled={!session?.address} look={theme.button} onClick={handleCopyEmail}>
                    {copied ? 'Copied' : 'Copy'}
                  </SecondaryButton>
                  <SecondaryButton
                    disabled={!session?.sessionId || loadingInbox}
                    look={theme.button}
                    onClick={() => loadMessages(session?.sessionId)}
                  >
                    {loadingInbox ? 'Refreshing...' : 'Refresh'}
                  </SecondaryButton>
                </div>
              </div>
            </section>

            <section className={classNames('rounded-[2rem] border p-5 backdrop-blur-2xl', theme.shell)}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Inbox</p>
                  <h2 className="mt-2 text-2xl font-semibold">Messages</h2>
                </div>
                <span className={classNames('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', theme.badge)}>
                  {messages.length}
                </span>
              </div>

              <div className={classNames('rounded-[1.4rem] border', theme.panel)}>
                <div className={classNames('hidden gap-3 border-b px-4 py-3 text-xs font-semibold uppercase tracking-[0.16em] sm:grid sm:grid-cols-[1fr_1.05fr_72px]', theme.dark ? 'border-white/10 text-slate-400' : 'border-slate-200 text-slate-500')}>
                  <span>Sender</span>
                  <span>Subject</span>
                  <span>Open</span>
                </div>

                <div className="max-h-[34rem] overflow-y-auto">
                  {!session?.sessionId ? (
                    <EmptyState isDark={theme.dark} title="No inbox yet" description="Create an address first." />
                  ) : !messages.length ? (
                    <EmptyState isDark={theme.dark} title="Inbox is empty" description="Waiting for incoming messages." />
                  ) : (
                    messages.map((message) => (
                      <button
                        key={message.id}
                        type="button"
                        onClick={() => handleSelectMessage(message.id)}
                        className={classNames(
                          'grid w-full gap-3 border-b px-4 py-4 text-left transition sm:grid-cols-[1fr_1.05fr_72px]',
                          theme.dark ? 'border-white/10 hover:bg-white/[0.03]' : 'border-slate-200 hover:bg-white/70',
                          selectedMessageId === message.id && theme.selected,
                        )}
                      >
                        <div className="min-w-0">
                          <p className={classNames('mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] sm:hidden', theme.muted)}>Sender</p>
                          <p className="truncate text-sm font-semibold">{message.from?.address || 'Unknown sender'}</p>
                          <p className={classNames('mt-1 truncate text-xs', theme.muted)}>{formatDate(message.createdAt)}</p>
                        </div>
                        <div className="min-w-0">
                          <p className={classNames('mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] sm:hidden', theme.muted)}>Subject</p>
                          <p className="truncate text-sm font-semibold">{message.subject || '(No subject)'}</p>
                          <p className={classNames('mt-1 truncate text-xs', theme.muted)}>
                            {message.intro || 'Open to read full content.'}
                          </p>
                        </div>
                        <div className="flex items-center justify-start sm:justify-start">
                          <span className={classNames('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em]', theme.badge)}>
                            Open
                          </span>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              </div>
            </section>
          </div>

          <div className="grid gap-4">
            <section className={classNames('rounded-[2rem] border p-5 backdrop-blur-2xl', theme.shell)}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Reader</p>
                  <h2 className="mt-2 text-2xl font-semibold">Message View</h2>
                </div>
                <span className={classNames('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', theme.badge)}>
                  {selectedMessage ? 'Loaded' : 'Idle'}
                </span>
              </div>

              <div className={classNames('rounded-[1.4rem] border p-5', theme.panel)}>
                {!session?.sessionId ? (
                  <EmptyState isDark={theme.dark} title="Reader waiting" description="The full email will appear here." />
                ) : loadingMessage ? (
                  <EmptyState isDark={theme.dark} title="Loading message" description="Fetching full content..." />
                ) : selectedMessage ? (
                  <article className="space-y-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Selected Message</p>
                        <h3 className="mt-3 text-3xl font-semibold">{selectedMessage.subject || '(No subject)'}</h3>
                      </div>
                      <span className={classNames('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', theme.badge)}>
                        {selectedMessage.attachments?.length || 0} attachments
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoCard dark={theme.dark} label="From" value={selectedMessage.from?.address || 'Unknown'} />
                      <InfoCard dark={theme.dark} label="To" value={selectedMessage.to?.[0]?.address || session.address} />
                      <InfoCard dark={theme.dark} label="Received" value={formatDate(selectedMessage.createdAt)} />
                      <InfoCard dark={theme.dark} label="Message Id" value={selectedMessage.id} />
                    </div>

                    <div className={classNames('rounded-[1.4rem] border p-5', theme.panel)}>
                      <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Text Content</p>
                      <div className="mt-4 whitespace-pre-wrap text-sm leading-7">{selectedPreview?.text}</div>
                    </div>

                    {selectedPreview?.html ? (
                      <div>
                        <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>HTML Preview</p>
                        <iframe
                          title="HTML email preview"
                          srcDoc={selectedPreview.html}
                          className="mt-4 h-80 w-full rounded-[1.4rem] border border-slate-200 bg-white"
                          sandbox=""
                        />
                      </div>
                    ) : null}
                  </article>
                ) : (
                  <EmptyState isDark={theme.dark} title="Choose a message" description="Select an email from the inbox." />
                )}
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <SmallPanel title="Session" theme={theme}>
                Stays the same after refresh while the active session remains valid.
              </SmallPanel>
              <SmallPanel title="Signature" theme={theme}>
                Designed and crafted by Sandeep Patel.
              </SmallPanel>
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white/20 bg-white/10 backdrop-blur-xl">
      <svg viewBox="0 0 64 64" className="h-10 w-10" aria-hidden="true">
        <defs>
          <linearGradient id="bestLogo" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#38bdf8" />
            <stop offset="55%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#6366f1" />
          </linearGradient>
        </defs>
        <path d="M20 10h24l10 18-10 18H20L10 28l10-18Z" fill="url(#bestLogo)" />
        <path d="M21 24.5 32 33l11-8.5" fill="none" stroke="#f8fafc" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <path d="M24 29.5 20 40m20-10.5L44 40M18 19.5h28" fill="none" stroke="#f8fafc" strokeLinecap="round" strokeWidth="3" />
      </svg>
    </div>
  );
}

function PrimaryButton({ children, disabled, gradient, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames('w-full rounded-2xl bg-gradient-to-r px-4 py-3 text-sm font-semibold text-white shadow-lg transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50', gradient)}
    >
      {children}
    </button>
  );
}

function SecondaryButton({ children, disabled, look, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={classNames('w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', look)}
    >
      {children}
    </button>
  );
}

function InfoCard({ dark, label, value }) {
  return (
    <div className={classNames('rounded-2xl border p-4', dark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-white/88')}>
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-2 break-words text-sm leading-6">{value}</p>
    </div>
  );
}

function SmallPanel({ children, theme, title }) {
  return (
    <div className={classNames('rounded-[1.6rem] border p-5 backdrop-blur-2xl', theme.shell)}>
      <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>{title}</p>
      <p className={classNames('mt-3 text-sm leading-7', theme.strongMuted)}>{children}</p>
    </div>
  );
}

function EmptyState({ title, description, isDark }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center p-6 text-center">
      <div>
        <p className={classNames('text-lg font-semibold', isDark ? 'text-white' : 'text-slate-900')}>{title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

export default App;
