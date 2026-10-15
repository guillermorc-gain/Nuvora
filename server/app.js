'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const Busboy = require('busboy');
const { openDatabase } = require('./db');
const { BlobStore } = require('./storage');
const { streamZip } = require('./zip');
const { hashPassword, verifyPassword, randomToken } = require('./security');
const { createGoogleVerifier } = require('./google');

const DAY = 24 * 60 * 60 * 1000;
const SESSION_TTL = 30 * DAY;
const COLORS = ['#6C5CE7', '#00B894', '#0984E3', '#E17055', '#E84393', '#00CEC9', '#FDCB6E', '#D63031'];
// Tipos que no se deben mostrar en línea desde nuestro origen (riesgo de XSS).
const UNSAFE_INLINE = /^(text\/html|application\/xhtml|image\/svg|text\/xml|application\/xml|application\/javascript|text\/javascript)/i;

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
  bmp: 'image/bmp', ico: 'image/x-icon', svg: 'image/svg+xml', heic: 'image/heic',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', m4v: 'video/mp4', ogv: 'video/ogg',
  mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac', aac: 'audio/aac', opus: 'audio/opus',
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', json: 'application/json',
  js: 'text/javascript', ts: 'text/plain', css: 'text/css', html: 'text/html', htm: 'text/html', xml: 'text/xml',
  py: 'text/x-python', java: 'text/plain', c: 'text/plain', cpp: 'text/plain', go: 'text/plain', rs: 'text/plain',
  sh: 'text/plain', yml: 'text/yaml', yaml: 'text/yaml', log: 'text/plain', ini: 'text/plain', sql: 'text/plain',
  zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed', gz: 'application/gzip', tar: 'application/x-tar',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

function guessMime(name, fallback) {
  const ext = path.extname(name).slice(1).toLowerCase();
  return MIME[ext] || (fallback && fallback !== 'application/octet-stream' ? fallback : 'application/octet-stream');
}

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function cleanName(name) {
  const n = String(name ?? '').replace(/[\\/\x00-\x1f]/g, '').trim();
  if (!n || n === '.' || n === '..') throw new HttpError(400, 'Nombre no válido');
  if (n.length > 255) throw new HttpError(400, 'El nombre es demasiado largo');
  return n;
}

