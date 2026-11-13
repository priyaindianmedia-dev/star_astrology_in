'use strict';
const path = require('path');
const crypto = require('crypto');
const pkgFile = require('../packages.json');

const SERVICES = {
  kundli: 'Personalised Kundli Reading', business: 'Business Astrology', career: 'Career Guidance',
  marriage: 'Marriage & Relationship Consultation', finance: 'Financial Astrology', horoscope: 'Horoscope Analysis',
  chart: 'Birth Chart Analysis', personal: 'Personal Consultation'
};

function loadConfig(env = process.env) {
  const adminPassword = env.ADMIN_PASSWORD || '';
  const dbPath = env.DB_PATH || path.join(__dirname, '..', 'data', 'bookings.db');
  const warnings = [];
  if (adminPassword.length < 10) warnings.push('ADMIN_PASSWORD missing or shorter than 10 characters: the admin dashboard is DISABLED.');
  if (!env.SESSION_SECRET || env.SESSION_SECRET.length < 24) warnings.push('SESSION_SECRET missing or short: using a random one (admin sessions reset on every restart).');
  return {
    port: Number(env.PORT) || 3000,
    siteDir: env.SITE_DIR || path.resolve(__dirname, '..', '..'),
    dbPath, uploadDir: path.join(path.dirname(dbPath), 'uploads'),
    trustProxy: env.TRUST_PROXY === '1' || env.TRUST_PROXY === 'true',
    businessName: 'Star Astrology', mode: '', paymentsEnabled: false,
    admin: { user: env.ADMIN_USER || 'admin', password: adminPassword, enabled: adminPassword.length >= 10 },
    sessionSecret: env.SESSION_SECRET && env.SESSION_SECRET.length >= 24 ? env.SESSION_SECRET : crypto.randomBytes(32).toString('hex'),
    services: SERVICES, packages: pkgFile.packages, extras: pkgFile.extras || [], slots: pkgFile.slots, warnings
  };
}
module.exports = { loadConfig, SERVICES };
