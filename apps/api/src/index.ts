import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";

import {
  chatRequestSchema,
  createSessionRequestSchema,
  retrySessionRequestSchema,
  sessionDetailResponseSchema,
  sessionListResponseSchema,
  sessionMessagesResponseSchema,
} from "@repo-explainer/shared";

import { buildFileRecord, chunkFile } from "./lib/chunking";
import {
  getSessionDetail,
  getSessionRow,
  insertSession,
  listMessages,
  listSessionsByClientId,
  persistFilesAndChunks,
  resetSessionIndexData,
} from "./lib/db";
import { buildRepoPlan, extractSelectedFiles, parseGitHubRepoUrl } from "./lib/github";
import { generateOverview } from "./lib/overview";
import { retrieveEvidence } from "./lib/retrieval";
import { SessionCoordinator } from "./lib/session-do";
import type {
  AppEnv,
  ChatAnswerResult,
  RetrievalResult,
  SessionSnapshot,
  WorkflowPayload,
} from "./lib/types";
import { CHAT_MODEL } from "./lib/constants";
import {
  errorResponse,
  normalizeOptionalString,
  preflight,
  trimToLength,
  withCors,
} from "./lib/utils";

export { SessionCoordinator };

export class RepoIndexWorkflow extends WorkflowEntrypoint<AppEnv, WorkflowPayload> {
  async run(event: WorkflowEvent<WorkflowPayload>, step: WorkflowStep) {
    const { sessionId, repoUrl, branch, subdir } = event.payload;

    try {
      await invokeCoordinator(this.env, sessionId, {
        action: "setStatus",
        patch: {
          status: "indexing",
          statusStep: "fetching",
          statusMessage: "Fetching repo metadata and file tree",
        },
      });

      const plan = await step.do("resolve repo input", async () => {
        const resolvedPlan = await buildRepoPlan(this.env, { repoUrl, branch, subdir });
        await invokeCoordinator(this.env, sessionId, {
          action: "setStatus",
          patch: {
            status: "indexing",
            statusStep: "filtering",
            statusMessage: `Selected ${resolvedPlan.selectedFiles.length} files for indexing`,
            branch: resolvedPlan.branch,
            commitSha: resolvedPlan.commitSha,
            totalFiles: resolvedPlan.totalFiles,
            partialIndex: resolvedPlan.partialIndex,
          },
        });
        return resolvedPlan;
      });

      const extractedSummary = await step.do("extract archive and persist chunks", async () => {
        await invokeCoordinator(this.env, sessionId, {
          action: "setStatus",
          patch: {
            status: "indexing",
            statusStep: "extracting",
            statusMessage: "Downloading and extracting the repo archive",
          },
        });

        const extractedFiles = await extractSelectedFiles(this.env, plan);
        const createdAt = new Date().toISOString();
        const persisted = [];
        let totalBytes = 0;

        for (const file of extractedFiles) {
          const fileRecord = buildFileRecord(sessionId, file, createdAt);
          const chunks = chunkFile(sessionId, fileRecord, file);
          totalBytes += file.size;
          persisted.push({ file: fileRecord, chunks });
        }

        await invokeCoordinator(this.env, sessionId, {
          action: "setStatus",
          patch: {
            status: "indexing",
            statusStep: "chunking",
            statusMessage: `Chunking ${persisted.length} files into retrieval records`,
          },
        });

        await persistFilesAndChunks(this.env.DB, persisted);

        return {
          indexedFiles: persisted.length,
          totalBytes,
        };
      });

      const overviewSeed = await step.do("generate repo overview", async () => {
        await invokeCoordinator(this.env, sessionId, {
          action: "setStatus",
          patch: {
            status: "summarizing",
            statusStep: "summarizing",
            statusMessage: "Generating repo overview",
          },
        });

        const overview = await generateOverview(this.env, sessionId, plan.description);
        return overview.overview;
      });

      await step.do("finalize session", async () => {
        await invokeCoordinator(this.env, sessionId, {
          action: "setStatus",
          patch: {
            status: "ready",
            statusStep: "ready",
            statusMessage: "Repo indexed and ready for chat",
            branch: plan.branch,
            commitSha: plan.commitSha,
            totalFiles: plan.totalFiles,
            indexedFiles: extractedSummary.indexedFiles,
            totalBytes: extractedSummary.totalBytes,
            partialIndex: plan.partialIndex,
            overview: overviewSeed,
          },
        });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown workflow failure";
      await invokeCoordinator(this.env, sessionId, {
        action: "setStatus",
        patch: {
          status: "failed",
          statusStep: "failed",
          statusMessage: trimToLength(message, 180),
        },
      });
      throw error;
    }
  }
}

export default {
  async fetch(request: Request, env: AppEnv): Promise<Response> {
    const origin = env.ALLOWED_ORIGIN || "*";
    try {
      if (request.method === "OPTIONS") {
        return preflight(origin);
      }

      const response = await routeRequest(request, env);
      return withCors(response, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected server error";
      return withCors(errorResponse(message, 500), origin);
    }
  },
} satisfies ExportedHandler<AppEnv>;

async function routeRequest(request: Request, env: AppEnv) {
  const url = new URL(request.url);
  const segments = url.pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean);

  if (segments.length === 0) {
    return Response.json({
      name: "repo-explainer-api",
      ok: true,
    });
  }

  if (segments.length === 2 && segments[0] === "api" && segments[1] === "health") {
    return Response.json({ ok: true });
  }

  if (segments.length === 2 && segments[0] === "api" && segments[1] === "sessions") {
    if (request.method === "GET") {
      return handleListSessions(url, env);
    }
    if (request.method === "POST") {
      return handleCreateSession(request, env);
    }
  }

  if (segments.length >= 3 && segments[0] === "api" && segments[1] === "sessions") {
    const sessionId = segments[2];

    if (segments.length === 3 && request.method === "GET") {
      return handleGetSession(url, env, sessionId);
    }
    if (segments.length === 4 && segments[3] === "messages" && request.method === "GET") {
      return handleGetMessages(url, env, sessionId);
    }
    if (segments.length === 4 && segments[3] === "chat" && request.method === "POST") {
      return handleChat(request, env, sessionId);
    }
    if (segments.length === 4 && segments[3] === "retry" && request.method === "POST") {
      return handleRetry(request, env, sessionId);
    }
  }

  return errorResponse("Route not found.", 404);
}

async function handleListSessions(url: URL, env: AppEnv) {
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));
  if (!clientId) {
    return errorResponse("clientId is required.", 400);
  }

