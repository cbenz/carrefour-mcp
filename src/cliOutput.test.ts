import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { setupPipeSafeStdout } from "./cliOutput.js";

describe("setupPipeSafeStdout", () => {
  it("exits cleanly on EPIPE", () => {
    const stdout = new EventEmitter() as unknown as NodeJS.WriteStream;
    const exitWithCode = vi.fn(() => {
      throw new Error("exit-called");
    });

    setupPipeSafeStdout(stdout, exitWithCode as unknown as () => never);

    const epipeError = Object.assign(new Error("broken pipe"), {
      code: "EPIPE",
    });

    expect(() => stdout.emit("error", epipeError)).toThrow("exit-called");
    expect(exitWithCode).toHaveBeenCalledWith(0);
  });

  it("rethrows non-EPIPE errors", () => {
    const stdout = new EventEmitter() as unknown as NodeJS.WriteStream;

    setupPipeSafeStdout(stdout, (() => {
      throw new Error("unexpected-exit");
    }) as unknown as () => never);

    const writeError = Object.assign(new Error("write failed"), {
      code: "EIO",
    });

    expect(() => stdout.emit("error", writeError)).toThrow("write failed");
  });
});
