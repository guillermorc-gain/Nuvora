#!/usr/bin/env node
/*
 * nuvora-sync — sincroniza en ambos sentidos una carpeta local con «Mi unidad».
 *
 *   nuvora-sync login --server http://localhost:3000 --email tu@correo.com
 *   nuvora-sync sync ~/Nuvora [--watch] [--sentido ambos|subir|bajar] [--borrar si|no] [--intervalo 10]
 *   nuvora-sync status ~/Nuvora
 *   nuvora-sync logout
 *
 * Funciona con una comparación a tres bandas: estado local actual, estado remoto
 * actual y el estado de la última sincronización (guardado en .nuvora-sync.json).
 *
 * Como en Memories para ordenador, se elige el sentido: en los dos, solo subir
 * (copia de seguridad) o solo bajar; y si los borrados viajan al otro lado.
 */
'use strict';
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const CONFIG_FILE = path.join(os.homedir(), '.nuvora', 'config.json');
const STATE_NAME = '.nuvora-sync.json';
const IGNORE = new Set([STATE_NAME, '.DS_Store', 'Thumbs.db', 'desktop.ini']);
const ignored = (name) => IGNORE.has(name) || name.startsWith('.~') || name.endsWith('.nuvora-part') || name.startsWith('~$');

// ---------- Utilidades ----------
function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) out[k] = true;
      else { out[k] = next; i++; }
    } else out._.push(a);
  }
  return out;
}

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch { return null; }
}

function saveConfig(cfg) {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

function log(...args) {
  const t = new Date().toLocaleTimeString('es');
  console.log(`[${t}]`, ...args);
}

function ask(question, hidden = false) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); else rl.output.write('*'); };
    }
    rl.question(question, (ans) => { rl.close(); if (hidden) process.stdout.write('\n'); resolve(ans.trim()); });
  });
}

class Client {
  constructor(server, token) { this.server = server.replace(/\/$/, ''); this.token = token; }

  async request(method, url, { json, body, raw } = {}) {
    const headers = { Authorization: `Bearer ${this.token}` };
    if (json) headers['Content-Type'] = 'application/json';
    if (body) headers['Content-Type'] = 'application/octet-stream';
    const res = await fetch(this.server + url, {
      method, headers, body: json ? JSON.stringify(json) : body, duplex: body ? 'half' : undefined,
    });
    if (raw && res.ok) return res;
    const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    if (!res.ok) throw new Error(`${method} ${url}: ${data?.error || res.status}`);
    return data;
  }
}

async function hashFile(file) {
  const h = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) h.update(chunk);
  return h.digest('hex');
}

// Escanea la carpeta local. Reutiliza el hash anterior si mtime y tamaño no cambiaron.
async function scanLocal(rootDir, previous) {
  const files = new Map();
  const dirs = new Set();
  async function walk(dir, rel) {
    let entries;
    try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (ignored(e.name)) continue;
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) { dirs.add(r); await walk(abs, r); }
      else if (e.isFile()) {
        const st = await fsp.stat(abs);
        const prev = previous[r];
        const hash = prev && prev.mtime === st.mtimeMs && prev.size === st.size && prev.localHash
          ? prev.localHash : await hashFile(abs);
        files.set(r, { hash, size: st.size, mtime: st.mtimeMs });
      }
    }
  }
  await walk(rootDir, '');
  return { files, dirs };
}

function conflictName(rel) {
  const ext = path.extname(rel);
  const base = ext ? rel.slice(0, -ext.length) : rel;
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.');
  return `${base} (conflicto ${os.hostname()} ${stamp})${ext}`;
}

