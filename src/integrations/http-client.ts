export class HttpClient {
  constructor(
    private readonly base: string,
    private readonly headers: Record<string, string>,
  ) {
    if (new URL(base).protocol !== "https:")
      throw new Error("HTTPS required for remote integrations");
  }
  async request(path: string, method = "GET", body?: unknown): Promise<any> {
    const url = new URL(path, this.base);
    if (url.origin !== new URL(this.base).origin)
      throw new Error("Remote URL escaped configured origin");
    const response = await fetch(url, {
      method,
      headers: { ...this.headers, "Content-Type": "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(
        `Remote ${method} failed with HTTP ${response.status}; reconcile writes before retry`,
      );
    if (response.status === 204) return undefined;
    const text = await response.text();
    if (text.length > 2_000_000)
      throw new Error("Remote response limit exceeded");
    return text ? JSON.parse(text) : undefined;
  }
}
