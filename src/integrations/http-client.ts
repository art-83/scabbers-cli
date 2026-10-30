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
  async image(path: string, signal: AbortSignal): Promise<Buffer> {
    const url = new URL(path, this.base);
    if (url.origin !== new URL(this.base).origin)
      throw new Error("Image URL escaped configured Jira origin");
    const response = await fetch(url, {
      headers: this.headers,
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    });
    if (!response.ok || !response.body)
      throw new Error(
        `Jira image download failed with HTTP ${response.status}`,
      );
    const limit = 5 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel();
      throw new Error("Jira image exceeds 5 MiB");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > limit) throw new Error("Jira image exceeds 5 MiB");
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks);
  }
}