// ---------- Motor de sincronización ----------
async function syncOnce(client, rootDir, opciones = {}) {
  const sentido = opciones.sentido || 'ambos';
  const up = sentido !== 'bajar';
  const down = sentido !== 'subir';
  const borrar = opciones.borrar !== false;
  const stateFile = path.join(rootDir, STATE_NAME);
  let saved = { files: {}, dirs: [] };
  try { saved = JSON.parse(await fsp.readFile(stateFile, 'utf8')); } catch { /* primera sincronización */ }
  const base = saved.files || {};
  const baseDirs = new Set(saved.dirs || []);

  const local = await scanLocal(rootDir, base);
  const remoteState = await client.request('GET', '/api/sync/state');
  const remote = new Map();
  const remoteDirs = new Set();
  for (const it of remoteState.items) {
    if (it.type === 'folder') remoteDirs.add(it.path);
    else remote.set(it.path, it);
  }

  const next = {};
  const stats = { up: 0, down: 0, delLocal: 0, delRemote: 0, conflicts: 0 };
  const absOf = (rel) => path.join(rootDir, ...rel.split('/'));

  const upload = async (rel) => {
    const res = await client.request('PUT', `/api/sync/file?path=${encodeURIComponent(rel)}`, {
      body: Readable.toWeb(fs.createReadStream(absOf(rel))),
    });
    stats.up++;
    log('↑', rel);
    return res.hash;
  };
  const downloadTo = async (item, rel) => {
    const abs = absOf(rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    const tmp = `${abs}.nuvora-part`;
    const res = await client.request('GET', `/api/files/${item.id}/content?download=1`, { raw: true });
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(tmp));
    await fsp.rename(tmp, abs);
    stats.down++;
    log('↓', rel);
  };
  // Guarda lo que se sabe de cada lado. Un hash null = ese lado no lo tiene (a propósito).
  const record = async (rel, remoteHash, localHash = remoteHash) => {
    const st = localHash ? await fsp.stat(absOf(rel)) : null;
    next[rel] = { remoteHash, localHash, size: st ? st.size : 0, mtime: st ? st.mtimeMs : 0 };
  };

  const paths = new Set([...local.files.keys(), ...remote.keys(), ...Object.keys(base)]);
  for (const rel of [...paths].sort()) {
    const l = local.files.get(rel);
    const r = remote.get(rel);
    const b = base[rel];
    try {
      if (l && r) {
        if (l.hash === r.hash) { await record(rel, r.hash); continue; }
        const localChanged = !b || l.hash !== b.localHash;
        const remoteChanged = !b || r.hash !== b.remoteHash;
        if (!localChanged && !remoteChanged) { next[rel] = b; continue; } // diferencia ya aceptada
        if (localChanged && !remoteChanged) {
          if (up) await record(rel, await upload(rel));
          else await record(rel, r.hash, l.hash);
        } else if (!localChanged && remoteChanged) {
          if (down) { await downloadTo(r, rel); await record(rel, r.hash); }
          else await record(rel, r.hash, l.hash);
        } else if (up && down) {
          // Conflicto: se conserva la versión remota y la local se guarda con otro nombre
          const alt = conflictName(rel);
          await fsp.rename(absOf(rel), absOf(alt));
          await downloadTo(r, rel);
          await record(rel, r.hash);
          await record(alt, await upload(alt));
          stats.conflicts++;
          log('⚠ conflicto:', rel, '→ copia local guardada como', path.basename(alt));
        } else if (up) {
          // Solo subir: la versión de Nuvora no se toca; la local sube con otro nombre
          const alt = conflictName(rel);
          await fsp.rename(absOf(rel), absOf(alt));
          await record(alt, await upload(alt));
          stats.conflicts++;
          log('⚠ conflicto:', rel, '→ subida como', path.basename(alt));
        } else {
          // Solo bajar: manda Nuvora; la copia local se aparta sin subirla
          const alt = conflictName(rel);
          await fsp.rename(absOf(rel), absOf(alt));
          await downloadTo(r, rel);
          await record(rel, r.hash);
          stats.conflicts++;
          log('⚠ conflicto:', rel, '→ copia local apartada como', path.basename(alt));
        }
      } else if (l && !r) {
        if (b && b.remoteHash && l.hash === b.localHash) {
          // Se borró en Nuvora y no cambió en local
          if (down && borrar) {
            await fsp.rm(absOf(rel), { force: true });
            stats.delLocal++;
            log('✕ local', rel);
          } else await record(rel, null, l.hash);
        } else if (b && !b.remoteHash && l.hash === b.localHash) {
          await record(rel, null, l.hash); // ya se decidió no subirlo / conservarlo
        } else if (up) {
          await record(rel, await upload(rel));
        } else {
          await record(rel, null, l.hash);
        }
      } else if (!l && r) {
        if (b && b.localHash && r.hash === b.remoteHash) {
          // Se borró en local y no cambió en Nuvora
          if (up && borrar) {
            await client.request('POST', '/api/sync/delete', { json: { path: rel } });
            stats.delRemote++;
            log('✕ nube', rel);
          } else await record(rel, r.hash, null);
        } else if (b && !b.localHash && r.hash === b.remoteHash) {
          await record(rel, r.hash, null);
        } else if (down) {
          await downloadTo(r, rel);
          await record(rel, r.hash);
        } else {
          await record(rel, r.hash, null);
        }
      }
      // !l && !r: borrado en ambos lados, nada que hacer
    } catch (err) {
      log('error con', rel, '-', err.message);
      if (b) next[rel] = b; // reintentar en la próxima pasada
    }
  }

  // Carpetas (incluidas las vacías)
  const nextDirs = new Set();
  const mkdirRemote = (d) => client.request('POST', '/api/sync/mkdir', { json: { path: d } });
  for (const d of [...new Set([...local.dirs, ...remoteDirs, ...baseDirs])].sort()) {
    const inL = local.dirs.has(d), inR = remoteDirs.has(d), inB = baseDirs.has(d);
    try {
      if (inL && inR) nextDirs.add(d);
      else if (inL && !inR) {
        const abs = absOf(d);
        const vacia = (await fsp.readdir(abs).catch(() => [])).filter((n) => !ignored(n)).length === 0;
        if (inB && down && borrar && vacia) { await fsp.rm(abs, { recursive: true, force: true }); log('✕ local', `${d}/`); }
        else if (up && !(inB && vacia)) { await mkdirRemote(d); nextDirs.add(d); }
        else if (inB) nextDirs.add(d);
      } else if (!inL && inR) {
        // Si en esta pasada se descargó algo dentro, la carpeta ya existe y no se borró
        if (fs.existsSync(absOf(d))) nextDirs.add(d);
        else if (inB && up && borrar) { await client.request('POST', '/api/sync/delete', { json: { path: d } }); log('✕ nube', `${d}/`); }
        else if (down && !inB) { await fsp.mkdir(absOf(d), { recursive: true }); nextDirs.add(d); }
        else if (inB) nextDirs.add(d);
      }
    } catch (err) { log('error con carpeta', d, '-', err.message); }
  }

  await fsp.writeFile(stateFile, JSON.stringify({ files: next, dirs: [...nextDirs].sort(), syncedAt: Date.now() }, null, 2));
  return stats;
}

