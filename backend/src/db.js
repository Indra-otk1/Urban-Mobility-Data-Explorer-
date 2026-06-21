// src/db.js
// Shared MySQL connection pool. Both the ingestion script and the
// Express API import this so there's a single source of truth for
// how we connect to the database.

require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'urban_mobility',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  dateStrings: true, // return DATETIME columns as plain strings, not JS Date objects with TZ surprises
});

module.exports = pool;
