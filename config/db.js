import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import logger from "../logger.js";
dotenv.config();

/* =============================================================================
 * OLD CODE (kept for reference)
 * Issue: Intermittent `Error: read ECONNRESET` in authenticateAdmin / DB queries.
 * Cause: Idle pool connections were closed by MySQL (wait_timeout) or the network,
 *        but the pool still tried to reuse those stale connections.
 * Also: connectDB used a callback on mysql2/promise pool (getConnection returns a
 *        Promise), so reconnect logic never ran correctly.
 * =============================================================================
 *
 * const pool = mysql.createPool({
 *     host               : process.env.DB_HOST,
 *     user               : process.env.DB_USER,
 *     password           : process.env.DB_PASSWORD,
 *     database           : process.env.DB_NAME,
 *     port               : 3306,
 *     waitForConnections : true,
 *     connectionLimit    : 20,
 *     queueLimit         : 0
 *     // connectTimeout     : 10000,
 * });
 * // Added By Ravv
 * // pool.on("connection", (connection) => {
 * //     console.log("New DB connection established:", connection.threadId);
 * // });
 *
 * // pool.on("error", (err) => {
 * //     console.error(" MySQL Pool Error:", err);
 * //     if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
 * //       console.log("Reconnecting to database...");
 * //
 * //     }
 * //     logger.error(`Error database connection pool :`, err);
 * //     connectDB();
 * // });
 * function connectDB() {
 *     console.log("connection function call");
 *     pool.getConnection((err, connection) => {
 *         if (err) {
 *             console.log("Database connection failed:", err);
 *             logger.error(`Error database connection inside function :`, err);
 *             setTimeout(connectDB, 2000); // Retry after 2 seconds
 *         } else {
 *             console.log("connected");
 *             console.log("Database connected!");
 *             connection.release();
 *         }
 *     });
 * }
 * connectDB();
 *
 * // End Added By Ravv
 *
 * const retryConnection = async (retries, delay) => {
 *   for (let i = 0; i <= retries; i++) {
 *     try {
 *       const connection = await pool.getConnection();
 *       console.log("Connected to the MySQL database.");
 *       connection.release();
 *       return;
 *     } catch (err) {
 *       // console.error(`Error connecting to the database (attempt ${i + 1}):`, err);
 *       logger.error(`Error connecting to the database (attempt ${i + 1}):`, err);
 *
 *       if (err.code === 'ECONNREFUSED') {
 *         // console.log('Connection refused, retrying...');
 *         logger.error(`Connection refused, retrying...`);
 *       }
 *
 *       if (i < retries) {
 *         await new Promise((resolve) => setTimeout(resolve, delay));
 *       } else {
 *         // console.error('All retry attempts failed.');
 *         logger.error(`All retry attempts failed.`);
 *         throw err;
 *       }
 *     }
 *   }
 * };
 *
 * const testConnectionOld = async () => {
 *   const maxRetries = 5;
 *   const retryDelay = 2000;
 *   await retryConnection(maxRetries, retryDelay);
 * };
 *
 * const testConnection = async () => {
 *     try {
 *         const connection = await pool.getConnection();
 *         console.log("Connected to the MySQL database.");
 *         connection.release();
 *     } catch (err) {
 *         console.error("Error connecting to the database:", err);
 *     }
 * };
 * // testConnection();
 */

/* =============================================================================
 * UPDATED CODE
 * Fixes intermittent ECONNRESET by:
 * 1. enableKeepAlive      - keeps TCP sockets alive so DB/network don't drop them
 * 2. maxIdle + idleTimeout - recycle idle connections before MySQL wait_timeout
 * 3. async connectDB       - correct promise-based getConnection + retry on failure
 * =============================================================================
 */
const pool = mysql.createPool({
    host               : process.env.DB_HOST,
    user               : process.env.DB_USER,
    password           : process.env.DB_PASSWORD,
    database           : process.env.DB_NAME,
    port               : 3306,
    waitForConnections : true,
    connectionLimit    : 20,
    queueLimit         : 0,
    // Prevent stale connections that cause ECONNRESET
    enableKeepAlive    : true,
    keepAliveInitialDelay : 10000,
    // Close idle connections after 60s (before typical MySQL wait_timeout)
    maxIdle            : 10,
    idleTimeout        : 60000,
});

const connectDB = async () => {
    try {
        const connection = await pool.getConnection();
        console.log("Database connected!");
        connection.release();
    } catch (err) {
        console.log("Database connection failed:", err.message);
        logger.error(`Error database connection inside function :`, err);
        // Retry after 2 seconds if initial connection fails
        setTimeout(connectDB, 2000);
    }
};
connectDB();

export const startTransaction = async () => {
  const connection = await pool.getConnection();
  await connection.beginTransaction();
  return connection;
};

export const commitTransaction = async (connection) => {
  await connection.commit();
  connection.release();
};

export const rollbackTransaction = async (connection) => {
  await connection.rollback();
  connection.release();
};

export default pool;
