import { z } from "zod";

export const sessionStatusSchema = z.enum([
  "queued",
  "indexing",
  "summarizing",
  "ready",
  "failed",
]);

export const statusStepSchema = z.enum([
  "queued",
  "fetching",
  "filtering",
  "extracting",
  "chunking",
  "summarizing",
  "ready",
  "failed",
]);

export const citationSchema = z.object({
  path: z.string(),
  startLine: z.number().int().optional(),
  endLine: z.number().int().optional(),
  reason: z.string().optional(),
});

export const overviewItemSchema = z.object({
  path: z.string(),
  reason: z.string(),
});

export const repoOverviewSchema = z.object({
  summary: z.string(),
  technologies: z.array(z.string()),
  importantFolders: z.array(overviewItemSchema),
  entrypoints: z.array(overviewItemSchema),
  readingOrder: z.array(overviewItemSchema),
  notes: z.array(z.string()),
});

export const messageRoleSchema = z.enum(["user", "assistant"]);

export const chatMessageSchema = z.object({
  id: z.string(),
  role: messageRoleSchema,
  content: z.string(),
  citations: z.array(citationSchema).default([]),
  evidenceUsed: z.array(citationSchema).default([]),
  suggestedFiles: z.array(z.string()).default([]),
  createdAt: z.string(),
});

export const sessionListItemSchema = z.object({
  id: z.string(),
  repoUrl: z.string(),
  repoName: z.string(),
  branch: z.string(),
  subdir: z.string().nullable(),
  status: sessionStatusSchema,
  statusStep: statusStepSchema,
  statusMessage: z.string(),
  updatedAt: z.string(),
  partialIndex: z.boolean(),
});

export const sessionDetailSchema = sessionListItemSchema.extend({
  workflowId: z.string().nullable(),
  commitSha: z.string().nullable(),
  totalFiles: z.number().int(),
  indexedFiles: z.number().int(),
  totalBytes: z.number().int(),
  memorySummary: z.string(),
  focusAreas: z.array(z.string()),
  lastReferencedFiles: z.array(z.string()),
  overview: repoOverviewSchema.nullable(),
});

export const createSessionRequestSchema = z.object({
  clientId: z.string().min(8).max(128),
  repoUrl: z.url(),
  branch: z.string().trim().max(200).optional(),
  subdir: z.string().trim().max(500).optional(),
});

export const createSessionResponseSchema = z.object({
  sessionId: z.string(),
  status: sessionStatusSchema,
});

export const retrySessionRequestSchema = z.object({
  clientId: z.string().min(8).max(128),
});

export const chatRequestSchema = z.object({
  clientId: z.string().min(8).max(128),
  message: z.string().trim().min(1).max(5000),
});

export const chatResponseSchema = z.object({
  answer: z.string(),
  citations: z.array(citationSchema),
  evidenceUsed: z.array(citationSchema),
  suggestedFiles: z.array(z.string()),
  weakEvidence: z.boolean(),
});

export const sessionListResponseSchema = z.object({
  sessions: z.array(sessionListItemSchema),
});

export const sessionMessagesResponseSchema = z.object({
  messages: z.array(chatMessageSchema),
});

export const sessionDetailResponseSchema = z.object({
  session: sessionDetailSchema,
});

export type SessionStatus = z.infer<typeof sessionStatusSchema>;
export type StatusStep = z.infer<typeof statusStepSchema>;
export type Citation = z.infer<typeof citationSchema>;
export type RepoOverview = z.infer<typeof repoOverviewSchema>;
export type ChatMessage = z.infer<typeof chatMessageSchema>;
export type SessionListItem = z.infer<typeof sessionListItemSchema>;
export type SessionDetail = z.infer<typeof sessionDetailSchema>;
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;
export type RetrySessionRequest = z.infer<typeof retrySessionRequestSchema>;
export type ChatRequest = z.infer<typeof chatRequestSchema>;
export type ChatResponse = z.infer<typeof chatResponseSchema>;
export type SessionListResponse = z.infer<typeof sessionListResponseSchema>;
export type SessionMessagesResponse = z.infer<typeof sessionMessagesResponseSchema>;
export type SessionDetailResponse = z.infer<typeof sessionDetailResponseSchema>;
