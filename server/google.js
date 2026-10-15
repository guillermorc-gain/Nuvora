'use strict';
// Verificación de los tokens de «Iniciar sesión con Google» (ID tokens JWT RS256),
// sin dependencias: se comprueban la firma con las claves públicas de Google,
// el emisor, el destinatario (nuestro ID de cliente) y la caducidad.
const crypto = require('node:crypto');

const CERTS_URL = 'https://www.googleapis.com/oauth2/v3/certs';
const ISSUERS = new Set(['accounts.google.com', 'https://accounts.google.com']);

// Cliente web del proyecto de Firebase de Memories: así Nuvora y Memories
// comparten las mismas cuentas de Google. Se puede cambiar con NUVORA_GOOGLE_CLIENT_ID.
const CLIENTE_MEMORIES = '920678667813-ucrbu5sc7lh2gtef4rbor7sa63tampbo.apps.googleusercontent.com';

function createGoogleVerifier({ clientIds, fetchKeys } = {}) {
  const audiences = new Set((clientIds && clientIds.length ? clientIds : [CLIENTE_MEMORIES]).filter(Boolean));
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

  return { verify, clientId: [...audiences][0] };
}

module.exports = { createGoogleVerifier, CLIENTE_MEMORIES };
