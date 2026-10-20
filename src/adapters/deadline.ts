/** A point in time after which a dialog counts as timed out. The clock is injectable for tests. */
export class Deadline {
  private readonly end: number;

  constructor(
    readonly ms: number,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.end = now() + ms;
  }

  remainingMs(): number {
    return Math.max(0, this.end - this.now());
  }

  expired(): boolean {
    return this.remainingMs() === 0;
  }
}
