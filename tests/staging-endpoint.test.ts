import { describe, expect, it, vi } from "vitest";
import { StagingEndpoint } from "../src/development/staging-endpoint.js";

describe("staging endpoint readiness", () => {
  it("accepts the ordinary same-origin login redirect without credentials", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "/login?redirect_url=%2F" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await new StagingEndpoint(request).verify("https://staging.example/");
    expect(String(request.mock.calls[1]?.[0])).toBe(
      "https://staging.example/login?redirect_url=%2F",
    );
    expect(request.mock.calls[0]?.[1]).toMatchObject({
      method: "HEAD",
      redirect: "manual",
    });
  });

  it("rejects an external redirect before contacting that origin", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(null, {
        status: 302,
        headers: { location: "https://production.example/" },
      }),
    );
    await expect(
      new StagingEndpoint(request).verify("https://staging.example/"),
    ).rejects.toThrow("outside its configured origin");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("bounds redirect loops", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "/login" } }),
      );
    await expect(
      new StagingEndpoint(request).verify("https://staging.example/"),
    ).rejects.toThrow("redirect limit");
    expect(request).toHaveBeenCalledTimes(4);
  });

  it.each([401, 403, 503])("keeps HTTP %i failures blocked", async (status) => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status }));
    await expect(
      new StagingEndpoint(request).verify("https://staging.example/"),
    ).rejects.toThrow("unavailable");
  });
});
