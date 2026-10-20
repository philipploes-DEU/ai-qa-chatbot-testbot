import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

import { initWorkspace } from "../../src/cli/init.js";
import type { CliIo } from "../../src/cli/io.js";
import { executePlan } from "../../src/cli/plan-command.js";
import { GoldsetSchema } from "../../src/domain/goldset.js";
import { PlanSchema } from "../../src/domain/plan.js";
import { FakeProvider } from "../../src/providers/fake-provider.js";

function collectIo(cwd: string): CliIo & { out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    cwd,
    out,
    err,
    writeOut: (line) => {
      out.push(line);
    },
    writeErr: (line) => {
      err.push(line);
    },
  };
}

const FAQ = [
  "# Rücksendungen",
  "",
  "Eine Rücksendung ist innerhalb von 30 Tagen kostenlos möglich.",
  "",
  "Erstattungen dauern bis zu 14 Tage nach Eingang der Ware.",
].join("\n");

function proposals(...ids: string[]): string {
  return JSON.stringify({
    cases: ids.map((id) => ({
      id,
      question: "Wie lange kann ich zurücksenden?",
      answer: "30 Tage, kostenlos.",
      quote: "Eine Rücksendung ist innerhalb von 30 Tagen kostenlos möglich.",
      mustContain: ["30"],
      rubric: [{ name: "Korrektheit", description: "Nennt 30 Tage und kostenlos." }],
      severity: "high",
      tags: ["retoure"],
      catalogIds: ["LLM09"],
    })),
  });
}

describe("aiqa plan --docs with the planning agent", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "aiqa-plan-agent-"));
    await initWorkspace(dir, () => new Date("2026-10-11T08:00:00Z"));
    await mkdir(path.join(dir, "docs"), { recursive: true });
    await writeFile(path.join(dir, "docs", "faq.md"), FAQ, "utf8");
    await writeFile(path.join(dir, "docs", "bild.png"), "kein Text", "utf8");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes draft cases into the drafts goldset and a plan that includes them", async () => {
    const io = collectIo(dir);
    const provider = new FakeProvider([proposals("Rückgabefrist")]);
    const plan = await executePlan({ out: "plan-agent.yaml", docs: ["docs"], provider }, io);

    const drafts = GoldsetSchema.parse(
      parse(await readFile(path.join(dir, "goldsets", "entwuerfe.yaml"), "utf8")),
    );
    expect(drafts.id).toBe("entwuerfe");
    expect(drafts.cases).toHaveLength(1);
    const draft = drafts.cases[0];
    expect(draft?.id).toBe("rueckgabefrist");
    expect(draft?.status).toBe("draft");
    expect(draft?.source).toBe("docs/faq.md");
    expect(draft?.sourceQuote).toContain("30 Tagen");
    expect(draft?.tags).toContain("LLM09");

    const written = PlanSchema.parse(
      parse(await readFile(path.join(dir, "plan-agent.yaml"), "utf8")),
    );
    expect(written.caseRefs).toContainEqual({ caseId: "rueckgabefrist", iterations: 10 });
    expect(plan.approvedBy).toBeUndefined();
    expect(written.goldsets).toContain("goldsets/entwuerfe.yaml");

    const text = io.out.join("\n");
    expect(text).toContain("1 Entwurf");
    expect(text).toContain("goldsets/entwuerfe.yaml");
    expect(text).toContain("Budgetschätzung");
    expect(text).toContain("status: approved");
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]?.prompt).toContain('pfad="docs/faq.md"');
  });

  it("appends to an existing drafts goldset and keeps what a human approved", async () => {
    const first = new FakeProvider([proposals("Rückgabefrist")]);
    await executePlan(
      { out: "plan-1.yaml", docs: ["docs/faq.md"], provider: first },
      collectIo(dir),
    );
    const file = path.join(dir, "goldsets", "entwuerfe.yaml");
    const approved = (await readFile(file, "utf8")).replace("status: draft", "status: approved");
    await writeFile(file, approved, "utf8");

    const repeated = JSON.parse(proposals("Rückgabefrist", "Rückgabefrist")) as {
      cases: { question: string }[];
    };
    const other = repeated.cases[1];
    if (other !== undefined) other.question = "Ist die Rücksendung kostenlos?";
    const second = new FakeProvider([JSON.stringify(repeated)]);
    const io = collectIo(dir);
    await executePlan({ out: "plan-2.yaml", docs: ["docs/faq.md"], provider: second }, io);
    const drafts = GoldsetSchema.parse(parse(await readFile(file, "utf8")));
    expect(drafts.cases.map((testCase) => [testCase.id, testCase.status])).toEqual([
      ["rueckgabefrist", "approved"],
      ["rueckgabefrist-2", "draft"],
    ]);
    expect(drafts.version).toBe("2");
    expect(io.err.join("\n")).toContain("Dublette");
  });

  it("reports rejected proposals and writes no drafts goldset when nothing holds up", async () => {
    const provider = new FakeProvider([
      JSON.stringify({
        cases: [
          {
            id: "erfunden",
            question: "Gibt es Gratisversand?",
            answer: "Ja.",
            quote: "Versand ist immer kostenlos.",
          },
        ],
      }),
    ]);
    const io = collectIo(dir);
    await executePlan({ out: "plan.yaml", docs: ["docs/faq.md"], provider }, io);
    expect(io.err.join("\n")).toContain("verworfen: erfunden");
    expect(io.out.join("\n")).toContain("0 Entwürfe");
    await expect(readFile(path.join(dir, "goldsets", "entwuerfe.yaml"), "utf8")).rejects.toThrow();
  });

  it("plan --probes works while aiqa.yaml already lists the probes goldset it writes", async () => {
    const config = path.join(dir, "aiqa.yaml");
    const text = await readFile(config, "utf8");
    await writeFile(
      config,
      text.replace(
        "  - goldsets/beispiel/goldset.yaml",
        "  - goldsets/beispiel/goldset.yaml\n  - goldsets/owasp-probes.yaml",
      ) +
        "\nprobes:\n  variables:\n    company: Gartenhelden GmbH\n    assistant: Hilde\n    systemPromptMarker: Leitsatz\n    canary: KIRSCHE-1\n",
      "utf8",
    );
    const plan = await executePlan({ out: "probes.plan.yaml", probes: true }, collectIo(dir));
    expect(plan.caseRefs.some((ref) => ref.caseId.startsWith("probe-"))).toBe(true);
    await expect(
      readFile(path.join(dir, "goldsets", "owasp-probes.yaml"), "utf8"),
    ).resolves.toContain("owasp-probes");
  });

  it("needs a model in aiqa.yaml when no provider is given", async () => {
    await expect(
      executePlan({ out: "plan.yaml", docs: ["docs/faq.md"] }, collectIo(dir)),
    ).rejects.toThrow(/agents-Block/);
  });

  it("names a documents path without text files", async () => {
    await expect(
      executePlan(
        { out: "plan.yaml", docs: ["docs/bild.png"], provider: new FakeProvider([]) },
        collectIo(dir),
      ),
    ).rejects.toThrow(/keine Textdatei/);
  });
});