  const sessions = await listSessionsByClientId(env.DB, clientId);
  return Response.json(sessionListResponseSchema.parse({ sessions }));
}

async function handleCreateSession(request: Request, env: AppEnv) {
  const jsonBody = await request.json();
  const parsed = createSessionRequestSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid create session payload.", 400);
  }

  const { owner, repoName } = parseGitHubRepoUrl(parsed.data.repoUrl);
  const sessionId = crypto.randomUUID();
  const workflowId = `wf_${sessionId}_${Date.now()}`;
  const requestedBranch = parsed.data.branch?.trim() || "default";
  const normalizedSubdir = parsed.data.subdir?.trim() ? parsed.data.subdir.trim() : null;

  await insertSession(env.DB, {
    id: sessionId,
    clientId: parsed.data.clientId,
    workflowId,
    repoUrl: parsed.data.repoUrl,
    repoName,
    repoOwner: owner,
    branch: requestedBranch,
    subdir: normalizedSubdir,
  });

  await invokeCoordinator(env, sessionId, { action: "initialize" });
  await env.INDEX_WORKFLOW.create({
    id: workflowId,
    params: {
      sessionId,
      repoUrl: parsed.data.repoUrl,
      branch: parsed.data.branch,
      subdir: parsed.data.subdir,
    },
  });

  return Response.json({
    sessionId,
    status: "queued",
  });
}

async function handleGetSession(url: URL, env: AppEnv, sessionId: string) {
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));
  if (!clientId) {
    return errorResponse("clientId is required.", 400);
  }

  const session = await assertOwnedSession(env, sessionId, clientId);
  if (!session) {
    return errorResponse("Session not found.", 404);
  }

  return Response.json(sessionDetailResponseSchema.parse({ session }));
}

async function handleGetMessages(url: URL, env: AppEnv, sessionId: string) {
  const clientId = normalizeOptionalString(url.searchParams.get("clientId"));
  if (!clientId) {
    return errorResponse("clientId is required.", 400);
  }

  const session = await assertOwnedSession(env, sessionId, clientId);
  if (!session) {
    return errorResponse("Session not found.", 404);
  }

  const messages = await listMessages(env.DB, session.id);
  return Response.json(sessionMessagesResponseSchema.parse({ messages }));
}

async function handleRetry(request: Request, env: AppEnv, sessionId: string) {
  const jsonBody = await request.json();
  const parsed = retrySessionRequestSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid retry payload.", 400);
  }

  const sessionRow = await getSessionRow(env.DB, sessionId);
  if (!sessionRow || sessionRow.client_id !== parsed.data.clientId) {
    return errorResponse("Session not found.", 404);
  }

  const workflowId = `wf_${sessionId}_${Date.now()}`;
  await resetSessionIndexData(env.DB, sessionId);
  await invokeCoordinator(env, sessionId, { action: "resetForRetry", workflowId });
  await env.INDEX_WORKFLOW.create({
    id: workflowId,
    params: {
      sessionId,
      repoUrl: sessionRow.repo_url,
      branch: sessionRow.branch === "default" ? undefined : sessionRow.branch,
      subdir: sessionRow.subdir ?? undefined,
    },
  });

  return Response.json({ ok: true });
}

