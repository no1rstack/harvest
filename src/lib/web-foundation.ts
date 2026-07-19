import type { Express } from "express";
import { createWebFoundation, type WebFoundationConfig } from "@noirstack/web-foundation";
import { createExpressMiddleware } from "@noirstack/web-foundation/express";
import { emitHexArchRequestEvent } from "./hex-arch-events.js";

const APP_NAME = "Harvest";
const DEFAULT_BASE =
  process.env.HARVEST_PUBLIC_URL ||
  process.env.APP_URL ||
  process.env.APP_BASE_URL ||
  "https://harvest.noirstack.com";

export function createHarvestWebFoundationConfig(): WebFoundationConfig {
  const baseUrl = DEFAULT_BASE.replace(/\/+$/, "");
  const environment = process.env.NODE_ENV === "production" ? "production" : "development";

  return createWebFoundation({
    environment,
    app: {
      name: APP_NAME,
      slug: "harvest",
      baseUrl,
      brandName: "Noir Stack",
      defaultTitle: `${APP_NAME} — Collection Platform`,
      defaultDescription: "OSINT registry, observations, and intelligence collection platform.",
      themeColor: "#0d0d0d",
      supportedLocales: ["en"],
    },
    robots: {
      defaultDirective: "index,follow",
      crawlDelay: 1,
      disallowPaths: ["/api/*", "/metrics"],
      allowPaths: ["/"],
    },
    ipTracking: {
      enabled: process.env.WEB_FOUNDATION_IP_TRACKING !== "false",
      hashSalt:
        process.env.WEB_FOUNDATION_IP_HASH_SALT ||
        process.env.WEB_FOUNDATION_IP_SALT ||
        process.env.IP_HASH_SALT ||
        "harvest-web-foundation",
      storeRawIp: false,
      botScoring: true,
    },
    rateLimit: { enabled: false },
    logging: {
      requestLogging: process.env.WEB_FOUNDATION_REQUEST_LOGGING !== "false",
      traceHeaders: true,
      skipPaths: ["/api/health", "/metrics", "/assets/", "/favicon.ico"],
    },
  });
}

export function attachWebFoundation(app: Express) {
  const config = createHarvestWebFoundationConfig();
  const wf = createExpressMiddleware({
    config,
    onRequestLog: (entry) => {
      emitHexArchRequestEvent({
        appSlug: config.app.slug,
        method: entry.method,
        path: entry.path,
        statusCode: entry.statusCode,
        responseTimeMs: entry.responseTimeMs,
        ipHash: entry.ipHash,
        botScore: entry.botScore,
        traceId: entry.traceId,
      });
    },
  });

  app.set("trust proxy", true);
  app.use(wf.securityHeaders());
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/")) return next();
    return wf.crawlTrapBlocker()(req, res, next);
  });
  app.use(wf.ipTracking());
  app.use(wf.requestLogger());
  app.get("/robots.txt", wf.robotsTxt());
}
