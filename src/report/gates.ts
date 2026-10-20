import type { GatesConfig } from "../domain/gates.js";
import type { ComparisonModel } from "./compare.js";
import type { ReportModel } from "./report-model.js";

export { GatesConfigSchema, type GatesConfig } from "../domain/gates.js";

export interface GateResult {
  name: "minPassRate" | "maxCriticalFails" | "maxRegressionPoints";
  /** Human readable limit. */
  limit: string;
  /** Human readable measured value. */
  actual: string;
  /** null when the gate could not be evaluated, for example without a base run. */
  pass: boolean | null;
  reason: string;
}

export interface GateEvaluation {
  results: GateResult[];
  /** False when at least one evaluated gate failed. */
  pass: boolean;
  /** Gates that could not be evaluated, listed by name. */
  skipped: string[];
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1).replace(".", ",")} %`;
}

/** Evaluates the configured gates against a report and, for regressions, a comparison. */
export function evaluateGates(
  gates: GatesConfig,
  report: ReportModel,
  comparison?: ComparisonModel,
): GateEvaluation {
  const results: GateResult[] = [];

  if (gates.minPassRate !== undefined) {
    const rate = report.totals.passRate;
    results.push(
      rate === null
        ? {
            name: "minPassRate",
            limit: percent(gates.minPassRate),
            actual: "kein Urteil",
            pass: null,
            reason: "keine Iteration mit Urteil, Pass-Rate nicht messbar",
          }
        : {
            name: "minPassRate",
            limit: percent(gates.minPassRate),
            actual: percent(rate),
            pass: rate >= gates.minPassRate,
            reason:
              rate >= gates.minPassRate
                ? `Pass-Rate ${percent(rate)} erreicht die Mindestquote ${percent(gates.minPassRate)}`
                : `Pass-Rate ${percent(rate)} liegt unter der Mindestquote ${percent(gates.minPassRate)}`,
          },
    );
  }

  if (gates.maxCriticalFails !== undefined) {
    const criticalFails = report.cases
      .filter((entry) => !entry.draft && entry.severity === "critical" && entry.summary !== null)
      .reduce((sum, entry) => sum + ((entry.summary?.n ?? 0) - (entry.summary?.passes ?? 0)), 0);
    const pass = criticalFails <= gates.maxCriticalFails;
    results.push({
      name: "maxCriticalFails",
      limit: String(gates.maxCriticalFails),
      actual: String(criticalFails),
      pass,
      reason: pass
        ? `${String(criticalFails)} gescheiterte Iterationen kritischer Fälle, erlaubt sind ${String(gates.maxCriticalFails)}`
        : `${String(criticalFails)} gescheiterte Iterationen kritischer Fälle übersteigen die erlaubten ${String(gates.maxCriticalFails)}`,
    });
  }

  if (gates.maxRegressionPoints !== undefined) {
    if (comparison === undefined) {
      results.push({
        name: "maxRegressionPoints",
        limit: `${String(gates.maxRegressionPoints)} Punkte`,
        actual: "kein Vergleich",
        pass: null,
        reason: "kein Base-Lauf zum Vergleich, Regression nicht messbar",
      });
    } else {
      const drops = comparison.cases
        .filter((entry) => entry.passRateDelta !== null && entry.passRateDelta < 0)
        .map((entry) => ({ caseId: entry.caseId, points: -(entry.passRateDelta ?? 0) * 100 }))
        .sort((a, b) => b.points - a.points);
      const worst = drops[0];
      const points = worst?.points ?? 0;
      const pass = points <= gates.maxRegressionPoints;
      results.push({
        name: "maxRegressionPoints",
        limit: `${String(gates.maxRegressionPoints)} Punkte`,
        actual: `${points.toFixed(1).replace(".", ",")} Punkte`,
        pass,
        reason:
          worst === undefined
            ? "kein Fall hat sich verschlechtert"
            : pass
              ? `größter Rückgang ${points.toFixed(1).replace(".", ",")} Punkte bei ${worst.caseId}, erlaubt sind ${String(gates.maxRegressionPoints)}`
              : `Rückgang um ${points.toFixed(1).replace(".", ",")} Punkte bei ${worst.caseId} übersteigt die erlaubten ${String(gates.maxRegressionPoints)}`,
      });
    }
  }

  return {
    results,
    pass: results.every((result) => result.pass !== false),
    skipped: results.filter((result) => result.pass === null).map((result) => result.name),
  };
}
