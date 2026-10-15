'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApp } = require('../server/app');
const { syncOnce, Client } = require('../sync/nuvora-sync');

let server, base, tmp;

test.before(async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'nuvora-test-'));
  const app = createApp({ dataDir: path.join(tmp, 'data'), quota: 5 * 1024 * 1024 });
  await new Promise((r) => { server = app.listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  server.closeAllConnections();
  server.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function call(token, method, url, body) {
  const res = await fetch(base + url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, headers: res.headers, body: ct.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
}

async function register(name) {
  const res = await fetch(`${base}/api/auth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, email: `${name}@ejemplo.com`, password: 'contraseña-segura', client: 'test' }),
  });
  assert.equal(res.status, 201);
  return (await res.json()).token;
}

async function upload(token, files, parentId) {
  const fd = new FormData();
  for (const [name, content, type] of files) fd.append('file', new Blob([content], { type: type || 'text/plain' }), name);
  const res = await fetch(`${base}/api/upload${parentId ? `?parentId=${parentId}` : ''}`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: fd,
  });
  return { status: res.status, body: await res.json() };
}

let ana, beto;

test('registro, inicio de sesión y protección CSRF', async () => {
  ana = await register('ana');
  beto = await register('beto');
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'ANA@ejemplo.com', password: 'contraseña-segura' }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const noHeader = await fetch(`${base}/api/folders`, { method: 'POST', headers: { Cookie: cookie, 'Content-Type': 'application/json' }, body: '{"name":"x"}' });
  assert.equal(noHeader.status, 403);
  const bad = await fetch(`${base}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'ana@ejemplo.com', password: 'mal' }),
  });
  assert.equal(bad.status, 401);
});

test('carpetas, subidas, renombrar, mover, papelera', async () => {
  const folder = (await call(ana, 'POST', '/api/folders', { name: 'Fotos' })).body;
  const up = await upload(ana, [['hola.txt', 'hola mundo'], ['viaje/playa.txt', 'arena']], folder.id);
  assert.equal(up.status, 201);
  assert.equal(up.body.items.length, 2);
  const list = (await call(ana, 'GET', `/api/nodes?parent=${folder.id}`)).body;
  assert.deepEqual(list.items.map((i) => i.name), ['viaje', 'hola.txt']);

  // Nombre repetido → se conservan ambos
  const dup = await upload(ana, [['hola.txt', 'otra']], folder.id);
  assert.equal(dup.body.items[0].name, 'hola (1).txt');

  const file = list.items[1];
  const ren = await call(ana, 'PATCH', `/api/nodes/${file.id}`, { name: 'saludo.txt' });
  assert.equal(ren.body.name, 'saludo.txt');
  const moved = await call(ana, 'PATCH', `/api/nodes/${file.id}`, { parentId: 'root' });
  assert.equal(moved.body.parentId, null);
  const loop = await call(ana, 'PATCH', `/api/nodes/${folder.id}`, { parentId: list.items[0].id });
  assert.equal(loop.status, 400);

  await call(ana, 'DELETE', `/api/nodes/${folder.id}`);
  const trash = (await call(ana, 'GET', '/api/views/trash')).body.items;
  assert.equal(trash.length, 1);
  assert.equal((await call(ana, 'GET', '/api/nodes?parent=root')).body.items.length, 1);
  await call(ana, 'POST', `/api/nodes/${folder.id}/restore`);
  assert.equal((await call(ana, 'GET', '/api/nodes?parent=root')).body.items.length, 2);

  const search = (await call(ana, 'GET', '/api/search?q=playa')).body.items;
  assert.equal(search[0].path, 'Fotos/viaje/playa.txt');
});

