'use strict';
// Syncthing en el Mac (u otro ordenador): la carpeta ~/Nuvora se sincroniza
// directamente con los móviles de tu cuenta, igual que entre móviles.
//
// Emparejar: el ordenador enseña un código de 6 cifras; el móvil lo encuentra
// en la wifi, manda el código y su id de Syncthing. El ordenador lo acepta como
// «introductor»: así conoce también al resto de tus móviles sin hacer nada más.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const ID_CARPETA = 'nuvora';

class SyncthingLocal {
  constructor({ binario, home, carpeta, puerto = 28386, log = () => {} }) {
    this.binario = binario;
    this.home = home;
    this.carpeta = carpeta;
    this.base = `http://127.0.0.1:${puerto}`;
    this.puerto = puerto;
    this.log = log;
    this.miId = null;
    this.proceso = null;
    this.codigo = null;
    this.fallos = 0;
    this.lineas = [];        // lo último que ha dicho Syncthing, para enseñarlo si algo falla
    this.ultimoError = null;
    this.reintentos = 0;
    fs.mkdirSync(home, { recursive: true });
    const claveArchivo = path.join(home, 'nuvora-apikey');
    if (!fs.existsSync(claveArchivo)) fs.writeFileSync(claveArchivo, crypto.randomBytes(24).toString('base64url'), { mode: 0o600 });
    this.apiKey = fs.readFileSync(claveArchivo, 'utf8');
    this.nuevoCodigo();
  }

  nuevoCodigo() {
    this.codigo = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    this.fallos = 0;
  }

  apuntar(texto) {
    this.log(texto);
    for (const l of String(texto).split('\n')) if (l.trim()) this.lineas.push(l.trimEnd());
    if (this.lineas.length > 60) this.lineas.splice(0, this.lineas.length - 60);
  }

  /** Un error que la web puede enseñar tal cual (503 y con lo que pasó). */
  noDisponible(motivo) {
    const err = new Error(`Syncthing no responde en este ordenador${motivo ? `: ${motivo}` : ''}. Se está reintentando solo.`);
    err.status = 503;
    return err;
  }