async function handleChat(request: Request, env: AppEnv, sessionId: string) {
  const jsonBody = await request.json();
  const parsed = chatRequestSchema.safeParse(jsonBody);
  if (!parsed.success) {
    return errorResponse(parsed.error.issues[0]?.message ?? "Invalid chat payload.", 400);
  }

  const session = await assertOwnedSession(env, sessionId, parsed.data.clientId);
  if (!session) {
    return errorResponse("Session not found.", 404);
  }
  if (session.status !== "ready") {
    return errorResponse(`Session is ${session.status}. Wait until indexing completes.`, 409);
  }

  const snapshot = (await invokeCoordinator(env, sessionId, {
    action: "recordUserMessage",
    content: parsed.data.message,
  })) as SessionSnapshot;

  const answer = await answerQuestion(env, sessionId, session, snapshot, parsed.data.message);

  await invokeCoordinator(env, sessionId, {
    action: "recordAssistantMessage",
    content: answer.answer,
    citations: answer.citations,
    evidenceUsed: answer.evidenceUsed,
    suggestedFiles: answer.suggestedFiles,
  });

  return Response.json(answer);
}

async function answerQuestion(
  env: AppEnv,
  sessionId: string,
  session: Awaited<ReturnType<typeof getSessionDetail>>,
  snapshot: SessionSnapshot,
  question: string,
): Promise<ChatAnswerResult> {
  if (!session) {
    throw new Error("Session detail unexpectedly missing.");
  }

  const retrieval = await retrieveEvidence(env, sessionId, question, snapshot);
  if (retrieval.chunks.length === 0) {
    return {
      answer:
        "I do not have enough indexed evidence to answer that confidently yet. Try asking about a specific file, folder, or module name that exists in the repo.",
      citations: [],
      evidenceUsed: [],
      suggestedFiles: [],
      weakEvidence: true,
    };
  }

  const prompt = [
    "You are answering questions about a GitHub repository.",
    "Rules:",
    "- Use only the supplied repository evidence.",
    "- Be concise and explicit about uncertainty.",
    "- Prefer direct evidence over speculation.",
    "- Mention concrete file paths in backticks when relevant.",
    "",
    `Repository: ${session.repoName}`,
    `Branch: ${session.branch}`,
    session.overview ? `Repo overview: ${session.overview.summary}` : "",
    snapshot.memorySummary ? `Conversation memory: ${snapshot.memorySummary}` : "",
    snapshot.lastReferencedFiles.length
      ? `Last referenced files: ${snapshot.lastReferencedFiles.join(", ")}`
      : "",
    `User question: ${question}`,
    "",
    "Evidence:",
    ...retrieval.chunks.map(
      (chunk, index) =>
        `[${index + 1}] ${chunk.path}:${chunk.startLine}-${chunk.endLine}\n${trimToLength(chunk.text, 1600)}`,
    ),
    "",
    "Write a short answer followed by one sentence that says whether the evidence is strong or weak.",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const result = await env.AI.run(CHAT_MODEL, {
      prompt,
      temperature: 0.1,
      max_tokens: 500,
    });
    const answer = typeof result === "string" ? result.trim() : result.response?.trim() ?? "";

    return {
      answer:
        answer ||
        "I found relevant evidence, but the model did not return text. Review the cited files below for the strongest matching context.",
      citations: retrieval.citations,
      evidenceUsed: retrieval.citations,
      suggestedFiles: retrieval.suggestedFiles,
      weakEvidence: retrieval.weakEvidence,
    };
  } catch {
    return {
      answer: buildFallbackAnswer(question, retrieval),
      citations: retrieval.citations,
      evidenceUsed: retrieval.citations,
      suggestedFiles: retrieval.suggestedFiles,
      weakEvidence: retrieval.weakEvidence,
    };
  }
}

function buildFallbackAnswer(question: string, retrieval: RetrievalResult) {
  if (retrieval.citations.length === 0) {
    return `I could not find strong indexed evidence for "${question}".`;
  }

  return [
    "The model call failed, but the retrieval layer found likely evidence.",
    `Start with ${retrieval.citations
      .slice(0, 3)
      .map((citation) => `\`${citation.path}\``)
      .join(", ")}.`,
  ].join(" ");
}

async function assertOwnedSession(env: AppEnv, sessionId: string, clientId: string) {
  const row = await getSessionRow(env.DB, sessionId);
  if (!row || row.client_id !== clientId) {
    return null;
  }
  return getSessionDetail(env.DB, sessionId);
}

async function invokeCoordinator(env: AppEnv, sessionId: string, payload: object) {
  const id = env.SESSION_COORDINATOR.idFromName(sessionId);
  const stub = env.SESSION_COORDINATOR.get(id);
  const response = await stub.fetch("https://session-coordinator/internal", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Session coordinator request failed with ${response.status}.`);
  }
  return response.json();
}
