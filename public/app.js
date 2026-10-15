/* Nuvora — cliente web */
'use strict';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  me: null,
  view: 'drive',
  folderId: null,
  folder: null,
  role: 'owner',
  items: [],
  selected: new Set(),
  anchor: null,
  layout: 'grid',
  query: '',
};
try { state.layout = localStorage.getItem('nuvora-layout') || 'grid'; } catch { /* sin almacenamiento */ }

const VIEW_SUBTITLES = {
  drive: 'Tus archivos y carpetas',
  'shared-by-me': 'Personas invitadas y enlaces públicos', recent: 'Lo último que subiste o cambiaste',
  starred: 'Lo que quieres tener a mano', trash: 'Se puede restaurar hasta que la vacíes',
  sync: 'Una carpeta de tu ordenador, siempre al día',
  shared: 'Tus amigos y lo que comparten contigo',
};

const VIEW_TITLES = {
  drive: 'Mi unidad', shared: 'Compartido conmigo', 'shared-by-me': 'Compartido por mí',
  recent: 'Recientes', starred: 'Destacados', trash: 'Papelera', search: 'Resultados de búsqueda', sync: 'Sincronización',
  amigo: 'Amigo',
};

// ---------- API ----------
async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    credentials: 'same-origin',
    headers: { 'X-Nuvora': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (res.status === 401 && !url.startsWith('/api/auth')) { showAuth(); throw new Error('Sesión caducada'); }
  if (!res.ok) throw new Error(data?.error || `Error ${res.status}`);
  return data;
}

async function attempt(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(okMsg);
    return r;
  } catch (err) {
    toast(err.message, 'error');
    return undefined;
  }
}

const contentUrl = (item, download) => `/api/files/${item.id}/content${download ? '?download=1' : ''}`;

// ---------- Iconos estáticos ----------
for (const el of $$('[data-icon]')) el.innerHTML = icon(el.dataset.icon);

// ---------- Acceso ----------
let authMode = 'login';
function showAuth() {
  $('#app').classList.add('hidden');
  $('#auth').classList.remove('hidden');
  prepararGoogle();
}

function authError(msg) {
  const box = $('#auth-error');
  box.textContent = msg;
  box.classList.toggle('hidden', !msg);
}

function entrar(user) {
  // Si ya había una sesión abierta en esta página (otra cuenta), se empieza de cero
  if (started) { location.hash = ''; location.reload(); return; }
  state.me = user;
  startApp();
}

// ---------- Iniciar sesión con Google ----------
const G_LOGO = '<svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.5 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z"/><path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.8 6C6.6 42.6 14.6 48 24 48z"/></svg>';

async function loginGoogle(credential) {
  authError('');
  try {
    const data = await api('POST', '/api/auth/google', { credential });
    entrar(data.user);
  } catch (err) {
    authError(err.message);
  }
}
// La app de Android entrega aquí el token del inicio de sesión nativo de Google
window.nuvoraGoogleToken = loginGoogle;
window.nuvoraGoogleError = (msg) => { if (msg) authError(msg); };

let googleListo = false;
async function prepararGoogle() {
  if (googleListo) return;
  googleListo = true;
  const slot = $('#google-slot');
  const enApp = window.NuvoraApp && typeof window.NuvoraApp.iniciarConGoogle === 'function';
  if (enApp) {
    // Dentro de la APK: el inicio de sesión de Google de Android (la web de Google no deja hacerlo en una WebView)
    slot.innerHTML = `<button type="button" class="btn wide google">${G_LOGO} Continuar con Google</button>`;
    slot.firstChild.onclick = () => { authError(''); window.NuvoraApp.iniciarConGoogle(); };
    // Si ya se eligió la cuenta de Google en la bienvenida de la app, se entra directamente
    const pendiente = typeof window.NuvoraApp.tokenPendiente === 'function' ? window.NuvoraApp.tokenPendiente() : '';
    if (pendiente) loginGoogle(pendiente);
    return;
  }
  if (window.NuvoraMac) {
    // En la app de Mac: Google no deja entrar dentro de una ventana de app, así que se
    // termina en el navegador, que aprueba un código de vinculación para esta ventana.
    slot.innerHTML = `<button type="button" class="btn wide google">${G_LOGO} Continuar con Google</button>`;
    slot.firstChild.onclick = async () => {
      authError('');
      let data;
      try { data = await api('POST', '/api/vincular', { client: 'web' }); } catch (err) { authError(err.message); return; }
      window.NuvoraMac.abrirNavegador(`${location.origin}/#/vincular/${data.codigo}`);
      esperarVinculo(data, 'Continuar con Google',
        `<p>Se ha abierto tu navegador: entra allí con tu cuenta de Google y pulsa <b>Vincular</b>. Esta ventana entrará sola.</p>
         <p class="esperando"><i></i> Esperando al navegador…</p>`);
    };
    return;
  }
  let cfg;
  try { cfg = await api('GET', '/api/config'); } catch { return; }
  if (!cfg.googleClientId) return;
  const script = document.createElement('script');
  script.src = 'https://accounts.google.com/gsi/client';
  script.async = true;
  script.onload = () => {
    try {
      google.accounts.id.initialize({ client_id: cfg.googleClientId, callback: (r) => loginGoogle(r.credential), ux_mode: 'popup' });
      google.accounts.id.renderButton(slot, {
        theme: 'outline', size: 'large', text: 'continue_with', shape: 'pill', locale: 'es',
        width: Math.min(400, $('#vincular-btn').offsetWidth || 300),
      });
    } catch { /* Google no disponible: quedan las otras formas de entrar */ }
  };
  document.head.appendChild(script);
}

// ---------- Entrar con otro dispositivo (código de vinculación) ----------
$('#vincular-btn').addEventListener('click', async () => {
  let data;
  try { data = await api('POST', '/api/vincular', { client: 'web' }); } catch (err) { authError(err.message); return; }
  esperarVinculo(data, 'Entrar con otro dispositivo',
    `<p>En el móvil o en otro ordenador donde ya hayas entrado en Nuvora, toca tu <b>foto de perfil → Vincular un dispositivo</b> y escribe este código:</p>
      <div class="codigo">${esc(data.codigo)}</div>
      <p class="esperando"><i></i> Esperando… El código caduca en 10 minutos.</p>`);
});

// Espera a que otro dispositivo apruebe el código y entra con esa cuenta
function esperarVinculo(data, titulo, body) {
  let activo = true;
  const m = openModal({ title: titulo, body, actions: [{ label: 'Cancelar' }], onClose: () => { activo = false; } });
  const comprobar = async () => {
    if (!activo) return;
    try {
      const r = await api('GET', `/api/vincular/${data.secreto}`);
      if (r.estado === 'listo') { activo = false; m.close(); entrar(r.user); return; }
    } catch (err) {
      activo = false; m.close(); authError(err.message); return;
    }
    setTimeout(comprobar, 2000);
  };
  setTimeout(comprobar, 2000);
}

function vincularDialog(codigo = '') {
  const m = openModal({
    title: 'Vincular un dispositivo',
    body: `<p>Escribe el código que aparece en el otro dispositivo (en «Entrar con otro dispositivo» o en <code>nuvora-sync login</code>).</p>
      <input id="codigo-vincular" class="codigo-input" maxlength="9" placeholder="ABCD-EFGH" autocomplete="off" autocapitalize="characters" value="${esc(codigo)}">`,
    actions: [{ label: 'Cancelar' }, { label: 'Vincular', primary: true, onClick: async (w) => {
      const r = await attempt(() => api('POST', '/api/vincular/aprobar', { codigo: $('#codigo-vincular', w).value }));
      if (!r) return false;
      toast(r.dispositivo === 'web' ? 'Listo: el otro dispositivo ya ha entrado con tu cuenta' : `Listo: ${r.dispositivo} ya tiene tu cuenta`);
    } }],
  });
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal footer .primary', m.el).click(); });
}
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  authMode = t.dataset.mode;
  $$('.tab').forEach((x) => x.classList.toggle('active', x === t));
  $$('.register-only').forEach((x) => x.classList.toggle('hidden', authMode !== 'register'));
  $('#auth-submit').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
  $('#auth-form [name=password]').autocomplete = authMode === 'login' ? 'current-password' : 'new-password';
  $('#auth-error').classList.add('hidden');
}));
$('#auth-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const btn = $('#auth-submit');
  btn.disabled = true;
  try {
    const data = await api('POST', `/api/auth/${authMode}`, Object.fromEntries(f));
    e.target.reset();
    entrar(data.user);
  } catch (err) {
    authError(err.message);
  } finally {
    btn.disabled = false;
  }
});

// ---------- Arranque ----------
async function boot() {
  try {
    state.me = await api('GET', '/api/me');
    startApp();
  } catch {
    showAuth();
  }
}

let started = false;
function startApp() {
  $('#auth').classList.add('hidden');
  $('#app').classList.remove('hidden');
  renderAccount();
  if (!started) {
    started = true;
    window.addEventListener('hashchange', route);
    connectEvents();
  }
  route();
}

function renderAccount() {
  const me = state.me;
  const av = $('#avatar-btn');
  av.textContent = (me.name || me.email)[0].toUpperCase();
  av.style.backgroundColor = me.color;
  av.style.backgroundImage = me.foto ? `url("${me.foto.replace(/"/g, '%22')}")` : '';
  av.classList.toggle('foto', !!me.foto);
  $('.storage-bar').classList.toggle('hidden', !me.quota);
  if (me.quota) {
    const pct = Math.min(100, (me.used / me.quota) * 100);
    $('#storage-fill').style.width = `${Math.max(pct, me.used ? 1 : 0)}%`;
  }
  $('#storage-text').textContent = espacioTexto(me);
}

const espacioTexto = (me) => me.quota ? `${formatSize(me.used)} de ${formatSize(me.quota)} usados` : `${formatSize(me.used)} usados · espacio ilimitado`;

async function refreshMe() {
  try { state.me = await api('GET', '/api/me'); renderAccount(); } catch { /* ignorado */ }
}

// ---------- Tiempo real ----------
let refreshTimer = null;
function connectEvents() {
  const es = new EventSource('/api/events');
  es.onopen = () => $('#live').classList.add('on');
  es.onerror = () => $('#live').classList.remove('on');
  es.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'shared') toast(`${msg.by} compartió «${msg.name}» contigo`);
    if (msg.type === 'amigo') { toast(`${msg.by} te ha añadido como amigo`); amigosCache = null; }
    if (msg.type === 'emparejado') { toast(`${msg.nombre || 'Un móvil'} se ha emparejado con este ordenador`); if (state.view === 'sync') renderSync(); }
    pulseRing();
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (state.view !== 'sync') load(true); refreshMe(); }, 250);
  };
}

