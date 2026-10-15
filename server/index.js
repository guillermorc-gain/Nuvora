#!/usr/bin/env node
'use strict';
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.NUVORA_DATA || path.join(__dirname, '..', 'data');
const quotaGb = Number(process.env.NUVORA_QUOTA_GB) || 15;

const app = createApp({ dataDir, quota: quotaGb * 1024 ** 3 });
app.listen(port, host, () => {
  console.log(`☁  Nuvora funcionando en http://localhost:${port}`);
  // Direcciones de la red local, para conectar la app de Android
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`   En el móvil: http://${a.address}:${port}`);
    }
  }
  console.log(`   Datos en: ${dataDir}`);
});
