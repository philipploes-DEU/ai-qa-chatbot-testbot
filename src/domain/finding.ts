import { z } from "zod";

import { IdSchema, SeveritySchema } from "./common.js";
import { TestCaseSchema } from "./test-case.js";

export const FindingStatusSchema = z.enum(["hypothesis", "confirmed", "rejected"]);
export type FindingStatus = z.infer<typeof FindingStatusSchema>;

/**
 * A grouped observation across failed iterations, produced by the analysis agent (issue #17).
 * It starts as a hypothesis; only a human confirms or rejects it (ADR 0010).
 */
export const FindingSchema = z.strictObject({
  id: IdSchema,
  runId: IdSchema,
  caseIds: z.array(IdSchema).min(1),
  /** Catalog id such as LLM01 or a domain tag. */
  category: z.string().min(1),
  severity: SeveritySchema,
  hypothesis: z.string().min(1),
  /** Catalog ids and domain tags the analysis assigned. */
  tags: z.array(z.string().min(1)).default([]),
  /** Failed iterations the finding groups, counted from the result store. */
  failedIterations: z.number().int().nonnegative().optional(),
  /** Pointers to the failed iterations, `<caseId>#<index>`. */
  evidenceRefs: z.array(z.string().min(1)).default([]),
  /** Cases that would test the hypothesis. Drafts, never written into a goldset by the agent. */
  suggestedCases: z.array(TestCaseSchema).default([]),
  status: FindingStatusSchema.default("hypothesis"),
  /** Why a human decided so, for a rejection for example "Fehlalarm des Werkzeugs" (issue #86). */
  note: z.string().min(1).optional(),
  /** For a confirmed finding: the cause as far as known. */
  cause: z.string().min(1).optional(),
  /** For a confirmed finding: what would fix it. */
  suggestion: z.string().min(1).optional(),
});
export type Finding = z.infer<typeof FindingSchema>;
export type FindingInput = z.input<typeof FindingSchema>;
