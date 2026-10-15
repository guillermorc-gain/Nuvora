'use strict';
// Generador ZIP mínimo (sin compresión, método "store") para descargar
// carpetas completas. Admite archivos de hasta 4 GB.
const fs = require('node:fs');
const zlib = require('node:zlib');

function dosDateTime(ms) {
  const d = new Date(ms);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const date = ((Math.max(d.getFullYear(), 1980) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date };
}

async function crcOfFile(file) {
  let crc = 0;
  for await (const chunk of fs.createReadStream(file)) crc = zlib.crc32(chunk, crc);
  return crc >>> 0;
}

function write(out, buf) {
  return new Promise((resolve, reject) => {
    if (out.destroyed) return reject(new Error('cliente desconectado'));
    if (out.write(buf)) resolve();
    else out.once('drain', resolve);
  });
}

// entries: [{ name: 'carpeta/archivo.txt', file: '/ruta/en/disco' | null (carpeta), mtime }]
async function streamZip(out, entries) {
  const central = [];
  let offset = 0;
  for (const entry of entries) {
    const isDir = !entry.file;
    const name = Buffer.from(isDir ? entry.name.replace(/\/?$/, '/') : entry.name, 'utf8');
    const size = isDir ? 0 : fs.statSync(entry.file).size;
    const crc = isDir ? 0 : await crcOfFile(entry.file);
    const { time, date } = dosDateTime(entry.mtime || Date.now());

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nombres en UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(time, 10);
    local.writeUInt16LE(date, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    await write(out, local);
    await write(out, name);
    if (!isDir) {
      for await (const chunk of fs.createReadStream(entry.file)) await write(out, chunk);
    }

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(0x0800, 8);
    cd.writeUInt16LE(0, 10);
    cd.writeUInt16LE(time, 12);
    cd.writeUInt16LE(date, 14);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(size, 20);
    cd.writeUInt32LE(size, 24);
    cd.writeUInt16LE(name.length, 28);
    cd.writeUInt32LE(isDir ? 0x10 : 0, 38);
    cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, name]));
    offset += 30 + name.length + size;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  await write(out, cdBuf);
  await write(out, end);
  out.end();
}

module.exports = { streamZip };
