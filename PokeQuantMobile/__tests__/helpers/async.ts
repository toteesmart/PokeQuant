// Promise plumbing for pure store suites (no React, no act()).
export const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));
export function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
