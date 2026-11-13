'use strict';
// Payment by your own UPI QR (a fixed image) + the customer's payment screenshot. No payment gateway / API.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { cleanMobile, mobileError } = require('./validate');

const REF = /^MP-[A-Z0-9]{8}$/;
const newRef = () => 'MP-' + [...crypto.randomBytes(8)].map((x) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[x % 32]).join('');
const imgExt = (b) => (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 ? 'png' : b[0] === 0xff && b[1] === 0xd8 ? 'jpg' : b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' ? 'webp' : null);

function initManual(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS manual_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ref TEXT NOT NULL UNIQUE, name TEXT, mobile TEXT NOT NULL, info TEXT,
    amount_paise INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'created',  -- created | submitted | paid | rejected
    payer_upi TEXT, utr TEXT, screenshot TEXT, auto INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL, submitted_at TEXT, decided_at TEXT)`);
  try { db.exec('ALTER TABLE manual_payments ADD COLUMN info TEXT'); } catch (e) { /* column already exists */ }
}

function manualRouter({ config, db, log = console }) {
  const r = express.Router();
  const lim = (n) => rateLimit({ windowMs: 15 * 60e3, limit: n, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });
  const txt = (v, n) => String(v || '').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, n);

  // 1) customer pressed PAY NOW: remember who they are and what they are booking
  r.post('/api/manual', lim(30), express.json({ limit: '8kb' }), (req, res) => {
    const b = req.body || {};
    const mobile = cleanMobile(b.mobile), me = mobileError(mobile);
    if (me) return res.status(400).json({ error: me });
    const ref = newRef();
    db.prepare('INSERT INTO manual_payments (ref,name,mobile,info,created_at) VALUES (?,?,?,?,?)').run(ref, txt(b.name, 60), mobile, txt(b.info, 1500), new Date().toISOString());
    res.json({ ref });
  });

  // 2) customer uploads the payment screenshot
  r.post('/api/manual/:ref/screenshot', lim(30), express.json({ limit: '4mb' }), (req, res) => {
    const p = REF.test(req.params.ref) && db.prepare('SELECT * FROM manual_payments WHERE ref = ?').get(req.params.ref);
    if (!p) return res.status(404).json({ error: 'Payment not found. Please press PAY NOW again.' });
    const m = /^data:image\/(?:png|jpe?g|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String((req.body || {}).screenshot || ''));
    const buf = m && Buffer.from(m[1], 'base64'), ext = buf && imgExt(buf);
    if (!ext || buf.length > 3 * 1024 * 1024) return res.status(400).json({ error: 'Please upload a PNG, JPG or WEBP screenshot under 3 MB.' });
    fs.mkdirSync(config.uploadDir, { recursive: true });
    const file = `${p.ref}.${ext}`;
    fs.writeFileSync(path.join(config.uploadDir, file), buf);
    db.prepare("UPDATE manual_payments SET screenshot=?, status=CASE WHEN status='paid' THEN status ELSE 'submitted' END, submitted_at=? WHERE id=?").run(file, new Date().toISOString(), p.id);
    log.info(`[payment] ${p.ref} screenshot uploaded`);
    res.json({ ok: true, ref: p.ref });
  });
  return r;
}
module.exports = { initManual, manualRouter };