// ---------- Comandos ----------
async function cmdLogin(args) {
  const server = args.server || (await ask('Servidor (p. ej. http://localhost:3000): '));
  const email = args.email || (await ask('Correo: '));
  const password = args.password || (await ask('Contraseña: ', true));
  const res = await fetch(`${server.replace(/\/$/, '')}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, client: `nuvora-sync@${os.hostname()}` }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'No se pudo iniciar sesión');
  saveConfig({ server, token: data.token, email: data.user.email });
  console.log(`✓ Sesión iniciada como ${data.user.name} <${data.user.email}>`);
}

function requireClient() {
  const cfg = loadConfig();
  if (!cfg) throw new Error('Primero inicia sesión: nuvora-sync login --server URL --email CORREO');
  return new Client(cfg.server, cfg.token);
}

async function cmdSync(args) {
  const client = requireClient();
  const dir = path.resolve(args._[1] || path.join(os.homedir(), 'Nuvora'));
  await fsp.mkdir(dir, { recursive: true });
  const interval = Math.max(2, Number(args.intervalo || args.interval) || 10) * 1000;
  const sentido = ['ambos', 'subir', 'bajar'].includes(args.sentido) ? args.sentido : 'ambos';
  const borrar = !['no', 'false', '0'].includes(String(args.borrar ?? 'si').toLowerCase());
  const opciones = { sentido, borrar };
  const nombres = { ambos: 'en los dos sentidos', subir: 'del ordenador a Nuvora', bajar: 'de Nuvora al ordenador' };
  log(`Sincronizando ${dir} ${nombres[sentido]}${borrar ? '' : ', sin llevar los borrados'}`);
  const run = async () => {
    const s = await syncOnce(client, dir, opciones);
    const total = s.up + s.down + s.delLocal + s.delRemote;
    if (total || !args.watch) {
      log(`✓ ${dir} sincronizada — ${s.up} subidos, ${s.down} descargados, ${s.delLocal + s.delRemote} eliminados${s.conflicts ? `, ${s.conflicts} conflictos` : ''}`);
    }
  };
  await run();
  if (!args.watch) return;
  log(`Vigilando cambios (cada ${interval / 1000}s y al modificar archivos). Ctrl+C para salir.`);
  let running = false, again = false, lastCursor = null, timer = null;
  const tick = async (force) => {
    if (running) { again = true; return; }
    running = true;
    try {
      const { cursor } = await client.request('GET', '/api/sync/cursor');
      if (force || cursor !== lastCursor) await run();
      lastCursor = (await client.request('GET', '/api/sync/cursor')).cursor;
    } catch (err) { log('sin conexión:', err.message); }
    running = false;
    if (again) { again = false; tick(true); }
  };
  lastCursor = (await client.request('GET', '/api/sync/cursor')).cursor;
  setInterval(() => tick(false), interval);
  try {
    fs.watch(dir, { recursive: true }, (_ev, file) => {
      if (file && ignored(path.basename(file))) return;
      clearTimeout(timer);
      timer = setTimeout(() => tick(true), 800);
    });
  } catch { /* fs.watch recursivo no disponible: sólo sondeo */ }
}

async function cmdStatus(args) {
  const dir = path.resolve(args._[1] || path.join(os.homedir(), 'Nuvora'));
  const cfg = loadConfig();
  console.log(cfg ? `Cuenta: ${cfg.email} en ${cfg.server}` : 'Sin sesión iniciada');
  try {
    const s = JSON.parse(fs.readFileSync(path.join(dir, STATE_NAME), 'utf8'));
    console.log(`Carpeta: ${dir}\nArchivos sincronizados: ${Object.keys(s.files).length}\nÚltima sincronización: ${new Date(s.syncedAt).toLocaleString('es')}`);
  } catch { console.log(`La carpeta ${dir} aún no se ha sincronizado`); }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (cmd === 'login') return cmdLogin(args);
  if (cmd === 'sync') return cmdSync(args);
  if (cmd === 'status') return cmdStatus(args);
  if (cmd === 'logout') { fs.rmSync(CONFIG_FILE, { force: true }); return console.log('Sesión cerrada'); }
  console.log(`nuvora-sync — sincroniza una carpeta con Nuvora

Uso:
  nuvora-sync login  --server URL --email CORREO   Inicia sesión
  nuvora-sync sync   [CARPETA] [opciones]          Sincroniza (por defecto ~/Nuvora)
      --watch                      Sigue vigilando los cambios
      --sentido ambos|subir|bajar  En los dos sentidos (por defecto), solo subir o solo bajar
      --borrar si|no               Llevar los borrados al otro lado (por defecto sí, a la papelera)
      --intervalo S                Cada cuántos segundos mirar si hay cambios en Nuvora (10)
  nuvora-sync status [CARPETA]                     Muestra el estado
  nuvora-sync logout                               Cierra la sesión`);
}

if (require.main === module) {
  main().catch((err) => { console.error('✕', err.message); process.exit(1); });
}

module.exports = { syncOnce, Client };
