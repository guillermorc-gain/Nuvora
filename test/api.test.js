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
