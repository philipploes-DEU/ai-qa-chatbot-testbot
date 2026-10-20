import { z } from "zod";

/**
 * Identifier that is safe for file names and references: letters, digits, dot, underscore
 * and dash, starting with a letter or digit.
 */
export const IdSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    "IDs bestehen aus Buchstaben, Ziffern, Punkt, Unterstrich und Bindestrich und beginnen mit Buchstabe oder Ziffer",
  );
export type Id = z.infer<typeof IdSchema>;

/**
 * Version of a document. YAML turns `version: 1` into a number, so numbers are accepted
 * and normalised to a string.
 */
export const VersionSchema = z
  .union([z.string().min(1), z.number().int().nonnegative()])
  .transform((value) => String(value));
export type Version = z.infer<typeof VersionSchema>;

export const SeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export type Severity = z.infer<typeof SeveritySchema>;

/** ISO 8601 timestamp with time, for example 2026-10-10T14:30:00Z or with an offset. */
export const TimestampSchema = z.iso.datetime({ offset: true });
export type Timestamp = z.infer<typeof TimestampSchema>;

export const TokensSchema = z.strictObject({
  input: z.number().int().nonnegative(),
  output: z.number().int().nonnegative(),
});
export type Tokens = z.infer<typeof TokensSchema>;

export const TurnRoleSchema = z.enum(["user", "assistant", "system"]);
export type TurnRole = z.infer<typeof TurnRoleSchema>;

export const TurnSchema = z.strictObject({
  role: TurnRoleSchema,
  content: z.string(),
});
export type Turn = z.infer<typeof TurnSchema>;
