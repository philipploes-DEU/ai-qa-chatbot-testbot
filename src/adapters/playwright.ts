import type { Browser, BrowserContext, Locator, Page } from "playwright";

import type { Turn } from "../domain/common.js";
import {
  type PlaywrightSpec,
  PlaywrightSpecSchema,
  type SpecStep,
  type WaitCondition,
} from "../domain/playwright-spec.js";
import type { TargetConfig } from "../domain/target-config.js";
import { loadDocument } from "../io/yaml.js";
import { type Environment, resolveEnvRef } from "./auth.js";
import { Deadline } from "./deadline.js";
import { TimeoutError } from "./errors.js";
import { RateLimiter } from "./rate-limit.js";
import type { TargetAdapter, TargetResponse } from "./target.js";

export interface PlaywrightAdapterOptions {
  env?: Environment;
  /** The spec file, already resolved against the workspace. */
  specFile: string;
}

type PlaywrightModule = typeof import("playwright");

async function loadPlaywright(): Promise<PlaywrightModule> {
  try {
    return await import("playwright");
  } catch (error) {
    throw new Error(
      "Playwright ist nicht installiert. Im Repository von AI QA: pnpm install, dann npx playwright install chromium.",
      { cause: error },
    );
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Adapter `playwright` (issue #13): drives the web interface of a target the way a user does,
 * following the spec of that interface. Every send types the last user turn into the input,
 * triggers the send action, waits until the newest answer element is complete and returns
 * its text. A session keeps the conversation on the page; without a session every send
 * starts fresh through the spec's reset action. Rate limit, timeouts and latency expectation
 * work as for every adapter; basic auth goes into the browser context.
 */
export class PlaywrightAdapter implements TargetAdapter {
  readonly name: string;
  private readonly endpoint: string;
  private readonly headless: boolean;
  private readonly browserName: "chromium" | "firefox" | "webkit";
  private readonly requestMs: number;
  private readonly limiter: RateLimiter;
  private readonly credentials: { username: string; password: string } | undefined;
  private readonly specFile: string;
  private spec: PlaywrightSpec | undefined;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private page: Page | undefined;
  private sessions = 0;
  private activeSession: string | undefined;
  /** The active session already sent a turn: later turns continue the conversation. */
  private sessionStarted = false;
  /** The page shows a conversation that a send outside the session must reset first. */
  private conversationOpen = false;

  constructor(target: TargetConfig, options: PlaywrightAdapterOptions) {
    if (target.playwright === undefined || target.endpoint === undefined) {
      throw new Error(
        `Zielsystem ${target.name}: Adapter playwright braucht endpoint und einen playwright-Block`,
      );
    }
    this.name = target.name;
    this.endpoint = target.endpoint;
    this.headless = target.playwright.headless;
    this.browserName = target.playwright.browser;
    this.requestMs = target.timeouts.requestMs;
    this.limiter = new RateLimiter(target.rateLimit);
    this.specFile = options.specFile;
    const env = options.env ?? process.env;
    if (target.auth.type === "basic") {
      this.credentials = {
        username: resolveEnvRef(target.auth.username, env, "auth.username"),
        password: resolveEnvRef(target.auth.password, env, "auth.password"),
      };
    } else if (target.auth.type !== "none") {
      throw new Error(
        `Zielsystem ${target.name}: Adapter playwright unterstützt auth none und basic, nicht ${target.auth.type}`,
      );
    }
  }

  /** A session is one conversation on the page; the next send starts it with the reset action. */
  startSession(): Promise<string> {
    const id = `browser-${String(++this.sessions)}`;
    this.activeSession = id;
    this.sessionStarted = false;
    return Promise.resolve(id);
  }

  endSession(session: string): Promise<void> {
    if (this.activeSession === session) {
      this.activeSession = undefined;
      this.sessionStarted = false;
    }
    return Promise.resolve();
  }

  async send(turns: readonly Turn[], session?: string): Promise<TargetResponse> {
    const lastUserTurn = turns.findLast((turn) => turn.role === "user");
    if (lastUserTurn === undefined) {
      throw new Error("der Adapter playwright braucht mindestens einen Gesprächszug mit role user");
    }
    return this.limiter.run(async () => {
      const page = await this.ensurePage();
      const spec = await this.ensureSpec();
      const deadline = new Deadline(this.requestMs);
      const work = this.exchange(page, spec, lastUserTurn.content, session, deadline);
      let timer: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new TimeoutError(this.requestMs, "request"));
        }, this.requestMs);
      });
      try {
        return await Promise.race([work, timeout]);
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    });
  }

  /** Closes the browser. The run command calls it after the run. */
  async close(): Promise<void> {
    await this.context?.close();
    await this.browser?.close();
    this.context = undefined;
    this.browser = undefined;
    this.page = undefined;
  }

  private async ensureSpec(): Promise<PlaywrightSpec> {
    this.spec ??= await loadDocument(PlaywrightSpecSchema, this.specFile);
    return this.spec;
  }

  private async ensurePage(): Promise<Page> {
    if (this.page !== undefined) return this.page;
    const playwright = await loadPlaywright();
    const spec = await this.ensureSpec();
    this.browser = await playwright[this.browserName].launch({ headless: this.headless });
    this.context = await this.browser.newContext(
      this.credentials === undefined ? {} : { httpCredentials: this.credentials },
    );
    this.page = await this.context.newPage();
    await this.page.goto(this.endpoint);
    for (const step of spec.before) await this.runStep(this.page, step);
    this.conversationOpen = false;
    return this.page;
  }

  private async runStep(page: Page, step: SpecStep): Promise<void> {
    switch (step.action) {
      case "click":
        await page.locator(step.selector).first().click();
        return;
      case "fill":
        await page.locator(step.selector).first().fill(step.value);
        return;
      case "waitFor":
        await page.locator(step.selector).first().waitFor({ state: step.state });
        return;
      case "goto":
        await page.goto(step.url);
        return;
      case "press":
        if (step.selector === undefined) await page.keyboard.press(step.key);
        else await page.locator(step.selector).first().press(step.key);
        return;
    }
  }

  private async reset(page: Page, spec: PlaywrightSpec): Promise<void> {
    switch (spec.reset.method) {
      case "reload":
        await page.reload();
        for (const step of spec.before) await this.runStep(page, step);
        return;
      case "click":
        await page.locator(spec.reset.selector).first().click();
        return;
      case "none":
        return;
    }
  }

  private async exchange(
    page: Page,
    spec: PlaywrightSpec,
    message: string,
    session: string | undefined,
    deadline: Deadline,
  ): Promise<TargetResponse> {
    // Only a later turn of the active session continues the conversation on the page;
    // everything else starts fresh through the reset action.
    const continuing =
      session !== undefined && session === this.activeSession && this.sessionStarted;
    if (!continuing && this.conversationOpen) await this.reset(page, spec);
    this.activeSession = session;
    this.sessionStarted = session !== undefined;
    this.conversationOpen = true;

    const answers = page.locator(spec.response.selector);
    const before = await answers.count();
    const input = page.locator(spec.input.selector).first();
    await input.fill(message);
    const started = performance.now();
    if (spec.send.method === "enter") await input.press("Enter");
    else await page.locator(spec.send.selector).first().click();

    const last = await this.waitForAnswer(answers, before, deadline);
    await this.waitUntilComplete(page, last, spec.response.wait, deadline);
    const content = (await last.innerText()).trim();
    return { content, raw: { answers: before + 1 }, latencyMs: performance.now() - started };
  }

  private async waitForAnswer(
    answers: Locator,
    before: number,
    deadline: Deadline,
  ): Promise<Locator> {
    while ((await answers.count()) <= before) {
      if (deadline.expired()) throw new TimeoutError(this.requestMs, "request");
      await delay(50);
    }
    return answers.nth(before);
  }

  private async waitUntilComplete(
    page: Page,
    answer: Locator,
    wait: WaitCondition,
    deadline: Deadline,
  ): Promise<void> {
    if (wait.type === "signal") {
      await page
        .locator(wait.selector)
        .first()
        .waitFor({ state: wait.state, timeout: Math.max(1, deadline.remainingMs()) });
      return;
    }
    let previous = await answer.innerText();
    let stableSince = performance.now();
    while (performance.now() - stableSince < wait.forMs) {
      if (deadline.expired()) throw new TimeoutError(this.requestMs, "request");
      await delay(Math.min(100, wait.forMs));
      const current = await answer.innerText();
      if (current !== previous) {
        previous = current;
        stableSince = performance.now();
      }
    }
  }
}
