import { readFileSync } from "node:fs";
import path from "node:path";

import { Command, CommanderError } from "commander";

import { toPosix } from "../io/files.js";
import { ValidationError } from "../io/yaml.js";
import { requireWorkspaceConfig } from "./config.js";
import { loadEnvFiles } from "./env-files.js";
import { CliError } from "./errors.js";
import { initWorkspace } from "./init.js";
import { executeCalibrate } from "./calibrate-command.js";
import { executeCompare } from "./compare-command.js";
import { executeGate } from "./gate-command.js";
import { executeJudge } from "./judge-command.js";
import { executePlan } from "./plan-command.js";
import type { CliIo } from "./io.js";
import { executeAnalyze } from "./analyze-command.js";
import { executeImport } from "./import-command.js";
import { executeReport } from "./report-command.js";
import { executeResolve } from "./resolve-command.js";
import { executeRun } from "./run-command.js";
import { executeUi } from "./ui-command.js";
import { validatePaths, type ValidationResult } from "./validate.js";

export type { CliIo } from "./io.js";

interface CliState {
  exitCode: number;
}

function readVersion(): string {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
  ) as { version?: string };
  return packageJson.version ?? "0.0.0";
}

function printValidation(result: ValidationResult, io: CliIo): void {
  for (const file of result.files) {
    const detail = [file.kind, file.summary].filter((part) => part !== undefined).join(", ");
    if (file.errors.length === 0) {
      io.writeOut(`OK      ${file.path} (${detail})`);
    } else {
      io.writeOut(`FEHLER  ${file.path} (${detail})`);
      for (const line of file.errors) io.writeOut(`        ${line}`);
    }
  }
  const failed = result.files.filter((file) => file.errors.length > 0).length;
  io.writeOut(`${String(result.files.length)} Dateien geprüft, ${String(failed)} mit Fehlern`);
}

async function workspacePaths(cwd: string, configPath?: string): Promise<string[]> {
  const workspace = await requireWorkspaceConfig(cwd, configPath);
  return [
    workspace.file,
    ...workspace.config.goldsets.map((ref) => path.resolve(workspace.dir, ref)),
    ...workspace.config.catalogs.map((ref) => path.resolve(workspace.dir, ref)),
  ];
}