function contentDisposition(type, name) {
  const ascii = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `${type}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

function createApp(options = {}) {
  const dataDir = options.dataDir || path.join(__dirname, '..', 'data');
  const defaultQuota = options.quota || 15 * 1024 ** 3;
  const db = openDatabase(dataDir);
  const blobs = new BlobStore(path.join(dataDir, 'blobs'));
  const secretFile = path.join(dataDir, 'secret');
  if (!fs.existsSync(secretFile)) fs.writeFileSync(secretFile, randomToken(48), { mode: 0o600 });
  const secret = fs.readFileSync(secretFile, 'utf8');
  const google = createGoogleVerifier(options.google || {
    clientIds: (process.env.NUVORA_GOOGLE_CLIENT_ID || '').split(',').map((x) => x.trim()).filter(Boolean),
  });

  // ---------- Consultas preparadas ----------
  const q = {
    userById: db.prepare('SELECT * FROM users WHERE id = ?'),
    userByEmail: db.prepare('SELECT * FROM users WHERE email = ?'),
    insertUser: db.prepare('INSERT INTO users (id, name, email, pass_hash, quota, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    session: db.prepare('SELECT * FROM sessions WHERE token = ? AND expires_at > ?'),
    insertSession: db.prepare('INSERT INTO sessions (token, user_id, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?)'),
    deleteSession: db.prepare('DELETE FROM sessions WHERE token = ?'),
    node: db.prepare('SELECT * FROM nodes WHERE id = ?'),
    children: db.prepare('SELECT * FROM nodes WHERE owner_id = ? AND parent_id IS ? AND trashed_at IS NULL'),
    childrenOf: db.prepare('SELECT * FROM nodes WHERE parent_id = ?'),
    childByName: db.prepare('SELECT * FROM nodes WHERE owner_id = ? AND parent_id IS ? AND name = ? COLLATE NOCASE AND trashed_at IS NULL'),
    insertNode: db.prepare(`INSERT INTO nodes (id, owner_id, parent_id, name, type, size, mime, hash, created_by, created_at, updated_at)
                            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`),
    usage: db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM nodes WHERE owner_id = ? AND type = \'file\''),
    hashRefs: db.prepare('SELECT COUNT(*) AS n FROM nodes WHERE hash = ?'),
    shareFor: db.prepare('SELECT role FROM shares WHERE node_id = ? AND user_id = ?'),
    recordChange: db.prepare('INSERT INTO changes (owner_id, node_id, action, at) VALUES (?, ?, ?, ?)'),
    lastSeq: db.prepare('SELECT COALESCE(MAX(seq), 0) AS seq FROM changes WHERE owner_id = ?'),
    link: db.prepare('SELECT * FROM links WHERE token = ?'),
  };

  // ---------- Notificaciones en tiempo real (Server-Sent Events) ----------
  const listeners = new Map(); // userId -> Set<res>
  function notify(ownerId, payload) {
    const targets = new Set([ownerId]);
    for (const row of db.prepare('SELECT DISTINCT s.user_id FROM shares s JOIN nodes n ON n.id = s.node_id WHERE n.owner_id = ?').all(ownerId)) {
      targets.add(row.user_id);
    }
    const msg = `data: ${JSON.stringify(payload)}\n\n`;
    for (const uid of targets) for (const res of listeners.get(uid) || []) res.write(msg);
  }
  function changed(node, action) {
    q.recordChange.run(node.owner_id, node.id, action, Date.now());
    notify(node.owner_id, { type: 'change', action, nodeId: node.id, parentId: node.parent_id });
  }

  // ---------- Utilidades del árbol ----------
  function ancestors(node) {
    const chain = [];
    let cur = node;
    const seen = new Set();
    while (cur && cur.parent_id && !seen.has(cur.parent_id)) {
      seen.add(cur.parent_id);
      cur = q.node.get(cur.parent_id);
      if (cur) chain.unshift(cur);
    }
    return chain;
  }

  // Devuelve 'owner' | 'editor' | 'viewer' | null
  function roleFor(user, node) {
    if (!node) return null;
    if (node.owner_id === user.id) return 'owner';
    if (node.trashed_at) return null;
    let best = null;
    for (const n of [...ancestors(node), node]) {
      if (n.trashed_at) return null;
      const s = q.shareFor.get(n.id, user.id);
      if (s && (s.role === 'editor' || !best)) best = s.role;
    }
    return best;
  }

  function requireNode(user, id, need = 'viewer') {
    const node = q.node.get(id);
    const role = node && roleFor(user, node);
    if (!role) throw new HttpError(404, 'No se encontró el elemento');
    const rank = { viewer: 1, editor: 2, owner: 3 };
    if (rank[role] < rank[need]) throw new HttpError(403, 'No tienes permiso para hacer esto');
    return { node, role };
  }

  function uniqueName(ownerId, parentId, name) {
    if (!q.childByName.get(ownerId, parentId, name)) return name;
    const ext = path.extname(name);
    const base = ext && ext !== name ? name.slice(0, -ext.length) : name;
    for (let i = 1; ; i++) {
      const candidate = `${base} (${i})${ext && ext !== name ? ext : ''}`;
      if (!q.childByName.get(ownerId, parentId, candidate)) return candidate;
    }
  }

  function descendants(node, includeTrashed = false) {
    const out = [];
    const stack = [node];
    while (stack.length) {
      const cur = stack.pop();
      for (const child of q.childrenOf.all(cur.id)) {
        if (!includeTrashed && child.trashed_at) continue;
        out.push(child);
        if (child.type === 'folder') stack.push(child);
      }
    }
    return out;
  }

  function userSummary(u) {
    return u && { id: u.id, name: u.name, email: u.email, color: u.color, foto: u.foto || null };
  }

  function serialize(node, user, extra = {}) {
    const owner = node.owner_id === user.id ? null : userSummary(q.userById.get(node.owner_id));
    const shareCount = db.prepare('SELECT COUNT(*) AS n FROM shares WHERE node_id = ?').get(node.id).n
      + db.prepare('SELECT COUNT(*) AS n FROM links WHERE node_id = ?').get(node.id).n;
    return {
      id: node.id,
      name: node.name,
      type: node.type,
      size: node.size,
      mime: node.mime,
      hash: node.hash,
      parentId: node.parent_id,
      starred: !!node.starred,
      trashedAt: node.trashed_at,
      createdAt: node.created_at,
      updatedAt: node.updated_at,
      version: node.version,
      shared: shareCount > 0,
      owner,
      ...extra,
    };
  }

  function createFolder(user, ownerId, parentId, name) {
    const now = Date.now();
    const node = { id: crypto.randomUUID(), owner_id: ownerId, parent_id: parentId, name, type: 'folder' };
    q.insertNode.run(node.id, ownerId, parentId, name, 'folder', 0, null, null, user.id, now, now);
    const saved = q.node.get(node.id);
    changed(saved, 'create');
    return saved;
  }

  // Busca (o crea) la ruta de carpetas "a/b/c" bajo parentId
  function ensureFolders(user, ownerId, parentId, parts) {
    let current = parentId;
    for (const part of parts) {
      const name = cleanName(part);
      const existing = q.childByName.get(ownerId, current, name);
      if (existing && existing.type === 'folder') current = existing.id;
      else current = createFolder(user, ownerId, current, existing ? uniqueName(ownerId, current, name) : name).id;
    }
    return current;
  }

  function releaseBlob(hash) {
    if (hash && q.hashRefs.get(hash).n === 0) blobs.remove(hash);
  }

  // Guarda un archivo subido. mode: 'rename' (conservar ambos) | 'replace'
  function saveFile(user, ownerId, parentId, name, mime, stored, mode = 'rename') {
    const now = Date.now();
    const existing = q.childByName.get(ownerId, parentId, name);
    if (existing && existing.type === 'file' && mode === 'replace') {
      const oldHash = existing.hash;
      db.prepare('UPDATE nodes SET size = ?, hash = ?, mime = ?, updated_at = ?, version = version + 1 WHERE id = ?')
        .run(stored.size, stored.hash, mime, now, existing.id);
      if (oldHash !== stored.hash) releaseBlob(oldHash);
      const saved = q.node.get(existing.id);
      changed(saved, 'update');
      return saved;
    }
    const finalName = existing ? uniqueName(ownerId, parentId, name) : name;
    const id = crypto.randomUUID();
    q.insertNode.run(id, ownerId, parentId, finalName, 'file', stored.size, mime, stored.hash, user.id, now, now);
    const saved = q.node.get(id);
    changed(saved, 'create');
    return saved;
  }

  function purge(node) {
    const all = [node, ...descendants(node, true)];
    const hashes = all.filter((n) => n.type === 'file').map((n) => n.hash);
    db.prepare('DELETE FROM nodes WHERE id = ?').run(node.id); // ON DELETE CASCADE elimina hijos
    for (const h of new Set(hashes)) releaseBlob(h);
    q.recordChange.run(node.owner_id, node.id, 'delete', Date.now());
    notify(node.owner_id, { type: 'change', action: 'delete', nodeId: node.id, parentId: node.parent_id });
  }

  function pathOf(node, rootId = null) {
    const parts = [];
    for (const a of ancestors(node)) {
      if (rootId && a.id === rootId) parts.length = 0;
      else parts.push(a.name);
    }
    return [...parts, node.name].join('/');
  }

  // ---------- Express ----------
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  });
  app.use('/api', express.json({ limit: '1mb' }));

  function parseCookies(header = '') {
    const out = {};
    for (const part of header.split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
    }
    return out;
  }

  function authenticate(req) {
    let token = null;
    let viaCookie = false;
    const h = req.headers.authorization;
    if (h && h.startsWith('Bearer ')) token = h.slice(7);
    else {
      token = parseCookies(req.headers.cookie).nuvora_session;
      viaCookie = !!token;
    }
    if (!token) return null;
    const s = q.session.get(token, Date.now());
    if (!s) return null;
    const user = q.userById.get(s.user_id);
    return user ? { user, token, viaCookie } : null;
  }

  const auth = (req, res, next) => {
    const a = authenticate(req);
    if (!a) return next(new HttpError(401, 'Inicia sesión para continuar'));
    // Protección CSRF: las peticiones con cookie que modifican datos deben llevar este encabezado
    if (a.viaCookie && req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-nuvora'] !== '1') {
      return next(new HttpError(403, 'Petición no permitida'));
    }
    req.user = a.user;
    req.token = a.token;
    next();
  };

  const wrap = (fn) => (req, res, next) => {
    try {
      const r = fn(req, res, next);
      if (r && typeof r.catch === 'function') r.catch(next);
    } catch (err) { next(err); }
  };

  function startSession(res, user, label = 'web') {
    const token = randomToken();
    const now = Date.now();
    q.insertSession.run(token, user.id, label, now, now + SESSION_TTL);
    if (label === 'web') {
      res.setHeader('Set-Cookie', `nuvora_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL / 1000}`);
    }
    return token;
  }

  function meResponse(user) {
    return { ...userSummary(user), google: !!user.google_sub, quota: user.quota, used: q.usage.get(user.id).used };
  }

  // ----- Autenticación -----
  app.post('/api/auth/register', wrap((req, res) => {
    const { name, email, password } = req.body || {};
    const mail = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(mail)) throw new HttpError(400, 'Correo electrónico no válido');
    if (String(password || '').length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres');
    const displayName = String(name || '').trim() || mail.split('@')[0];
    if (q.userByEmail.get(mail)) throw new HttpError(409, 'Ya existe una cuenta con ese correo');
    const id = crypto.randomUUID();
    q.insertUser.run(id, displayName.slice(0, 80), mail, hashPassword(password), defaultQuota,
      COLORS[crypto.randomInt(COLORS.length)], Date.now());
    const user = q.userById.get(id);
    const token = startSession(res, user, req.body.client || 'web');
    res.status(201).json({ user: meResponse(user), token });
  }));

  app.post('/api/auth/login', wrap((req, res) => {
    const { email, password } = req.body || {};
    const user = q.userByEmail.get(String(email || '').trim().toLowerCase());
    if (!user || !verifyPassword(String(password || ''), user.pass_hash)) {
      throw new HttpError(401, 'Correo o contraseña incorrectos');
    }
    const token = startSession(res, user, req.body.client || 'web');
    res.json({ user: meResponse(user), token });
  }));

  app.post('/api/auth/logout', auth, (req, res) => {
    q.deleteSession.run(req.token);
    res.setHeader('Set-Cookie', 'nuvora_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0');
    res.json({ ok: true });
  });

  app.get('/api/me', auth, (req, res) => res.json(meResponse(req.user)));

  // Lo que la web necesita saber antes de iniciar sesión
  // (la app de Android la usa también para encontrar el servidor en la wifi)
  app.get('/api/config', (req, res) => res.json({ nuvora: true, nombre: require('node:os').hostname(), googleClientId: google.clientId }));

  // ----- Iniciar sesión con Google (las mismas cuentas que Memories) -----
  app.post('/api/auth/google', wrap(async (req, res) => {
    let datos;
    try {
      datos = await google.verify(req.body && req.body.credential);
    } catch (err) {
      throw new HttpError(err.status || 401, err.message);
    }
    const mail = String(datos.email).toLowerCase();
    let user = db.prepare('SELECT * FROM users WHERE google_sub = ?').get(datos.sub) || q.userByEmail.get(mail);
    if (user) {
      // Una cuenta de correo y contraseña con el mismo correo queda unida a Google
      db.prepare('UPDATE users SET google_sub = ?, foto = COALESCE(?, foto) WHERE id = ?').run(datos.sub, datos.picture || null, user.id);
    } else {
      const id = crypto.randomUUID();
      q.insertUser.run(id, String(datos.name || mail.split('@')[0]).slice(0, 80), mail, hashPassword(randomToken()),
        defaultQuota, COLORS[crypto.randomInt(COLORS.length)], Date.now());
      db.prepare('UPDATE users SET google_sub = ?, foto = ? WHERE id = ?').run(datos.sub, datos.picture || null, id);
      user = { id };
    }
    user = q.userById.get(user.id);
    const token = startSession(res, user, (req.body && req.body.client) || 'web');
    res.json({ user: meResponse(user), token });
  }));

  // ----- Vincular un dispositivo con un código (como el ordenador en Memories) -----
  // El dispositivo nuevo pide un código, lo enseña y espera; desde otro donde ya
  // has entrado (por ejemplo el móvil con Google) escribes el código y queda dentro.
  const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  app.post('/api/vincular', wrap((req, res) => {
    db.prepare('DELETE FROM vinculos WHERE expires_at < ?').run(Date.now());
    const letras = Array.from({ length: 8 }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
    const codigo = `${letras.slice(0, 4)}-${letras.slice(4)}`;
    const secreto = randomToken(24);
    const cliente = String((req.body && req.body.client) || 'web').slice(0, 80);
    db.prepare('INSERT INTO vinculos (secreto, codigo, cliente, expires_at) VALUES (?, ?, ?, ?)')
      .run(secreto, codigo, cliente, Date.now() + 10 * 60 * 1000);
    res.status(201).json({ codigo, secreto, caduca: 600 });
  }));

  app.get('/api/vincular/:secreto', wrap((req, res) => {
    const v = db.prepare('SELECT * FROM vinculos WHERE secreto = ?').get(req.params.secreto);
    if (!v || v.expires_at < Date.now()) throw new HttpError(410, 'El código ha caducado. Pide uno nuevo.');
    if (!v.user_id) return res.json({ estado: 'esperando' });
    db.prepare('DELETE FROM vinculos WHERE secreto = ?').run(v.secreto);
    const user = q.userById.get(v.user_id);
    const token = startSession(res, user, v.cliente);
    res.json({ estado: 'listo', user: meResponse(user), token });
  }));

  app.post('/api/vincular/aprobar', auth, wrap((req, res) => {
    const codigo = String((req.body && req.body.codigo) || '').toUpperCase().replace(/[^A-Z]/g, '');
    const formateado = `${codigo.slice(0, 4)}-${codigo.slice(4)}`;
    const v = db.prepare('SELECT * FROM vinculos WHERE codigo = ? AND user_id IS NULL AND expires_at > ?').get(formateado, Date.now());
    if (codigo.length !== 8 || !v) throw new HttpError(404, 'Ese código no existe o ha caducado');
    db.prepare('UPDATE vinculos SET user_id = ? WHERE secreto = ?').run(req.user.id, v.secreto);
    res.json({ ok: true, dispositivo: v.cliente });
  }));

  // ----- Eventos en tiempo real -----
  app.get('/api/events', auth, (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 3000\n\n');
    const set = listeners.get(req.user.id) || new Set();
    set.add(res);
    listeners.set(req.user.id, set);
    const ping = setInterval(() => res.write(': ping\n\n'), 25000);
    req.on('close', () => { clearInterval(ping); set.delete(res); });
  });

  // ----- Listados -----
  function sortNodes(list) {
    return list.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name, 'es', { numeric: true }) : a.type === 'folder' ? -1 : 1));
  }

  app.get('/api/nodes', auth, wrap((req, res) => {
    const parent = req.query.parent && req.query.parent !== 'root' ? req.query.parent : null;
    let items, crumbs = [], role = 'owner', folder = null;
    if (parent) {
      ({ node: folder, role } = requireNode(req.user, parent));
      if (folder.type !== 'folder') throw new HttpError(400, 'No es una carpeta');
      if (folder.trashed_at) throw new HttpError(404, 'La carpeta está en la papelera');
      items = q.children.all(folder.owner_id, folder.id);
      const chain = [...ancestors(folder), folder];
      // Para elementos compartidos, la ruta empieza en el primer ancestro accesible
      crumbs = chain.filter((n) => roleFor(req.user, n)).map((n) => ({ id: n.id, name: n.name }));
    } else {
      items = q.children.all(req.user.id, null);
    }
    res.json({
      folder: folder && serialize(folder, req.user),
      role,
      breadcrumbs: crumbs,
      items: sortNodes(items).map((n) => serialize(n, req.user)),
    });
  }));

  app.get('/api/views/:view', auth, wrap((req, res) => {
    const uid = req.user.id;
    let rows;
    switch (req.params.view) {
      case 'recent':
        rows = db.prepare(`SELECT * FROM nodes WHERE trashed_at IS NULL AND type = 'file' AND
          (owner_id = ? OR id IN (SELECT node_id FROM shares WHERE user_id = ?)) ORDER BY updated_at DESC LIMIT 60`).all(uid, uid);
        break;
      case 'starred':
        rows = db.prepare('SELECT * FROM nodes WHERE owner_id = ? AND starred = 1 AND trashed_at IS NULL').all(uid);
        rows = sortNodes(rows);
        break;
      case 'trash':
        // Sólo los elementos enviados a la papelera directamente (no sus hijos)
        rows = db.prepare(`SELECT n.* FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
          WHERE n.owner_id = ? AND n.trashed_at IS NOT NULL AND (p.id IS NULL OR p.trashed_at IS NULL)
          ORDER BY n.trashed_at DESC`).all(uid);
        break;
      case 'shared':
        rows = db.prepare(`SELECT n.*, s.role AS share_role FROM shares s JOIN nodes n ON n.id = s.node_id
          WHERE s.user_id = ? AND n.trashed_at IS NULL ORDER BY s.created_at DESC`).all(uid);
        break;
      case 'shared-by-me':
        rows = db.prepare(`SELECT * FROM nodes WHERE owner_id = ? AND trashed_at IS NULL AND
          (id IN (SELECT node_id FROM shares) OR id IN (SELECT node_id FROM links))`).all(uid);
        rows = sortNodes(rows);
        break;
      default:
        throw new HttpError(404, 'Vista desconocida');
    }
    res.json({ items: rows.map((n) => serialize(n, req.user, n.share_role ? { role: n.share_role } : {})) });
  }));

  app.get('/api/search', auth, wrap((req, res) => {
    const term = String(req.query.q || '').trim();
    if (!term) return res.json({ items: [] });
    const like = `%${term.replace(/[%_\\]/g, (c) => '\\' + c)}%`;
    const uid = req.user.id;
    const own = db.prepare(`SELECT * FROM nodes WHERE owner_id = ? AND trashed_at IS NULL AND name LIKE ? ESCAPE '\\' LIMIT 100`).all(uid, like);
    const shared = db.prepare(`SELECT * FROM nodes WHERE owner_id != ? AND trashed_at IS NULL AND name LIKE ? ESCAPE '\\' LIMIT 300`)
      .all(uid, like).filter((n) => roleFor(req.user, n));
    res.json({ items: sortNodes([...own, ...shared]).slice(0, 100).map((n) => serialize(n, req.user, { path: pathOf(n) })) });
  }));

  app.get('/api/nodes/:id', auth, wrap((req, res) => {
    const { node, role } = requireNode(req.user, req.params.id);
    res.json({ ...serialize(node, req.user), role, path: pathOf(node) });
  }));

  // Todas las carpetas propias (para el diálogo "Mover a")
  app.get('/api/folders', auth, wrap((req, res) => {
    const rows = db.prepare(`SELECT id, name, parent_id FROM nodes WHERE owner_id = ? AND type = 'folder' AND trashed_at IS NULL`).all(req.user.id);
    res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, parentId: r.parent_id })) });
  }));

  // ----- Crear / modificar -----
  function targetFolder(user, parentId) {
    if (!parentId || parentId === 'root') return { ownerId: user.id, parentId: null };
    const { node } = requireNode(user, parentId, 'editor');
    if (node.type !== 'folder' || node.trashed_at) throw new HttpError(400, 'Carpeta de destino no válida');
    return { ownerId: node.owner_id, parentId: node.id };
  }

  app.post('/api/folders', auth, wrap((req, res) => {
    const { ownerId, parentId } = targetFolder(req.user, req.body.parentId);
    const name = uniqueName(ownerId, parentId, cleanName(req.body.name));
    const folder = createFolder(req.user, ownerId, parentId, name);
    res.status(201).json(serialize(folder, req.user));
  }));

  app.post('/api/upload', auth, (req, res, next) => {
    let target;
    try { target = targetFolder(req.user, req.query.parentId); } catch (err) { return next(err); }
    const mode = req.query.onConflict === 'replace' ? 'replace' : 'rename';
    const owner = q.userById.get(target.ownerId);
    const declared = Number(req.headers['content-length']) || 0;
    if (declared > owner.quota - q.usage.get(owner.id).used + 64 * 1024) {
      res.setHeader('Connection', 'close');
      return next(new HttpError(413, 'Espacio de almacenamiento insuficiente'));
    }
    let bb;
    try {
      bb = Busboy({ headers: req.headers, preservePath: true, defParamCharset: 'utf8', limits: { fieldSize: 1024 * 64 } });
    } catch {
      return next(new HttpError(400, 'Se esperaba un formulario multipart'));
    }
    const pending = [];
    const results = [];
    let failed = null;
    bb.on('file', (_field, stream, info) => {
      const job = (async () => {
        const parts = String(info.filename || 'archivo').split(/[\\/]/).filter((p) => p && p !== '.' && p !== '..');
        const name = cleanName(parts.pop() || 'archivo');
        const free = owner.quota - q.usage.get(owner.id).used;
        const stored = await blobs.write(stream, Math.max(free, 0));
        const parentId = parts.length ? ensureFolders(req.user, target.ownerId, target.parentId, parts) : target.parentId;
        const node = saveFile(req.user, target.ownerId, parentId, name, guessMime(name, info.mimeType), stored, mode);
        results.push(serialize(node, req.user));
      })().catch((err) => { failed = failed || err; if (!stream.destroyed) stream.resume(); });
      pending.push(job);
    });
    bb.on('error', (err) => { failed = failed || err; });
    bb.on('close', async () => {
      await Promise.all(pending);
      if (failed) return next(failed.status ? failed : new HttpError(400, failed.message));
      res.status(201).json({ items: results });
    });
    req.pipe(bb);
  });

  app.patch('/api/nodes/:id', auth, wrap((req, res) => {
    const body = req.body || {};
    let { node, role } = requireNode(req.user, req.params.id, 'viewer');
    const now = Date.now();
    if (body.starred !== undefined) {
      if (role !== 'owner') throw new HttpError(403, 'Sólo el propietario puede destacar elementos');
      db.prepare('UPDATE nodes SET starred = ? WHERE id = ?').run(body.starred ? 1 : 0, node.id);
    }
    if (body.name !== undefined) {
      if (role === 'viewer') throw new HttpError(403, 'No tienes permiso para cambiar el nombre');
      const name = cleanName(body.name);
      const clash = q.childByName.get(node.owner_id, node.parent_id, name);
      if (clash && clash.id !== node.id) throw new HttpError(409, 'Ya existe un elemento con ese nombre aquí');
      db.prepare('UPDATE nodes SET name = ?, updated_at = ? WHERE id = ?').run(name, now, node.id);
    }
    if (body.parentId !== undefined) {
      if (role !== 'owner') throw new HttpError(403, 'Sólo el propietario puede mover elementos');
      const dest = body.parentId && body.parentId !== 'root' ? requireNode(req.user, body.parentId, 'owner').node : null;
      if (dest) {
        if (dest.type !== 'folder' || dest.trashed_at) throw new HttpError(400, 'Destino no válido');
        if (dest.id === node.id || ancestors(dest).some((a) => a.id === node.id)) {
          throw new HttpError(400, 'No puedes mover una carpeta dentro de sí misma');
        }
      }
      const destId = dest ? dest.id : null;
      if (destId !== node.parent_id) {
        const name = uniqueName(node.owner_id, destId, q.node.get(node.id).name);
        db.prepare('UPDATE nodes SET parent_id = ?, name = ?, updated_at = ? WHERE id = ?').run(destId, name, now, node.id);
      }
    }
    node = q.node.get(node.id);
    changed(node, 'update');
    res.json(serialize(node, req.user));
  }));

  app.post('/api/nodes/:id/copy', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id, 'viewer');
    const { ownerId, parentId } = targetFolder(req.user, req.body.parentId ?? (node.owner_id === req.user.id ? node.parent_id : null));
    const owner = q.userById.get(ownerId);
    const total = node.type === 'file' ? node.size : descendants(node).reduce((s, n) => s + n.size, 0);
    if (q.usage.get(ownerId).used + total > owner.quota) throw new HttpError(413, 'Espacio de almacenamiento insuficiente');
    const copyTree = (src, destParent, name) => {
      const now = Date.now();
      const id = crypto.randomUUID();
      q.insertNode.run(id, ownerId, destParent, name, src.type, src.size, src.mime, src.hash, req.user.id, now, now);
      if (src.type === 'folder') {
        for (const child of q.childrenOf.all(src.id)) if (!child.trashed_at) copyTree(child, id, child.name);
      }
      return q.node.get(id);
    };
    const base = node.type === 'file' && path.extname(node.name)
      ? `${node.name.slice(0, -path.extname(node.name).length)} (copia)${path.extname(node.name)}` : `${node.name} (copia)`;
    const copy = copyTree(node, parentId, uniqueName(ownerId, parentId, base));
    changed(copy, 'create');
    res.status(201).json(serialize(copy, req.user));
  }));

  app.delete('/api/nodes/:id', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id, 'owner');
    if (req.query.permanent === '1') {
      purge(node);
    } else {
      db.prepare('UPDATE nodes SET trashed_at = ? WHERE id = ?').run(Date.now(), node.id);
      changed(node, 'trash');
    }
    res.json({ ok: true });
  }));

  app.post('/api/nodes/:id/restore', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id, 'owner');
    let parentId = node.parent_id;
    const parent = parentId && q.node.get(parentId);
    if (parent && (parent.trashed_at || ancestors(parent).some((a) => a.trashed_at))) parentId = null; // se restaura en la raíz
    const name = uniqueName(node.owner_id, parentId, node.name);
    db.prepare('UPDATE nodes SET trashed_at = NULL, parent_id = ?, name = ? WHERE id = ?').run(parentId, name, node.id);
    const restored = q.node.get(node.id);
    changed(restored, 'restore');
    res.json(serialize(restored, req.user));
  }));

  app.delete('/api/trash', auth, wrap((req, res) => {
    const rows = db.prepare(`SELECT n.* FROM nodes n LEFT JOIN nodes p ON p.id = n.parent_id
      WHERE n.owner_id = ? AND n.trashed_at IS NOT NULL AND (p.id IS NULL OR p.trashed_at IS NULL)`).all(req.user.id);
    for (const n of rows) purge(n);
    res.json({ ok: true, removed: rows.length });
  }));

  // ----- Contenido -----
  function sendContent(req, res, node) {
    if (node.type !== 'file') throw new HttpError(400, 'No es un archivo');
    const file = blobs.pathFor(node.hash);
    if (!fs.existsSync(file)) throw new HttpError(410, 'El contenido de este archivo no está disponible');
    const download = req.query.download === '1';
    let mime = node.mime || 'application/octet-stream';
    if (!download && UNSAFE_INLINE.test(mime)) mime = 'text/plain; charset=utf-8';
    else if (mime.startsWith('text/') || mime === 'application/json') mime += '; charset=utf-8';
    res.setHeader('Content-Type', mime);
    res.setHeader('Content-Disposition', contentDisposition(download ? 'attachment' : 'inline', node.name));
    res.setHeader('Cache-Control', 'private, max-age=0, must-revalidate');
    res.setHeader('ETag', `"${node.hash}"`);
    res.sendFile(file, { etag: false, lastModified: false });
  }

  function sendZip(res, root, user) {
    const entries = [];
    const walk = (folder, prefix) => {
      entries.push({ name: prefix, file: null, mtime: folder.updated_at });
      for (const child of sortNodes(q.children.all(folder.owner_id, folder.id))) {
        if (child.type === 'folder') walk(child, `${prefix}/${child.name}`);
        else entries.push({ name: `${prefix}/${child.name}`, file: blobs.pathFor(child.hash), mtime: child.updated_at });
      }
    };
    walk(root, root.name);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', contentDisposition('attachment', `${root.name}.zip`));
    streamZip(res, entries.filter((e) => !e.file || fs.existsSync(e.file))).catch(() => res.destroy());
  }

  app.get('/api/files/:id/content', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id);
    if (node.type === 'folder') return sendZip(res, node, req.user);
    sendContent(req, res, node);
  }));

  // ----- Compartir con usuarios -----
  app.get('/api/nodes/:id/shares', auth, wrap((req, res) => {
    const { node, role } = requireNode(req.user, req.params.id);
    const shares = db.prepare(`SELECT s.id, s.role, s.created_at, u.id AS uid, u.name, u.email, u.color
      FROM shares s JOIN users u ON u.id = s.user_id WHERE s.node_id = ? ORDER BY s.created_at`).all(node.id);
    const links = role === 'owner'
      ? db.prepare('SELECT * FROM links WHERE node_id = ? ORDER BY created_at DESC').all(node.id).map((l) => ({
        token: l.token, hasPassword: !!l.pass_hash, expiresAt: l.expires_at, allowDownload: !!l.allow_download,
        views: l.views, createdAt: l.created_at,
      }))
      : [];
    res.json({
      owner: userSummary(q.userById.get(node.owner_id)),
      shares: shares.map((s) => ({ id: s.id, role: s.role, user: { id: s.uid, name: s.name, email: s.email, color: s.color } })),
      links,
      canManage: role === 'owner',
    });
  }));

  app.post('/api/nodes/:id/shares', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id, 'owner');
    const role = req.body.role === 'editor' ? 'editor' : 'viewer';
    const target = q.userByEmail.get(String(req.body.email || '').trim().toLowerCase());
    if (!target) throw new HttpError(404, 'No hay ninguna cuenta de Nuvora con ese correo');
    if (target.id === node.owner_id) throw new HttpError(400, 'No puedes compartir contigo mismo');
    db.prepare(`INSERT INTO shares (id, node_id, user_id, role, created_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (node_id, user_id) DO UPDATE SET role = excluded.role`).run(crypto.randomUUID(), node.id, target.id, role, Date.now());
    changed(node, 'share');
    for (const r of listeners.get(target.id) || []) r.write(`data: ${JSON.stringify({ type: 'shared', nodeId: node.id, by: req.user.name, name: node.name })}\n\n`);
    res.status(201).json({ ok: true });
  }));

  app.delete('/api/shares/:id', auth, wrap((req, res) => {
    const share = db.prepare('SELECT * FROM shares WHERE id = ?').get(req.params.id);
    if (!share) throw new HttpError(404, 'No encontrado');
    const node = q.node.get(share.node_id);
    // El propietario puede quitar a cualquiera; un invitado puede salir por sí mismo
    if (node.owner_id !== req.user.id && share.user_id !== req.user.id) throw new HttpError(403, 'No tienes permiso');
    db.prepare('DELETE FROM shares WHERE id = ?').run(share.id);
    changed(node, 'share');
    res.json({ ok: true });
  }));

  // ----- Enlaces públicos -----
  app.post('/api/nodes/:id/links', auth, wrap((req, res) => {
    const { node } = requireNode(req.user, req.params.id, 'owner');
    const token = randomToken(12);
    const days = Number(req.body.expiresInDays) || 0;
    const pass = req.body.password ? String(req.body.password) : null;
    db.prepare('INSERT INTO links (token, node_id, created_by, pass_hash, expires_at, allow_download, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(token, node.id, req.user.id, pass ? hashPassword(pass) : null, days > 0 ? Date.now() + days * DAY : null,
        req.body.allowDownload === false ? 0 : 1, Date.now());
    changed(node, 'share');
    res.status(201).json({ token, url: `/s/${token}` });
  }));

  app.delete('/api/links/:token', auth, wrap((req, res) => {
    const link = q.link.get(req.params.token);
    if (!link) throw new HttpError(404, 'No encontrado');
    const node = q.node.get(link.node_id);
    if (node.owner_id !== req.user.id) throw new HttpError(403, 'No tienes permiso');
    db.prepare('DELETE FROM links WHERE token = ?').run(link.token);
    changed(node, 'share');
    res.json({ ok: true });
  }));

  const linkKey = (link) => crypto.createHmac('sha256', secret).update(`${link.token}:${link.pass_hash}`).digest('base64url');

  function openLink(req) {
    const link = q.link.get(req.params.token);
    if (!link) throw new HttpError(404, 'Este enlace no existe o se ha desactivado');
    if (link.expires_at && link.expires_at < Date.now()) throw new HttpError(410, 'Este enlace ha caducado');
    const root = q.node.get(link.node_id);
    if (!root || root.trashed_at) throw new HttpError(404, 'El archivo ya no está disponible');
    if (link.pass_hash) {
      const key = req.query.k || req.headers['x-link-key'];
      const keyOk = typeof key === 'string' && key.length > 0 &&
        crypto.timingSafeEqual(Buffer.from(crypto.createHash('sha256').update(key).digest()),
          Buffer.from(crypto.createHash('sha256').update(linkKey(link)).digest()));
      if (!keyOk) throw Object.assign(new HttpError(401, 'Este enlace está protegido con contraseña'), { needsPassword: true });
    }
    // Resuelve el elemento solicitado dentro del árbol compartido
    let node = root;
    if (req.query.node && req.query.node !== root.id) {
      node = q.node.get(req.query.node);
      if (!node || node.trashed_at || !ancestors(node).some((a) => a.id === root.id) || ancestors(node).some((a) => a.trashed_at)) {
        throw new HttpError(404, 'No encontrado');
      }
    }
    return { link, root, node };
  }

  function publicNode(n) {
    return { id: n.id, name: n.name, type: n.type, size: n.size, mime: n.mime, updatedAt: n.updated_at };
  }

  app.post('/api/public/:token/unlock', wrap((req, res) => {
    const link = q.link.get(req.params.token);
    if (!link) throw new HttpError(404, 'Este enlace no existe');
    if (!link.pass_hash || !verifyPassword(String(req.body.password || ''), link.pass_hash)) {
      throw new HttpError(401, 'Contraseña incorrecta');
    }
    res.json({ key: linkKey(link) });
  }));

  app.get('/api/public/:token', wrap((req, res) => {
    const { link, root, node } = openLink(req);
    if (node.id === root.id) db.prepare('UPDATE links SET views = views + 1 WHERE token = ?').run(link.token);
    const owner = q.userById.get(root.owner_id);
    const chain = ancestors(node);
    const crumbs = node.id === root.id ? [root] : [root, ...chain.slice(chain.findIndex((a) => a.id === root.id) + 1), node];
    res.json({
      owner: { name: owner.name, color: owner.color },
      allowDownload: !!link.allow_download,
      root: publicNode(root),
      node: publicNode(node),
      breadcrumbs: crumbs.map(publicNode),
      items: node.type === 'folder' ? sortNodes(q.children.all(node.owner_id, node.id)).map(publicNode) : [],
    });
  }));

  app.get('/api/public/:token/content', wrap((req, res) => {
    const { link, node } = openLink(req);
    if (req.query.download === '1' && !link.allow_download) throw new HttpError(403, 'La descarga está desactivada para este enlace');
    if (node.type === 'folder') {
      if (!link.allow_download) throw new HttpError(403, 'La descarga está desactivada para este enlace');
      return sendZip(res, node);
    }
    sendContent(req, res, node);
  }));

  // ----- API de sincronización (cliente de escritorio nuvora-sync) -----
  app.get('/api/sync/state', auth, wrap((req, res) => {
    const rows = db.prepare('SELECT * FROM nodes WHERE owner_id = ? AND trashed_at IS NULL').all(req.user.id);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const full = (n) => {
      const parts = [n.name];
      let cur = n;
      while (cur.parent_id) {
        cur = byId.get(cur.parent_id);
        if (!cur) return null; // ancestro en la papelera
        parts.unshift(cur.name);
      }
      return parts.join('/');
    };
    const items = [];
    for (const r of rows) {
      const p = full(r);
      if (p) items.push({ id: r.id, path: p, type: r.type, size: r.size, hash: r.hash, updatedAt: r.updated_at });
    }
    res.json({ cursor: q.lastSeq.get(req.user.id).seq, items });
  }));

  app.get('/api/sync/cursor', auth, (req, res) => res.json({ cursor: q.lastSeq.get(req.user.id).seq }));

  function splitSyncPath(p) {
    const parts = String(p || '').split('/').filter(Boolean);
    if (!parts.length || parts.some((x) => x === '.' || x === '..')) throw new HttpError(400, 'Ruta no válida');
    return parts.map(cleanName);
  }

  function resolvePath(user, parts) {
    let parent = null;
    let node = null;
    for (const part of parts) {
      node = q.childByName.get(user.id, parent, part);
      if (!node) return null;
      parent = node.id;
    }
    return node;
  }

  app.put('/api/sync/file', auth, wrap(async (req, res) => {
    const parts = splitSyncPath(req.query.path);
    const name = parts.pop();
    const free = req.user.quota - q.usage.get(req.user.id).used;
    const stored = await blobs.write(req, Math.max(free, 0));
    const parentId = ensureFolders(req.user, req.user.id, null, parts);
    const existing = q.childByName.get(req.user.id, parentId, name);
    if (existing && existing.type === 'folder') throw new HttpError(409, 'Ya existe una carpeta con ese nombre');
    if (existing && existing.hash === stored.hash) return res.json(serialize(existing, req.user));
    const node = saveFile(req.user, req.user.id, parentId, name, guessMime(name), stored, 'replace');
    res.json(serialize(node, req.user));
  }));

  app.post('/api/sync/mkdir', auth, wrap((req, res) => {
    const parts = splitSyncPath(req.body.path);
    const id = ensureFolders(req.user, req.user.id, null, parts);
    res.json(serialize(q.node.get(id), req.user));
  }));

  app.post('/api/sync/delete', auth, wrap((req, res) => {
    const node = resolvePath(req.user, splitSyncPath(req.body.path));
    if (node) {
      db.prepare('UPDATE nodes SET trashed_at = ? WHERE id = ?').run(Date.now(), node.id);
      changed(node, 'trash');
    }
    res.json({ ok: true });
  }));

  // ----- Archivos estáticos -----
  const pub = path.join(__dirname, '..', 'public');
  app.get('/s/:token', (req, res) => res.sendFile(path.join(pub, 'share.html')));
  app.use(express.static(pub, { index: 'index.html', maxAge: 0 }));

  app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return res.end();
    res.status(status).json({ error: status >= 500 ? 'Error interno del servidor' : err.message, needsPassword: err.needsPassword || undefined });
  });

  app.locals.db = db;
  return app;
}

module.exports = { createApp };
