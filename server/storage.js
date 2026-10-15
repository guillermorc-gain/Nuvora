'use strict';
// Almacenamiento de contenido direccionado por hash (SHA-256): los archivos
// idénticos se guardan una sola vez en disco.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');

class BlobStore {
  constructor(dir) {
    this.dir = dir;
    this.tmp = path.join(dir, 'tmp');
    fs.mkdirSync(this.tmp, { recursive: true });
  }

  pathFor(hash) {
    return path.join(this.dir, hash.slice(0, 2), hash);
  }

  exists(hash) {
    return fs.existsSync(this.pathFor(hash));
  }

  // Guarda un stream; devuelve { hash, size }. Lanza un error si supera maxBytes.
  async write(stream, maxBytes = Infinity) {
    const tmpFile = path.join(this.tmp, crypto.randomUUID());
    const sha = crypto.createHash('sha256');
    let size = 0;
    let overflow = false;
    // Al superar el límite se sigue consumiendo la entrada (sin escribirla) para no bloquear la petición
    const meter = new Transform({
      transform(chunk, _enc, cb) {
        size += chunk.length;
        if (overflow || size > maxBytes) { overflow = true; return cb(); }
        sha.update(chunk);
        cb(null, chunk);
      },
    });
    try {
      await pipeline(stream, meter, fs.createWriteStream(tmpFile));
    } catch (err) {
      fs.rmSync(tmpFile, { force: true });
      throw err;
    }
    if (overflow) {
      fs.rmSync(tmpFile, { force: true });
      throw Object.assign(new Error('Espacio de almacenamiento insuficiente'), { status: 413 });
    }
    const hash = sha.digest('hex');
    const dest = this.pathFor(hash);
    if (fs.existsSync(dest)) {
      fs.rmSync(tmpFile, { force: true });
    } else {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(tmpFile, dest);
    }
    return { hash, size };
  }

  remove(hash) {
    fs.rmSync(this.pathFor(hash), { force: true });
  }
}

module.exports = { BlobStore };
