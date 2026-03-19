import { startTransition, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";

import type { ChatMessage, RepoOverview, SessionDetail, SessionListItem } from "@repo-explainer/shared";

import {
  createSession,
  getClientId,
  getMessages,
  getSession,
  listSessions,
  retrySession,
  sendMessage,
} from "./api";

const STARTER_PROMPTS = [
  "What does this project do?",
  "Where should I start reading?",
  "Explain the architecture.",
  "Compare `src/index.ts` and `src/server.ts`.",
];

export default function App() {
  const [clientId] = useState(getClientId);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [sessionDetail, setSessionDetail] = useState<SessionDetail | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [subdir, setSubdir] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [isBooting, setIsBooting] = useState(true);
  const [isSubmittingRepo, setIsSubmittingRepo] = useState(false);
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesRef = useRef<HTMLDivElement | null>(null);

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  );

  const refreshSidebar = useEffectEvent(async () => {
    const nextSessions = await listSessions(clientId);
    setSessions(nextSessions);
    if (!selectedSessionId && nextSessions.length > 0) {
      startTransition(() => setSelectedSessionId(nextSessions[0].id));
    }
  });

  const refreshSession = useEffectEvent(async (options?: { includeMessages?: boolean }) => {
    if (!selectedSessionId) {
      return;
    }

    const [detail, nextMessages] = await Promise.all([
      getSession(selectedSessionId, clientId),
      options?.includeMessages ? getMessages(selectedSessionId, clientId) : Promise.resolve(null),
    ]);

    setSessionDetail(detail);
    if (nextMessages) {
      setMessages(nextMessages);
    }
  });

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      try {
        await refreshSidebar();
      } catch (nextError) {
        if (!cancelled) {
          setError(errorMessage(nextError));
        }
      } finally {
        if (!cancelled) {
          setIsBooting(false);
        }
      }
    }
    void boot();
    return () => {
      cancelled = true;
    };
  }, [refreshSidebar]);

  useEffect(() => {
    if (!selectedSessionId) {
      setSessionDetail(null);
      setMessages([]);
      return;
    }

    let cancelled = false;
    async function hydrate() {
      try {
        await refreshSession({ includeMessages: true });
      } catch (nextError) {
        if (!cancelled) {
          setError(errorMessage(nextError));
        }
      }
    }
    void hydrate();

    return () => {
      cancelled = true;
    };
  }, [refreshSession, selectedSessionId]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    const interval = window.setInterval(() => {
      void refreshSidebar();
      void refreshSession({ includeMessages: activeSession?.status !== "ready" || false });
    }, activeSession?.status === "ready" ? 9000 : 2500);

    return () => window.clearInterval(interval);
  }, [activeSession?.status, refreshSession, refreshSidebar, selectedSessionId]);

  useEffect(() => {
    messagesRef.current?.scrollTo({
      top: messagesRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  async function onSubmitRepo(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmittingRepo(true);

    try {
      const created = await createSession({
        clientId,
        repoUrl,
        branch: branch.trim() || undefined,
        subdir: subdir.trim() || undefined,
      });

      setRepoUrl("");
      setBranch("");
      setSubdir("");
      await refreshSidebar();
      startTransition(() => setSelectedSessionId(created.sessionId));
    } catch (nextError) {
      setError(errorMessage(nextError));
    } finally {
      setIsSubmittingRepo(false);
    }
  }

  async function onSendMessage(event?: React.FormEvent<HTMLFormElement>, preset?: string) {
    event?.preventDefault();
    const message = (preset ?? chatInput).trim();
    if (!message || !selectedSessionId) {
      return;
    }

    setError(null);
    setIsSendingMessage(true);
    if (!preset) {
      setChatInput("");
    }

    try {
      const response = await sendMessage(selectedSessionId, clientId, message);
      const optimisticUserMessage: ChatMessage = {
        id: `local-user-${Date.now()}`,
        role: "user",
        content: message,
        citations: [],
        evidenceUsed: [],
        suggestedFiles: [],
        createdAt: new Date().toISOString(),
      };
      const assistantMessage: ChatMessage = {
        id: `local-assistant-${Date.now()}`,
        role: "assistant",
        content: response.answer,
        citations: response.citations,
        evidenceUsed: response.evidenceUsed,
        suggestedFiles: response.suggestedFiles,
        createdAt: new Date().toISOString(),
      };
      setMessages((current) => [...current, optimisticUserMessage, assistantMessage]);
      await refreshSidebar();
      await refreshSession({ includeMessages: true });
    } catch (nextError) {
      setError(errorMessage(nextError));
      if (preset) {
        setChatInput(preset);
      }
    } finally {
      setIsSendingMessage(false);
    }
  }

  async function onRetrySession() {
    if (!selectedSessionId) {
      return;
    }
    setError(null);
    try {
      await retrySession(selectedSessionId, clientId);
      await refreshSidebar();
      await refreshSession({ includeMessages: true });
    } catch (nextError) {
      setError(errorMessage(nextError));
    }
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <p className="eyebrow">Cloudflare-native demo</p>
          <h1>Repo Explainer</h1>
          <p className="muted">
            Ingest a public GitHub repo, generate a grounded overview, then chat over indexed code with
            citations.
          </p>
        </div>

        <form className="repo-form" onSubmit={onSubmitRepo}>
          <label>
            <span>GitHub repo URL</span>
            <input
              required
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder="https://github.com/cloudflare/workers-sdk"
            />
          </label>
          <div className="inline-fields">
            <label>
              <span>Branch</span>
              <input value={branch} onChange={(event) => setBranch(event.target.value)} placeholder="default" />
            </label>
            <label>
              <span>Subdir</span>
              <input value={subdir} onChange={(event) => setSubdir(event.target.value)} placeholder="optional/path" />
            </label>
          </div>
          <button className="primary-button" disabled={isSubmittingRepo} type="submit">
            {isSubmittingRepo ? "Queueing repo..." : "Index repo"}
          </button>
        </form>

        <section className="session-list">
          <div className="section-label">
            <span>Recent sessions</span>
            {isBooting ? <small>Loading…</small> : <small>{sessions.length}</small>}
          </div>
          {sessions.length === 0 ? (
            <p className="empty-copy">No repo sessions yet. Paste a public GitHub repo to start.</p>
          ) : (
            sessions.map((session) => (
              <button
                key={session.id}
                className={`session-card ${session.id === selectedSessionId ? "active" : ""}`}
                onClick={() => startTransition(() => setSelectedSessionId(session.id))}
                type="button"
              >
                <div className="session-card-top">
                  <strong>{session.repoName}</strong>
                  <StatusPill status={session.status} />
                </div>
                <p>{session.statusMessage}</p>
                <small>
                  {session.branch}
                  {session.subdir ? ` · ${session.subdir}` : ""}
                </small>
              </button>
            ))
          )}
        </section>
      </aside>

      <main className="workspace">
        {error ? <div className="error-banner">{error}</div> : null}

        {!selectedSessionId || !sessionDetail ? (
          <section className="hero-panel">
            <p className="eyebrow">What this build demonstrates</p>
            <h2>Workers AI, Workflows, Durable Objects, and D1 working together around one repo.</h2>
            <p>
              Paste a repo, watch the indexing states move from queued to ready, then ask grounded questions
              like “where is auth handled?” or “what files should I read first?”
            </p>
            <div className="hero-grid">
              <div>
                <h3>Grounded answers</h3>
                <p>Every response returns cited file paths and line ranges from indexed chunks.</p>
              </div>
              <div>
                <h3>Session memory</h3>
                <p>Follow-up questions carry focus areas and last-referenced files across the chat.</p>
              </div>
              <div>
                <h3>Cloudflare story</h3>
                <p>Pages hosts the UI while the Worker orchestrates Workflows, state, storage, and AI.</p>
              </div>
            </div>
          </section>
        ) : (
          <>
            <section className="repo-summary">
              <div className="repo-summary-header">
                <div>
                  <p className="eyebrow">Active repo session</p>
                  <h2>{sessionDetail.repoName}</h2>
                  <p className="muted">
                    {sessionDetail.repoUrl}
                    {sessionDetail.commitSha ? ` · ${sessionDetail.commitSha.slice(0, 7)}` : ""}
                  </p>
                </div>
                <div className="status-block">
                  <StatusPill status={sessionDetail.status} />
                  <span>{sessionDetail.statusMessage}</span>
                  {sessionDetail.partialIndex ? <small>Partial index</small> : null}
                </div>
              </div>

              <div className="stats-grid">
                <Metric label="Indexed files" value={`${sessionDetail.indexedFiles}/${sessionDetail.totalFiles}`} />
                <Metric label="Bytes kept" value={formatBytes(sessionDetail.totalBytes)} />
                <Metric label="Branch" value={sessionDetail.branch} />
                <Metric label="Focus memory" value={sessionDetail.focusAreas.slice(0, 3).join(", ") || "None yet"} />
              </div>

              <OverviewPanel overview={sessionDetail.overview} />

              {sessionDetail.status === "failed" ? (
                <div className="retry-row">
                  <p>The indexing workflow failed. Retry after checking the repo URL or GitHub availability.</p>
                  <button className="secondary-button" onClick={onRetrySession} type="button">
                    Retry indexing
                  </button>
                </div>
              ) : null}

              {sessionDetail.status !== "ready" ? (
                <ProgressPanel status={sessionDetail.status} statusStep={sessionDetail.statusStep} />
              ) : (
                <div className="prompt-row">
                  {STARTER_PROMPTS.map((prompt) => (
                    <button
                      key={prompt}
                      className="prompt-chip"
                      disabled={isSendingMessage}
                      onClick={() => void onSendMessage(undefined, prompt)}
                      type="button"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              )}
            </section>

            <section className="chat-panel">
              <div className="chat-header">
                <div>
                  <p className="eyebrow">Chat over indexed code</p>
                  <h3>Ask follow-up questions</h3>
                </div>
                <small>{messages.length} messages</small>
              </div>

              <div className="messages" ref={messagesRef}>
                {messages.length === 0 ? (
                  <div className="message-empty">
                    {sessionDetail.status === "ready"
                      ? "The repo is ready. Ask about architecture, auth, data flow, or files to read first."
                      : "Messages will appear here once the repo is ready and you start asking questions."}
                  </div>
                ) : (
                  messages.map((message) => <MessageCard key={message.id} message={message} />)
                )}
              </div>

              <form className="chat-form" onSubmit={(event) => void onSendMessage(event)}>
                <textarea
                  disabled={sessionDetail.status !== "ready" || isSendingMessage}
                  onChange={(event) => setChatInput(event.target.value)}
                  placeholder={
                    sessionDetail.status === "ready"
                      ? "Explain the architecture or ask for specific files."
                      : "Wait for indexing to finish before chatting."
                  }
                  rows={3}
                  value={chatInput}
                />
                <button
                  className="primary-button"
                  disabled={!chatInput.trim() || sessionDetail.status !== "ready" || isSendingMessage}
                  type="submit"
                >
                  {isSendingMessage ? "Answering..." : "Ask repo"}
                </button>
              </form>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function OverviewPanel({ overview }: { overview: RepoOverview | null }) {
  if (!overview) {
    return (
      <div className="overview-grid">
        <div className="panel-card">
          <h3>Overview pending</h3>
          <p>The workflow will fill this in once summarization completes.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="overview-grid">
      <div className="panel-card summary-card">
        <h3>Repo overview</h3>
        <p>{overview.summary}</p>
      </div>
      <ListCard title="Technologies" items={overview.technologies} />
      <ReasonListCard title="Important folders" items={overview.importantFolders} />
      <ReasonListCard title="Likely entrypoints" items={overview.entrypoints} />
      <ReasonListCard title="Read first" items={overview.readingOrder} />
    </div>
  );
}

function ListCard({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="panel-card">
      <h3>{title}</h3>
      <ul>
        {items.length === 0 ? <li>None detected yet.</li> : items.map((item) => <li key={item}>{item}</li>)}
      </ul>
    </div>
  );
}

function ReasonListCard({
  title,
  items,
}: {
  title: string;
  items: Array<{ path: string; reason: string }>;
}) {
  return (
    <div className="panel-card">
      <h3>{title}</h3>
      <ul>
        {items.length === 0 ? (
          <li>None detected yet.</li>
        ) : (
          items.map((item) => (
            <li key={`${title}-${item.path}`}>
              <code>{item.path}</code>
              <span>{item.reason}</span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}

function ProgressPanel({
  status,
  statusStep,
}: {
  status: SessionDetail["status"];
  statusStep: SessionDetail["statusStep"];
}) {
  const steps = ["queued", "fetching", "filtering", "extracting", "chunking", "summarizing", "ready"];
  return (
    <div className="panel-card progress-card">
      <h3>Workflow progress</h3>
      <div className="progress-rail">
        {steps.map((step) => (
          <div
            key={step}
            className={`progress-step ${
              step === statusStep || (status === "ready" && step === "ready") ? "current" : ""
            }`}
          >
            {step}
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: SessionDetail["status"] | SessionListItem["status"] }) {
  return <span className={`status-pill status-${status}`}>{status}</span>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function MessageCard({ message }: { message: ChatMessage }) {
  return (
    <article className={`message-card ${message.role}`}>
      <header>
        <strong>{message.role === "assistant" ? "Repo Explainer" : "You"}</strong>
        <small>{new Date(message.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</small>
      </header>
      <p>{message.content}</p>
      {message.citations.length > 0 ? (
        <div className="citation-block">
          <span>Evidence used</span>
          <div className="citation-list">
            {message.citations.map((citation) => (
              <code key={`${message.id}-${citation.path}-${citation.startLine ?? 0}`}>
                {citation.path}
                {citation.startLine ? `:${citation.startLine}-${citation.endLine}` : ""}
              </code>
            ))}
          </div>
        </div>
      ) : null}
    </article>
  );
}

function errorMessage(value: unknown) {
  return value instanceof Error ? value.message : "Unexpected error";
}

function formatBytes(value: number) {
  if (!value) {
    return "0 B";
  }
  const units = ["B", "KB", "MB"];
  let current = value;
  let index = 0;
  while (current > 1024 && index < units.length - 1) {
    current /= 1024;
    index += 1;
  }
  return `${current.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}