// El anillo que gira alrededor de la foto de perfil mientras se envían o reciben datos
let ringTimer = null;
function updateRing() {
  $('#ring').classList.toggle('on', activeUploads > 0 || ringTimer !== null);
}
function pulseRing() {
  clearTimeout(ringTimer);
  ringTimer = setTimeout(() => { ringTimer = null; updateRing(); }, 1600);
  updateRing();
}

// ---------- Rutas ----------
function route() {
  const hash = location.hash.replace(/^#\/?/, '') || (VIEW_TITLES[apariencia.inicio] ? apariencia.inicio : 'drive');
  const [view, arg] = hash.split('/');
  // Enlace para aprobar un código (lo abre la app de Mac en el navegador): #/vincular/ABCD-EFGH
  if (view === 'vincular') {
    history.replaceState(null, '', '#/drive');
    vincularDialog(decodeURIComponent(arg || ''));
    route();
    return;
  }
  state.view = VIEW_TITLES[view] ? view : 'drive';
  state.folderId = state.view === 'drive' && arg ? arg : null;
  state.amigoId = state.view === 'amigo' ? arg : null;
  if (state.view === 'amigo' && !arg) state.view = 'shared';
  if (state.view === 'search') state.query = decodeURIComponent(arg || '');
  else $('#search').value = '';
  state.selected.clear();
  const activa = state.view === 'amigo' ? 'shared' : state.view;
  $$('.nav a, .tabbar a').forEach((a) => a.classList.toggle('active', a.dataset.view === activa));
  abrirMenuLateral(false);
  load();
}

function go(view, arg) {
  const h = `#/${view}${arg ? `/${encodeURIComponent(arg)}` : ''}`;
  if (location.hash === h) route(); else location.hash = h;
}

async function load(silent) {
  const content = $('#content');
  $('#empty-trash').classList.toggle('hidden', state.view !== 'trash');
  if (state.view === 'sync') { renderCrumbs(); renderSync(); return; }
  if (!silent) content.innerHTML = '<div class="empty"><p>Cargando…</p></div>';
  try {
    let data;
    if (state.view === 'drive') {
      data = await api('GET', `/api/nodes?parent=${state.folderId || 'root'}`);
      state.folder = data.folder;
      state.role = data.role;
      state.crumbs = data.breadcrumbs;
    } else if (state.view === 'search') {
      data = await api('GET', `/api/search?q=${encodeURIComponent(state.query)}`);
      state.folder = null; state.role = 'owner';
    } else if (state.view === 'amigo') {
      const r = await api('GET', `/api/amigos/${encodeURIComponent(state.amigoId)}/compartido`);
      state.amigo = r.amigo;
      state.grupos = { conmigo: r.conmigo.map((i) => i.id), porMi: r.porMi.map((i) => i.id) };
      data = { items: [...r.conmigo, ...r.porMi] };
      state.folder = null; state.role = 'owner';
    } else if (state.view === 'shared') {
      const [r, a] = await Promise.all([api('GET', '/api/views/shared'), cargarAmigos(true)]);
      data = { items: r.items, amigos: a };
      state.folder = null; state.role = 'owner';
    } else {
      data = await api('GET', `/api/views/${state.view}`);
      state.folder = null; state.role = 'owner';
    }
    // Evita volver a pintar (y cortar un doble clic o recargar miniaturas) si nada cambió
    const signature = JSON.stringify([state.view, state.folderId, state.amigoId, state.query, data.items, data.amigos]);
    if (silent && signature === state.signature) return;
    state.signature = signature;
    state.items = data.items;
    for (const id of [...state.selected]) if (!state.items.some((i) => i.id === id)) state.selected.delete(id);
    renderCrumbs();
    render();
  } catch (err) {
    if (state.view === 'drive' && state.folderId) { toast(err.message, 'error'); go('drive'); return; }
    content.innerHTML = `<div class="empty"><h3>No se pudo cargar</h3><p>${esc(err.message)}</p></div>`;
  }
}

function canEditHere() {
  return state.view === 'drive' && (state.role === 'owner' || state.role === 'editor');
}

function renderCrumbs() {
  const el = $('#crumbs');
  if (state.view === 'drive' && state.folder) {
    const sharedRoot = state.folder.owner && state.crumbs.length;
    const parts = [sharedRoot ? `<a href="#/shared">Compartido conmigo</a>` : `<a href="#/drive">Mi unidad</a>`];
    state.crumbs.forEach((c, i) => {
      parts.push(icon('chevron'));
      parts.push(i === state.crumbs.length - 1 ? `<span>${esc(c.name)}</span>` : `<a href="#/drive/${c.id}" data-drop="${c.id}">${esc(c.name)}</a>`);
    });
    el.innerHTML = parts.join('');
  } else if (state.view === 'search') {
    el.innerHTML = `<span>Resultados para «${esc(state.query)}»</span>`;
  } else if (state.view === 'amigo' && state.amigo) {
    el.innerHTML = `<a href="#/shared">Compartido</a>${icon('chevron')}<span>${esc(state.amigo.name)}</span>`;
  } else {
    el.innerHTML = `<span data-drop="${state.view === 'drive' ? 'root' : ''}">${VIEW_TITLES[state.view]}</span>`;
  }
  $('#subtitle').textContent = state.view === 'drive' && state.folder ? ''
    : state.view === 'amigo' && state.amigo ? state.amigo.email : VIEW_SUBTITLES[state.view] || '';
  $$('[data-layout]').forEach((b) => b.classList.toggle('active', b.dataset.layout === state.layout));
  $('.seg').classList.toggle('hidden', state.view === 'sync');
}

// ---------- Renderizado ----------
const EMPTY = {
  drive: ['Arrastra archivos aquí', 'O usa el botón «Nuevo» para subir archivos y carpetas.'],
  shared: ['Nada compartido todavía', 'Lo que tus amigos compartan contigo aparecerá aquí. Toca un amigo para compartir algo con él.'],
  'shared-by-me': ['No has compartido nada', 'Comparte con personas o crea enlaces públicos desde el menú de cada archivo.'],
  recent: ['Sin actividad reciente', 'Los archivos que subas o modifiques aparecerán aquí.'],
  starred: ['Sin destacados', 'Marca con una estrella lo que quieras tener a mano.'],
  trash: ['La papelera está vacía', 'Los elementos eliminados se guardan aquí hasta que vacíes la papelera.'],
  search: ['Sin resultados', 'Prueba con otras palabras.'],
};

const EMPTY_ART = '<img class="art" src="/art.svg" alt="">';

function itemLabel(it) {
  if (state.view === 'trash') return `En la papelera · ${formatDate(it.trashedAt)}`;
  if (it.owner) return `De ${it.owner.name}`;
  return it.type === 'folder' ? formatDate(it.updatedAt) : `${formatSize(it.size)} · ${formatDate(it.updatedAt)}`;
}

function thumbHtml(it) {
  const k = fileKind(it);
  if (k.kind === 'image' && !/heic|tiff/.test(it.mime)) return `<img loading="lazy" src="${contentUrl(it)}" alt="">`;
  if (k.kind === 'video') {
    return `<video preload="metadata" muted src="${contentUrl(it)}#t=0.5"></video><span class="play"><svg class="ico" viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>`;
  }
  return `<svg class="ico big-ico" viewBox="0 0 24 24" style="color:${k.color}">${ICONS[k.icon]}</svg>`;
}

function render() {
  const content = $('#content');
  const items = state.items;
  if (state.view === 'amigo') return renderAmigo();
  const cabeza = state.view === 'shared' ? tiraAmigos() : '';
  if (!items.length) {
    const [h, p] = EMPTY[state.view] || EMPTY.drive;
    content.innerHTML = `${cabeza}<div class="empty">${EMPTY_ART}<h3>${h}</h3><p>${p}</p></div>`;
    return;
  }
  // En Compartido, la lista va debajo de los amigos
  const pre = cabeza ? `${cabeza}<div class="section-title">Compartido contigo</div>` : '';
  if (state.layout === 'list') {
    content.innerHTML = pre + `<table class="list"><thead><tr>
      <th>Nombre</th><th class="col-hide">${state.view === 'shared' ? 'Compartido por' : 'Propietario'}</th>
      <th class="col-hide">${state.view === 'trash' ? 'Eliminado' : 'Modificado'}</th><th class="col-hide">Tamaño</th><th></th>
    </tr></thead><tbody>${items.map((it) => {
      const k = fileKind(it);
      return `<tr class="item" data-id="${it.id}" draggable="${canDrag(it)}" ${it.type === 'folder' ? `data-drop="${it.id}"` : ''}>
        <td><div class="namecell"><svg class="ico" viewBox="0 0 24 24" style="color:${k.color}">${ICONS[k.icon]}</svg>
          <span>${esc(it.name)}</span>${it.shared ? `<span class="badge-shared" title="Compartido">${icon('people')}</span>` : ''}
          ${it.starred ? `<span class="badge-shared" title="Destacado">${icon('star')}</span>` : ''}</div>
          ${it.path ? `<div class="muted small">${esc(it.path)}</div>` : ''}</td>
        <td class="col-hide">${it.owner ? esc(it.owner.name) : 'yo'}</td>
        <td class="col-hide">${formatDate(state.view === 'trash' ? it.trashedAt : it.updatedAt)}</td>
        <td class="col-hide">${it.type === 'folder' ? '—' : formatSize(it.size)}</td>
        <td style="width:40px"><button class="icon-btn" data-more aria-label="Más acciones">${icon('more')}</button></td>
      </tr>`;
    }).join('')}</tbody></table>`;
  } else {
    const html = gridHtml(items);
    content.innerHTML = pre + html;
  }
  paintSelection();
}

// Tarjetas de carpetas y archivos (cuadrícula)
function gridHtml(items, titulos = true) {
  const folders = items.filter((i) => i.type === 'folder');
  const files = items.filter((i) => i.type === 'file');
  let html = '';
  if (folders.length) {
    html += `${titulos ? '<div class="section-title">Carpetas</div>' : ''}<div class="grid folders">${folders.map((it) => `
      <div class="card folder" data-id="${it.id}" data-drop="${it.id}" draggable="${canDrag(it)}" title="${esc(it.name)}">
        <div class="row"><svg class="ico" viewBox="0 0 24 24" style="color:var(--c-folder);fill:var(--c-folder);fill-opacity:.25">${ICONS.folder}</svg>
          <span class="name">${esc(it.name)}</span>
          ${it.shared ? `<span class="badge-shared">${icon('people')}</span>` : ''}
          <button class="icon-btn" data-more aria-label="Más acciones">${icon('more')}</button></div>
      </div>`).join('')}</div>`;
  }
  if (files.length) {
    html += `${titulos ? '<div class="section-title">Archivos</div>' : ''}<div class="grid files">${files.map((it) => {
      const k = fileKind(it);
      return `<div class="card file" data-id="${it.id}" draggable="${canDrag(it)}" title="${esc(it.name)}">
        <div class="row"><svg class="ico" viewBox="0 0 24 24" style="color:${k.color}">${ICONS[k.icon]}</svg>
          <span class="name">${esc(it.name)}</span>
          <button class="icon-btn" data-more aria-label="Más acciones">${icon('more')}</button></div>
        <div class="thumb">${thumbHtml(it)}</div>
        <div class="muted small" style="padding:0 14px 10px;margin-top:-4px">${esc(itemLabel(it))}</div>
      </div>`;
    }).join('')}</div>`;
  }
  return html;
}

function canDrag(it) {
  return state.view !== 'trash' && !it.owner;
}

function paintSelection() {
  $$('[data-id]', $('#content')).forEach((el) => el.classList.toggle('selected', state.selected.has(el.dataset.id)));
}

const byId = (id) => state.items.find((i) => i.id === id);
const selectedItems = () => state.items.filter((i) => state.selected.has(i.id));

// ---------- Interacción con elementos ----------
const contentEl = $('#content');

contentEl.addEventListener('click', (e) => {
  const el = e.target.closest('[data-id]');
  if (!el) { state.selected.clear(); paintSelection(); return; }
  const id = el.dataset.id;
  if (e.target.closest('[data-more]')) {
    if (!state.selected.has(id)) { state.selected = new Set([id]); paintSelection(); }
    const r = e.target.closest('[data-more]').getBoundingClientRect();
    showItemMenu(r.right, r.bottom);
    return;
  }
  if (e.shiftKey && state.anchor) {
    const ids = state.items.map((i) => i.id);
    const [a, b] = [ids.indexOf(state.anchor), ids.indexOf(id)].sort((x, y) => x - y);
    state.selected = new Set(ids.slice(a, b + 1));
  } else if (e.ctrlKey || e.metaKey) {
    state.selected.has(id) ? state.selected.delete(id) : state.selected.add(id);
    state.anchor = id;
  } else {
    // En pantallas táctiles un toque abre directamente
    if (matchMedia('(hover: none)').matches) { openItem(byId(id)); return; }
    state.selected = new Set([id]);
    state.anchor = id;
  }
  paintSelection();
});

contentEl.addEventListener('dblclick', (e) => {
  const el = e.target.closest('[data-id]');
  if (el && !e.target.closest('[data-more]')) openItem(byId(el.dataset.id));
});

contentEl.addEventListener('contextmenu', (e) => {
  const el = e.target.closest('[data-id]');
  e.preventDefault();
  if (!el) { if (canEditHere()) showNewMenu(e.clientX, e.clientY); return; }
  if (!state.selected.has(el.dataset.id)) { state.selected = new Set([el.dataset.id]); paintSelection(); }
  showItemMenu(e.clientX, e.clientY);
});

function openItem(it) {
  if (!it) return;
  if (state.view === 'trash') { toast('Restaura el elemento para abrirlo'); return; }
  if (it.type === 'folder') go('drive', it.id);
  else openViewer(it);
}

document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || $('.modal-wrap') || $('.viewer')) return;
  const sel = selectedItems();
  if (e.key === '?') { atajosDialog(); return; }
  if (e.key === 'Escape') { state.selected.clear(); paintSelection(); hideMenu(); }
  else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); state.selected = new Set(state.items.map((i) => i.id)); paintSelection(); }
  else if (!sel.length) return;
  else if (e.key === 'Enter' && sel.length === 1) openItem(sel[0]);
  else if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); state.view === 'trash' ? deleteForever(sel) : trashItems(sel); }
  else if (e.key === 'F2' && sel.length === 1) renameItem(sel[0]);
});

