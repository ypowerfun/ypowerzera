import { afterAll } from "vitest";

afterAll(async () => {
  await (globalThis as { __d1Dispose?: () => Promise<void> }).__d1Dispose?.();
});
