'use strict';
// Verificación de los tokens de «Iniciar sesión con Google» (ID tokens JWT RS256),
// sin dependencias: se comprueban la firma con las claves públicas de Google,
// el emisor, el destinatario (nuestro ID de cliente) y la caducidad.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// El ID del cliente web sale del google-services.json del proyecto de Firebase
// «Nuvora» (el mismo archivo que usa la app de Android), o de NUVORA_GOOGLE_CLIENT_ID.
const RUTAS_GOOGLE_SERVICES = [
  path.join(__dirname, '..', 'google-services.json'),
  path.join(__dirname, '..', 'android', 'app', 'google-services.json'),
];

function clienteWebDeGoogleServices(rutas = RUTAS_GOOGLE_SERVICES) {
  for (const ruta of rutas) {
    try {
      const datos = JSON.parse(fs.readFileSync(ruta, 'utf8'));
      for (const c of datos.client || []) {
        for (const o of c.oauth_client || []) if (o.client_type === 3 && o.client_id) return o.client_id;
      }
    } catch { /* no existe o no es válido: se prueba el siguiente */ }
  }
  return null;
}

function createGoogleVerifier({ clientIds, fetchKeys } = {}) {
  // clientIds explícito (aunque esté vacío) manda; si no, se busca google-services.json
  const audiences = new Set((clientIds !== undefined ? clientIds : [clienteWebDeGoogleServices()]).filter(Boolean));
  let cache = { keys: null, until: 0 };

  async function keys(force) {
    if (!force && cache.keys && Date.now() < cache.until) return cache.keys;
    let jwks, maxAge = 3600;
    if (fetchKeys) jwks = await fetchKeys();
    else {
      const res = await fetch(CERTS_URL);
      if (!res.ok) throw new Error(`Google respondió ${res.status} al pedir sus claves`);
      const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
      if (m) maxAge = Number(m[1]);
      jwks = await res.json();
    }
    const map = new Map();
    for (const k of jwks.keys || []) map.set(k.kid, crypto.createPublicKey({ key: k, format: 'jwk' }));
    cache = { keys: map, until: Date.now() + maxAge * 1000 };
    return map;
  }

  const b64 = (s) => Buffer.from(s, 'base64url');

  async function verify(token) {
    if (!audiences.size) throw Object.assign(new Error('El inicio de sesión con Google no está configurado en este servidor'), { status: 503 });
    const parts = String(token || '').split('.');
    if (parts.length !== 3) throw new Error('Token de Google no válido');
    const header = JSON.parse(b64(parts[0]).toString('utf8'));
    const payload = JSON.parse(b64(parts[1]).toString('utf8'));
    if (header.alg !== 'RS256') throw new Error('Token de Google no válido');
    let key = (await keys()).get(header.kid);
    if (!key) key = (await keys(true)).get(header.kid); // Google rota sus claves
    if (!key) throw new Error('Token de Google firmado con una clave desconocida');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, b64(parts[2]));
    if (!ok) throw new Error('La firma del token de Google no es válida');
    const now = Math.floor(Date.now() / 1000);
    if (!ISSUERS.has(payload.iss)) throw new Error('El token no es de Google');
    if (!audiences.has(payload.aud)) throw new Error('El token de Google es para otra aplicación');
    if (!payload.exp || payload.exp < now - 60) throw new Error('El token de Google ha caducado');
    if (!payload.email || payload.email_verified === false || payload.email_verified === 'false') {
      throw new Error('La cuenta de Google no tiene un correo verificado');
    }
    return payload;
  }

  return { verify, clientId: [...audiences][0] || null };
}

module.exports = { createGoogleVerifier, clienteWebDeGoogleServices };
