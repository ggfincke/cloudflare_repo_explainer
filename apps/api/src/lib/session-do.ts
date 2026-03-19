import type { Citation } from "@repo-explainer/shared";

import { getSessionRow, insertMessage, updateMemoryState, updateSession } from "./db";
import type { AppEnv, SessionSnapshot, SessionStatusPatch } from "./types";
import { extractFocusAreas, makeId, nowIso, safeJsonParse, trimToLength, uniqueStrings } from "./utils";

type CoordinatorAction =
  | { action: "initialize" }
  | { action: "getSnapshot" }
  | { action: "setStatus"; patch: SessionStatusPatch }
  | { action: "recordUserMessage"; content: string }
  | {
      action: "recordAssistantMessage";
      content: string;
      citations: Citation[];
      evidenceUsed: Citation[];
      suggestedFiles: string[];
    }
  | { action: "resetForRetry"; workflowId: string };

export class SessionCoordinator implements DurableObject {
  private snapshot?: SessionSnapshot;

  constructor(
    private readonly state: DurableObjectState,
    private readonly env: AppEnv,
  ) {}

  async fetch(request: Request): Promise<Response> {
    const payload = (await request.json()) as CoordinatorAction;
    const snapshot = await this.ensureSnapshot();

    switch (payload.action) {
      case "initialize":
      case "getSnapshot":
        return Response.json(snapshot);
      case "setStatus":
        return Response.json(await this.handleSetStatus(payload.patch));
      case "recordUserMessage":
        return Response.json(await this.handleRecordUserMessage(payload.content));
      case "recordAssistantMessage":
        return Response.json(
          await this.handleRecordAssistantMessage(
            payload.content,
            payload.citations,
            payload.evidenceUsed,
            payload.suggestedFiles,
          ),
        );
      case "resetForRetry":
        return Response.json(await this.handleReset(payload.workflowId));
      default:
        return Response.json({ error: "Unsupported coordinator action." }, { status: 400 });
    }
  }

  private async handleSetStatus(patch: SessionStatusPatch) {
    const snapshot = await this.ensureSnapshot();
    await updateSession(this.env.DB, snapshot.id, patch);

    if (patch.status) snapshot.status = patch.status;
    if (patch.statusStep) snapshot.statusStep = patch.statusStep;
    if (patch.statusMessage) snapshot.statusMessage = patch.statusMessage;

    await this.persistSnapshot(snapshot);
    return snapshot;
  }

  private async handleRecordUserMessage(content: string) {
    const snapshot = await this.ensureSnapshot();
    const createdAt = nowIso();
    await insertMessage(this.env.DB, {
      id: makeId("msg"),
      sessionId: snapshot.id,
      role: "user",
      content,
      createdAt,
    });

    snapshot.focusAreas = uniqueStrings([
      ...extractFocusAreas(content, snapshot.lastReferencedFiles),
      ...snapshot.focusAreas,
    ]).slice(0, 8);
    snapshot.memorySummary = trimToLength(`Recent question: ${content}`, 280);

    await updateMemoryState(this.env.DB, snapshot.id, {
      memorySummary: snapshot.memorySummary,
      focusAreas: snapshot.focusAreas,
      lastReferencedFiles: snapshot.lastReferencedFiles,
    });
    await this.persistSnapshot(snapshot);

    return snapshot;
  }

  private async handleRecordAssistantMessage(
    content: string,
    citations: Citation[],
    evidenceUsed: Citation[],
    suggestedFiles: string[],
  ) {
    const snapshot = await this.ensureSnapshot();
    const createdAt = nowIso();
    await insertMessage(this.env.DB, {
      id: makeId("msg"),
      sessionId: snapshot.id,
      role: "assistant",
      content,
      citations,
      evidenceUsed,
      suggestedFiles,
      createdAt,
    });

    snapshot.lastReferencedFiles = uniqueStrings(
      citations.map((citation) => citation.path).concat(suggestedFiles),
    ).slice(0, 6);
    snapshot.focusAreas = uniqueStrings([
      ...snapshot.focusAreas,
      ...extractFocusAreas(content, snapshot.lastReferencedFiles),
    ]).slice(0, 8);
    snapshot.memorySummary = trimToLength(
      `Recent focus: ${snapshot.focusAreas.join(", ") || "repo overview"}. Last answer: ${content}`,
      320,
    );

    await updateMemoryState(this.env.DB, snapshot.id, {
      memorySummary: snapshot.memorySummary,
      focusAreas: snapshot.focusAreas,
      lastReferencedFiles: snapshot.lastReferencedFiles,
    });
    await this.persistSnapshot(snapshot);

    return snapshot;
  }

  private async handleReset(workflowId: string) {
    const snapshot = await this.ensureSnapshot();
    snapshot.status = "queued";
    snapshot.statusStep = "queued";
    snapshot.statusMessage = "Queued for indexing";
    snapshot.memorySummary = "";
    snapshot.focusAreas = [];
    snapshot.lastReferencedFiles = [];

    await updateSession(this.env.DB, snapshot.id, {
      workflowId,
      status: "queued",
      statusStep: "queued",
      statusMessage: "Queued for indexing",
      commitSha: null,
      totalFiles: 0,
      indexedFiles: 0,
      totalBytes: 0,
      partialIndex: false,
      overview: null,
    });
    await updateMemoryState(this.env.DB, snapshot.id, {
      memorySummary: "",
      focusAreas: [],
      lastReferencedFiles: [],
    });
    await this.persistSnapshot(snapshot);

    return snapshot;
  }

  private async ensureSnapshot() {
    if (this.snapshot) {
      return this.snapshot;
    }

    const stored = await this.state.storage.get<SessionSnapshot>("snapshot");
    if (stored) {
      this.snapshot = stored;
      return stored;
    }

    const sessionId = this.state.id.name;
    if (!sessionId) {
      throw new Error("Session coordinator was invoked without a named Durable Object id.");
    }

    const row = await getSessionRow(this.env.DB, sessionId);
    if (!row) {
      throw new Error(`No session exists for coordinator ${sessionId}.`);
    }

    const snapshot: SessionSnapshot = {
      id: row.id,
      status: row.status,
      statusStep: row.status_step,
      statusMessage: row.status_message,
      memorySummary: row.memory_summary,
      focusAreas: safeJsonParse<string[]>(row.focus_areas_json, []),
      lastReferencedFiles: safeJsonParse<string[]>(row.last_referenced_files_json, []),
    };

    this.snapshot = snapshot;
    await this.persistSnapshot(snapshot);
    return snapshot;
  }

  private async persistSnapshot(snapshot: SessionSnapshot) {
    this.snapshot = snapshot;
    await this.state.storage.put("snapshot", snapshot);
  }
}