  async peticion(metodo, ruta, cuerpo) {
    let res;
    try {
      res = await fetch(this.base + ruta, {
      method: metodo,
      headers: { 'X-API-Key': this.apiKey, ...(cuerpo ? { 'Content-Type': 'application/json' } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined,
      });
    } catch (err) {
      throw this.noDisponible(this.ultimoError || (err.cause && err.cause.code) || err.message);
    }
    const texto = await res.text();
    if (!res.ok) throw new Error(`Syncthing ${metodo} ${ruta} → ${res.status} ${texto}`);
    return texto ? JSON.parse(texto) : null;
  }

  async arrancar() {
    this.proceso = spawn(this.binario, [
      'serve', '--home', this.home, '--no-browser', '--no-restart', '--no-upgrade',
      '--gui-address', `127.0.0.1:${this.puerto}`, '--gui-apikey', this.apiKey,
    ], { env: { ...process.env, STNOUPGRADE: '1', STNORESTART: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const proceso = this.proceso;
    this.proceso.stdout.on('data', (d) => this.apuntar(String(d)));
    this.proceso.stderr.on('data', (d) => this.apuntar(String(d)));
    this.proceso.on('error', (err) => { this.ultimoError = `no se pudo ejecutar (${err.code || err.message})`; this.apuntar(this.ultimoError); });
    this.proceso.on('exit', (c, senal) => {
      if (this.proceso === proceso) this.proceso = null;
      if (this.parado) return;
      this.ultimoError = `se cerró (${senal || `código ${c}`})`;
      this.apuntar(`Syncthing ${this.ultimoError}`);
      // Se vuelve a arrancar solo, cada vez un poco más tarde
      const espera = Math.min(60, 2 ** Math.min(this.reintentos++, 6)) * 1000;
      setTimeout(() => { if (!this.parado && !this.proceso) this.arrancar().catch((e) => this.apuntar(`No arrancó: ${e.message}`)); }, espera).unref();
    });
    for (let i = 0; i < 120; i++) {
      try {
        const salud = await (await fetch(`${this.base}/rest/noauth/health`)).json();
        if (salud.status === 'OK') break;
      } catch { /* aún arrancando */ }
      await new Promise((r) => setTimeout(r, 500));
    }
    this.miId = (await this.peticion('GET', '/rest/system/status')).myID;
    this.ultimoError = null;
    this.reintentos = 0;
    const o = await this.peticion('GET', '/rest/config/options');
    Object.assign(o, {
      urAccepted: -1, urSeen: 3, startBrowser: false, crashReportingEnabled: false, autoUpgradeIntervalH: 0,
      globalAnnounceEnabled: true, localAnnounceEnabled: true, relaysEnabled: true, natEnabled: true,
    });
    await this.peticion('PUT', '/rest/config/options', o);
    await this.prepararCarpeta();
    return this.miId;
  }

  async prepararCarpeta(extra = []) {
    fs.mkdirSync(path.join(this.carpeta, '.stfolder'), { recursive: true });
    // Lo que no debe viajar a los móviles: el estado de la sincronización con la web y basura del sistema
    const ignorar = path.join(this.carpeta, '.stignore');
    const reglas = '// Nuvora\n.nuvora-sync.json\n*.nuvora-part\n(?d).DS_Store\n(?d)Thumbs.db\n(?d)desktop.ini\n';
    if (!fs.existsSync(ignorar) || fs.readFileSync(ignorar, 'utf8') !== reglas) fs.writeFileSync(ignorar, reglas);
    let actual = null;
    try { actual = await this.peticion('GET', `/rest/config/folders/${ID_CARPETA}`); } catch { /* no existe aún */ }
    const ids = new Set([this.miId, ...((actual && actual.devices) || []).map((d) => d.deviceID), ...extra]);
    await this.peticion('PUT', `/rest/config/folders/${ID_CARPETA}`, {
      ...(actual || {}),
      id: ID_CARPETA,
      label: 'Nuvora',
      path: this.carpeta,
      type: 'sendreceive',
      devices: [...ids].map((deviceID) => ({ deviceID })),
      rescanIntervalS: 600,
      fsWatcherEnabled: true,
      fsWatcherDelayS: 2,
      ignorePerms: true,
      markerName: '.stfolder',
      versioning: { type: 'trashcan', params: { cleanoutDays: '30' } },
    });
  }

  /** El móvil se empareja con el código. Devuelve el id y el nombre de este ordenador. */
  async emparejar({ codigo, id, nombre }) {
    if (this.fallos >= 5) this.nuevoCodigo();
    if (String(codigo || '').replace(/\D/g, '') !== this.codigo) {
      this.fallos++;
      throw Object.assign(new Error('El código no es correcto. Míralo otra vez en el ordenador.'), { status: 403 });
    }
    if (!/^[A-Z0-9]{7}(-[A-Z0-9]{7}){7}$/.test(String(id || ''))) {
      throw Object.assign(new Error('Id de dispositivo no válido'), { status: 400 });
    }
    await this.peticion('PUT', `/rest/config/devices/${id}`, {
      deviceID: id,
      name: String(nombre || 'Móvil').slice(0, 80),
      addresses: ['dynamic'],
      // Introductor: el móvil le presenta al ordenador el resto de tus dispositivos
      introducer: true,
      autoAcceptFolders: true,
    });
    await this.prepararCarpeta([id]);
    this.nuevoCodigo();
    return { id: this.miId, nombre: os.hostname().replace(/\.local$/, '') };
  }

  async estado() {
    const [dispositivos, conexiones, carpeta] = await Promise.all([
      this.peticion('GET', '/rest/config/devices'),
      this.peticion('GET', '/rest/system/connections'),
      this.peticion('GET', `/rest/db/status?folder=${ID_CARPETA}`).catch(() => ({})),
    ]);
    return {
      id: this.miId,
      carpeta: this.carpeta,
      estado: carpeta.state || '',
      pendientes: carpeta.needFiles || 0,
      dispositivos: dispositivos.filter((d) => d.deviceID !== this.miId).map((d) => ({
        id: d.deviceID, nombre: d.name, conectado: !!(conexiones.connections[d.deviceID] || {}).connected,
      })),
    };
  }

  async quitar(id) {
    await this.peticion('DELETE', `/rest/config/devices/${id}`);
  }

  parar() {
    this.parado = true;
    if (this.proceso) this.proceso.kill();
  }
}

module.exports = { SyncthingLocal, ID_CARPETA };
