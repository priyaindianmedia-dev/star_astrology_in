'use strict';
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { validateEnquiry } = require('./validate');
const { adminRouter } = require('./admin');
const { initManual, manualRouter } = require('./manual');
const { initFreeChat, freeChatRouter } = require('./freechat');

function createApp({ config, db, log = console }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.trustProxy);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginOpenerPolicy: false, crossOriginEmbedderPolicy: false, referrerPolicy: { policy: 'strict-origin-when-cross-origin' } }));

  initManual(db);
  app.use(manualRouter({ config, db, log }));   // before the 64kb json parser: screenshots are larger
  initFreeChat(db);
  // the public free chat form was removed from the website (the paid first chat replaces it); the table stays so old records remain visible in admin
  app.use(express.json({ limit: '64kb' }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

  const limiter = rateLimit({ windowMs: 15 * 60e3, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests. Please wait a few minutes.' } });
  app.post('/api/enquiries', limiter, (req, res) => {
    const r = validateEnquiry(req.body);
    if (r.error) return res.status(400).json({ error: r.error });
    const v = r.value;
    db.prepare('INSERT INTO enquiries (name, mobile, email, gender, topic, message, source, created_at) VALUES (?,?,?,?,?,?,?,?)')
      .run(v.name, v.mobile, v.email, v.gender, v.topic, v.message, v.source, new Date().toISOString());
    res.json({ ok: true });
  });

  app.use('/admin', adminRouter({ config, db, log }));

  const site = config.siteDir;   // only the site's own files are exposed, never server/, .env or the database
  app.get('/', (req, res) => res.sendFile(path.join(site, 'index.html')));
  app.use('/images', express.static(path.join(site, 'images'), { maxAge: '7d' }));
  app.use('/videos', express.static(path.join(site, 'videos'), { maxAge: '7d' }));
  app.use((req, res) => res.status(404).type('text').send('Not found'));
  app.use((err, req, res, next) => {   // eslint-disable-line no-unused-vars
    if (err && err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Invalid request.' });
    log.error('[error]', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  });
  return app;
}
module.exports = { createApp };
