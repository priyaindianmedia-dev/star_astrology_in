'use strict';
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { STATUSES: FC_STATUSES } = require('./freechat');
const hmacHex = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');

const COOKIE = 'sa_admin';
const SESSION_HOURS = 8;
const b64 = (s) => Buffer.from(s).toString('base64url');
const sha = (s) => crypto.createHash('sha256').update(String(s)).digest();
const sameStr = (a, b) => crypto.timingSafeEqual(sha(a), sha(b));

function adminRouter({ config, db }) {
  const r = express.Router();
  const sign = (payload) => { const p = b64(JSON.stringify(payload)); return p + '.' + hmacHex(config.sessionSecret, p); };
  function readSession(req) {
    const m = (req.headers.cookie || '').split(/;\s*/).find((c) => c.startsWith(COOKIE + '='));
    if (!m) return null;
    const tok = decodeURIComponent(m.slice(COOKIE.length + 1));
    const [p, sig] = tok.split('.');
    if (!p || !sig) return null;
    const want = hmacHex(config.sessionSecret, p);
    if (sig.length !== want.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
    try { const d = JSON.parse(Buffer.from(p, 'base64url').toString()); return d.exp > Date.now() ? d : null; } catch { return null; }
  }

  // Strict CSP: the dashboard loads nothing from outside its own origin.
  r.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow'
    });
    next();
  });
  r.use(express.json({ limit: '4kb' }));

  r.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'index.html')));
  r.get('/admin.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'admin.js')));
  r.get('/admin.css', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'admin.css')));

  const loginLimit = rateLimit({ windowMs: 15 * 60e3, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many login attempts. Try again in 15 minutes.' } });

  r.post('/api/login', loginLimit, (req, res) => {
    if (!config.admin.enabled) return res.status(503).json({ error: 'Admin login is disabled: set ADMIN_PASSWORD (10+ characters) in the server .env file.' });
    const { username, password } = req.body || {};
    const ok = sameStr(username || '', config.admin.user) & sameStr(password || '', config.admin.password);   // both always evaluated
    if (!ok) return res.status(401).json({ error: 'Incorrect username or password.' });
    const tok = sign({ u: config.admin.user, exp: Date.now() + SESSION_HOURS * 3600e3 });
    res.append('Set-Cookie', `${COOKIE}=${encodeURIComponent(tok)}; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=${SESSION_HOURS * 3600}${req.secure ? '; Secure' : ''}`);
    res.json({ ok: true });
  });
  r.post('/api/logout', (req, res) => {
    res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Strict; Path=/admin; Max-Age=0`);
    res.json({ ok: true });
  });

  const requireAuth = (req, res, next) => (config.admin.enabled && readSession(req) ? next() : res.status(401).json({ error: 'Please log in.' }));
  r.get('/api/me', requireAuth, (req, res) => res.json({ ok: true, user: config.admin.user, mode: config.mode || 'off' }));

  // ----- manual UPI payments (see manual.js) -----
  r.get('/manual', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'manual.html')));
  r.get('/manual.js', (req, res) => res.sendFile(path.join(__dirname, '..', 'admin', 'manual.js')));
  r.get('/api/manual', requireAuth, (req, res) => res.json(db.prepare('SELECT id, ref, name, mobile, info, status, screenshot, created_at, submitted_at, decided_at FROM manual_payments ORDER BY id DESC LIMIT 200').all()));
  r.get('/api/manual/:ref/screenshot', requireAuth, (req, res) => {
    const row = /^MP-[A-Z0-9]{8}$/.test(req.params.ref) && db.prepare('SELECT screenshot FROM manual_payments WHERE ref = ?').get(req.params.ref);
    if (!row || !row.screenshot) return res.status(404).end();
    res.sendFile(path.join(config.uploadDir, path.basename(row.screenshot)));
  });
  r.post('/api/manual/:ref/:action(approve|reject)', requireAuth, (req, res) => {
    const to = req.params.action === 'approve' ? 'paid' : 'rejected';
    const i = db.prepare("UPDATE manual_payments SET status=?, decided_at=? WHERE ref=? AND status IN ('submitted','created')").run(to, new Date().toISOString(), req.params.ref);
    res.json({ ok: i.changes === 1 });
  });

  // ----- queries -----
  const STATUSES = ['pending', 'paid', 'failed', 'expired', 'refunded'];
  const likeEsc = (s) => s.replace(/[\\%_]/g, (c) => '\\' + c);
  function filters(qs) {
    const w = [], p = {};
    if (STATUSES.includes(qs.status)) { w.push('status = @status'); p.status = qs.status; }
    const s = String(qs.q || '').trim().slice(0, 80);
    if (s) { w.push(`(name LIKE @q ESCAPE '\\' OR mobile LIKE @q ESCAPE '\\' OR email LIKE @q ESCAPE '\\' OR ref LIKE @q ESCAPE '\\' OR payment_id LIKE @q ESCAPE '\\' OR order_id LIKE @q ESCAPE '\\')`); p.q = '%' + likeEsc(s) + '%'; }
    // dates are entered as Indian dates (IST); stored times are UTC
    if (/^\d{4}-\d{2}-\d{2}$/.test(qs.from || '')) { w.push('created_at >= @from'); p.from = new Date(qs.from + 'T00:00:00+05:30').toISOString(); }
    if (/^\d{4}-\d{2}-\d{2}$/.test(qs.to || '')) { w.push('created_at < @to'); p.to = new Date(new Date(qs.to + 'T00:00:00+05:30').getTime() + 864e5).toISOString(); }
    return { where: w.length ? 'WHERE ' + w.join(' AND ') : '', p };
  }
  const LIST_COLS = 'id, ref, name, mobile, email, service_name, package_name, appt_date, appt_time, amount_paise, status, payment_id, payment_method, created_at, paid_at, mode';

  r.get('/api/bookings', requireAuth, (req, res) => {
    const { where, p } = filters(req.query);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit, 10) || 25));
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const total = db.prepare(`SELECT COUNT(*) n FROM bookings ${where}`).get(p).n;
    const rows = db.prepare(`SELECT ${LIST_COLS} FROM bookings ${where} ORDER BY created_at DESC, id DESC LIMIT @limit OFFSET @offset`).all({ ...p, limit, offset: (page - 1) * limit });
    res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  });

  r.get('/api/enquiries', requireAuth, (req, res) => {
    res.json({ rows: db.prepare('SELECT id, name, mobile, email, gender, topic, message, source, created_at FROM enquiries ORDER BY id DESC LIMIT 200').all() });
  });

  // ----- first-time free chat registrations -----
  r.get('/api/freechats', requireAuth, (req, res) => {
    const s = String(req.query.q || '').trim().slice(0, 80);
    const q = s ? '%' + likeEsc(s) + '%' : null;
    const rows = db.prepare(`SELECT id, name, mobile, country_code, dob, birth_time, birth_time_unknown, birth_place, rashi, problem_category, problem_description, status, created_at FROM free_chats ${q ? "WHERE name LIKE @q ESCAPE '\\' OR mobile LIKE @q ESCAPE '\\' OR birth_place LIKE @q ESCAPE '\\' OR problem_category LIKE @q ESCAPE '\\'" : ''} ORDER BY id DESC LIMIT 500`).all(q ? { q } : {});
    res.json({ rows });
  });
  r.post('/api/freechats/:id/status', requireAuth, (req, res) => {
    const status = String((req.body || {}).status || '');
    if (!FC_STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status.' });
    const i = db.prepare('UPDATE free_chats SET status = ?, updated_at = ? WHERE id = ?').run(status, new Date().toISOString(), parseInt(req.params.id, 10) || 0);
    res.json({ ok: i.changes === 1 });
  });

  r.get('/api/summary', requireAuth, (req, res) => {
    const by = Object.fromEntries(STATUSES.map((s) => [s, { count: 0, paise: 0 }]));
    db.prepare('SELECT status, COUNT(*) n, COALESCE(SUM(amount_paise),0) s FROM bookings GROUP BY status').all().forEach((x) => { by[x.status] = { count: x.n, paise: x.s }; });
    // collected = money actually kept: paid bookings minus any partial refunds (fully refunded bookings count as 0)
    const collected = db.prepare("SELECT COALESCE(SUM(amount_paise - refunded_paise),0) s FROM bookings WHERE status = 'paid'").get().s;
    const refunded = db.prepare('SELECT COALESCE(SUM(refunded_paise),0) s FROM bookings').get().s;
    res.json({ by, collectedPaise: collected, refundedPaise: refunded, mode: config.mode || 'off' });
  });

  r.get('/api/bookings/:id', requireAuth, (req, res) => {
    const b = db.prepare('SELECT * FROM bookings WHERE id = ?').get(parseInt(req.params.id, 10) || 0);
    if (!b) return res.status(404).json({ error: 'Not found' });
    let details = []; try { details = JSON.parse(b.details || '[]'); } catch { /* ignore */ }
    const events = db.prepare('SELECT source, event, payment_id, status_after, note, at FROM payment_events WHERE booking_id = ? ORDER BY id').all(b.id);
    res.json({ ...b, details, events });
  });

  const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return '"' + s.replace(/"/g, '""') + '"'; };
  r.get('/api/export.csv', requireAuth, (req, res) => {
    const { where, p } = filters(req.query);
    const rows = db.prepare(`SELECT * FROM bookings ${where} ORDER BY created_at DESC, id DESC`).all(p);
    const head = ['Booking Ref', 'Created (UTC)', 'Paid at (UTC)', 'Client name', 'Mobile', 'Email', 'Date of birth', 'Birth time', 'Birth place', 'Service', 'Package', 'Appointment date', 'Appointment time', 'Amount (INR)', 'Status', 'Transaction ID (gateway payment ID)', 'Gateway order ID', 'Payment method', 'Refunded (INR)', 'Mode'];
    const lines = [head.map(csvCell).join(',')].concat(rows.map((b) => [b.ref, b.created_at, b.paid_at, b.name, b.mobile, b.email, b.dob, b.birth_time_unknown ? 'Unknown' : b.birth_time, b.birth_place, b.service_name, b.package_name, b.appt_date, b.appt_time, (b.amount_paise / 100).toFixed(2), b.status, b.payment_id, b.order_id, b.payment_method, (b.refunded_paise / 100).toFixed(2), b.mode].map(csvCell).join(',')));
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="transactions-${new Date().toISOString().slice(0, 10)}.csv"` });
    res.send('\ufeff' + lines.join('\r\n'));
  });

  return r;
}

module.exports = { adminRouter };
