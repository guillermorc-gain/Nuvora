/* Utilidades compartidas entre la app y la página de enlaces públicos */
'use strict';

const ICONS = {
  drive: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  people: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.5a6.5 6.5 0 0 1 3.5 5.5"/>',
  link: '<path d="M10 14a4.5 4.5 0 0 0 6.4 0l3-3a4.5 4.5 0 0 0-6.4-6.4l-1 1"/><path d="M14 10a4.5 4.5 0 0 0-6.4 0l-3 3a4.5 4.5 0 0 0 6.4 6.4l1-1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
  sync: '<path d="M20 12a8 8 0 0 1-14.3 4.9M4 12a8 8 0 0 1 14.3-4.9"/><path d="M18.5 3v4.2h-4.2M5.5 21v-4.2h4.2"/>',
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
  video: '<rect x="3" y="5" width="13" height="14" rx="2"/><path d="m16 10 5-3v10l-5-3z"/>',
  audio: '<path d="M9 18V6l11-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',
  pdf: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M8.5 13h7M8.5 16.5h5"/>',
  zip: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M11 4v2m0 2v2m0 2v2"/><rect x="9.5" y="14" width="3" height="3" rx=".5"/>',
  code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14"/>',
  sheet: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 9h16M4 15h16M10 3v18"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M4 19h16"/>',
  upload: '<path d="M12 16V5m0 0L7.5 9.5M12 5l4.5 4.5M4 19h16"/>',
  share: '<circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.2 10.8 7.6-4.4M8.2 13.2l7.6 4.4"/>',
  edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13.5 6.5 4 4"/>',
  move: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M10 13h6m-2-2 2 2-2 2"/>',
  copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5"/>',
  restore: '<path d="M4 12a8 8 0 1 0 2.3-5.7L4 8.6"/><path d="M4 4v4.6h4.6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  folderPlus: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 10.5v5M9.5 13h5"/>',
  folderUp: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 16v-5m0 0-2.5 2.5M12 11l2.5 2.5"/>',
  more: '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  eye: '<path d="M2.5 12S6 5 12 5s9.5 7 9.5 7-3.5 7-9.5 7-9.5-7-9.5-7z"/><circle cx="12" cy="12" r="3"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  logout: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 16l-4-4 4-4M6 12h10"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  chevron: '<path d="m9 6 6 6-6 6"/>',
  back: '<path d="m15 6-6 6 6 6"/>',
  palette: '<path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.8-.9 1.8-1.9 0-.5-.2-.9-.5-1.3-.3-.3-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4C21 6.4 17 3 12 3z"/><circle cx="7.5" cy="11.5" r="1.2"/><circle cx="10" cy="7.2" r="1.2"/><circle cx="15" cy="7.5" r="1.2"/>',
  keyboard: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9"/>',
  devices: '<rect x="2.5" y="4" width="13" height="10" rx="1.5"/><path d="M6 18h6M9 14v4"/><rect x="16" y="8" width="5.5" height="12" rx="1.3"/><path d="M18.5 17.5h.5"/>',
  terminal: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M12 15h5"/>',
};

function icon(name, cls = '') {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.file}</svg>`;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatSize(bytes) {
  if (bytes == null) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024, i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 ? 1 : 0).replace('.', ',')} ${units[i]}`;
}

