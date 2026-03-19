import type {
  ChatMessage,
  ChatResponse,
  CreateSessionResponse,
  SessionDetail,
  SessionListItem,
} from "@repo-explainer/shared";

const API_BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "http://127.0.0.1:8787";
const CLIENT_ID_KEY = "repo-explainer-client-id";

export function getClientId() {
  const existing = window.localStorage.getItem(CLIENT_ID_KEY);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.localStorage.setItem(CLIENT_ID_KEY, next);
  return next;
}

export async function listSessions(clientId: string) {
  const response = await fetch(`${API_BASE}/api/sessions?clientId=${encodeURIComponent(clientId)}`);
  return unwrap<{ sessions: SessionListItem[] }>(response).then((body) => body.sessions);
}

export async function createSession(input: {
  clientId: string;
  repoUrl: string;
  branch?: string;
  subdir?: string;
}) {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  return unwrap<CreateSessionResponse>(response);
}

export async function getSession(sessionId: string, clientId: string) {
  const response = await fetch(
    `${API_BASE}/api/sessions/${sessionId}?clientId=${encodeURIComponent(clientId)}`,
  );
  return unwrap<{ session: SessionDetail }>(response).then((body) => body.session);
}

export async function getMessages(sessionId: string, clientId: string) {
  const response = await fetch(
    `${API_BASE}/api/sessions/${sessionId}/messages?clientId=${encodeURIComponent(clientId)}`,
  );
  return unwrap<{ messages: ChatMessage[] }>(response).then((body) => body.messages);
}

export async function sendMessage(sessionId: string, clientId: string, message: string) {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientId, message }),
  });
  return unwrap<ChatResponse>(response);
}

export async function retrySession(sessionId: string, clientId: string) {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ clientId }),
  });
  return unwrap<{ ok: true }>(response);
}

async function unwrap<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
}