test('descarga con rangos (streaming de video) y ZIP de carpeta', async () => {
  const up = await upload(ana, [['clip.mp4', Buffer.alloc(1000, 7), 'video/mp4']]);
  const id = up.body.items[0].id;
  const res = await fetch(`${base}/api/files/${id}/content`, { headers: { Authorization: `Bearer ${ana}`, Range: 'bytes=100-199' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal((await res.arrayBuffer()).byteLength, 100);

  const html = await upload(ana, [['malo.html', '<script>alert(1)</script>', 'text/html']]);
  const inline = await fetch(`${base}/api/files/${html.body.items[0].id}/content`, { headers: { Authorization: `Bearer ${ana}` } });
  assert.match(inline.headers.get('content-type'), /^text\/plain/);

  const fotos = (await call(ana, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.name === 'Fotos');
  const zip = await call(ana, 'GET', `/api/files/${fotos.id}/content?download=1`);
  assert.equal(zip.headers.get('content-type'), 'application/zip');
  assert.equal(zip.body.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.body.includes(Buffer.from('Fotos/viaje/playa.txt')));
});

test('compartir con otro usuario y permisos', async () => {
  const fotos = (await call(ana, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.name === 'Fotos');
  assert.equal((await call(beto, 'GET', `/api/nodes?parent=${fotos.id}`)).status, 404);
  assert.equal((await call(ana, 'POST', `/api/nodes/${fotos.id}/shares`, { email: 'nadie@x.com' })).status, 404);
  await call(ana, 'POST', `/api/nodes/${fotos.id}/shares`, { email: 'beto@ejemplo.com', role: 'viewer' });

  const shared = (await call(beto, 'GET', '/api/views/shared')).body.items;
  assert.equal(shared[0].name, 'Fotos');
  assert.equal(shared[0].owner.name, 'ana');
  const inside = (await call(beto, 'GET', `/api/nodes?parent=${fotos.id}`)).body;
  assert.equal(inside.role, 'viewer');
  assert.equal((await upload(beto, [['x.txt', 'x']], fotos.id)).status, 403);

  await call(ana, 'POST', `/api/nodes/${fotos.id}/shares`, { email: 'beto@ejemplo.com', role: 'editor' });
  const up = await upload(beto, [['de-beto.txt', 'hola ana']], fotos.id);
  assert.equal(up.status, 201);
  const sub = inside.items.find((i) => i.name === 'viaje');
  assert.equal((await call(beto, 'GET', `/api/nodes?parent=${sub.id}`)).body.role, 'editor');
  assert.equal((await call(beto, 'DELETE', `/api/nodes/${fotos.id}`)).status, 403);
});

test('enlaces públicos con contraseña y caducidad', async () => {
  const fotos = (await call(ana, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.name === 'Fotos');
  const open = (await call(ana, 'POST', `/api/nodes/${fotos.id}/links`, {})).body;
  const pub = await (await fetch(`${base}/api/public/${open.token}`)).json();
  assert.equal(pub.node.name, 'Fotos');
  const viaje = pub.items.find((i) => i.name === 'viaje');
  const deeper = await (await fetch(`${base}/api/public/${open.token}?node=${viaje.id}`)).json();
  assert.deepEqual(deeper.breadcrumbs.map((b) => b.name), ['Fotos', 'viaje']);
  const file = deeper.items[0];
  const content = await fetch(`${base}/api/public/${open.token}/content?node=${file.id}`);
  assert.equal(await content.text(), 'arena');

  // Un elemento ajeno al enlace no es accesible
  const other = (await call(ana, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.type === 'file');
  assert.equal((await fetch(`${base}/api/public/${open.token}/content?node=${other.id}`)).status, 404);

  const locked = (await call(ana, 'POST', `/api/nodes/${fotos.id}/links`, { password: 'secreto', allowDownload: false })).body;
  const denied = await fetch(`${base}/api/public/${locked.token}`);
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).needsPassword, true);
  const wrong = await fetch(`${base}/api/public/${locked.token}/unlock`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"no"}' });
  assert.equal(wrong.status, 401);
  const { key } = await (await fetch(`${base}/api/public/${locked.token}/unlock`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"secreto"}',
  })).json();
  assert.equal((await fetch(`${base}/api/public/${locked.token}?k=${key}`)).status, 200);
  assert.equal((await fetch(`${base}/api/public/${locked.token}/content?k=${key}&download=1`)).status, 403);

  await call(ana, 'DELETE', `/api/links/${open.token}`);
  assert.equal((await fetch(`${base}/api/public/${open.token}`)).status, 404);
});

test('cuota de almacenamiento', async () => {
  const big = await upload(ana, [['enorme.bin', Buffer.alloc(6 * 1024 * 1024), 'application/octet-stream']]);
  assert.equal(big.status, 413);
});

test('cliente de sincronización bidireccional', async () => {
  const carla = await register('carla');
  const client = new Client(base, carla);
  const dirA = fs.mkdtempSync(path.join(tmp, 'pc-a-'));
  const dirB = fs.mkdtempSync(path.join(tmp, 'pc-b-'));
  fs.mkdirSync(path.join(dirA, 'docs/vacia'), { recursive: true });
  fs.writeFileSync(path.join(dirA, 'docs/nota.txt'), 'v1');
  fs.writeFileSync(path.join(dirA, 'raiz.txt'), 'raíz');

  let s = await syncOnce(client, dirA);
  assert.equal(s.up, 2);
  s = await syncOnce(client, dirB);
  assert.equal(s.down, 2);
  assert.equal(fs.readFileSync(path.join(dirB, 'docs/nota.txt'), 'utf8'), 'v1');
  assert.ok(fs.existsSync(path.join(dirB, 'docs/vacia')));

  // Modificar en B → llega a A
  fs.writeFileSync(path.join(dirB, 'docs/nota.txt'), 'v2 desde B');
  await syncOnce(client, dirB);
  await syncOnce(client, dirA);
  assert.equal(fs.readFileSync(path.join(dirA, 'docs/nota.txt'), 'utf8'), 'v2 desde B');

  // Borrar en A → se borra en la nube y en B
  fs.rmSync(path.join(dirA, 'raiz.txt'));
  s = await syncOnce(client, dirA);
  assert.equal(s.delRemote, 1);
  s = await syncOnce(client, dirB);
  assert.equal(s.delLocal, 1);
  assert.ok(!fs.existsSync(path.join(dirB, 'raiz.txt')));

  // Conflicto: ambos cambian el mismo archivo
  fs.writeFileSync(path.join(dirA, 'docs/nota.txt'), 'versión A');
  fs.writeFileSync(path.join(dirB, 'docs/nota.txt'), 'versión B');
  await syncOnce(client, dirA);
  s = await syncOnce(client, dirB);
  assert.equal(s.conflicts, 1);
  assert.equal(fs.readFileSync(path.join(dirB, 'docs/nota.txt'), 'utf8'), 'versión A');
  const copies = fs.readdirSync(path.join(dirB, 'docs')).filter((n) => n.includes('conflicto'));
  assert.equal(copies.length, 1);
  await syncOnce(client, dirA);
  assert.ok(fs.readdirSync(path.join(dirA, 'docs')).some((n) => n.includes('conflicto')));

  // Cambio desde la web → llega por sync
  const docs = (await call(carla, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.name === 'docs');
  await upload(carla, [['web.txt', 'subido desde la web']], docs.id);
  await syncOnce(client, dirA);
  assert.equal(fs.readFileSync(path.join(dirA, 'docs/web.txt'), 'utf8'), 'subido desde la web');
});

test('sincronización solo subir y sin llevar los borrados', async () => {
  const dani = await register('dani');
  const client = new Client(base, dani);
  const pc = fs.mkdtempSync(path.join(tmp, 'pc-copia-'));
  fs.writeFileSync(path.join(pc, 'foto.jpg'), 'original');
  let s = await syncOnce(client, pc, { sentido: 'subir' });
  assert.equal(s.up, 1);

  // Algo subido desde la web no baja al ordenador
  await upload(dani, [['solo-nube.txt', 'web']]);
  s = await syncOnce(client, pc, { sentido: 'subir' });
  assert.equal(s.down, 0);
  assert.ok(!fs.existsSync(path.join(pc, 'solo-nube.txt')));

  // Un cambio en la nube tampoco pisa el archivo local
  const foto = (await call(dani, 'GET', '/api/nodes?parent=root')).body.items.find((i) => i.name === 'foto.jpg');
  await fetch(`${base}/api/sync/file?path=foto.jpg`, { method: 'PUT', headers: { Authorization: `Bearer ${dani}` }, body: 'cambiada en la nube' });
  await syncOnce(client, pc, { sentido: 'subir' });
  assert.equal(fs.readFileSync(path.join(pc, 'foto.jpg'), 'utf8'), 'original');

  // Borrar en local sin llevar los borrados: sigue en Nuvora
  fs.rmSync(path.join(pc, 'foto.jpg'));
  s = await syncOnce(client, pc, { sentido: 'subir', borrar: false });
  assert.equal(s.delRemote, 0);
  assert.ok((await call(dani, 'GET', '/api/nodes?parent=root')).body.items.some((i) => i.id === foto.id));
  s = await syncOnce(client, pc, { sentido: 'subir', borrar: false });
  assert.equal(s.up + s.down + s.delRemote, 0);

  // Solo bajar: trae lo de la nube y lo nuevo en local no sube
  const otro = fs.mkdtempSync(path.join(tmp, 'pc-bajar-'));
  fs.writeFileSync(path.join(otro, 'local.txt'), 'no sube');
  s = await syncOnce(client, otro, { sentido: 'bajar' });
  assert.equal(s.up, 0);
  assert.equal(s.down, 2);
  assert.equal(fs.readFileSync(path.join(otro, 'foto.jpg'), 'utf8'), 'cambiada en la nube');
  assert.ok(fs.existsSync(path.join(otro, 'local.txt')));
});

test('iniciar sesión con Google y vincular otro dispositivo con un código', async () => {
  const crypto = require('node:crypto');
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'clave-prueba', alg: 'RS256', use: 'sig' };
  const firmar = (payload, kid = 'clave-prueba') => {
    const h = Buffer.from(JSON.stringify({ alg: 'RS256', kid })).toString('base64url');
    const p = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${h}.${p}`), privateKey).toString('base64url');
    return `${h}.${p}.${sig}`;
  };
  const app = createApp({
    dataDir: path.join(tmp, 'data-google'),
    google: { clientIds: ['cliente-prueba'], fetchKeys: async () => ({ keys: [jwk] }) },
  });
  let srv;
  await new Promise((r) => { srv = app.listen(0, '127.0.0.1', r); });
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (ruta, body, token) => fetch(url + ruta, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  try {
    const ahora = Math.floor(Date.now() / 1000);
    const base = { iss: 'https://accounts.google.com', aud: 'cliente-prueba', sub: 'g-123', email: 'Eva@Gmail.com',
      email_verified: true, name: 'Eva', picture: 'https://foto/eva.jpg', exp: ahora + 600, iat: ahora };

    assert.equal((await (await fetch(`${url}/api/config`)).json()).googleClientId, 'cliente-prueba');

    // Token válido: crea la cuenta con su nombre y foto
    let r = await post('/api/auth/google', { credential: firmar(base), client: 'android' });
    assert.equal(r.status, 200);
    const eva = await r.json();
    assert.equal(eva.user.email, 'eva@gmail.com');
    assert.equal(eva.user.foto, 'https://foto/eva.jpg');
    assert.equal(eva.user.google, true);

    // La segunda vez entra en la misma cuenta
    r = await post('/api/auth/google', { credential: firmar(base) });
    assert.equal((await r.json()).user.id, eva.user.id);
    assert.match(r.headers.get('set-cookie'), /nuvora_session=/);

    // Tokens que no valen
    for (const malo of [
      firmar({ ...base, aud: 'otra-app' }),
      firmar({ ...base, exp: ahora - 3600 }),
      firmar({ ...base, iss: 'https://evil.example' }),
      firmar({ ...base, email_verified: false }),
      firmar(base, 'clave-desconocida'),
      firmar(base).slice(0, -4) + 'AAAA',
    ]) {
      assert.equal((await post('/api/auth/google', { credential: malo })).status, 401);
    }

    // Una cuenta de correo y contraseña con el mismo correo se une a Google
    await post('/api/auth/register', { name: 'Fede', email: 'fede@gmail.com', password: 'contraseña-larga', client: 't' });
    const fede = await (await post('/api/auth/google', { credential: firmar({ ...base, sub: 'g-456', email: 'fede@gmail.com', name: 'Fede G' }) })).json();
    assert.equal(fede.user.name, 'Fede');
    assert.equal(fede.user.google, true);

    // Vincular: el ordenador pide un código, el móvil (con Google) lo aprueba
    const { codigo, secreto } = await (await post('/api/vincular', { client: 'nuvora-sync@pc' })).json();
    assert.match(codigo, /^[A-Z]{4}-[A-Z]{4}$/);
    assert.equal((await (await fetch(`${url}/api/vincular/${secreto}`)).json()).estado, 'esperando');
    assert.equal((await post('/api/vincular/aprobar', { codigo: 'ZZZZ-ZZZZ' }, eva.token)).status, 404);
    assert.equal((await post('/api/vincular/aprobar', { codigo: codigo.toLowerCase().replace('-', ' ') }, eva.token)).status, 200);
    const listo = await (await fetch(`${url}/api/vincular/${secreto}`)).json();
    assert.equal(listo.estado, 'listo');
    assert.equal(listo.user.id, eva.user.id);
    const yo = await (await fetch(`${url}/api/me`, { headers: { Authorization: `Bearer ${listo.token}` } })).json();
    assert.equal(yo.email, 'eva@gmail.com');
    // El código solo sirve una vez
    assert.equal((await fetch(`${url}/api/vincular/${secreto}`)).status, 410);
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});
