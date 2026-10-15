/* Página pública para enlaces compartidos (/s/:token) */
'use strict';

const token = location.pathname.split('/').pop();
const root = document.getElementById('root');
let key = null;
try { key = sessionStorage.getItem(`nuvora-key-${token}`); } catch { /* sin almacenamiento */ }

document.getElementById('theme-btn').innerHTML = icon('moon');
document.getElementById('theme-btn').onclick = toggleTheme;

function q(params = {}) {
  const sp = new URLSearchParams(params);
  if (key) sp.set('k', key);
  const s = sp.toString();
  return s ? `?${s}` : '';
}

async function load(nodeId) {
  const res = await fetch(`/api/public/${token}${q(nodeId ? { node: nodeId } : {})}`);
  const data = await res.json();
  if (res.status === 401 && data.needsPassword) return askPassword();
  if (!res.ok) return showError(data.error);
  render(data);
}

function showError(msg) {
  root.innerHTML = `<div class="center-card">${icon('link')}<h2>Enlace no disponible</h2><p class="muted">${esc(msg)}</p>
    <a class="btn primary" href="/">Ir a Nuvora</a></div>`;
}

function askPassword(error) {
  root.innerHTML = `<form class="center-card" id="pw">${icon('lock')}<h2>Enlace protegido</h2>
    <p class="muted">Introduce la contraseña para ver el contenido.</p>
    <input type="password" name="password" placeholder="Contraseña" required autofocus>
    ${error ? `<p class="error" style="margin-top:10px">${esc(error)}</p>` : ''}
    <button class="btn primary wide" style="margin-top:14px">Desbloquear</button></form>`;
  document.getElementById('pw').onsubmit = async (e) => {
    e.preventDefault();
    const res = await fetch(`/api/public/${token}/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: new FormData(e.target).get('password') }),
    });
    const data = await res.json();
    if (!res.ok) return askPassword(data.error);
    key = data.key;
    try { sessionStorage.setItem(`nuvora-key-${token}`, key); } catch { /* sin almacenamiento */ }
    load();
  };
}

function contentUrl(node, download) {
  return `/api/public/${token}/content${q({ node: node.id, ...(download ? { download: '1' } : {}) })}`;
}

function render(data) {
  const { node, owner, allowDownload } = data;
  const k = fileKind(node);
  const crumbs = data.breadcrumbs.length > 1
    ? `<nav class="crumbs">${data.breadcrumbs.map((c, i) => i === data.breadcrumbs.length - 1
      ? `<span>${esc(c.name)}</span>` : `<a href="#" data-node="${c.id}">${esc(c.name)}</a>${icon('chevron')}`).join('')}</nav>` : '';
  let stage = '';
  if (node.type === 'file') {
    const url = contentUrl(node);
    if (k.kind === 'image') stage = `<img src="${url}" alt="${esc(node.name)}">`;
    else if (k.kind === 'video') stage = `<video src="${url}" controls playsinline></video>`;
    else if (k.kind === 'audio') stage = `<audio src="${url}" controls></audio>`;
    else if (k.kind === 'pdf') stage = `<iframe src="${url}" title="${esc(node.name)}"></iframe>`;
    else if (k.kind === 'text' && node.size < 2 * 1024 * 1024) stage = '<pre>Cargando…</pre>';
    else stage = `<div class="nopreview">${icon(k.icon)}<p>${esc(k.label)} · ${formatSize(node.size)}</p></div>`;
  }
  root.innerHTML = `<div class="pub-card">
    ${crumbs}
    <div class="pub-head">
      <svg class="ico" viewBox="0 0 24 24" style="width:32px;height:32px;color:${k.color}">${ICONS[k.icon]}</svg>
      <div class="grow"><h1>${esc(node.name)}</h1>
        <span class="muted small">Compartido por ${esc(owner.name)}${node.type === 'file' ? ` · ${formatSize(node.size)}` : ` · ${data.items.length} elementos`}</span></div>
      ${allowDownload ? `<a class="btn primary" href="${contentUrl(node, true)}" download>${icon('download')} ${node.type === 'folder' ? 'Descargar ZIP' : 'Descargar'}</a>` : ''}
    </div>
    ${node.type === 'file' ? `<div class="pub-stage">${stage}</div>` : `<div class="pub-list">${data.items.map((it) => {
      const ik = fileKind(it);
      return `<div class="pub-row" data-node="${it.id}"><svg class="ico" viewBox="0 0 24 24" style="color:${ik.color}">${ICONS[ik.icon]}</svg>
        <span class="n">${esc(it.name)}</span><span class="muted small">${it.type === 'folder' ? '' : formatSize(it.size)}</span></div>`;
    }).join('') || '<p class="muted" style="padding:20px">Esta carpeta está vacía.</p>'}</div>`}
  </div>`;
  if (node.type === 'file' && k.kind === 'text' && node.size < 2 * 1024 * 1024) {
    fetch(contentUrl(node)).then((r) => r.text()).then((t) => { root.querySelector('pre').textContent = t; });
  }
  root.querySelectorAll('[data-node]').forEach((el) => el.addEventListener('click', (e) => {
    e.preventDefault();
    load(el.dataset.node);
  }));
}

load();
