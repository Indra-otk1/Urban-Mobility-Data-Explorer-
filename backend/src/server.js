// src/server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');

const tripsRouter = require('./routes/trips');
const zonesRouter = require('./routes/zones');
const insightsRouter = require('./routes/insights');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

app.use('/api/trips', tripsRouter);
app.use('/api/zones', zonesRouter);
app.use('/api/insights', insightsRouter);

// Centralized error handler — every route below calls next(err) on
// failure rather than handling errors inline, so this is the single
// place that decides what the client sees.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({
    error: err.message || 'Internal server error',
  });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`Urban Mobility API listening on port ${PORT}`);
});
