export function setupPipeSafeStdout(
  stdout: NodeJS.WriteStream,
  exitWithCode: (code: number) => never = process.exit,
): void {
  stdout.on("error", (error: NodeJS.ErrnoException) => {
    if (error?.code === "EPIPE") {
      exitWithCode(0);
    }

    throw error;
  });
}
