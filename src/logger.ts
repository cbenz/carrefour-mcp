export function logInfo(message: string): void {
  process.stderr.write(`[info] ${message}\n`);
}

export function logError(message: string, error?: unknown): void {
  const details =
    error instanceof Error
      ? `${error.message}\n${error.stack ?? ""}`
      : String(error ?? "");
  process.stderr.write(`[error] ${message}${details ? `\n${details}` : ""}\n`);
}
