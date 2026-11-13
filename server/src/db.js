'use strict';
const fs = require('fs');
const path = require('path');
// Uses Node's built-in SQLite (node:sqlite, Node 22.13+), so no native compiling / Python / Visual Studio is needed.
const { DatabaseSync } = require('node:sqlite');

// Small wrapper so the rest of the code can keep using db.pragma() and db.transaction().
function wrap(db) {
  db.pragma = (text) => { db.exec('PRAGMA ' + text); };
  db.transaction = (fn) => (...args) => {
    db.exec('BEGIN');
    try { const r = fn(...args); db.exec('COMMIT'); return r; }
    catch (e) { try { db.exec('ROLLBACK'); } catch (_) {} throw e; }
  };
  return db;
}

function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = wrap(new DatabaseSync(file));
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ref TEXT NOT NULL UNIQUE,
      order_id TEXT UNIQUE,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT,
      language TEXT,
      dob TEXT,
      birth_time TEXT,
      birth_time_unknown INTEGER NOT NULL DEFAULT 0,
      birth_place TEXT,
      birth_country TEXT,
      service_key TEXT NOT NULL,
      service_name TEXT NOT NULL,
      package_name TEXT NOT NULL,
      package_duration TEXT,
      appt_date TEXT,
      appt_time TEXT,
      details TEXT,
      amount_paise INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'INR',
      status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid | failed | expired | refunded
      payment_id TEXT,
      payment_method TEXT,
      failure_reason TEXT,
      refunded_paise INTEGER NOT NULL DEFAULT 0,
      mode TEXT,
      created_at TEXT NOT NULL,
      paid_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    CREATE INDEX IF NOT EXISTS idx_bookings_created ON bookings(created_at);
    CREATE INDEX IF NOT EXISTS idx_bookings_payment ON bookings(payment_id);

    -- every gateway order ever created for a booking (a retry makes a NEW order and a NEW QR), so a late
    -- payment on an older QR can still be matched to the right booking
    CREATE TABLE IF NOT EXISTS gateway_orders (
      order_id TEXT PRIMARY KEY,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS webhook_events (
      id TEXT PRIMARY KEY,
      event TEXT,
      received_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payment_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL REFERENCES bookings(id),
      source TEXT NOT NULL,          -- verify | webhook | retry
      event TEXT,
      payment_id TEXT,
      status_after TEXT,
      note TEXT,
      at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS enquiries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL,
      email TEXT,
      gender TEXT,
      topic TEXT NOT NULL,
      message TEXT,
      source TEXT,
      created_at TEXT NOT NULL
    );
  `);
  // Upgrade older databases (created before the UPI QR payment system) without losing any rows.
  const have = new Set(db.prepare('PRAGMA table_info(bookings)').all().map((c) => c.name));
  const add = { payment_session_id: 'TEXT', upi_link: 'TEXT', qr_image: 'TEXT', expires_at: 'TEXT', attempts: 'INTEGER NOT NULL DEFAULT 1' };
  for (const [col, type] of Object.entries(add)) if (!have.has(col)) db.exec(`ALTER TABLE bookings ADD COLUMN ${col} ${type}`);
  db.exec('INSERT OR IGNORE INTO gateway_orders (order_id, booking_id, created_at) SELECT order_id, id, created_at FROM bookings WHERE order_id IS NOT NULL');
  return db;
}

module.exports = { openDb };
