// Serializes async operations: start/stop/restart of a core must never overlap,
// otherwise two processes fight for the same ports and one ends up orphaned.
export class AsyncLock {
    private tail: Promise<unknown> = Promise.resolve();

    run<T>(fn: () => Promise<T>): Promise<T> {
        const next = this.tail.then(fn, fn);
        this.tail = next.catch(() => undefined);
        return next;
    }
}
