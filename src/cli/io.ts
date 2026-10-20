/** Where commands write and from where they resolve paths. Tests inject their own. */
export interface CliIo {
  cwd: string;
  writeOut(line: string): void;
  writeErr(line: string): void;
  /** Environment that .env files fill before a command; process.env when omitted. */
  env?: Record<string, string | undefined>;
}
