import { describe, expect, it, rs } from "@rstest/core";
import { publicBookingWorker, type PublicBookingWorkerEnv } from "./worker";

function envWith(
  assetResponse = new Response("<main>TAP Calendar</main>", {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  }),
) {
  const assetFetch = rs.fn(async (_request: Request) => assetResponse);
  const gatewayFetch = rs.fn(async (_request: Request) => Response.json({ ok: true }));
  return {
    env: {
      ASSETS: { fetch: assetFetch },
      CALENDAR_GATEWAY: { fetch: gatewayFetch },
    },
    assetFetch,
    gatewayFetch,
  };
}

describe("public booking Worker", () => {
  it.each([
    "/api/public/profiles/alex-morgan",
    "/api/public/pages/alex-morgan/30min",
    "/api/public/pages/alex-morgan/30min/availability",
    "/api/public/pages/alex-morgan/30min/bookings",
    "/api/public/manage",
    "/api/public/manage/cancel",
    "/api/public/manage/reschedule",
  ])("proxies only the supported public gateway path %s", async (pathname) => {
    const { env, assetFetch, gatewayFetch } = envWith();
    const request = new Request(`https://cal.with-tap.ai${pathname}`, { method: "OPTIONS" });

    const response = await publicBookingWorker.fetch(request, env);

    expect(response.status).toBe(200);
    expect(gatewayFetch).toHaveBeenCalledTimes(1);
    expect(gatewayFetch).toHaveBeenCalledWith(request);
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it.each([
    "/api/public",
    "/api/public/profiles",
    "/api/public/profiles/alex-morgan/anything-else",
    "/api/public/manage/anything-else",
    "/api/private",
    "/api/v1/connections",
  ])("fails closed instead of serving the SPA for %s", async (pathname) => {
    const { env, assetFetch, gatewayFetch } = envWith();

    const response = await publicBookingWorker.fetch(
      new Request(`https://cal.with-tap.ai${pathname}`),
      env,
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "not_found" } });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(assetFetch).not.toHaveBeenCalled();
  });

  it("serves deep links through the asset binding with production security headers", async () => {
    const { env, assetFetch, gatewayFetch } = envWith();
    const request = new Request("https://cal.with-tap.ai/alex-morgan/30min");

    const response = await publicBookingWorker.fetch(request, env);

    expect(await response.text()).toContain("TAP Calendar");
    expect(assetFetch).toHaveBeenCalledWith(request);
    expect(gatewayFetch).not.toHaveBeenCalled();
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Content-Security-Policy")).toContain(
      "frame-src https://challenges.cloudflare.com",
    );
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("X-Robots-Tag")).toContain("noindex");
  });

  it("marks fingerprinted static assets immutable", async () => {
    const { env } = envWith(new Response("compiled", {
      headers: { "Content-Type": "text/javascript" },
    }));

    const response = await publicBookingWorker.fetch(
      new Request("https://cal.with-tap.ai/static/js/index.abc123.js"),
      env,
    );

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=31536000, immutable");
  });
});
