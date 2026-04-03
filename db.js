const mysql = require('mysql2');
require('dotenv').config();

console.log('=== CHARGEMENT DB.JS ===');
console.log('DB_HOST (process.env):', process.env.DB_HOST);
console.log('DB_PORT (process.env):', process.env.DB_PORT);
console.log('DB_USER (process.env):', process.env.DB_USER);
console.log('DB_NAME (process.env):', process.env.DB_NAME);

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: { rejectUnauthorized: false },
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

const promisePool = pool.promise();
module.exports = promisePool;