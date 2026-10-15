'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

function openDatabase(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'nuvora.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL UNIQUE COLLATE NOCASE,
      pass_hash   TEXT NOT NULL,
      quota       INTEGER NOT NULL,
      color       TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token       TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label       TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS nodes (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_id   TEXT REFERENCES nodes(id) ON DELETE CASCADE,
      name        TEXT NOT NULL,
      type        TEXT NOT NULL CHECK (type IN ('file','folder')),
      size        INTEGER NOT NULL DEFAULT 0,
      mime        TEXT,
      hash        TEXT,
      starred     INTEGER NOT NULL DEFAULT 0,
      trashed_at  INTEGER,
      created_by  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      version     INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_nodes_parent ON nodes(owner_id, parent_id);
    CREATE INDEX IF NOT EXISTS idx_nodes_hash ON nodes(hash);

    CREATE TABLE IF NOT EXISTS shares (
      id          TEXT PRIMARY KEY,
      node_id     TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role        TEXT NOT NULL CHECK (role IN ('viewer','editor')),
      created_at  INTEGER NOT NULL,
      UNIQUE (node_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS links (
      token          TEXT PRIMARY KEY,
      node_id        TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE,
      created_by     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      pass_hash      TEXT,
      expires_at     INTEGER,
      allow_download INTEGER NOT NULL DEFAULT 1,
      views          INTEGER NOT NULL DEFAULT 0,
      created_at     INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS changes (
      seq         INTEGER PRIMARY KEY AUTOINCREMENT,
      owner_id    TEXT NOT NULL,
      node_id     TEXT NOT NULL,
      action      TEXT NOT NULL,
      at          INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_changes_owner ON changes(owner_id, seq);

    CREATE TABLE IF NOT EXISTS vinculos (
      secreto     TEXT PRIMARY KEY,
      codigo      TEXT NOT NULL UNIQUE,
      cliente     TEXT NOT NULL,
      user_id     TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at  INTEGER NOT NULL
    );
  `);
  // Columnas añadidas después (bases de datos de versiones anteriores)
  const cols = new Set(db.prepare('PRAGMA table_info(users)').all().map((c) => c.name));
  if (!cols.has('google_sub')) db.exec('ALTER TABLE users ADD COLUMN google_sub TEXT');
  if (!cols.has('foto')) db.exec('ALTER TABLE users ADD COLUMN foto TEXT');
  // Cuenta creada al compartir o al añadir de amigo a alguien que aún no ha entrado en Nuvora
  if (!cols.has('pendiente')) db.exec('ALTER TABLE users ADD COLUMN pendiente INTEGER NOT NULL DEFAULT 0');
  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_users_google ON users(google_sub)');
  db.exec(`CREATE TABLE IF NOT EXISTS amigos (
      user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      amigo_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      PRIMARY KEY (user_id, amigo_id)
    )`);
  return db;
}

module.exports = { openDatabase };
