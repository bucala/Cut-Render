import path from "node:path";
import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", router);

// On Render the API and the built web app share one service; Replit serves the web app itself.
const staticDir = process.env.STATIC_DIR;
if (staticDir) {
  const root = path.resolve(staticDir);
  app.use(
    express.static(root, {
      index: false,
      setHeaders: (res, file) => {
        res.setHeader(
          "Cache-Control",
          file.includes(`${path.sep}assets${path.sep}`) ? "public, max-age=31536000, immutable" : "public, max-age=3600",
        );
      },
    }),
  );
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(root, "index.html"));
  });
}

export default app;
