var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// src/worker.ts
var PUBLIC_PAGE_API_PREFIX = "/api/public/pages/";
var PUBLIC_MANAGEMENT_API_PATHS = /* @__PURE__ */ new Set([
  "/api/public/manage",
  "/api/public/manage/cancel",
  "/api/public/manage/reschedule"
]);
var CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'none'",
  "connect-src 'self' https://challenges.cloudflare.com",
  "font-src 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "frame-src https://challenges.cloudflare.com",
  "img-src 'self' data:",
  "object-src 'none'",
  "script-src 'self' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "upgrade-insecure-requests"
].join("; ");
function isPublicGatewayPath(pathname) {
  return pathname.startsWith(PUBLIC_PAGE_API_PREFIX) || PUBLIC_MANAGEMENT_API_PATHS.has(pathname);
}
__name(isPublicGatewayPath, "isPublicGatewayPath");
function jsonNotFound() {
  return Response.json(
    {
      error: {
        code: "not_found",
        message: "The requested public API endpoint does not exist."
      }
    },
    {
      status: 404,
      headers: {
        "Cache-Control": "no-store"
      }
    }
  );
}
__name(jsonNotFound, "jsonNotFound");
function withPublicSecurityHeaders(request, response) {
  const headers = new Headers(response.headers);
  const pathname = new URL(request.url).pathname;
  const contentType = headers.get("Content-Type")?.toLowerCase() ?? "";
  headers.set("Content-Security-Policy", CONTENT_SECURITY_POLICY);
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  if (contentType.includes("text/html")) {
    headers.set("Cache-Control", "no-cache");
  } else if (pathname.startsWith("/static/") && response.ok) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
__name(withPublicSecurityHeaders, "withPublicSecurityHeaders");
var publicBookingWorker = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      if (!isPublicGatewayPath(url.pathname)) {
        return jsonNotFound();
      }
      return env.CALENDAR_GATEWAY.fetch(request);
    }
    const assetResponse = await env.ASSETS.fetch(request);
    return withPublicSecurityHeaders(request, assetResponse);
  }
};
var worker_default = publicBookingWorker;
export {
  worker_default as default,
  publicBookingWorker
};
//# sourceMappingURL=worker.js.map
