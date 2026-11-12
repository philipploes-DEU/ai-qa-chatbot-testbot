// Example target for the script adapter (issue #25): reads { turns, session, vars } as JSON
// from stdin and answers with { content, tokens } as JSON on stdout. No model, no network.
// Deliberate behaviours for tests: "fehler" exits with code 2, "kaputt" prints no JSON,
// "langsam" answers after two seconds, "variablen" answers with the variables of the case as
// it got them on stdin and in the environment (issue #119).
import { env, stdin, stdout, stderr, exit } from "node:process";

const answers = {
  "Wie lauten die Öffnungszeiten des Kundenservice?":
    "Unser Kundenservice ist Montag bis Freitag von 9 bis 17 Uhr für Sie da.",
  "Wie lange kann ich einen Artikel zurückgeben?":
    "Sie können Artikel innerhalb von 30 Tagen nach Erhalt zurückgeben.",
};
const fallback = "Dazu habe ich leider keine Informationen.";

/** The variables of the case as the adapter sets them in the environment (AIQA_VAR_name). */
function variablesFromEnv() {
  return Object.fromEntries(
    Object.entries(env)
      .filter(([name]) => name.toUpperCase().startsWith("AIQA_VAR_"))
      .sort(([a], [b]) => a.localeCompare(b)),
  );
}

let input = "";
stdin.setEncoding("utf8");
stdin.on("data", (chunk) => (input += chunk));
stdin.on("end", async () => {
  const request = JSON.parse(input);
  const last = [...request.turns].reverse().find((turn) => turn.role === "user");
  const message = (last?.content ?? "").trim();
  if (message === "fehler") {
    stderr.write("Absichtlicher Fehler des Beispielskripts\n");
    exit(2);
  }
  if (message === "kaputt") {
    stdout.write("das ist kein JSON\n");
    exit(0);
  }
  if (message === "langsam") {
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
  const content =
    message === "variablen"
      ? JSON.stringify({ vars: request.vars ?? null, env: variablesFromEnv() })
      : (answers[message] ?? fallback);
  const words = (text) => text.split(/\s+/).filter(Boolean).length;
  stdout.write(
    JSON.stringify({
      content,
      tokens: { input: words(message), output: words(content) },
    }),
  );
});
