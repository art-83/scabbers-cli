export class StagingEndpoint {
  constructor(private readonly request: typeof fetch = fetch) {}

  async verify(address: string): Promise<void> {
    const origin = new URL(address).origin;
    let target = new URL(address);
    const signal = AbortSignal.timeout(15000);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const response = await this.request(target, {
        method: "HEAD",
        redirect: "manual",
        signal,
      });
      if (response.ok) return;
      const location = response.headers.get("location");
      if (![301, 302, 303, 307, 308].includes(response.status) || !location)
        throw new Error(
          "Staging endpoint is unavailable or requires browser authentication",
        );
      const next = new URL(location, target);
      if (next.origin !== origin || next.username || next.password)
        throw new Error(
          "Staging endpoint redirected outside its configured origin",
        );
      target = next;
    }
    throw new Error("Staging endpoint exceeded the redirect limit");
  }
}
