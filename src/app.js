const express = require("express");
const cors = require("cors");
const Sentry = require("@sentry/node");
const env = require("./config/env");
const authRoutes = require("./routes/authRoutes");
const syncRoutes = require("./routes/syncRoutes");
const dataRoutes = require("./routes/dataRoutes");
const userRoutes = require("./routes/userRoutes");
const medicalProxyRoutes = require("./routes/medicalProxyRoutes");
const { errorMiddleware } = require("./middlewares/errorMiddleware");
const { requireAuth } = require("./middlewares/authMiddleware");
const { handleGraphql } = require("./graphql/graphqlHandler");
const { requestContextMiddleware } = require("./middlewares/requestContext");
const { httpMetrics } = require("./middlewares/httpMetrics");
const { metricsHandler } = require("./metrics/metricsHandler");

const app = express();
app.set("trust proxy", env.trustProxy);

const corsOptions = {
  // If CORS_ORIGINS is not set, allow all origins (dev only — set CORS_ORIGINS in production).
  origin: env.cors.allowAll ? true : env.cors.origins,
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
};

// cors() handles OPTIONS preflight automatically for all routes.
app.use(cors(corsOptions));

app.use(requestContextMiddleware);
app.use(httpMetrics);
app.use(express.json({ limit: "20mb" }));

app.get("/metrics", metricsHandler);
app.get("/version", (_req, res) => {
  res.json({
    version: env.appVersion,
    service: env.serviceName,
    migrations_status: "unknown",
  });
});

app.get("/health", (_req, res) =>
  res.status(200).json({ status: "ok", service: "Nexxaura API Gateway" }),
);
app.get("/gateway/health", (_req, res) =>
  res
    .status(200)
    .json({
      status: "ok",
      service: "Nexxaura API Gateway",
      note: "Use GET / for upstream FastAPI health",
    }),
);

app.use("/api/auth", authRoutes);
app.use("/api/sync", syncRoutes);
app.use("/api/data", dataRoutes);
app.use("/api/users", userRoutes);

app.post("/graphql", requireAuth, handleGraphql);

app.use(medicalProxyRoutes);

app.get("/debug-sentry", (_req, res) => {
  if (!env.sentry.debugRouteEnabled) {
    return res.status(404).json({ message: "Not found" });
  }
  return Sentry.startSpan(
    {
      op: "test",
      name: "Sentry Test Span",
    },
    () => {
      if (Sentry.logger && typeof Sentry.logger.info === "function") {
        Sentry.logger.info("User triggered test error", {
          action: "test_error_span",
        });
      }
      const error = new Error(
        "Intentional Sentry test error from /debug-sentry",
      );
      const eventId = Sentry.captureException(error);
      return res.status(500).json({
        message: error.message,
        sentry_event_id: eventId,
      });
    },
  );
});

if (env.sentry.enabled) {
  Sentry.setupExpressErrorHandler(app);
}

app.use(errorMiddleware);

module.exports = app;