// ---------- Menús ----------
const menuEl = $('#menu');
function showMenu(x, y, entries) {
  menuEl.innerHTML = entries.map((en, i) => en === '-' ? '<hr>'
    : en.html ? en.html
    : `<button data-i="${i}" class="${en.danger ? 'danger' : ''}">${icon(en.icon)}<span>${esc(en.label)}</span></button>`).join('');
  menuEl.classList.remove('hidden');
  const { innerWidth: W, innerHeight: H } = window;
  const r = menuEl.getBoundingClientRect();
  menuEl.style.left = `${Math.max(8, Math.min(x, W - r.width - 8))}px`;
  menuEl.style.top = `${Math.max(8, y + r.height > H - 8 ? y - r.height : y)}px`;
  menuEl.onclick = (e) => {
    const b = e.target.closest('button[data-i]');
    if (!b) return;
    hideMenu();
    entries[b.dataset.i].action();
  };
}
function hideMenu() { menuEl.classList.add('hidden'); }
document.addEventListener('mousedown', (e) => { if (!menuEl.contains(e.target)) hideMenu(); });
window.addEventListener('resize', hideMenu);
contentEl.addEventListener('scroll', hideMenu);

function showItemMenu(x, y) {
  const sel = selectedItems();
  if (!sel.length) return;
  const one = sel.length === 1 ? sel[0] : null;
  const mine = sel.every((i) => !i.owner);
  const entries = [];
  if (state.view === 'trash') {
    entries.push({ icon: 'restore', label: 'Restaurar', action: () => restoreItems(sel) });
    entries.push({ icon: 'trash', label: 'Eliminar definitivamente', danger: true, action: () => deleteForever(sel) });
    return showMenu(x, y, entries);
  }
  if (one) {
    entries.push({ icon: one.type === 'folder' ? 'folder' : 'eye', label: one.type === 'folder' ? 'Abrir' : 'Vista previa', action: () => openItem(one) });
  }
  entries.push({ icon: 'download', label: sel.length > 1 ? `Descargar (${sel.length})` : one.type === 'folder' ? 'Descargar como ZIP' : 'Descargar', action: () => sel.forEach(download) });
  entries.push('-');
  if (one && mine) {
    entries.push({ icon: 'share', label: 'Compartir', action: () => shareDialog(one) });
    entries.push({ icon: 'link', label: 'Copiar enlace público', action: () => quickLink(one) });
  }
  if (one && (mine || state.role === 'editor')) entries.push({ icon: 'edit', label: 'Cambiar nombre', action: () => renameItem(one) });
  if (mine) {
    entries.push({ icon: 'move', label: 'Mover a…', action: () => moveDialog(sel) });
    const allStarred = sel.every((i) => i.starred);
    entries.push({ icon: 'star', label: allStarred ? 'Quitar de destacados' : 'Añadir a destacados', action: () => starItems(sel, !allStarred) });
  }
  if (one) entries.push({ icon: 'copy', label: 'Hacer una copia', action: () => copyItem(one) });
  if (one) entries.push({ icon: 'info', label: 'Detalles', action: () => detailsDialog(one) });
  if (mine) {
    entries.push('-');
    entries.push({ icon: 'trash', label: 'Mover a la papelera', danger: true, action: () => trashItems(sel) });
  }
  if (state.view === 'shared' && one && one.role) {
    entries.push('-');
    entries.push({ icon: 'logout', label: 'Quitar de mi lista', action: () => leaveShare(one) });
  }
  showMenu(x, y, entries);
}

function showNewMenu(x, y) {
  showMenu(x, y, [
    { icon: 'folderPlus', label: 'Nueva carpeta', action: newFolder },
    '-',
    { icon: 'upload', label: 'Subir archivos', action: () => $('#file-input').click() },
    { icon: 'folderUp', label: 'Subir carpeta', action: () => $('#folder-input').click() },
  ]);
}

$('#new-btn').addEventListener('click', (e) => {
  if (!canEditHere()) { go('drive'); setTimeout(() => showNewMenu(e.clientX, e.clientY), 120); return; }
  const r = e.currentTarget.getBoundingClientRect();
  showNewMenu(r.left, r.bottom + 6);
});

$('#avatar-btn').addEventListener('click', (e) => {
  const r = e.currentTarget.getBoundingClientRect();
  const me = state.me;
  showMenu(r.right - 260, r.bottom + 8, [
    { html: `<div class="menu-head"><b>${esc(me.name)}</b><span class="muted small">${esc(me.email)}</span><br>
      <span class="muted small">${esc(espacioTexto(me))}</span></div>` },
    '-',
    { icon: 'people', label: 'Amigos', action: amigosDialog },
    { icon: 'devices', label: 'Vincular un dispositivo', action: vincularDialog },
    { icon: 'palette', label: 'Apariencia', action: aparienciaDialog },
    { icon: 'keyboard', label: 'Atajos de teclado', action: atajosDialog },
    { icon: 'sync', label: 'Sincronizar mi ordenador', action: () => go('sync') },
    ...(window.NuvoraApp ? [{ icon: 'link', label: 'Cambiar de servidor', action: () => window.NuvoraApp.cambiarServidor() }] : []),
    ...(window.NuvoraMac ? [{ icon: 'folder', label: 'Abrir la carpeta Nuvora en el Finder', action: () => window.NuvoraMac.abrirCarpeta() }] : []),
    { icon: 'logout', label: 'Cerrar sesión', action: logout },
  ]);
});

async function logout() {
  await attempt(() => api('POST', '/api/auth/logout'));
  // Para que la próxima vez Google vuelva a preguntar qué cuenta usar
  if (window.NuvoraApp && typeof window.NuvoraApp.cerrarSesionGoogle === 'function') window.NuvoraApp.cerrarSesionGoogle();
  if (window.google && google.accounts) google.accounts.id.disableAutoSelect();
  location.hash = '';
  location.reload();
}

