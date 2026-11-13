'use strict';
const { isPayable } = require('./config');

// ---- same mobile rules as the website (cleanMob / mobErr in index.html) ----
function cleanMobile(v) {
  let d = String(v == null ? '' : v).replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d[0] === '0') d = d.slice(1);
  return d.slice(0, 10);
}
function mobileError(v) {
  v = String(v || '');
  if (!/^[0-9]{10}$/.test(v)) return 'Please enter a valid 10-digit mobile number.';
  if (!/^[6-9]/.test(v)) return 'Please enter a valid mobile number. It must start with 6, 7, 8 or 9.';
  if (/^(\d)\1{9}$/.test(v)) return 'Please enter a valid mobile number.';
  if (/^(\d\d)\1{4}$/.test(v) || /^(\d\d\d)\1{2}\d$/.test(v) || /^(\d{5})\1$/.test(v)) return 'Please enter a valid mobile number.';
  if ('01234567890'.includes(v) || '09876543210'.includes(v)) return 'Please enter a valid mobile number.';
  return '';
}

const clean = (v, max) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max) : '');
const todayIST = (now = new Date()) => new Date(now.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);

function validDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}
function addDays(s, n) { const d = new Date(s + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }

function cleanDetails(arr) {
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (const p of arr.slice(0, 40)) {
    if (!Array.isArray(p)) continue;
    const label = clean(String(p[0] == null ? '' : p[0]), 200);
    const value = clean(String(p[1] == null ? '' : p[1]), 2000);
    if (label && value) out.push([label, value]);
  }
  return out;
}

// Returns { error } or { value }. The client NEVER sends an amount: the price comes from the server config.
function validateBooking(body, cfg, now = new Date()) {
  const b = body && typeof body === 'object' ? body : {};
  const c = b.client && typeof b.client === 'object' ? b.client : {};
  const fail = (error) => ({ error });

  const serviceKey = clean(b.service, 30);
  if (!Object.prototype.hasOwnProperty.call(cfg.services, serviceKey)) return fail('Please choose a service.');

  const pkg = cfg.packages.find((p) => p.n === b.package);
  if (!pkg) return fail('Please choose a consultation package.');
  if (!isPayable(cfg, pkg)) return fail('Online payment is not available for this package yet. Please call +91 90046 29005.');

  const today = todayIST(now);
  const apptDate = clean(b.date, 10);
  if (!validDate(apptDate)) return fail('Please choose a consultation date.');
  if (apptDate < today) return fail('The consultation date cannot be in the past.');
  if (apptDate > addDays(today, 365)) return fail('Please choose a date within the next year.');
  const slot = clean(b.slot, 20);
  if (!cfg.slots.includes(slot)) return fail('Please choose a time slot.');

  const name = clean(c.name, 80);
  if (name.length < 2) return fail('Please enter your full name.');
  const mobile = cleanMobile(c.mobile);
  const me = mobileError(mobile);
  if (me) return fail(me);
  const email = clean(c.email, 120);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email address.');

  const dob = clean(c.dob, 10);
  if (!validDate(dob) || dob < '1900-01-01' || dob > today) return fail('Please enter a valid date of birth.');
  const tobUnknown = c.tobUnknown === true;
  const tob = tobUnknown ? '' : clean(c.tob, 5);
  if (tob && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tob)) return fail('Please enter a valid time of birth.');

  return {
    value: {
      serviceKey, serviceName: cfg.services[serviceKey], pkg,
      apptDate, slot, name, mobile, email,
      language: clean(c.language, 30), dob, tob, tobUnknown,
      pob: clean(c.pob, 120), cob: clean(c.cob, 80),
      details: cleanDetails(b.details)
    }
  };
}

// Fixed-price items paid outside the booking form (Kundli Making, the Rs 199 / Rs 299 offers).
function validateExtra(body, cfg, now = new Date()) {
  const b = body && typeof body === 'object' ? body : {};
  const fail = (error) => ({ error });
  const key = clean(b.key, 40);
  const extra = (cfg.extras || []).find((x) => x.key === key);
  if (!extra) return fail('Please choose what you would like to pay for.');
  if (!isPayable(cfg, extra)) return fail('Online payment is not available for this item yet. Please call +91 90046 29005.');

  const name = clean(b.name, 80);
  if (name.length < 2) return fail('Please enter your full name.');
  const mobile = cleanMobile(b.mobile);
  const me = mobileError(mobile);
  if (me) return fail(me);
  const email = clean(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email address.');

  let dob = '', tob = '', pob = '', tobUnknown = false;
  if (extra.needsBirth) {
    const today = todayIST(now);
    dob = clean(b.dob, 10);
    if (!validDate(dob) || dob < '1900-01-01' || dob > today) return fail('Please enter a valid date of birth.');
    tobUnknown = b.tobUnknown === true;
    tob = tobUnknown ? '' : clean(b.tob, 5);
    if (!tobUnknown && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tob)) return fail('Please enter your time of birth, or tick the box if you do not know it.');
    pob = clean(b.pob, 120);
    if (pob.length < 2) return fail('Please enter your place of birth.');
  }
  return { value: { extra, name, mobile, email, dob, tob, tobUnknown, pob, details: cleanDetails(b.details) } };
}

// Contact form and products enquiry form (no payment).
function validateEnquiry(body) {
  const b = body && typeof body === 'object' ? body : {};
  const fail = (error) => ({ error });
  const name = clean(b.name, 80);
  if (name.length < 2) return fail('Please enter your full name.');
  const mobile = cleanMobile(b.mobile);
  const me = mobileError(mobile);
  if (me) return fail(me);
  const email = clean(b.email, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fail('Please enter a valid email address.');
  const topic = clean(b.topic, 120);
  if (!topic) return fail('Please tell us what you would like to enquire about.');
  return {
    value: {
      name, mobile, email, topic,
      gender: b.gender === 'Male' || b.gender === 'Female' ? b.gender : '',
      message: clean(b.message, 1000),
      source: b.source === 'contact' || b.source === 'products' ? b.source : 'website'
    }
  };
}

module.exports = { validateBooking, validateExtra, validateEnquiry, cleanMobile, mobileError, todayIST };
