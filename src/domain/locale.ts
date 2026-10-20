import { z } from "zod";

/** Switches Zod's built-in messages to German. Called once by the CLI entry point. */
export function useGermanMessages(): void {
  z.config(z.locales.de());
}