$('#theme-btn').addEventListener('click', toggleTheme);
$('#fab').addEventListener('click', (e) => {
  if (!canEditHere()) { go('drive'); setTimeout(() => showNewMenu(e.clientX, e.clientY), 120); return; }
  const r = e.currentTarget.getBoundingClientRect();
  showNewMenu(r.right - 230, r.top - 8 - 170);
});
$('#menu-btn').addEventListener('click', () => abrirMenuLateral(!$('#sidebar').classList.contains('open')));
$$('[data-layout]').forEach((b) => b.addEventListener('click', () => {
  state.layout = b.dataset.layout;
  state.signature = null;
  try { localStorage.setItem('nuvora-layout', state.layout); } catch { /* sin almacenamiento */ }
  renderCrumbs();
  render();
}));
$('#empty-trash').addEventListener('click', () => {
  openModal({
    title: '¿Vaciar la papelera?',
    body: '<p>Todos los elementos de la papelera se eliminarán para siempre. Esta acción no se puede deshacer.</p>',
    actions: [{ label: 'Cancelar' }, { label: 'Vaciar papelera', danger: true, onClick: async () => {
      await attempt(() => api('DELETE', '/api/trash'), 'Papelera vaciada');
      load(); refreshMe();
    } }],
  });
});

let searchTimer;
$('#search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const v = e.target.value.trim();
  searchTimer = setTimeout(() => { if (v) go('search', v); else if (state.view === 'search') go('drive'); }, 300);
});

// ---------- Acciones ----------
function download(it) {
  const a = document.createElement('a');
  a.href = contentUrl(it, true);
  a.download = it.type === 'folder' ? `${it.name}.zip` : it.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function newFolder() {
  openModal({
    title: 'Nueva carpeta',
    body: '<input id="folder-name" value="Carpeta sin título">',
    actions: [{ label: 'Cancelar' }, { label: 'Crear', primary: true, onClick: async (w) => {
      const name = $('#folder-name', w).value.trim();
      if (!name) return false;
      await attempt(() => api('POST', '/api/folders', { name, parentId: state.folderId }));
      load(true);
    } }],
  }).el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal footer .primary').click(); });
}

function renameItem(it) {
  const m = openModal({
    title: 'Cambiar nombre',
    body: `<input id="rename" value="${esc(it.name)}">`,
    actions: [{ label: 'Cancelar' }, { label: 'Aceptar', primary: true, onClick: async (w) => {
      const name = $('#rename', w).value.trim();
      if (!name || name === it.name) return;
      const r = await attempt(() => api('PATCH', `/api/nodes/${it.id}`, { name }));
      if (r === undefined) return false;
      load(true);
    } }],
  });
  const input = $('#rename', m.el);
  setTimeout(() => {
    const dot = it.type === 'file' ? it.name.lastIndexOf('.') : -1;
    input.setSelectionRange(0, dot > 0 ? dot : it.name.length);
  }, 40);
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal footer .primary', m.el).click(); });
}

async function trashItems(items) {
  for (const it of items) await attempt(() => api('DELETE', `/api/nodes/${it.id}`));
  toast(items.length > 1 ? `${items.length} elementos movidos a la papelera` : `«${items[0].name}» se ha movido a la papelera`);
  state.selected.clear();
  load(true);
}

async function restoreItems(items) {
  for (const it of items) await attempt(() => api('POST', `/api/nodes/${it.id}/restore`));
  toast(items.length > 1 ? 'Elementos restaurados' : `«${items[0].name}» restaurado`);
  load(true);
}

function deleteForever(items) {
  openModal({
    title: '¿Eliminar definitivamente?',
    body: `<p>${items.length > 1 ? `Se eliminarán ${items.length} elementos` : `Se eliminará «${esc(items[0].name)}»`} para siempre.</p>`,
    actions: [{ label: 'Cancelar' }, { label: 'Eliminar', danger: true, onClick: async () => {
      for (const it of items) await attempt(() => api('DELETE', `/api/nodes/${it.id}?permanent=1`));
      load(true); refreshMe();
    } }],
  });
}

async function starItems(items, starred) {
  for (const it of items) await attempt(() => api('PATCH', `/api/nodes/${it.id}`, { starred }));
  load(true);
}

async function copyItem(it) {
  const r = await attempt(() => api('POST', `/api/nodes/${it.id}/copy`, {}), 'Copia creada');
  if (r) { load(true); refreshMe(); }
}

async function leaveShare(it) {
  const data = await attempt(() => api('GET', `/api/nodes/${it.id}/shares`));
  const mine = data?.shares.find((s) => s.user.id === state.me.id);
  if (mine) await attempt(() => api('DELETE', `/api/shares/${mine.id}`), 'Eliminado de tu lista');
  load(true);
}

async function moveItems(items, parentId) {
  let ok = 0;
  for (const it of items) {
    if (it.id === parentId) continue;
    if (await attempt(() => api('PATCH', `/api/nodes/${it.id}`, { parentId: parentId || 'root' }))) ok++;
  }
  if (ok) toast(ok > 1 ? `${ok} elementos movidos` : 'Elemento movido');
  load(true);
}

async function moveDialog(items) {
  const data = await attempt(() => api('GET', '/api/folders'));
  if (!data) return;
  const kids = new Map();
  for (const f of data.items) {
    if (!kids.has(f.parentId)) kids.set(f.parentId, []);
    kids.get(f.parentId).push(f);
  }
  const blocked = new Set(items.map((i) => i.id));
  let target = null;
  const rows = [];
  const walk = (parent, depth, disabled) => {
    for (const f of (kids.get(parent) || []).sort((a, b) => a.name.localeCompare(b.name, 'es'))) {
      const dis = disabled || blocked.has(f.id);
      rows.push(`<button data-t="${f.id}" style="padding-left:${10 + depth * 18}px" ${dis ? 'disabled' : ''}>${icon('folder')}<span>${esc(f.name)}</span></button>`);
      walk(f.id, depth + 1, dis);
    }
  };
  walk(null, 1, false);
  const m = openModal({
    title: items.length > 1 ? `Mover ${items.length} elementos` : `Mover «${items[0].name}»`,
    body: `<div class="tree"><button data-t="" class="sel">${icon('drive')}<span>Mi unidad</span></button>${rows.join('')}</div>`,
    actions: [{ label: 'Cancelar' }, { label: 'Mover aquí', primary: true, onClick: () => moveItems(items, target) }],
  });
  $('.tree', m.el).addEventListener('click', (e) => {
    const b = e.target.closest('button[data-t]');
    if (!b || b.disabled) return;
    $$('.tree button', m.el).forEach((x) => x.classList.toggle('sel', x === b));
    target = b.dataset.t || null;
  });
}

async function detailsDialog(it) {
  const info = await attempt(() => api('GET', `/api/nodes/${it.id}`));
  if (!info) return;
  const k = fileKind(info);
  openModal({
    title: info.name,
    body: `<div class="details"><dl>
      <dt>Tipo</dt><dd>${k.label}${info.mime ? ` <span class="muted">(${esc(info.mime)})</span>` : ''}</dd>
      ${info.type === 'file' ? `<dt>Tamaño</dt><dd>${formatSize(info.size)}</dd>` : ''}
      <dt>Ubicación</dt><dd>${esc(info.path)}</dd>
      <dt>Propietario</dt><dd>${info.owner ? esc(info.owner.name) : 'yo'}</dd>
      <dt>Tu acceso</dt><dd>${{ owner: 'Propietario', editor: 'Editor', viewer: 'Lector' }[info.role]}</dd>
      <dt>Creado</dt><dd>${new Date(info.createdAt).toLocaleString('es')}</dd>
      <dt>Modificado</dt><dd>${new Date(info.updatedAt).toLocaleString('es')}</dd>
      ${info.type === 'file' ? `<dt>Versión</dt><dd>${info.version}</dd><dt>SHA-256</dt><dd class="muted small">${esc(info.hash)}</dd>` : ''}
    </dl></div>`,
    actions: [{ label: 'Cerrar', primary: true }],
  });
}

// ---------- Compartir ----------
function linkUrl(token) { return `${location.origin}/s/${token}`; }

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

async function quickLink(it) {
  const r = await attempt(() => api('POST', `/api/nodes/${it.id}/links`, {}));
  if (!r) return;
  const url = linkUrl(r.token);
  if (await copyText(url)) toast('Enlace copiado al portapapeles');
  else openModal({ title: 'Enlace público', body: `<input value="${esc(url)}" readonly>`, actions: [{ label: 'Listo', primary: true }] });
  load(true);
}

async function shareDialog(it) {
  const body = document.createElement('div');
  const m = openModal({ title: `Compartir «${it.name}»`, body, wide: true, actions: [{ label: 'Listo', primary: true }], onClose: () => load(true) });
  const draw = async () => {
    const [data, amigos] = await Promise.all([attempt(() => api('GET', `/api/nodes/${it.id}/shares`)), cargarAmigos()]);
    if (!data) return m.close();
    const avatar = (u) => `<span class="avatar sm" style="background:${u.color}">${esc((u.name || u.email)[0].toUpperCase())}</span>`;
    body.innerHTML = `
      <form class="share-row" id="share-form">
        <input name="email" type="email" placeholder="Añadir personas por correo electrónico" required>
        <select name="role"><option value="viewer">Lector</option><option value="editor">Editor</option></select>
        <button class="btn primary">Compartir</button>
      </form>
      ${amigos.length ? `<div class="subhead">Tus amigos</div><div class="chips amigos-chips">${amigos.map((a) => `
        <button type="button" class="chip-amigo" data-amigo="${esc(a.email)}" ${data.shares.some((x) => x.user.id === a.id) ? 'aria-pressed="true"' : ''}>
          ${avatarHtml(a, 'xs')}<span>${esc(a.name.split(' ')[0])}</span></button>`).join('')}</div>` : ''}
      <div class="subhead">Personas con acceso</div>
      <div class="people">
        <div class="person">${avatar(data.owner)}<div class="who"><b>${esc(data.owner.name)} ${data.owner.id === state.me.id ? '(tú)' : ''}</b><span>${esc(data.owner.email)}</span></div><span class="muted">Propietario</span></div>
        ${data.shares.map((s) => `<div class="person">${avatar(s.user)}<div class="who"><b>${esc(s.user.name)}</b><span>${esc(s.user.email)}</span></div>
          <select data-role="${esc(s.user.email)}"><option value="viewer" ${s.role === 'viewer' ? 'selected' : ''}>Lector</option><option value="editor" ${s.role === 'editor' ? 'selected' : ''}>Editor</option></select>
          <button class="icon-btn" data-unshare="${s.id}" title="Quitar acceso">${icon('close')}</button></div>`).join('')}
      </div>
      <div class="subhead">Enlaces públicos</div>
      <p class="muted small" style="margin-top:0">Cualquiera con el enlace podrá ver ${it.type === 'folder' ? 'esta carpeta' : 'este archivo'}, sin necesidad de cuenta.</p>
      ${data.links.map((l) => `<div class="link-box">
        <div class="url"><input value="${esc(linkUrl(l.token))}" readonly><button class="btn" data-copy="${l.token}">Copiar</button>
          <button class="icon-btn" data-unlink="${l.token}" title="Desactivar enlace">${icon('trash')}</button></div>
        <div class="link-meta"><span>${icon('eye', 'small')} ${l.views} visitas</span>
          ${l.hasPassword ? '<span>🔒 Con contraseña</span>' : ''}
          <span>${l.expiresAt ? `Caduca el ${new Date(l.expiresAt).toLocaleDateString('es')}` : 'Sin caducidad'}</span>
          ${l.allowDownload ? '' : '<span>Descarga desactivada</span>'}</div></div>`).join('') || ''}
      <details><summary style="cursor:pointer;font-weight:600;margin:6px 0 10px">Crear enlace nuevo</summary>
        <form id="link-form">
          <div class="grid2">
            <label class="field"><span>Contraseña (opcional)</span><input name="password" type="password" autocomplete="new-password"></label>
            <label class="field"><span>Caducidad</span><select name="expiresInDays"><option value="0">Nunca</option><option value="1">1 día</option><option value="7">7 días</option><option value="30">30 días</option></select></label>
          </div>
          <label class="check"><input type="checkbox" name="allowDownload" checked> Permitir descargas</label>
          <button class="btn">${icon('link')} Crear enlace</button>
        </form>
      </details>`;
    $('#share-form', body).onsubmit = async (e) => {
      e.preventDefault();
      const f = Object.fromEntries(new FormData(e.target));
      if (await compartirCon(it, f.email, f.role)) draw();
    };
    $('#link-form', body).onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(e.target);
      const r = await attempt(() => api('POST', `/api/nodes/${it.id}/links`, {
        password: f.get('password') || null, expiresInDays: Number(f.get('expiresInDays')), allowDownload: f.get('allowDownload') === 'on',
      }));
      if (r) { await copyText(linkUrl(r.token)); toast('Enlace creado y copiado'); draw(); }
    };
    body.onclick = async (e) => {
      const t = e.target.closest('button');
      if (!t) return;
      if (t.dataset.amigo) {
        if (t.getAttribute('aria-pressed') === 'true') return toast('Ya lo tiene');
        if (await compartirCon(it, t.dataset.amigo, $('#share-form select', body).value)) draw();
      } else if (t.dataset.copy) { if (await copyText(linkUrl(t.dataset.copy))) toast('Enlace copiado'); }
      else if (t.dataset.unlink) { if (await attempt(() => api('DELETE', `/api/links/${t.dataset.unlink}`), 'Enlace desactivado')) draw(); }
      else if (t.dataset.unshare) { if (await attempt(() => api('DELETE', `/api/shares/${t.dataset.unshare}`), 'Acceso quitado')) draw(); }
    };
    $$('[data-role]', body).forEach((s) => s.onchange = () => attempt(() => api('POST', `/api/nodes/${it.id}/shares`, { email: s.dataset.role, role: s.value }), 'Permiso actualizado'));
  };
  draw();
}

