'use strict';
const { loadConfig } = require('./src/config');
const config = loadConfig();
const { openDb } = require('./src/db');
const { createApp } = require('./src/app');
const app = createApp({ config, db: openDb(config.dbPath) });
app.listen(config.port, () => {
  console.log(`Star Astrology server running on http://localhost:${config.port}`);
  console.log(`  Admin: ${config.admin.enabled ? 'http://localhost:' + config.port + '/admin  (payments: /admin/manual)' : 'disabled'}`);
  config.warnings.forEach((w) => console.warn('  ! ' + w));
});
