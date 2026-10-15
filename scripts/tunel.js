#!/usr/bin/env node
'use strict';
/*
 * Nuvora fuera de casa: arranca el servidor y lo publica en internet con un
 * túnel HTTPS gratuito de Cloudflare (sin abrir puertos en el router).
 *
 *   npm run tunel                       dirección temporal *.trycloudflare.com
 *   NUVORA_TUNEL=nombre npm run tunel   túnel con nombre (dirección fija, ver README)
 *
 * Necesita «cloudflared»: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/
 */
const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');

if (spawnSync('cloudflared', ['--version']).error) {
  console.error('✕ Falta «cloudflared». Instálalo y vuelve a intentarlo:');
  console.error('  Windows:  winget install --id Cloudflare.cloudflared');
  console.error('  Mac:      brew install cloudflared');
  console.error('  Linux:    https://pkg.cloudflare.com/');
  process.exit(1);
}

process.env.PORT = process.env.PORT || '3000';
require(path.join(__dirname, '..', 'server', 'index.js'));

const nombre = process.env.NUVORA_TUNEL;
const argumentos = nombre
  ? ['tunnel', '--no-autoupdate', 'run', nombre]
  : ['tunnel', '--no-autoupdate', '--url', `http://localhost:${process.env.PORT}`];
const tunel = spawn('cloudflared', argumentos, { stdio: ['ignore', 'pipe', 'pipe'] });
let avisado = false;
const leer = (chunk) => {
  const m = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(String(chunk));
  if (m && !avisado) {
    avisado = true;
    console.log(`\n☁  Fuera de casa: ${m[0]}`);
    console.log('   Escríbela en la app (foto de perfil → Cambiar de servidor). Cambia cada vez que arrancas;');
    console.log('   para una dirección fija, crea un túnel con nombre (README → Usarlo fuera de casa).\n');
  }
  if (/connection.*registered|Registered tunnel connection/i.test(String(chunk)) && nombre && !avisado) {
    avisado = true;
    console.log(`\n☁  Túnel «${nombre}» conectado.\n`);
  }
};
tunel.stdout.on('data', leer);
tunel.stderr.on('data', leer);
tunel.on('exit', (code) => { console.error(`El túnel se ha cerrado (código ${code}).`); process.exit(code || 1); });
process.on('SIGINT', () => { tunel.kill(); process.exit(0); });