// ---------- Visor ----------
function openViewer(start) {
  const files = state.items.filter((i) => i.type === 'file');
  let index = Math.max(0, files.findIndex((f) => f.id === start.id));
  const el = document.createElement('div');
  el.className = 'viewer';
  document.body.appendChild(el);
  let cerrado = false;
  const close = (desdeAtras) => {
    if (cerrado) return;
    cerrado = true;
    el.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('popstate', onAtras);
    if (desdeAtras !== true && history.state && history.state.visor) history.back();
  };
  const onAtras = () => close(true);
  history.pushState({ visor: true }, '');
  window.addEventListener('popstate', onAtras);
  let toque = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || e.target.closest('header, video, audio, pre')) { toque = null; return; }
    toque = { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() };
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (!toque) return;
    const dy = e.touches[0].clientY - toque.y;
    const dx = e.touches[0].clientX - toque.x;
    const st = $('.stage', el);
    if (st && dy > 0 && Math.abs(dy) > Math.abs(dx)) { st.style.transform = `translateY(${dy}px)`; st.style.opacity = String(Math.max(0.3, 1 - dy / 500)); }
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    if (!toque) return;
    const dx = e.changedTouches[0].clientX - toque.x;
    const dy = e.changedTouches[0].clientY - toque.y;
    toque = null;
    const st = $('.stage', el);
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) return close();
    if (st) { st.style.transform = ''; st.style.opacity = ''; }
    if (files.length > 1 && Math.abs(dx) > 60 && Math.abs(dx) > 1.5 * Math.abs(dy)) step(dx < 0 ? 1 : -1);
  }, { passive: true });
  const step = (d) => { index = (index + d + files.length) % files.length; draw(); };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight' && !e.target.closest('video,audio')) step(1);
    else if (e.key === 'ArrowLeft' && !e.target.closest('video,audio')) step(-1);
  };
  document.addEventListener('keydown', onKey);
  async function draw() {
    const it = files[index];
    const k = fileKind(it);
    const url = contentUrl(it);
    let stage;
    if (k.kind === 'image') stage = `<img src="${url}" alt="${esc(it.name)}">`;
    else if (k.kind === 'video') stage = `<video src="${url}" controls autoplay playsinline></video>`;
    else if (k.kind === 'audio') stage = `<audio src="${url}" controls autoplay></audio>`;
    else if (k.kind === 'pdf') stage = `<iframe src="${url}" title="${esc(it.name)}"></iframe>`;
    else if (k.kind === 'text' && it.size < 2 * 1024 * 1024) stage = '<pre>Cargando…</pre>';
    else stage = `<div class="nopreview">${icon(k.icon)}<p>No hay vista previa disponible para este tipo de archivo.</p>
      <button class="btn primary" data-dl>${icon('download')} Descargar (${formatSize(it.size)})</button></div>`;
    el.innerHTML = `<header>
        <button class="icon-btn" data-x aria-label="Cerrar">${icon('back')}</button>
        <div class="name"><svg class="ico" viewBox="0 0 24 24" style="color:${k.color}">${ICONS[k.icon]}</svg>${esc(it.name)}</div>
        ${!it.owner ? `<button class="icon-btn" data-share title="Compartir">${icon('share')}</button>` : ''}
        <button class="icon-btn" data-dl title="Descargar">${icon('download')}</button>
      </header>
      <div class="stage">${stage}
        ${files.length > 1 ? `<button class="icon-btn nav-arrow prev" data-prev aria-label="Anterior">${icon('back')}</button>
        <button class="icon-btn nav-arrow next" data-next aria-label="Siguiente">${icon('chevron')}</button>` : ''}
      </div>`;
    if (k.kind === 'text' && it.size < 2 * 1024 * 1024) {
      try { $('pre', el).textContent = await (await fetch(url, { credentials: 'same-origin' })).text(); }
      catch { $('pre', el).textContent = 'No se pudo cargar el archivo.'; }
    }
  }
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    const it = files[index];
    if (e.target.classList.contains('stage')) return close();
    if (!b) return;
    if (b.hasAttribute('data-x')) close();
    else if (b.hasAttribute('data-dl')) download(it);
    else if (b.hasAttribute('data-share')) shareDialog(it);
    else if (b.hasAttribute('data-prev')) step(-1);
    else if (b.hasAttribute('data-next')) step(1);
  });
  draw();
}

// ---------- Subidas ----------
const uploadQueue = [];
let activeUploads = 0;
let cerrarSubidas = null;
const uploadsEl = $('#uploads');
$('#uploads-close').addEventListener('click', () => { uploadsEl.classList.add('hidden'); $('#uploads-list').innerHTML = ''; });

