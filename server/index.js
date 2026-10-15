#!/usr/bin/env node
'use strict';
const path = require('node:path');
const os = require('node:os');
const { createApp } = require('./app');

const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '0.0.0.0';
const dataDir = process.env.NUVORA_DATA || path.join(__dirname, '..', 'data');
// Sin límite de espacio salvo que se pida uno (NUVORA_QUOTA_GB)
const quotaGb = Number(process.env.NUVORA_QUOTA_GB) || 0;

// Syncthing (lo pone la app de Mac): la carpeta ~/Nuvora se sincroniza con tus móviles
let syncthing = null;
if (process.env.NUVORA_SYNCTHING) {
  const { SyncthingLocal } = require('./syncthing');
  syncthing = new SyncthingLocal({
    binario: process.env.NUVORA_SYNCTHING,
    home: process.env.NUVORA_SYNCTHING_HOME || path.join(dataDir, 'syncthing'),
    carpeta: process.env.NUVORA_CARPETA || path.join(os.homedir(), 'Nuvora'),
  });
  syncthing.arrancar()
    .then((id) => console.log(`   Syncthing listo: ${id.slice(0, 7)}… (carpeta ${syncthing.carpeta})`))
    .catch((err) => { syncthing.ultimoError = err.message; console.error('   No se pudo arrancar Syncthing:', err.message); });
  process.on('exit', () => syncthing.parar());
  for (const s of ['SIGINT', 'SIGTERM']) process.on(s, () => { syncthing.parar(); process.exit(0); });
}

const app = createApp({ dataDir, quota: quotaGb ? quotaGb * 1024 ** 3 : undefined, syncthing });
app.listen(port, host, () => {
  console.log(`☁  Nuvora funcionando en http://localhost:${port}`);
  // Direcciones de la red local, para conectar la app de Android
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family === 'IPv4' && !a.internal) console.log(`   En el móvil: http://${a.address}:${port}`);
    }
  }
  console.log(`   Datos en: ${dataDir}`);
  if (!process.env.NUVORA_GOOGLE_CLIENT_ID && !require('./google').clienteWebDeGoogleServices()) {
    console.log('   Google: sin configurar (falta google-services.json del proyecto de Firebase «Nuvora»)');
  }
});

// Dentro de la app de Mac: si la app desaparece (queda huérfano), se cierra también
if (process.env.NUVORA_APP) setInterval(() => { if (process.ppid === 1) process.exit(0); }, 3000).unref();
