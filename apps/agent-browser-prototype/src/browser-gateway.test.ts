import { afterEach, describe, expect, it, rs } from "@rstest/core";
import { captureSnapshot } from "./browser-gateway";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("Kitesurf browser gateway adapter", () => {
  it("always requests Kitesurf and rejects an engine-substituted response", async () => {
    const gatewayFetch = rs.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            result: { markdown: "# Kitesurf evidence" },
            meta: { formats: ["markdown"] },
          }),
          {
            status: 200,
            headers: { "X-Agent-Browser-Engine": "chromium" },
          },
        ),
    );
    globalThis.fetch = gatewayFetch as typeof globalThis.fetch;

    await expect(
      captureSnapshot(
        {
          gatewayOrigin: "http://localhost:8787",
          url: "https://example.com/",
          formats: ["markdown"],
        },
        { preview: true, previewBearer: "" },
      ),
    ).rejects.toThrow(/returned chromium; kitesurf was required/u);

    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = gatewayFetch.mock.calls[0];
    expect(requestUrl).toBe("http://localhost:8787/v1/snapshot");
    expect(JSON.parse(String(requestInit?.body))).toMatchObject({
      url: "https://example.com/",
      engine: "kitesurf",
      formats: ["markdown"],
    });
  });

  it("preserves an empty text field returned by Kitesurf", async () => {
    globalThis.fetch = rs.fn(
      async () => new Response(
        JSON.stringify({
          success: true,
          result: { markdown: "" },
          meta: { formats: ["markdown"], title: "" },
        }),
        {
          status: 200,
          headers: { "X-Agent-Browser-Engine": "kitesurf" },
        },
      ),
    ) as typeof globalThis.fetch;

    const result = await captureSnapshot(
      {
        gatewayOrigin: "http://localhost:8787",
        url: "https://example.com/",
        formats: ["markdown"],
      },
      { preview: true, previewBearer: "" },
    );

    expect(result.markdown).toBe("");
    expect(result.formats).toEqual(["markdown"]);
    expect(result.title).toBe("");
  });

  it("rejects response format metadata that does not match the request", async () => {
    globalThis.fetch = rs.fn(
      async () => new Response(
        JSON.stringify({
          success: true,
          result: { markdown: "# Example" },
          meta: { formats: ["content"] },
        }),
        {
          status: 200,
          headers: { "X-Agent-Browser-Engine": "kitesurf" },
        },
      ),
    ) as typeof globalThis.fetch;

    await expect(
      captureSnapshot(
        {
          gatewayOrigin: "http://localhost:8787",
          url: "https://example.com/",
          formats: ["markdown"],
        },
        { preview: true, previewBearer: "" },
      ),
    ).rejects.toThrow(/formats that do not match the request/u);
  });

  it("rejects malformed returned status and browser-time metadata", async () => {
    for (const scenario of [
      { status: "200", browserMs: "12", message: /invalid page status/u },
      { status: 200, browserMs: "12.5", message: /invalid browser time/u },
    ] as const) {
      globalThis.fetch = rs.fn(
        async () => new Response(
          JSON.stringify({
            success: true,
            result: { markdown: "# Example" },
            meta: { formats: ["markdown"], status: scenario.status },
          }),
          {
            status: 200,
            headers: {
              "X-Agent-Browser-Engine": "kitesurf",
              "X-Browser-Ms-Used": scenario.browserMs,
            },
          },
        ),
      ) as typeof globalThis.fetch;

      await expect(
        captureSnapshot(
          {
            gatewayOrigin: "http://localhost:8787",
            url: "https://example.com/",
            formats: ["markdown"],
          },
          { preview: true, previewBearer: "" },
        ),
      ).rejects.toThrow(scenario.message);
    }
  });
});