function enqueueUploads(files, parentId) {
  if (!files.length) return;
  clearTimeout(cerrarSubidas);
  uploadsEl.classList.remove('hidden');
  for (const { file, path } of files) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="n">${esc(path)}</span><span class="st">En cola</span><span class="bar"><i></i></span>`;
    $('#uploads-list').prepend(li);
    uploadQueue.push({ file, path, parentId, li });
  }
  updateUploadTitle();
  pumpUploads();
}

function updateUploadTitle() {
  const pending = uploadQueue.length + activeUploads;
  $('#uploads-title').textContent = pending ? `Subiendo ${pending} elemento${pending > 1 ? 's' : ''}…` : 'Subidas completadas';
}

function pumpUploads() {
  while (activeUploads < 3 && uploadQueue.length) {
    const job = uploadQueue.shift();
    activeUploads++;
    updateRing();
    uploadOne(job).finally(() => {
      activeUploads--;
      updateRing();
      updateUploadTitle();
      pumpUploads();
      if (!activeUploads && !uploadQueue.length) {
        load(true); refreshMe();
        // Si todo ha ido bien, el aviso de «Subidas completadas» se quita solo
        clearTimeout(cerrarSubidas);
        if (!$('#uploads-list .fail')) {
          cerrarSubidas = setTimeout(() => {
            if (activeUploads || uploadQueue.length) return;
            uploadsEl.classList.add('hidden');
            $('#uploads-list').innerHTML = '';
          }, 1500);
        }
      }
    });
  }
}

function uploadOne({ file, path, parentId, li }) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    const fd = new FormData();
    fd.append('file', file, path);
    xhr.open('POST', `/api/upload${parentId ? `?parentId=${encodeURIComponent(parentId)}` : ''}`);
    xhr.setRequestHeader('X-Nuvora', '1');
    const st = $('.st', li), bar = $('.bar i', li);
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable) return;
      const p = Math.round((e.loaded / e.total) * 100);
      bar.style.width = `${p}%`;
      st.textContent = `${p}%`;
    };
    xhr.onload = () => {
      if (xhr.status < 300) { li.classList.add('done'); bar.style.width = '100%'; st.textContent = '✓'; }
      else {
        li.classList.add('fail');
        let msg = 'Error';
        try { msg = JSON.parse(xhr.responseText).error; } catch { /* respuesta sin JSON */ }
        st.textContent = msg;
        st.title = msg;
      }
      resolve();
    };
    xhr.onerror = () => { li.classList.add('fail'); st.textContent = 'Error de red'; resolve(); };
    xhr.send(fd);
  });
}

$('#file-input').addEventListener('change', (e) => {
  enqueueUploads([...e.target.files].map((f) => ({ file: f, path: f.name })), state.folderId);
  e.target.value = '';
});
$('#folder-input').addEventListener('change', (e) => {
  enqueueUploads([...e.target.files].map((f) => ({ file: f, path: f.webkitRelativePath || f.name })), state.folderId);
  e.target.value = '';
});

// Recorre carpetas arrastradas desde el sistema
async function collectEntries(dataTransfer) {
  const out = [];
  const entries = [...dataTransfer.items].map((i) => i.webkitGetAsEntry && i.webkitGetAsEntry()).filter(Boolean);
  if (!entries.length) return [...dataTransfer.files].map((f) => ({ file: f, path: f.name }));
  const readAll = (reader) => new Promise((resolve) => {
    const acc = [];
    const next = () => reader.readEntries((batch) => { if (!batch.length) resolve(acc); else { acc.push(...batch); next(); } }, () => resolve(acc));
    next();
  });
  const walk = async (entry, prefix) => {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + file.name });
    } else if (entry.isDirectory) {
      for (const child of await readAll(entry.createReader())) await walk(child, `${prefix}${entry.name}/`);
    }
  };
  for (const e of entries) await walk(e, '');
  return out;
}

// ---------- Arrastrar y soltar ----------
const mainEl = $('#main');
let dragDepth = 0;
let internalDrag = null;
const isExternal = (e) => !internalDrag && [...(e.dataTransfer?.types || [])].includes('Files');

contentEl.addEventListener('dragstart', (e) => {
  const el = e.target.closest('[data-id]');
  if (!el) return;
  if (!state.selected.has(el.dataset.id)) { state.selected = new Set([el.dataset.id]); paintSelection(); }
  internalDrag = selectedItems();
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', internalDrag.map((i) => i.name).join(', '));
});
document.addEventListener('dragend', () => { internalDrag = null; $$('.drop-over').forEach((x) => x.classList.remove('drop-over')); });

document.addEventListener('dragover', (e) => {
  const target = e.target.closest?.('[data-drop]');
  $$('.drop-over').forEach((x) => x !== target && x.classList.remove('drop-over'));
  if (internalDrag) {
    if (target && target.dataset.drop && !internalDrag.some((i) => i.id === target.dataset.drop)) {
      e.preventDefault();
      target.classList.add('drop-over');
    }
  } else if (isExternal(e) && canEditHere()) {
    e.preventDefault();
    if (target && target.dataset.drop && target.dataset.drop !== 'root') target.classList.add('drop-over');
  }
});
mainEl.addEventListener('dragenter', (e) => {
  if (!isExternal(e) || !canEditHere()) return;
  dragDepth++;
  $('#drop-target').textContent = state.folder ? state.folder.name : 'Mi unidad';
  mainEl.classList.add('dragging');
});
mainEl.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; mainEl.classList.remove('dragging'); } });
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  dragDepth = 0;
  mainEl.classList.remove('dragging');
  const target = e.target.closest?.('[data-drop]');
  $$('.drop-over').forEach((x) => x.classList.remove('drop-over'));
  if (internalDrag) {
    const items = internalDrag;
    internalDrag = null;
    if (target && target.dataset.drop) moveItems(items, target.dataset.drop === 'root' ? null : target.dataset.drop);
    return;
  }
  if (!isExternal(e) || !canEditHere()) return;
  const parentId = target && target.dataset.drop && target.dataset.drop !== 'root' ? target.dataset.drop : state.folderId;
  enqueueUploads(await collectEntries(e.dataTransfer), parentId);
});

// ---------- Apariencia (como Opciones → Apariencia de Memories) ----------
function aparienciaDialog() {
  const body = document.createElement('div');
  const chips = (key, opciones) => `<div class="chips">${opciones.map(([v, t]) =>
    `<button class="chip-opt" data-k="${key}" data-v="${v}" aria-pressed="${String(apariencia[key]) === String(v)}">${t}</button>`).join('')}</div>`;
  const draw = () => {
    body.innerHTML = `
      <div class="ap-title">Tema</div>
      <div class="themes">${Object.entries(TEMAS).map(([id, t]) => `
        <button class="theme" data-k="tema" data-v="${id}" aria-pressed="${apariencia.tema === id}">
          <div class="head" style="background:linear-gradient(110deg, ${t.cabecera.join(', ')})"></div>
          <div class="foot">${esc(t.nombre)}<span class="dots">${t.muestra.map((c) => `<i style="background:${c}"></i>`).join('')}</span></div>
        </button>`).join('')}</div>
      <div class="ap-title">Modo</div>
      ${chips('modo', [['sistema', 'Como el sistema'], ['claro', 'Claro'], ['oscuro', 'Oscuro']])}
      <div class="ap-title">Letra</div>
      <div class="fonts">${Object.entries(LETRAS).map(([id, l]) => `
        <button class="font-opt" data-k="fuente" data-v="${id}" aria-pressed="${apariencia.fuente === id}">
          <b style="font-family:${esc(l.css)}">${esc(l.nombre)}</b><span>Mis fotos del viaje.jpg</span></button>`).join('')}</div>
      <div class="ap-title">Formas</div>
      ${chips('estilo', Object.entries(FORMAS).map(([id, f]) => [id, f.nombre]))}
      <div class="ap-title">Tamaño del texto</div>
      ${chips('texto', [['pequeno', 'Pequeño'], ['normal', 'Normal'], ['grande', 'Grande'], ['muygrande', 'Muy grande']])}
      <div class="ap-title">Cabecera</div>
      ${chips('cabecera', [['degradado', 'Con degradado'], ['liso', 'Lisa']])}
      <div class="ap-title">Pestañas en el móvil</div>
      ${chips('pestanas', [['todo', 'Con su nombre'], ['iconos', 'Solo el icono']])}
      <div class="ap-title">Abrir Nuvora en</div>
      ${chips('inicio', [['drive', 'Mi unidad'], ['recent', 'Recientes'], ['starred', 'Destacados'], ['shared', 'Compartido conmigo']])}
      <label class="switch"><span><b>Animaciones</b><br><span class="muted small">El brillo del logotipo, los menús y las transiciones</span></span>
        <input type="checkbox" id="ap-anim" ${apariencia.animaciones ? 'checked' : ''}></label>`;
  };
  body.addEventListener('click', (e) => {
    const b = e.target.closest('[data-k]');
    if (!b) return;
    guardarApariencia({ [b.dataset.k]: b.dataset.v });
    draw();
  });
  body.addEventListener('change', (e) => {
    if (e.target.id === 'ap-anim') guardarApariencia({ animaciones: e.target.checked });
  });
  draw();
  openModal({
    title: 'Apariencia', body, wide: true,
    actions: [
      { label: 'Restablecer', onClick: () => { guardarApariencia({ ...APARIENCIA_POR_DEFECTO }); draw(); return false; } },
      { label: 'Listo', primary: true },
    ],
  });
}

function atajosDialog() {
  const filas = [
    ['Doble clic · Enter', 'Abrir carpeta o vista previa'],
    ['Ctrl/⌘ + clic · Mayús + clic', 'Seleccionar varios'],
    ['Ctrl/⌘ + A', 'Seleccionar todo'],
    ['Supr', 'Mover a la papelera'],
    ['F2', 'Cambiar nombre'],
    ['Clic derecho', 'Menú del elemento'],
    ['← →', 'Archivo anterior o siguiente en la vista previa'],
    ['Esc', 'Cerrar o quitar la selección'],
    ['Arrastrar', 'Subir desde el ordenador o mover a una carpeta'],
    ['?', 'Esta ayuda'],
  ];
  openModal({
    title: 'Atajos de teclado',
    body: `<div class="shortcuts">${filas.map(([k, d]) => `<span>${k.split(' · ').map((x) => `<kbd>${esc(x)}</kbd>`).join(' ')}</span><span>${esc(d)}</span>`).join('')}</div>`,
    actions: [{ label: 'Listo', primary: true }],
  });
}

// ---------- Página de sincronización (como Ajustes → Sentido de Memories para ordenador) ----------
const SENTIDOS = [
  ['ambos', 'En los dos sentidos', 'Lo que añadas en la carpeta sube a Nuvora y lo de Nuvora baja a la carpeta.'],
  ['subir', 'Del ordenador a Nuvora', 'Copia de seguridad: lo de la carpeta sube, pero no se descarga nada.'],
  ['bajar', 'De Nuvora al ordenador', 'Solo se descarga: lo que cambies en la carpeta no sube.'],
];
const syncOpts = { sentido: 'ambos', borrar: true, intervalo: '10', carpeta: '~/Nuvora' };
try { Object.assign(syncOpts, JSON.parse(localStorage.getItem('nuvora-sync') || '{}')); } catch { /* sin almacenamiento */ }

// Emparejar este ordenador con tus móviles (solo si tiene Syncthing, como la app de Mac)
async function pintarMoviles() {
  const caja = $('#moviles');
  if (!caja) return;
  let cfg;
  try { cfg = await api('GET', '/api/config'); } catch { return; }
  if (!cfg.syncthing) return;
  let codigo, estado;
  try {
    [codigo, estado] = await Promise.all([api('GET', '/api/emparejar/codigo'), api('GET', '/api/emparejar/estado')]);
  } catch (err) {
    let lineas = [];
    try { lineas = (await api('GET', '/api/emparejar/registro')).lineas; } catch { /* sin registro */ }
    caja.innerHTML = `<div class="feature" style="margin-bottom:22px">${icon('sync')}<b>Sincronización con móviles</b>
      <span class="muted small">${esc(err.message)}</span>
      ${lineas.length ? `<details><summary class="muted small" style="cursor:pointer">Ver qué ha pasado</summary><pre class="cmd registro">${esc(lineas.slice(-25).join('\n'))}</pre></details>` : ''}</div>`;
    // Se vuelve a mirar sola mientras siga en esta página
    setTimeout(() => { if (state.view === 'sync' && document.body.contains(caja) && !caja.querySelector('details[open]')) pintarMoviles(); }, 6000);
    return;
  }
  const lista = estado.dispositivos.map((d) => `<div class="person">
      <span class="avatar sm" style="background:${d.conectado ? '#2BB673' : '#9CA3AF'}">${icon('devices')}</span>
      <div class="who"><b>${esc(d.nombre)}</b><span>${d.conectado ? 'Conectado' : 'Sin conexión ahora'}</span></div>
      <button class="icon-btn" data-quitar="${esc(d.id)}" title="Dejar de sincronizar">${icon('close')}</button></div>`).join('');
  caja.innerHTML = `
    <h2>Tus móviles</h2>
    <p class="muted">La carpeta <b>${esc(estado.carpeta)}</b> de este ordenador se sincroniza directamente con la app Nuvora de tus móviles.</p>
    <div class="ap-title">Emparejar un móvil</div>
    <p class="muted small" style="margin-top:0">En el móvil, con la misma wifi: <b>Nuvora → Dispositivos → Añadir mi Mac u ordenador</b>, y escribe este código:</p>
    <div class="codigo">${esc(codigo.codigo.replace(/(\d{3})(\d{3})/, '$1 $2'))}</div>
    <button class="btn ghost" id="otro-codigo">Otro código</button>
    ${lista ? `<div class="ap-title">Emparejados</div><div class="people">${lista}</div>` : ''}
    <p class="note">Tus otros móviles se añaden solos a través del primero. ${estado.pendientes ? `Recibiendo ${estado.pendientes} archivos…` : ''}</p>
    <hr style="border:0;border-top:1px solid var(--border);margin:26px 0 18px">`;
  $('#otro-codigo').onclick = async () => { await attempt(() => api('POST', '/api/emparejar/codigo')); pintarMoviles(); };
  caja.querySelectorAll('[data-quitar]').forEach((b) => b.onclick = async () => {
    await attempt(() => api('DELETE', `/api/emparejar/${b.dataset.quitar}`), 'Ese móvil ya no se sincroniza con este ordenador');
    pintarMoviles();
  });
}

function renderSync() {
  const origin = location.origin;
  const carpeta = () => { const c = syncOpts.carpeta || '~/Nuvora'; return /\s/.test(c) ? `"${c}"` : c; };
  const cmd = () => ['node sync/nuvora-sync.js sync', carpeta(), '--watch',
    syncOpts.sentido !== 'ambos' ? `--sentido ${syncOpts.sentido}` : '',
    !syncOpts.borrar ? '--borrar no' : '',
    syncOpts.intervalo !== '10' ? `--intervalo ${syncOpts.intervalo}` : ''].filter(Boolean).join(' ');
  $('#content').innerHTML = `<div class="sync-page"><div id="moviles"></div>
    <h2>Sincroniza una carpeta de tu ordenador</h2>
    <p class="muted">Con el cliente <b>nuvora-sync</b> una carpeta de tu ordenador se mantiene al día con «Mi unidad».
      Elige cómo quieres que funcione y copia la orden.</p>

    <div class="subhead">Sentido</div>
    <div class="opt-group">${SENTIDOS.map(([v, t, d]) => `<label class="opt"><input type="radio" name="sentido" value="${v}" ${syncOpts.sentido === v ? 'checked' : ''}>
      <span><b>${t}</b><span>${d}</span></span></label>`).join('')}</div>

    <div class="subhead">Borrados</div>
    <label class="switch"><span><b>Llevar los borrados al otro lado</b><br><span class="muted small">
      Lo que borres en el ordenador va a la papelera de Nuvora, y lo que borres en Nuvora se quita de la carpeta.</span></span>
      <input type="checkbox" id="sync-borrar" ${syncOpts.borrar ? 'checked' : ''}></label>
    <p class="note">Si lo desactivas, lo que borres en un sitio no se borra en el otro.</p>

    <div class="grid2" style="margin-top:14px">
      <label class="field"><span>Carpeta del ordenador</span><input id="sync-carpeta" value="${esc(syncOpts.carpeta)}"></label>
      <label class="field"><span>Comprobar cambios en Nuvora cada</span>
        <select id="sync-intervalo">${[['5', '5 segundos'], ['10', '10 segundos'], ['30', '30 segundos'], ['60', '1 minuto']].map(([v, t]) =>
          `<option value="${v}" ${syncOpts.intervalo === v ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    </div>

    <ol class="steps">
      <li><b>Instala Node.js 22 o superior</b> y descarga el cliente desde el repositorio de Nuvora (carpeta <code>sync/</code>).</li>
      <li><b>Inicia sesión desde la terminal</b> <span class="muted small">(te dará un código: apruébalo en tu foto de perfil → Vincular un dispositivo)</span>
        <pre class="cmd">node sync/nuvora-sync.js login --server ${esc(origin)}</pre></li>
      <li><b>Empieza a sincronizar</b> <span class="muted small">(sigue vigilando la carpeta hasta que cierres la terminal)</span>
        <pre class="cmd" id="sync-cmd">${esc(cmd())}</pre>
        <button class="btn" id="copy-cmd" style="margin-top:8px">${icon('copy')} Copiar la orden</button></li>
    </ol>
    <div class="feature-grid">
      <div class="feature">${icon('sync')}<b>Al momento</b><span class="muted small">Los cambios de la carpeta se envían en cuanto guardas un archivo.</span></div>
      <div class="feature">${icon('copy')}<b>Sin duplicados</b><span class="muted small">Detecta los cambios por la huella SHA-256 y solo envía lo necesario.</span></div>
      <div class="feature">${icon('info')}<b>Conflictos seguros</b><span class="muted small">Si un archivo cambia en los dos sitios, se guardan las dos versiones.</span></div>
      <div class="feature">${icon('restore')}<b>Papelera</b><span class="muted small">Lo que se borra en el ordenador se puede recuperar en Nuvora.</span></div>
    </div>
  </div>`;
  pintarMoviles();
  const page = $('.sync-page');
  const save = () => {
    try { localStorage.setItem('nuvora-sync', JSON.stringify(syncOpts)); } catch { /* sin almacenamiento */ }
    $('#sync-cmd').textContent = cmd();
  };
  page.addEventListener('change', (e) => {
    if (e.target.name === 'sentido') syncOpts.sentido = e.target.value;
    else if (e.target.id === 'sync-borrar') syncOpts.borrar = e.target.checked;
    else if (e.target.id === 'sync-intervalo') syncOpts.intervalo = e.target.value;
    save();
  });
  $('#sync-carpeta').addEventListener('input', (e) => { syncOpts.carpeta = e.target.value.trim(); save(); });
  $('#copy-cmd').addEventListener('click', async () => {
    if (await copyText(cmd())) toast('Orden copiada');
    else { getSelection().selectAllChildren($('#sync-cmd')); toast('Selecciona la orden y cópiala'); }
  });
}

// ---------- Amigos ----------
let amigosCache = null;
async function cargarAmigos(forzar) {
  if (amigosCache && !forzar) return amigosCache;
  try { amigosCache = (await api('GET', '/api/amigos')).amigos; } catch { amigosCache = amigosCache || []; }
  return amigosCache;
}

function avatarHtml(u, tam = 'sm') {
  const foto = u.foto ? ` style="background-image:url('${esc(u.foto)}');background-color:${u.color}"` : ` style="background:${u.color}"`;
  return `<span class="avatar ${tam} ${u.foto ? 'foto' : ''}"${foto}>${u.foto ? '' : esc((u.name || u.email)[0].toUpperCase())}</span>`;
}

async function compartirCon(it, email, role = 'viewer') {
  const r = await attempt(() => api('POST', `/api/nodes/${it.id}/shares`, { email, role }));
  if (!r) return false;
  amigosCache = null;
  toast(r.pendiente ? `Compartido. ${email} lo verá cuando entre en Nuvora con Google` : `Compartido con ${email}`);
  return true;
}

// La fila de amigos de la pestaña Compartido
function tiraAmigos() {
  const amigos = amigosCache || [];
  return `<div class="amigos-tira">
    <button class="amigo-burbuja nuevo" data-accion="nuevo-amigo"><span class="avatar md">${icon('userPlus')}</span><span>Añadir</span></button>
    ${amigos.map((a) => `<a class="amigo-burbuja" href="#/amigo/${a.id}" title="${esc(a.email)}">
      ${avatarHtml(a, 'md')}${a.conmigo ? `<i class="cuenta">${a.conmigo}</i>` : ''}
      <span>${esc(a.name.split(' ')[0])}</span></a>`).join('')}
  </div>
  ${amigos.length ? '' : '<p class="muted small amigos-ayuda">Añade a tus amigos por su correo o desde tus contactos. Después toca uno para compartir algo con él.</p>'}`;
}

contentEl.addEventListener('click', (e) => {
  const b = e.target.closest('[data-accion]');
  if (!b) return;
  e.stopPropagation();
  if (b.dataset.accion === 'nuevo-amigo') anadirAmigoDialog();
  else if (b.dataset.accion === 'compartir-con') elegirParaCompartir(state.amigo);
}, true);

function renderAmigo() {
  const a = state.amigo;
  const conmigo = state.items.filter((i) => state.grupos.conmigo.includes(i.id));
  const porMi = state.items.filter((i) => state.grupos.porMi.includes(i.id));
  const nombre = esc(a.name.split(' ')[0]);
  $('#content').innerHTML = `<div class="amigo-cabeza">${avatarHtml(a, 'lg')}
      <div><b>${esc(a.name)}</b><span class="muted small">${esc(a.email)}${a.pendiente ? ' · aún no ha entrado en Nuvora' : ''}</span></div>
      <button class="btn primary" data-accion="compartir-con">${icon('share')} Compartir con ${nombre}</button></div>
    <div class="section-title">${nombre} comparte contigo</div>
    ${conmigo.length ? gridHtml(conmigo, false) : `<p class="muted small vacio-grupo">Nada todavía.</p>`}
    <div class="section-title">Tú compartes con ${nombre}</div>
    ${porMi.length ? gridHtml(porMi, false) : `<p class="muted small vacio-grupo">Toca «Compartir con ${nombre}» para elegir archivos o carpetas de Mi unidad.</p>`}`;
  paintSelection();
}

// Elegir de Mi unidad lo que se comparte con un amigo
async function elegirParaCompartir(amigo) {
  if (!amigo) return;
  const body = document.createElement('div');
  let carpeta = null;
  const pila = [];
  const hechos = new Set();
  const m = openModal({ title: `Compartir con ${amigo.name}`, body, wide: true, actions: [{ label: 'Listo', primary: true }], onClose: () => load(true) });
  const draw = async () => {
    const data = await attempt(() => api('GET', `/api/nodes?parent=${carpeta ? carpeta.id : 'root'}`));
    if (!data) return m.close();
    const items = data.items.filter((i) => !i.owner);
    body.innerHTML = `<div class="elegir-barra">
        ${carpeta ? `<button class="icon-btn" data-atras aria-label="Atrás">${icon('back')}</button>` : ''}
        <b>${esc(carpeta ? carpeta.name : 'Mi unidad')}</b>
        <select id="elegir-rol"><option value="viewer">Puede ver</option><option value="editor">Puede editar</option></select></div>
      <div class="elegir-lista">${items.length ? items.map((it) => {
        const k = fileKind(it);
        return `<div class="elegir-fila" data-id="${it.id}">
          <svg class="ico" viewBox="0 0 24 24" style="color:${it.type === 'folder' ? 'var(--c-folder)' : k.color}">${ICONS[it.type === 'folder' ? 'folder' : k.icon]}</svg>
          <span class="n" ${it.type === 'folder' ? 'data-abrir' : ''}>${esc(it.name)}</span>
          ${it.type === 'folder' ? `<button class="icon-btn" data-abrir aria-label="Abrir">${icon('chevron')}</button>` : ''}
          <button class="btn ${hechos.has(it.id) ? '' : 'primary'} sm" data-dar ${hechos.has(it.id) ? 'disabled' : ''}>${hechos.has(it.id) ? `${icon('check')} Compartido` : 'Compartir'}</button>
        </div>`;
      }).join('') : '<p class="muted">Esta carpeta está vacía.</p>'}</div>`;
    body.onclick = async (e) => {
      if (e.target.closest('[data-atras]')) { carpeta = pila.pop() || null; return draw(); }
      const fila = e.target.closest('.elegir-fila');
      if (!fila) return;
      const it = items.find((i) => i.id === fila.dataset.id);
      if (e.target.closest('[data-abrir]')) { pila.push(carpeta); carpeta = it; return draw(); }
      if (e.target.closest('[data-dar]')) {
        if (await compartirCon(it, amigo.email, $('#elegir-rol', body).value)) { hechos.add(it.id); draw(); }
      }
    };
  };
  draw();
}

function hayContactos() {
  return (window.NuvoraApp && typeof window.NuvoraApp.elegirContacto === 'function') || ('contacts' in navigator && 'ContactsManager' in window);
}

// Contactos del móvil: en la app de Android, el selector de Android; en Chrome, el de la web
function elegirContactos() {
  return new Promise((resolve) => {
    if (window.NuvoraApp && typeof window.NuvoraApp.elegirContacto === 'function') {
      window.nuvoraContactos = (lista) => { window.nuvoraContactos = null; resolve(lista || []); };
      window.NuvoraApp.elegirContacto();
      return;
    }
    navigator.contacts.select(['name', 'email'], { multiple: true })
      .then((r) => resolve(r.flatMap((c) => (c.email || []).map((email) => ({ name: (c.name || [])[0] || '', email })))))
      .catch(() => resolve([]));
  });
}

async function anadirAmigos(lista) {
  let n = 0;
  for (const c of lista) {
    const r = await attempt(() => api('POST', '/api/amigos', { email: c.email, name: c.name }));
    if (r) { n++; if (lista.length === 1) toast(r.amigo.pendiente ? `${r.amigo.name} añadido. Verá lo que compartas cuando entre en Nuvora con Google` : `${r.amigo.name} ya es tu amigo`); }
  }
  if (n > 1) toast(`${n} amigos añadidos`);
  amigosCache = null;
  await cargarAmigos(true);
  if (state.view === 'shared') { state.signature = null; load(true); }
  return n;
}

function anadirAmigoDialog(alTerminar) {
  const contactos = hayContactos();
  const m = openModal({
    title: 'Añadir amigo',
    body: `<p class="muted" style="margin-top:0">Escribe su correo (el de su cuenta de Google). Si aún no usa Nuvora, verá lo que le compartas cuando entre.</p>
      <input id="amigo-correo" type="email" placeholder="correo@ejemplo.com" autocomplete="email">
      ${contactos ? `<button class="btn wide" id="amigo-contactos" style="margin-top:12px">${icon('contacts')} Elegir de mis contactos</button>` : ''}`,
    actions: [{ label: 'Cancelar' }, { label: 'Añadir', primary: true, onClick: async (w) => {
      const email = $('#amigo-correo', w).value.trim();
      if (!email) return false;
      if (!(await anadirAmigos([{ email }]))) return false;
      alTerminar && alTerminar();
    } }],
  });
  m.el.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.modal footer .primary', m.el).click(); });
  if (contactos) $('#amigo-contactos', m.el).onclick = async () => {
    const lista = await elegirContactos();
    if (!lista.length) return;
    m.close();
    await anadirAmigos(lista);
    alTerminar && alTerminar();
  };
}

// Foto de perfil → Amigos
async function amigosDialog() {
  const body = document.createElement('div');
  const m = openModal({ title: 'Amigos', body, wide: true, actions: [{ label: 'Listo', primary: true }] });
  const draw = async () => {
    const amigos = await cargarAmigos(true);
    body.innerHTML = `<div class="amigos-botones">
        <button class="btn primary" data-nuevo>${icon('userPlus')} Añadir amigo</button>
        ${hayContactos() ? `<button class="btn" data-contactos>${icon('contacts')} De mis contactos</button>` : ''}</div>
      <div class="people">${amigos.length ? amigos.map((a) => `<div class="person">${avatarHtml(a)}
          <div class="who"><b>${esc(a.name)}</b><span>${esc(a.email)}${a.pendiente ? ' · aún no ha entrado' : ''}</span></div>
          <button class="btn sm" data-ver="${a.id}">Ver</button>
          <button class="icon-btn" data-quitar="${a.id}" title="Quitar de amigos">${icon('close')}</button></div>`).join('')
        : '<p class="muted">Aún no tienes amigos en Nuvora. Añádelos para compartir con ellos en un toque.</p>'}</div>`;
  };
  body.onclick = async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-nuevo')) anadirAmigoDialog(draw);
    else if (b.hasAttribute('data-contactos')) { const l = await elegirContactos(); if (l.length) { await anadirAmigos(l); draw(); } }
    else if (b.dataset.ver) { m.close(); go('amigo', b.dataset.ver); }
    else if (b.dataset.quitar) { await attempt(() => api('DELETE', `/api/amigos/${b.dataset.quitar}`), 'Quitado de tus amigos'); amigosCache = null; draw(); }
  };
  draw();
}

// ---------- Menú lateral (móvil) ----------
function abrirMenuLateral(abrir) {
  $('#sidebar').classList.toggle('open', abrir);
  $('#scrim').classList.toggle('on', abrir);
}
$('#scrim').addEventListener('click', () => abrirMenuLateral(false));
$$('.nav a').forEach((a) => a.addEventListener('click', () => abrirMenuLateral(false)));
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') abrirMenuLateral(false); });
{
  let x0 = null;
  $('#sidebar').addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
  $('#sidebar').addEventListener('touchend', (e) => {
    if (x0 !== null && e.changedTouches[0].clientX - x0 < -60) abrirMenuLateral(false);
    x0 = null;
  }, { passive: true });
}

// ---------- Pestañas de abajo: se ordenan a tu gusto y se cambia deslizando ----------
const tabbarEl = $('#tabbar');
const pestanaVisible = () => getComputedStyle(tabbarEl).display !== 'none';
function ordenarPestanas() {
  let orden = [];
  try { orden = JSON.parse(localStorage.getItem('nuvora-pestanas') || '[]'); } catch { /* sin almacenamiento */ }
  for (const v of orden) { const a = $(`a[data-view="${v}"]`, tabbarEl); if (a) tabbarEl.appendChild(a); }
}
function guardarPestanas() {
  try { localStorage.setItem('nuvora-pestanas', JSON.stringify([...tabbarEl.children].map((a) => a.dataset.view))); } catch { /* sin almacenamiento */ }
}
ordenarPestanas();

// Mantén pulsada una pestaña y arrástrala a otro sitio
{
  let espera = null, moviendo = null, x0 = 0, sinClic = false;
  tabbarEl.addEventListener('contextmenu', (e) => e.preventDefault());
  tabbarEl.addEventListener('pointerdown', (e) => {
    const a = e.target.closest('a');
    if (!a) return;
    x0 = e.clientX;
    espera = setTimeout(() => {
      moviendo = a;
      a.classList.add('moviendo');
      tabbarEl.classList.add('ordenando');
      try { tabbarEl.setPointerCapture(e.pointerId); } catch { /* sin captura */ }
      if (navigator.vibrate) navigator.vibrate(15);
    }, 420);
  });
  tabbarEl.addEventListener('pointermove', (e) => {
    if (!moviendo) { if (Math.abs(e.clientX - x0) > 12) clearTimeout(espera); return; }
    const tabs = [...tabbarEl.children];
    const i = tabs.indexOf(moviendo);
    const w = moviendo.offsetWidth;
    let dx = e.clientX - x0;
    if (dx > w / 2 && i < tabs.length - 1) { tabbarEl.insertBefore(tabs[i + 1], moviendo); x0 += w; dx -= w; }
    else if (dx < -w / 2 && i > 0) { tabbarEl.insertBefore(moviendo, tabs[i - 1]); x0 -= w; dx += w; }
    moviendo.style.transform = `translateX(${dx}px)`;
  });
  const soltar = () => {
    clearTimeout(espera);
    if (!moviendo) return;
    moviendo.style.transform = '';
    moviendo.classList.remove('moviendo');
    tabbarEl.classList.remove('ordenando');
    moviendo = null;
    sinClic = true;
    setTimeout(() => { sinClic = false; }, 80);
    guardarPestanas();
  };
  tabbarEl.addEventListener('pointerup', soltar);
  tabbarEl.addEventListener('pointercancel', soltar);
  tabbarEl.addEventListener('click', (e) => { if (sinClic) { e.preventDefault(); e.stopPropagation(); } }, true);
}

// Deslizar a los lados cambia de pestaña (y da la vuelta); desde el borde izquierdo abre el menú
function cambiarPestana(d) {
  const vistas = [...tabbarEl.children].map((a) => a.dataset.view);
  const actual = state.view === 'amigo' ? 'shared' : state.view;
  let i = vistas.indexOf(actual);
  if (i < 0) i = d > 0 ? -1 : 0;
  const v = vistas[(i + d + vistas.length) % vistas.length];
  const c = $('#content');
  c.classList.remove('desde-dcha', 'desde-izq');
  void c.offsetWidth;
  c.classList.add(d > 0 ? 'desde-dcha' : 'desde-izq');
  go(v);
}
{
  let t = null;
  mainEl.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1 || !pestanaVisible() || e.target.closest('input, textarea, select, pre, .amigos-tira, .chips')) { t = null; return; }
    t = { x: e.touches[0].clientX, y: e.touches[0].clientY, ms: Date.now() };
  }, { passive: true });
  mainEl.addEventListener('touchend', (e) => {
    if (!t) return;
    const dx = e.changedTouches[0].clientX - t.x;
    const dy = e.changedTouches[0].clientY - t.y;
    const borde = t.x < 28;
    const rapido = Date.now() - t.ms < 700;
    t = null;
    if (!rapido || Math.abs(dx) < 70 || Math.abs(dx) < 1.8 * Math.abs(dy)) return;
    if (borde && dx > 0) abrirMenuLateral(true);
    else cambiarPestana(dx < 0 ? 1 : -1);
  }, { passive: true });
}

boot();
