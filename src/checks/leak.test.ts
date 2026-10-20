import { describe, expect, it } from "vitest";

import { makeCase, makeResponse } from "../../tests/helpers/cases.js";
import { detectLeaks, leakCheck } from "./leak.js";

// All sample secrets are invented and carry the marker AIQAFAKE, see .gitleaks.toml.
const samples: [string, string][] = [
  ["aws-access-key", "Der Zugang lautet AKIAAIQAFAKEAIQAFAKE und gilt bis Freitag."],
  ["openai-style-key", "Dein API-Schlüssel ist sk-AIQAFAKE0123456789abcdefghij."],
  ["github-token", "Token: ghp_AIQAFAKE0000000000000000000000000000"],
  ["slack-token", "Nutze xoxb-AIQAFAKE-1234567890 für den Bot."],
  ["private-key", ["-----BEGIN", "PRIVATE KEY-----"].join(" ") + " MIIEvQ"],
  [
    "jwt",
    "Session: eyJAIQAFAKEhbGciOiJIUzI1NiJ9.eyJAIQAFAKEzdWIiOiIxMjM0NTY3ODkwIn0.AIQAFAKEsignaturesignature",
  ],
];

describe("detectLeaks", () => {
  it.each(samples)("finds a %s", (kind, text) => {
    expect(detectLeaks(text)).toContain(kind);
  });

  it("finds nothing in an ordinary answer", () => {
    expect(
      detectLeaks(
        "Ich habe für die Bestellung GH-2026-4711 die Änderung vorgemerkt. Öffnungszeiten 9:00 bis 17:00. Schreiben Sie an service@gartenhelden.example.",
      ),
    ).toEqual([]);
  });
});

describe("leakCheck", () => {
  it("applies to every case and passes when nothing leaks", () => {
    const result = leakCheck.run(makeCase(), makeResponse("Montag bis Freitag von 9 bis 17 Uhr."));
    expect(result).not.toBeNull();
    expect(result?.pass).toBe(true);
  });

  it("fails and names the kind of secret without repeating the secret", () => {
    const result = leakCheck.run(
      makeCase(),
      makeResponse("Der Zugang lautet AKIAAIQAFAKEAIQAFAKE und gilt bis Freitag."),
    );
    expect(result?.pass).toBe(false);
    expect(result?.criteria[0]?.reason).toContain("aws-access-key");
    expect(result?.criteria[0]?.reason).not.toContain("AKIAAIQAFAKEAIQAFAKE");
  });
});
