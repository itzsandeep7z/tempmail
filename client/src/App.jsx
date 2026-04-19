import { useEffect, useMemo, useRef, useState } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';
const POLL_INTERVAL_MS = 5000;
const SESSION_STORAGE_KEY = 'tempmail-buzz-session';

const THEMES = {
  light: {
    label: 'Light',
    dark: false,
    pageText: 'text-slate-900',
    shell: 'border-white/70 bg-white/72 shadow-[0_22px_60px_-28px_rgba(15,23,42,0.28)]',
    panel: 'border-slate-200/80 bg-white/90',
    muted: 'text-slate-500',
    strongMuted: 'text-slate-600',
    button: 'border-slate-200/80 bg-white/90 text-slate-900 hover:bg-slate-50',
    badge: 'border-sky-200 bg-sky-50 text-sky-700',
    primary: 'from-sky-500 via-blue-500 to-indigo-500',
    selected: 'bg-sky-50/80',
  },
  dark: {
    label: 'Dark',
    dark: true,
    pageText: 'text-slate-100',
    shell: 'border-white/10 bg-slate-950/62 shadow-[0_24px_70px_-32px_rgba(8,145,178,0.45)]',
    panel: 'border-white/10 bg-white/[0.05]',
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
  const readerRef = useRef(null);

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
      if (window.innerWidth < 768) {
        window.setTimeout(() => {
          readerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 120);
      }
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
      <div className="pointer-events-none absolute right-[-5rem] top-[18rem] h-56 w-56 rounded-full bg-indigo-300/15 blur-3xl dark:bg-cyan-400/10" />
      <div className="pointer-events-none absolute bottom-10 left-1/2 h-64 w-64 -translate-x-1/2 rounded-full bg-blue-200/20 blur-3xl dark:bg-indigo-500/10" />

      <main className="relative mx-auto max-w-7xl px-4 py-5 sm:px-6 sm:py-6 lg:px-8">
        <header className={classNames('mb-6 overflow-hidden rounded-[2rem] border p-5 backdrop-blur-2xl sm:p-6', theme.shell)}>
          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-start gap-4 sm:items-center">
              <div className="shrink-0">
                <LogoMark />
              </div>
              <div className="min-w-0">
                <p className={classNames('text-xs font-semibold uppercase tracking-[0.34em]', theme.dark ? 'text-cyan-300' : 'text-sky-700')}>
                  TempMail Buzz
                </p>
                <h1 className="display-font mt-2 max-w-xl text-3xl font-semibold leading-[1.02] tracking-[-0.04em] sm:text-4xl lg:text-5xl">
                  Temporary email, done properly.
                </h1>
                <p className={classNames('mt-3 max-w-xl text-sm leading-7 sm:text-[15px]', theme.muted)}>
                  Generate an address, keep it across refresh, and read messages in one clean interface.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2 self-start lg:self-auto">
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

        <div
          className={classNames(
            'pointer-events-none fixed bottom-5 right-5 z-50 transition-all duration-300',
            copied ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0',
          )}
        >
          <div
            className={classNames(
              'rounded-2xl border px-4 py-3 text-sm font-medium shadow-2xl backdrop-blur-xl',
              theme.dark
                ? 'border-cyan-400/20 bg-slate-950/85 text-cyan-100'
                : 'border-sky-200 bg-white/90 text-sky-700',
            )}
          >
            Email copied
          </div>
        </div>

        <section className="mb-4 grid gap-3 sm:grid-cols-3">
          <StatCard
            theme={theme}
            title="Instant Inbox"
            value="Ready in seconds"
            description="Generate a fresh address and start receiving mail without extra steps."
          />
          <StatCard
            theme={theme}
            title="Auto Refresh"
            value="Live message checks"
            description="Inbox updates quietly in the background while you stay on the page."
          />
          <StatCard
            theme={theme}
            title="Built For Any Screen"
            value="Mobile to desktop"
            description="Cleaner reading flow and responsive spacing across devices."
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[0.92fr_1.08fr]">
          <div className="grid gap-4">
            <section className={classNames('rounded-[2rem] border p-5 backdrop-blur-2xl', theme.shell)}>
              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0 flex-1">
                  <p className={classNames('text-xs font-semibold uppercase tracking-[0.3em]', theme.muted)}>Current Address</p>
                  <div className={classNames('mt-3 rounded-[1.4rem] border p-4 shadow-inner', theme.panel)}>
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

                <div className="premium-scroll max-h-[34rem] overflow-y-auto">
                  {!session?.sessionId ? (
                    <EmptyState
                      isDark={theme.dark}
                      title="No inbox yet"
                      description="Generate a temporary address to open your inbox and start receiving messages."
                      icon="mailbox"
                    />
                  ) : loadingInbox && !messages.length ? (
                    <SkeletonInboxRows theme={theme} />
                  ) : !messages.length ? (
                    <EmptyState
                      isDark={theme.dark}
                      title="Inbox is empty"
                      description="Your address is active. Incoming emails will appear here as soon as they arrive."
                      icon="spark"
                    />
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
                          !message.seen ? (theme.dark ? 'bg-cyan-400/[0.04]' : 'bg-sky-50/60') : '',
                        )}
                      >
                        <div className="min-w-0 sm:pr-2">
                          <p className={classNames('mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] sm:hidden', theme.muted)}>Sender</p>
                          <div className="flex items-center gap-2">
                            {!message.seen ? (
                              <span className={classNames('h-2.5 w-2.5 rounded-full', theme.dark ? 'bg-cyan-300' : 'bg-sky-500')} />
                            ) : null}
                            <p className="truncate text-sm font-semibold">{message.from?.address || 'Unknown sender'}</p>
                          </div>
                          <p className={classNames('mt-1 text-xs', theme.muted)}>{formatDate(message.createdAt)}</p>
                        </div>
                        <div className="min-w-0 sm:pr-2">
                          <p className={classNames('mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] sm:hidden', theme.muted)}>Subject</p>
                          <div className="flex items-center gap-2">
                            <p className="truncate text-sm font-semibold">{message.subject || '(No subject)'}</p>
                            {!message.seen ? (
                              <span className={classNames('rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]', theme.badge)}>
                                New
                              </span>
                            ) : null}
                          </div>
                          <p className={classNames('mt-1 overflow-hidden text-xs leading-6', theme.muted)}>
                            {message.intro || 'Open to read full content.'}
                          </p>
                        </div>
                        <div className="flex items-center justify-start sm:justify-start">
                          <span className={classNames('rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-[0.16em] shadow-sm', theme.badge)}>
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
            <section ref={readerRef} className={classNames('rounded-[2rem] border p-5 backdrop-blur-2xl', theme.shell)}>
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Reader</p>
                  <h2 className="display-font mt-2 text-2xl font-semibold tracking-[-0.03em]">Message View</h2>
                </div>
                <span className={classNames('rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', theme.badge)}>
                  {selectedMessage ? 'Loaded' : 'Idle'}
                </span>
              </div>

              <div className={classNames('rounded-[1.4rem] border p-5', theme.panel)}>
                {!session?.sessionId ? (
                  <EmptyState
                    isDark={theme.dark}
                    title="Reader waiting"
                    description="Open any message from the inbox to view the full content here."
                    icon="reader"
                  />
                ) : loadingMessage ? (
                  <SkeletonMessageView theme={theme} />
                ) : selectedMessage ? (
                  <article className="space-y-5">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Selected Message</p>
                        <h3 className="display-font mt-3 break-words text-2xl font-semibold leading-tight tracking-[-0.03em] sm:text-3xl">
                          {selectedMessage.subject || '(No subject)'}
                        </h3>
                      </div>
                      <span className={classNames('w-fit rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em]', theme.badge)}>
                        {selectedMessage.attachments?.length || 0} attachments
                      </span>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <InfoCard dark={theme.dark} label="From" value={selectedMessage.from?.address || 'Unknown'} />
                      <InfoCard dark={theme.dark} label="To" value={selectedMessage.to?.[0]?.address || session.address} />
                      <InfoCard dark={theme.dark} label="Received" value={formatDate(selectedMessage.createdAt)} />
                      <InfoCard dark={theme.dark} label="Message Id" value={selectedMessage.id} />
                    </div>

                    <div className={classNames('rounded-[1.4rem] border p-4 sm:p-5', theme.panel)}>
                      <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Text Content</p>
                      <div className="mt-4 whitespace-pre-wrap text-sm leading-7 sm:text-[15px]">{selectedPreview?.text}</div>
                    </div>

                    {selectedPreview?.html ? (
                      <div>
                        <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>HTML Preview</p>
                        <iframe
                          title="HTML email preview"
                          srcDoc={selectedPreview.html}
                          className="mt-4 h-64 w-full rounded-[1.4rem] border border-slate-200 bg-white sm:h-80"
                          sandbox=""
                        />
                      </div>
                    ) : null}
                  </article>
                ) : (
                  <EmptyState
                    isDark={theme.dark}
                    title="Choose a message"
                    description="Pick an email from the inbox to read the full body, details, and preview."
                    icon="message"
                  />
                )}
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2">
              <SmallPanel title="Experience" theme={theme}>
                Built for quick access, clean reading, and a smooth temporary inbox flow across desktop and mobile.
              </SmallPanel>
              <SignaturePanel theme={theme} />
            </section>
          </div>
        </section>
      </main>
    </div>
  );
}

function LogoMark() {
  return (
    <div className="flex h-14 w-14 items-center justify-center rounded-[1.2rem] border border-white/20 bg-white/10 shadow-[0_20px_40px_-24px_rgba(59,130,246,0.9)] backdrop-blur-xl">
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
      className={classNames('display-font w-full rounded-2xl bg-gradient-to-r px-4 py-3 text-sm font-semibold text-white shadow-lg shadow-sky-500/20 transition hover:scale-[1.01] disabled:cursor-not-allowed disabled:opacity-50', gradient)}
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
      className={classNames('display-font w-full rounded-2xl border px-4 py-3 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-50', look)}
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
    <div className={classNames('flex min-h-[180px] flex-col justify-center rounded-[1.6rem] border p-5 backdrop-blur-2xl', theme.shell)}>
      <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>{title}</p>
      <p className={classNames('mt-3 text-sm leading-7', theme.strongMuted)}>{children}</p>
    </div>
  );
}

function SignaturePanel({ theme }) {
  return (
    <div className={classNames('flex min-h-[180px] flex-col justify-center rounded-[1.6rem] border p-5 backdrop-blur-2xl', theme.shell)}>
      <p className={classNames('text-xs font-semibold uppercase tracking-[0.28em]', theme.muted)}>Signature</p>
      <p
        className={classNames(
          'signature-font mt-4 text-[2.4rem] leading-none sm:text-[3rem]',
          theme.dark ? 'text-cyan-100' : 'text-sky-700',
        )}
      >
        Sandeep Patel
      </p>
      <p className={classNames('mt-3 text-xs uppercase tracking-[0.24em]', theme.muted)}>TempMail Buzz</p>
    </div>
  );
}

function StatCard({ description, theme, title, value }) {
  return (
    <div className={classNames('rounded-[1.6rem] border p-4 backdrop-blur-2xl', theme.shell)}>
      <p className={classNames('text-[11px] font-semibold uppercase tracking-[0.24em]', theme.muted)}>{title}</p>
      <p className="display-font mt-3 text-xl font-semibold tracking-[-0.03em]">{value}</p>
      <p className={classNames('mt-2 text-sm leading-6', theme.strongMuted)}>{description}</p>
    </div>
  );
}

function SkeletonInboxRows({ theme }) {
  return (
    <div className="space-y-0">
      {Array.from({ length: 4 }).map((_, index) => (
        <div
          key={index}
          className={classNames(
            'grid gap-3 border-b px-4 py-4 sm:grid-cols-[1fr_1.05fr_72px]',
            theme.dark ? 'border-white/10' : 'border-slate-200',
          )}
        >
          <div className="space-y-2">
            <div className={classNames('h-4 w-32 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
            <div className={classNames('h-3 w-24 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
          </div>
          <div className="space-y-2">
            <div className={classNames('h-4 w-40 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
            <div className={classNames('h-3 w-full animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
          </div>
          <div className={classNames('h-8 w-16 animate-pulse self-center rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
        </div>
      ))}
    </div>
  );
}

function SkeletonMessageView({ theme }) {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className={classNames('h-3 w-28 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
        <div className={classNames('h-10 w-3/4 animate-pulse rounded-2xl', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className={classNames('rounded-2xl border p-4', theme.dark ? 'border-white/10 bg-white/[0.03]' : 'border-slate-200 bg-white/88')}>
            <div className={classNames('h-3 w-16 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
            <div className={classNames('mt-3 h-4 w-24 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
          </div>
        ))}
      </div>
      <div className={classNames('rounded-[1.4rem] border p-4 sm:p-5', theme.panel)}>
        <div className={classNames('h-3 w-24 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
        <div className="mt-4 space-y-3">
          <div className={classNames('h-3 w-full animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
          <div className={classNames('h-3 w-11/12 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
          <div className={classNames('h-3 w-4/5 animate-pulse rounded-full', theme.dark ? 'bg-white/10' : 'bg-slate-200')} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, description, isDark, icon = 'mailbox' }) {
  return (
    <div className="flex min-h-[16rem] items-center justify-center p-6 text-center">
      <div>
        <div
          className={classNames(
            'mx-auto flex h-14 w-14 items-center justify-center rounded-2xl border',
            isDark ? 'border-white/10 bg-white/[0.05] text-cyan-100' : 'border-slate-200 bg-white text-sky-700',
          )}
        >
          <EmptyStateIcon icon={icon} />
        </div>
        <p className={classNames('text-lg font-semibold', isDark ? 'text-white' : 'text-slate-900')}>{title}</p>
        <p className="mt-2 text-sm leading-6 text-slate-500">{description}</p>
      </div>
    </div>
  );
}

function EmptyStateIcon({ icon }) {
  if (icon === 'reader') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M5 5.5A2.5 2.5 0 0 1 7.5 3H20v16H7.5A2.5 2.5 0 0 0 5 21V5.5Z" />
        <path d="M8 7h8M8 11h8M8 15h5" strokeLinecap="round" />
      </svg>
    );
  }

  if (icon === 'message') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4h11A2.5 2.5 0 0 1 20 6.5v7A2.5 2.5 0 0 1 17.5 16H10l-4 4v-4H6.5A2.5 2.5 0 0 1 4 13.5v-7Z" />
      </svg>
    );
  }

  if (icon === 'spark') {
    return (
      <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="m12 3 1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" />
        <path d="m18.5 15 .8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2ZM5.5 14l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6.6-1.6Z" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9A2.5 2.5 0 0 1 17.5 19h-11A2.5 2.5 0 0 1 4 16.5v-9Z" />
      <path d="m5 7 7 5 7-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default App;