function formatDate(ms) {
  if (!ms) return '—';
  const d = new Date(ms);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

// Clasifica un archivo para elegir icono, color y tipo de vista previa
function fileKind(item) {
  if (item.type === 'folder') return { kind: 'folder', icon: 'folder', color: 'var(--c-folder)', label: 'Carpeta' };
  const m = item.mime || '';
  const ext = (item.name.split('.').pop() || '').toLowerCase();
  if (m.startsWith('image/')) return { kind: 'image', icon: 'image', color: '#E8505B', label: 'Imagen' };
  if (m.startsWith('video/')) return { kind: 'video', icon: 'video', color: '#E84393', label: 'Video' };
  if (m.startsWith('audio/')) return { kind: 'audio', icon: 'audio', color: '#F59E0B', label: 'Audio' };
  if (m === 'application/pdf') return { kind: 'pdf', icon: 'pdf', color: '#DC2626', label: 'PDF' };
  if (/zip|rar|7z|gzip|tar/.test(m)) return { kind: 'zip', icon: 'zip', color: '#8B5CF6', label: 'Comprimido' };
  if (/sheet|excel|csv/.test(m)) return { kind: 'text', icon: 'sheet', color: '#16A34A', label: 'Hoja de cálculo' };
  if (/word|document|presentation|powerpoint/.test(m)) return { kind: 'doc', icon: 'pdf', color: '#2563EB', label: 'Documento' };
  if (/javascript|json|xml|html|css|x-python|yaml/.test(m) || ['js', 'ts', 'py', 'java', 'c', 'cpp', 'go', 'rs', 'sh', 'sql'].includes(ext)) {
    return { kind: 'text', icon: 'code', color: '#0EA5E9', label: 'Código' };
  }
  if (m.startsWith('text/')) return { kind: 'text', icon: 'file', color: '#3B82F6', label: 'Texto' };
  return { kind: 'other', icon: 'file', color: '#64748B', label: 'Archivo' };
}

function toast(message, type = '') {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = message;
  box.appendChild(el);
  setTimeout(() => el.classList.add('out'), 3200);
  setTimeout(() => el.remove(), 3600);
}

// Diálogo modal genérico. Devuelve { el, close }.
function openModal({ title, body, actions = [], wide = false, onClose }) {
  const root = document.getElementById('modal-root');
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true" aria-label="${esc(title)}">
      <header><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="Cerrar">${icon('close')}</button></header>
      <div class="modal-body"></div>
      ${actions.length ? '<footer></footer>' : ''}
    </div>`;
  const bodyEl = wrap.querySelector('.modal-body');
  if (typeof body === 'string') bodyEl.innerHTML = body; else if (body) bodyEl.appendChild(body);
  const close = () => {
    wrap.remove();
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });
  wrap.querySelector('[data-close]').onclick = close;
  const footer = wrap.querySelector('footer');
  for (const a of actions) {
    const b = document.createElement('button');
    b.className = `btn ${a.primary ? 'primary' : a.danger ? 'danger' : 'ghost'}`;
    b.textContent = a.label;
    b.onclick = async () => {
      if (a.onClick) {
        b.disabled = true;
        try { if ((await a.onClick(wrap)) !== false) close(); } finally { b.disabled = false; }
      } else close();
    };
    footer.appendChild(b);
  }
  root.appendChild(wrap);
  const first = wrap.querySelector('input, select, textarea');
  if (first) setTimeout(() => { first.focus(); first.select && first.select(); }, 30);
  return { el: wrap, close };
}

// ---------- Apariencia: temas y opciones ----------
// Paleta: [fondo, tarjeta, suave, tinte, tinta, secundario, línea, acento]
const TEMAS = {
  nuvora: { nombre: 'Nuvora', claro: null, oscuro: null, muestra: ['#F6F5FC', '#7C5CFF', '#22D3EE'], cabecera: ['#7C5CFF', '#5B7CFF', '#1FB8D8'] },
  medianoche: { nombre: 'Medianoche',
    claro: ['#EEF2FB', '#FFFFFF', '#E6ECF8', '#DFE6FB', '#16203D', '#5D6A8F', '#D5DCEF', '#4338CA'],
    oscuro: ['#0B1020', '#141C33', '#1A2444', '#1B2D6B', '#DCE6FF', '#8B9AC4', '#26345E', '#22D3EE'],
    muestra: ['#0B1020', '#22D3EE', '#6366F1'], cabecera: ['#1E1B4B', '#4338CA', '#0891B2'] },
  amanecer: { nombre: 'Amanecer',
    claro: ['#FFF7F0', '#FFFFFF', '#FFF0E6', '#FFE7D8', '#3B2A24', '#9B7D70', '#FFD9C2', '#C2410C'],
    oscuro: ['#1F1512', '#2A1D18', '#33231D', '#4A2A1F', '#FFE9DC', '#C09A88', '#4A342A', '#FF9A66'],
    muestra: ['#FFF7F0', '#FF8A4C', '#FF5F7E'], cabecera: ['#FF7A45', '#FF4F7B', '#B83280'] },
  bosque: { nombre: 'Bosque',
    claro: ['#F1EFE6', '#FBFAF5', '#ECE8DA', '#E3ECDC', '#233127', '#6F7A68', '#DCD7C5', '#2F5A3E'],
    oscuro: ['#141C16', '#1C261F', '#223027', '#2A3D2F', '#E3EADB', '#9AA892', '#2F3F33', '#8FBF6A'],
    muestra: ['#F1EFE6', '#2F5A3E', '#6B8F47'], cabecera: ['#1F3B2A', '#3F6B3A', '#7A9A3F'] },
  oceano: { nombre: 'Océano',
    claro: ['#E6F6FA', '#FFFFFF', '#DFF1F7', '#D3EEF6', '#0F3B4C', '#5B7F8F', '#C9E3EC', '#0A6F94'],
    oscuro: ['#06222E', '#0B2F3D', '#0F3848', '#10455A', '#D6F3FB', '#7FB0C0', '#15485A', '#3FD0E0'],
    muestra: ['#E0F7FA', '#00A6B8', '#1565C0'], cabecera: ['#033E6B', '#0369A1', '#06B6D4'] },
  grafito: { nombre: 'Grafito',
    claro: ['#F2F1EE', '#FFFFFF', '#EAE8E3', '#F7EECD', '#26272B', '#6D6B66', '#DEDBD3', '#8A6508'],
    oscuro: ['#1A1B1E', '#232428', '#2A2B30', '#3A3320', '#E6E3DC', '#9A978F', '#34353A', '#F4C542'],
    muestra: ['#1A1B1E', '#F4C542', '#34353A'], cabecera: ['#141518', '#2E2F35', '#8A6A12'] },
  pastel: { nombre: 'Pastel',
    claro: ['#F6F3FF', '#FFFFFF', '#F1EDFF', '#ECE6FF', '#3D3654', '#8A83A3', '#E5DEFA', '#6D4FE0'],
    oscuro: ['#1E1B2E', '#28243D', '#2F2A48', '#3A3358', '#ECE6FF', '#A79FC4', '#3D3660', '#C9B8FF'],
    muestra: ['#F6F3FF', '#C9B8FF', '#A8E6CF'], cabecera: ['#7C6CF0', '#B794F6', '#F0A6CA'] },
  retro: { nombre: 'Retro 80',
    claro: ['#FFF0FA', '#FFFFFF', '#FBE6F5', '#F3E0FF', '#2B1640', '#7A5C96', '#E9C6F0', '#B00D72'],
    oscuro: ['#1B0F33', '#251548', '#2D1A57', '#3A2468', '#F3E9FF', '#B7A3D9', '#784BA0', '#FFD319'],
    muestra: ['#1B0F33', '#FF3CAC', '#FFD319'], cabecera: ['#3B0A6B', '#C0157F', '#FF8A00'] },
  mediterraneo: { nombre: 'Mediterráneo',
    claro: ['#FBFAF7', '#FFFFFF', '#F4F1EA', '#E8EEF6', '#1D3557', '#6B7A8F', '#E7E2D8', '#1D4E89'],
    oscuro: ['#0F1A2B', '#16243A', '#1B2C46', '#1D3557', '#E8EEF6', '#93A4BD', '#26395A', '#7FB2F0'],
    muestra: ['#FBFAF7', '#1D4E89', '#C8553D'], cabecera: ['#1D4E89', '#2F6FB3', '#C8553D'] },
};

const LETRAS = {
  sistema: { nombre: 'La del sistema', css: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif' },
  clasica: { nombre: 'Clásica', css: '"Lora", Georgia, serif', g: 'Lora:wght@400;500;600;700' },
  elegante: { nombre: 'Elegante', css: '"Playfair Display", Georgia, serif', g: 'Playfair+Display:wght@400;600;700;800' },
  moderna: { nombre: 'Moderna', css: '"Montserrat", system-ui, sans-serif', g: 'Montserrat:wght@400;500;600;700;800' },
  redondeada: { nombre: 'Redondeada', css: '"Nunito", system-ui, sans-serif', g: 'Nunito:wght@400;600;700;800' },
  suave: { nombre: 'Suave', css: '"Quicksand", system-ui, sans-serif', g: 'Quicksand:wght@400;500;600;700' },
  geometrica: { nombre: 'Geométrica', css: '"Comfortaa", system-ui, sans-serif', g: 'Comfortaa:wght@400;600;700' },
  estrecha: { nombre: 'Estrecha', css: '"Roboto Condensed", "Arial Narrow", sans-serif', g: 'Roboto+Condensed:wght@400;600;700' },
  maquina: { nombre: 'Máquina de escribir', css: '"Courier Prime", "Courier New", monospace', g: 'Courier+Prime:wght@400;700' },
  amano: { nombre: 'A mano', css: '"Caveat", "Segoe Print", cursive', g: 'Caveat:wght@400;600;700' },
};

const FORMAS = {
  clasico: { nombre: 'Clásico', r: [8, 12, 16, 22, 999] },
  redondeado: { nombre: 'Redondeado', r: [14, 20, 26, 26, 999] },
  recto: { nombre: 'Recto', r: [3, 3, 3, 3, 3] },
  plano: { nombre: 'Plano', r: [5, 7, 10, 13, 999] },
};

const APARIENCIA_POR_DEFECTO = {
  tema: 'nuvora', modo: 'sistema', texto: 'normal', estilo: 'clasico', fuente: 'sistema',
  cabecera: 'degradado', pestanas: 'todo', animaciones: true, inicio: 'drive',
};

function leerApariencia() {
  try { return { ...APARIENCIA_POR_DEFECTO, ...JSON.parse(localStorage.getItem('nuvora-apariencia') || '{}') }; }
  catch { return { ...APARIENCIA_POR_DEFECTO }; }
}

let apariencia = leerApariencia();
const oscuroDelSistema = matchMedia('(prefers-color-scheme: dark)');

function esOscuro() {
  return apariencia.modo === 'oscuro' || (apariencia.modo === 'sistema' && oscuroDelSistema.matches);
}

function oscurecer(hex, f = 0.62) {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(((n >> v) & 255) * f).toString(16).padStart(2, '0');
  return `#${c(16)}${c(8)}${c(0)}`;
}

function aplicarApariencia() {
  const root = document.documentElement;
  const a = apariencia;
  const oscuro = esOscuro();
  if (a.modo === 'sistema') delete root.dataset.theme; else root.dataset.theme = a.modo === 'oscuro' ? 'dark' : 'light';
  const props = ['--bg', '--surface', '--surface-2', '--tint', '--text', '--muted', '--border', '--primary', '--primary-ink', '--head-1', '--head-2', '--head-3'];
  props.forEach((p) => root.style.removeProperty(p));
  const tema = TEMAS[a.tema];
  if (tema && tema.claro) {
    const p = oscuro ? tema.oscuro : tema.claro;
    const vals = [p[0], p[1], p[2], p[3], p[4], p[5], p[6], p[7], oscuro ? p[0] : '#FFFFFF',
      ...tema.cabecera.map((c) => (oscuro ? oscurecer(c) : c))];
    props.forEach((prop, i) => root.style.setProperty(prop, vals[i]));
  }
  const letra = LETRAS[a.fuente] || LETRAS.sistema;
  if (letra.g && !document.getElementById(`font-${a.fuente}`)) {
    const link = document.createElement('link');
    link.id = `font-${a.fuente}`;
    link.rel = 'stylesheet';
    link.href = `https://fonts.googleapis.com/css2?family=${letra.g}&display=swap`;
    document.head.appendChild(link);
  }
  root.style.setProperty('--font', letra.css);
  const r = (FORMAS[a.estilo] || FORMAS.clasico).r;
  ['--r-sm', '--r-md', '--r-lg', '--r-xl', '--r-pill'].forEach((v, i) => root.style.setProperty(v, `${r[i]}px`));
  root.style.setProperty('--zoom', { pequeno: 0.9, grande: 1.12, muygrande: 1.25 }[a.texto] || 1);
  root.classList.toggle('liso', a.cabecera === 'liso');
  root.classList.toggle('solo-iconos', a.pestanas === 'iconos');
  root.classList.toggle('no-anim', !a.animaciones);
  const meta = document.querySelector('meta[name=theme-color]');
  const cabecera = getComputedStyle(root).getPropertyValue('--head-1').trim() || '#7C5CFF';
  if (meta) meta.content = cabecera;
  // En la app de Android, la barra de estado toma el color de la cabecera
  if (window.NuvoraApp && window.NuvoraApp.colorBarra) window.NuvoraApp.colorBarra(cabecera);
}

function guardarApariencia(cambios) {
  apariencia = { ...apariencia, ...cambios };
  try { localStorage.setItem('nuvora-apariencia', JSON.stringify(apariencia)); } catch { /* sin almacenamiento */ }
  aplicarApariencia();
}

oscuroDelSistema.addEventListener('change', aplicarApariencia);
aplicarApariencia();

function toggleTheme() {
  guardarApariencia({ modo: esOscuro() ? 'claro' : 'oscuro' });
}