export function createProgram(baseIo: CliIo, state: CliState): Command {
  // Commands read paths relative to io.cwd; --workspace moves that base directory.
  const io: CliIo = {
    cwd: baseIo.cwd,
    writeOut: (line) => {
      baseIo.writeOut(line);
    },
    writeErr: (line) => {
      baseIo.writeErr(line);
    },
  };

  const program = new Command("aiqa")
    .description(
      "Prüfwerkzeug für KI-Schnittstellen: Goldsets und OWASP-Testfälle gegen ein Zielsystem fahren, Antworten bewerten, Statistik und Report erzeugen.",
    )
    .version(readVersion())
    .option(
      "-w, --workspace <ordner>",
      "Arbeitsbereich, auf den sich alle Pfade beziehen (Standard: aktuelles Verzeichnis)",
    );

  program.exitOverride();
  program.configureOutput({
    writeOut: (text) => {
      io.writeOut(text.trimEnd());
    },
    writeErr: (text) => {
      io.writeErr(text.trimEnd());
    },
  });
  program.hook("preAction", (_program, action) => {
    const { workspace } = program.opts<{ workspace?: string }>();
    if (workspace !== undefined) {
      io.cwd = path.resolve(baseIo.cwd, workspace);
    }
    // Keys live in .env, never in aiqa.yaml: the workspace first, then the start directory.
    const { config } = action.opts<{ config?: string }>();
    const workspaceDir = config === undefined ? io.cwd : path.dirname(path.resolve(io.cwd, config));
    const env = baseIo.env ?? process.env;
    if (env.AIQA_NO_ENV_FILE === "1") return;
    for (const loaded of loadEnvFiles([workspaceDir, baseIo.cwd], env)) {
      io.writeErr(
        `Umgebung geladen: ${toPosix(path.relative(baseIo.cwd, loaded.file)) || ".env"} (${String(loaded.variables)} Variablen)`,
      );
    }
  });

  program
    .command("init")
    .argument("<ordner>", "neuer oder leerer Ordner für den Arbeitsbereich")
    .option(
      "--with-schedule",
      "legt zusätzlich eine GitHub-Actions-Vorlage für regelmäßige Läufe an",
    )
    .description("legt einen Arbeitsbereich mit aiqa.yaml, Beispiel-Goldset und Plan an")
    .action(async (folder: string, options: { withSchedule?: boolean }) => {
      const created = await initWorkspace(path.resolve(io.cwd, folder), undefined, {
        withSchedule: options.withSchedule === true,
      });
      io.writeOut(`Arbeitsbereich angelegt: ${folder}`);
      for (const file of created) {
        io.writeOut(
          `  ${path.relative(path.resolve(io.cwd, folder), file).split(path.sep).join("/")}`,
        );
      }
      io.writeOut("");
      io.writeOut("Nächste Schritte, aus diesem Verzeichnis:");
      io.writeOut(`  aiqa -w ${folder} validate`);
      io.writeOut(`  aiqa -w ${folder} run --plan goldsets/beispiel/plan.yaml --target dummy`);
      io.writeOut(`  aiqa -w ${folder} report --run latest`);
      io.writeOut("Aus dem Repository von AI QA heraus lautet der Befehl pnpm aiqa -- statt aiqa.");
    });

  program
    .command("validate")
    .argument(
      "[pfade...]",
      "Dateien oder Ordner; ohne Angabe aiqa.yaml und die darin genannten Goldsets und Kataloge",
    )
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml", undefined)
    .option(
      "--allow-same-model",
      "erlaubt, dass Judge und Zielsystem dasselbe Modell nutzen (Hinweis im Report)",
    )
    .description("prüft Goldsets, Kataloge, Pläne, Specs und aiqa.yaml gegen die Schemas")
    .action(async (paths: string[], options: { config?: string; allowSameModel?: boolean }) => {
      const targets = paths.length > 0 ? paths : await workspacePaths(io.cwd, options.config);
      const result = await validatePaths(targets, io.cwd, {
        allowSameModel: options.allowSameModel === true,
      });
      printValidation(result, io);
      if (!result.ok) state.exitCode = 1;
    });

  program
    .command("run")
    .requiredOption("--plan <datei>", "Lauf-Plan (YAML)")
    .option("--target <name>", "Name oder Adapter des Zielsystems aus aiqa.yaml")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .option(
      "--allow-same-model",
      "erlaubt, dass Judge und Zielsystem dasselbe Modell nutzen (Hinweis im Report)",
    )
    .option("--resolve", "bindet die Platzhalter {{fixtures.name}} vor dem Lauf neu")
    .description(
      "führt einen Plan gegen das Zielsystem aus und schreibt Iterationen und Urteile als JSONL",
    )
    .action(
      async (options: {
        plan: string;
        target?: string;
        config?: string;
        allowSameModel?: boolean;
        resolve?: boolean;
      }) => {
        const summary = await executeRun(options, io);
        if (summary.status === "aborted") state.exitCode = 2;
      },
    );

  program
    .command("resolve")
    .option("--plan <datei>", "bindet nur die Platzhalter der Fälle dieses Plans")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "bindet die Platzhalter {{fixtures.name}} aus den Datenquellen in aiqa.yaml und speichert die Bindung für den nächsten Lauf",
    )
    .action(async (options: { plan?: string; config?: string }) => {
      await executeResolve(options, io);
    });

  program
    .command("report")
    .requiredOption(
      "--run <id...>",
      "Lauf-ID oder latest, mehrere Läufe eines Zielsystems ergeben einen Übergabe-Report",
    )
    .option("--format <format>", "markdown (Standard), html oder junit")
    .option("--theme <name>", "Theme: default, wirkmittel (Standard für html) oder neutral")
    .option("--out <datei>", "Zieldatei statt reports/<id>.md, .html oder .xml")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "baut den Report eines Laufs mit Pass-Rate, Wilson-Intervall, Flakiness und Trend, als Markdown, HTML oder JUnit-XML, mit mehreren Läufen einen Übergabe-Report",
    )
    .action(
      async (options: {
        run: string[];
        out?: string;
        config?: string;
        format?: string;
        theme?: string;
      }) => {
        await executeReport(options, io);
      },
    );

  program
    .command("plan")
    .requiredOption("--out <datei>", "Plan-Datei, die geschrieben wird (YAML)")
    .option("--iterations <n>", "Iterationen je Fall (Standard 5)", (value) => Number(value))
    .option(
      "--probes [katalog]",
      "nimmt die OWASP-Testmuster als Proben auf, wahlweise aus einer eigenen Katalogdatei",
    )
    .option(
      "--docs <pfade...>",
      "Fachdokumente (.md, .txt, Ordner), aus denen der Planungsagent Entwürfe vorschlägt",
    )
    .option("--drafts <datei>", "Goldset für die Entwürfe (Standard goldsets/entwuerfe.yaml)")
    .option("--max-cases <n>", "höchstens so viele Entwürfe je Dokument (Standard 10)", (value) =>
      Number(value),
    )
    .option("--id <id>", "Plan-ID (Standard plan-<zeitstempel>)")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "schreibt einen Plan über alle aktiven Fälle der Goldsets, wahlweise mit OWASP-Proben aus dem Katalog und Entwürfen des Planungsagenten aus Fachdokumenten",
    )
    .action(
      async (options: {
        out: string;
        iterations?: number;
        probes?: string | boolean;
        docs?: string[];
        drafts?: string;
        maxCases?: number;
        id?: string;
        config?: string;
      }) => {
        await executePlan(options, io);
      },
    );

  program
    .command("ui")
    .option("--port <n>", "Port der Oberfläche (Standard 4317)", (value) => Number(value))
    .option("--no-open", "den Browser nicht öffnen")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "startet die lokale Oberfläche: Läufe, Reports, Entwürfe und Befunde im Browser, nur auf diesem Rechner",
    )
    .action(async (options: { port?: number; open?: boolean; config?: string }) => {
      await executeUi(options, io);
    });

  program
    .command("import")
    .argument(
      "<quelle>",
      "promptfoo für eine Ergebnisdatei, promptfoo-cases für erzeugte Angriffe (redteam.yaml), curl für einen im Browser kopierten Aufruf",
    )
    .requiredOption(
      "--file <datei>",
      "Ergebnisdatei, bei promptfoo aus eval --output, bei curl der kopierte Aufruf",
    )
    .option("--target <name>", "Name des Zielsystems im Lauf (Standard: target aus aiqa.yaml)")
    .option("--mapping <datei>", "eigene Zuordnung von Plugins zu OWASP-IDs")
    .option("--provider <id>", "Provider, der importiert wird, wenn die Datei mehrere vergleicht")
    .option("--templates <datei>", "promptfoo-cases: eigene Vorlagen je Plugin")
    .option("--id <id>", "promptfoo-cases: ID des Goldsets, das geschrieben wird")
    .option("--question <text>", "curl: die Frage, wie sie in der Oberfläche gestellt wurde")
    .option(
      "--response <datei>",
      "curl: gespeicherte Antwort (JSON, NDJSON oder Server-Sent Events) für den Antwortpfad",
    )
    .option("--call", "curl: ein Testaufruf mit dem kopierten Aufruf für den Antwortpfad")
    .option("--apply", "curl: ersetzt den target-Block der aiqa.yaml durch den Entwurf")
    .option("--name <name>", "curl: Name des Zielsystems")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "importiert eine Ergebnisdatei eines anderen Werkzeugs als Lauf mit Goldset, damit Report, Vergleich und Gates sie auswerten",
    )
    .action(
      async (
        source: string,
        options: {
          file: string;
          target?: string;
          mapping?: string;
          provider?: string;
          templates?: string;
          id?: string;
          question?: string;
          response?: string;
          call?: boolean;
          apply?: boolean;
          name?: string;
          config?: string;
        },
      ) => {
        await executeImport({ source, ...options }, io);
      },
    );

  program
    .command("analyze")
    .requiredOption("--run <id>", "Lauf-ID oder latest")
    .option("--confirm <befunde...>", "bestätigt Befunde, ohne ein Modell zu fragen")
    .option("--reject <befunde...>", "verwirft Befunde, ohne ein Modell zu fragen")
    .option("--reason <text>", "mit --reject: Grund, etwa Fehlalarm des Werkzeugs")
    .option("--cause <text>", "mit --confirm: Ursache des Befunds")
    .option("--suggestion <text>", "mit --confirm: Vorschlag zur Behebung")
    .option("--severity <stufe>", "mit --confirm: Schwere low, medium, high oder critical")
    .option("--no-agent", "gruppiert ohne Modell, keine Antwort verlässt den Rechner")
    .option(
      "--max-clusters <n>",
      "höchstens so viele Gruppen an das Modell (Standard 10)",
      (value) => Number(value),
    )
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "gruppiert die Fehlschläge eines Laufs, lässt den Analyseagenten je Gruppe eine Hypothese bilden und speichert sie als Befunde zur Prüfung",
    )
    .action(
      async (options: {
        run: string;
        confirm?: string[];
        reject?: string[];
        reason?: string;
        cause?: string;
        suggestion?: string;
        severity?: string;
        agent?: boolean;
        maxClusters?: number;
        config?: string;
      }) => {
        const { agent, ...rest } = options;
        await executeAnalyze({ ...rest, ...(agent === false ? { noAgent: true } : {}) }, io);
      },
    );

  program
    .command("gate")
    .requiredOption("--run <id>", "Lauf-ID oder latest")
    .option("--base <id>", "Vergleichslauf für das Regressions-Gate, auch previous")
    .option("--json <datei>", "Ergebnisdatei statt reports/gate-<lauf>.json")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "prüft die Gates aus aiqa.yaml gegen einen Lauf und endet mit Exit-Code 1, wenn eines reißt",
    )
    .action(async (options: { run: string; base?: string; json?: string; config?: string }) => {
      const evaluation = await executeGate(options, io);
      if (!evaluation.pass) state.exitCode = 1;
    });

  program
    .command("compare")
    .requiredOption("--base <id>", "Lauf-ID des Vergleichslaufs, auch latest oder previous")
    .requiredOption("--head <id>", "Lauf-ID des neuen Laufs, auch latest oder previous")
    .option("--out <datei>", "Markdown-Datei statt reports/<base>--<head>.md")
    .option("--json <datei>", "zusätzlich JSON für Gates und Werkzeuge")
    .option(
      "--pairwise",
      "lässt den Judge die Antworten beider Läufe paarweise in beiden Reihenfolgen vergleichen",
    )
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "vergleicht zwei Läufe über ihre gemeinsamen Fälle: Pass-Raten, neue und verschwundene Fehlschläge, Flakiness",
    )
    .action(
      async (options: {
        base: string;
        head: string;
        out?: string;
        json?: string;
        pairwise?: boolean;
        config?: string;
      }) => {
        await executeCompare(options, io);
      },
    );

  program
    .command("calibrate")
    .option(
      "--goldset <dateien...>",
      "Goldsets mit Kalibrierungsset; ohne Angabe alle Goldsets aus aiqa.yaml",
    )
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "lässt den Judge über die menschlich bewerteten Stichproben eines Goldsets laufen und berechnet Cohen's Kappa",
    )
    .action(async (options: { goldset?: string[]; config?: string }) => {
      await executeCalibrate(options, io);
    });

  program
    .command("judge")
    .requiredOption("--run <id>", "Lauf-ID oder latest")
    .option("-c, --config <datei>", "Pfad zur aiqa.yaml")
    .description(
      "ergänzt Judge-Urteile für einen Lauf, für Iterationen, die die Checks nicht entschieden haben",
    )
    .action(async (options: { run: string; config?: string }) => {
      await executeJudge(options, io);
    });

  return program;
}

/** Runs the CLI with the given arguments and returns the exit code instead of exiting. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const state: CliState = { exitCode: 0 };
  const program = createProgram(io, state);
  try {
    await program.parseAsync([...argv], { from: "user" });
    return state.exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.writeErr(`Fehler: ${message}`);
    if (error instanceof ValidationError) {
      for (const line of error.issues) io.writeErr(`  ${line}`);
    }
    return error instanceof CliError ? error.exitCode : 1;
  }
}
