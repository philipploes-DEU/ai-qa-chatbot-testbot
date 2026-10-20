/** A versioned judge prompt. The version lands in every verdict the judge produces. */
export interface JudgePrompt {
  version: string;
  system: string;
  /** The prompt explains source documents; older versions get none (issue #70). */
  readsSources?: boolean;
}
