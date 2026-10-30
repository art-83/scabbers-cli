export class NativeQuotaError extends Error {
  constructor() {
    super(
      "Native engine usage quota/rate limit reached; saved workflow and workspaces are preserved",
    );
    this.name = "NativeQuotaError";
  }
  static matches(code: unknown, message: unknown): boolean {
    if (
      typeof code === "string" &&
      [
        "rate_limit",
        "rate_limit_error",
        "usage_limit_reached",
        "insufficient_quota",
      ].includes(code)
    )
      return true;
    if (
      typeof message === "string" &&
      /^API Error: 429\b/.test(message.trim()) &&
      /rate_limit_error|too many requests/i.test(message)
    )
      return true;
    return (
      typeof message === "string" &&
      /^(?:Error:\s*)?(?:You(?:'ve| have) hit your (?:usage )?limit|Usage limit (?:reached|exceeded)|Rate limit (?:reached|exceeded)|Too many requests)/i.test(
        message.trim(),
      )
    );
  }
}
