const express = require('express');
const cors = require('cors');
const env = require('./config/env');
const authRoutes = require('./routes/authRoutes');
const syncRoutes = require('./routes/syncRoutes');
const dataRoutes = require('./routes/dataRoutes');
const userRoutes = require('./routes/userRoutes');
const medicalProxyRoutes = require('./routes/medicalProxyRoutes');
const { errorMiddleware } = require('./middlewares/errorMiddleware');
const { requireAuth } = require('./middlewares/authMiddleware');
const { handleGraphql } = require('./graphql/graphqlHandler');
const { requestContextMiddleware } = require('./middlewares/requestContext');
const { httpMetrics } = require('./middlewares/httpMetrics');
const { metricsHandler } = require('./metrics/metricsHandler');

const app = express();

app.use(
  cors({
    // If CORS_ORIGINS is not set, allow all origins for now.
    origin: env.cors.allowAll ? true : env.cors.origins,
    credentials: true,
  }),
);

app.use(requestContextMiddleware);
app.use(httpMetrics);
app.use(express.json({ limit: '20mb' }));

app.get('/metrics', metricsHandler);
app.get('/version', (_req, res) => {
  res.json({
    version: env.appVersion,
    service: env.serviceName,
    migrations_status: 'unknown',
  });
});

app.get('/health', (_req, res) => res.status(200).json({ status: 'ok', service: 'Nexxaura API Gateway' }));
app.get('/gateway/health', (_req, res) =>
  res.status(200).json({ status: 'ok', service: 'Nexxaura API Gateway', note: 'Use GET / for upstream FastAPI health' }),
);

app.use('/api/auth', authRoutes);
app.use('/api/sync', syncRoutes);
app.use('/api/data', dataRoutes);
app.use('/api/users', userRoutes);

app.post('/graphql', requireAuth, handleGraphql);

app.use(medicalProxyRoutes);

app.use(errorMiddleware);

module.exports = app;
