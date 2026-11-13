'use strict';
// First-time FREE CHAT with the astrologer: one registration per mobile number, enforced on the server.
// The UNIQUE constraint on the normalised 10-digit mobile number is the real guard: it works across browsers,
// devices, incognito windows and simultaneous requests. Nothing here depends on localStorage or cookies.
const express = require('express');
const rateLimit = require('express-rate-limit');
const { cleanMobile, mobileError, todayIST } = require('./validate');

const RASHIS = [
  'Mesha (Aries)', 'Vrishabha (Taurus)', 'Mithuna (Gemini)', 'Karka (Cancer)', 'Simha (Leo)', 'Kanya (Virgo)',
  'Tula (Libra)', 'Vrishchika (Scorpio)', 'Dhanu (Sagittarius)', 'Makara (Capricorn)', 'Kumbha (Aquarius)', 'Meena (Pisces)',
  "I don't know my Rashi"
];
const CATEGORIES = [
  'Love & Relationship', 'Marriage & Compatibility', 'Career & Job', 'Business & Finance', 'Family Problems',
  'Health & Well-being', 'Education', 'Future Predictions', 'Kundli & Dosha', 'Personal Life Problems', 'Other'
];
const STATUSES = ['registered', 'contacted', 'completed'];

function initFreeChat(db) {
  db.exec('PRAGMA busy_timeout = 5000');   // simultaneous requests wait for each other instead of failing
  db.exec(`CREATE TABLE IF NOT EXISTS free_chats (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT NOT NULL,                      -- normalised: exactly 10 digits, no country code
    country_code TEXT NOT NULL DEFAULT '+91',
    dob TEXT NOT NULL,                         -- YYYY-MM-DD
    birth_time TEXT,                           -- HH:MM, empty when unknown
    birth_time_unknown INTEGER NOT NULL DEFAULT 0,
    birth_place TEXT NOT NULL,
    rashi TEXT NOT NULL,
    problem_category TEXT NOT NULL,
    problem_description TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'registered', -- registered | contacted | completed
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CONSTRAINT uq_free_chats_mobile UNIQUE (mobile)
  )`);
  db.exec('CREATE INDEX IF NOT EXISTS idx_free_chats_created ON free_chats(created_at)');
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
// The description may have line breaks, so keep those but tidy everything else.
const cleanMulti = (v, max) => (typeof v === 'string'
  ? v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
  : '');
function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Returns { error } or { value }. Every rule is checked here again, whatever the browser did.
function validateFreeChat(body, now = new Date()) {
  const b = body && typeof body === 'object' ? body : {};
  const fail = (error) => ({ error });

  const name = clean(b.name, 80);
  if (name.length < 2) return fail('Please enter your full name.');

  const mobile = cleanMobile(b.mobile);
  const me = mobileError(mobile);
  if (me) return fail(me);

  const today = todayIST(now);
  const dob = clean(b.dob, 10);
  if (!validDate(dob) || dob < '1900-01-01' || dob > today) return fail('Please enter a valid date of birth.');

  const tobUnknown = b.tobUnknown === true;
  const tob = tobUnknown ? '' : clean(b.tob, 5);
  if (!tobUnknown && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tob)) return fail('Please enter your time of birth, or tick "I don\'t know my birth time".');

  const place = clean(b.place, 160);
  if (place.length < 3) return fail('Please enter your place of birth (city, state and country).');

  const rashi = clean(b.rashi, 40);
  if (!RASHIS.includes(rashi)) return fail('Please select your Vedic zodiac sign (Rashi), or choose "I don\'t know my Rashi".');

  const category = clean(b.category, 40);
  if (!CATEGORIES.includes(category)) return fail('Please select the area where you need guidance.');

  const description = cleanMulti(b.description, 1000);
  if (description.length < 10) return fail('Please briefly describe your problem (at least a few words).');

  return { value: { name, mobile, dob, tob, tobUnknown, place, rashi, category, description } };
}

const rowOut = (r) => ({
  id: r.id, name: r.name, mobile: r.mobile, countryCode: r.country_code, dob: r.dob,
  tob: r.birth_time_unknown ? '' : (r.birth_time || ''), tobUnknown: !!r.birth_time_unknown,
  place: r.birth_place, rashi: r.rashi, category: r.problem_category, description: r.problem_description, createdAt: r.created_at
});

// Core logic, kept separate from Express so it can be tested directly.
// Returns { status: 200|400|409, body }.
function registerFreeChat(db, body, now = new Date()) {
  const r = validateFreeChat(body, now);
  if (r.error) return { status: 400, body: { error: r.error } };
  const v = r.value;
  const alreadyUsed = { status: 409, body: { already: true, error: 'The free chat offer is available only once per mobile number.' } };

  // Friendly early exit (the unique constraint below is what actually guarantees it).
  if (db.prepare('SELECT 1 FROM free_chats WHERE mobile = ?').get(v.mobile)) return alreadyUsed;

  const ts = now.toISOString();
  try {
    const i = db.prepare(`INSERT INTO free_chats
      (name, mobile, country_code, dob, birth_time, birth_time_unknown, birth_place, rashi, problem_category, problem_description, status, created_at, updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`)
      .run(v.name, v.mobile, '+91', v.dob, v.tob, v.tobUnknown ? 1 : 0, v.place, v.rashi, v.category, v.description, 'registered', ts, ts);
    const row = db.prepare('SELECT * FROM free_chats WHERE id = ?').get(i.lastInsertRowid);
    return { status: 200, body: { ok: true, registration: rowOut(row) } };
  } catch (e) {
    // Two simultaneous submissions: the loser hits the UNIQUE constraint and is treated as "already used".
    if (e && /UNIQUE|constraint/i.test(String(e.message || e.code || ''))) return alreadyUsed;
    throw e;
  }
}

function freeChatRouter({ db, log = console }) {
  const r = express.Router();
  const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 15, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });
  r.post('/api/free-chat', limiter, express.json({ limit: '8kb' }), (req, res) => {
    try {
      const out = registerFreeChat(db, req.body);
      if (out.status === 200) log.info(`[free-chat] registration #${out.body.registration.id}`);
      res.status(out.status).json(out.body);
    } catch (e) {
      log.error('[free-chat]', e);
      res.status(500).json({ error: 'Something went wrong. Please try again.' });
    }
  });
  return r;
}

module.exports = { initFreeChat, freeChatRouter, registerFreeChat, validateFreeChat, RASHIS, CATEGORIES, STATUSES };
