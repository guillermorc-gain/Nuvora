# ☁ Nuvora

Nuvora es una nube personal estilo Google Drive para **guardar, compartir y sincronizar** archivos, fotos, videos y lo que quieras.

## Funciones

**Archivos y carpetas**
- Subida de archivos y carpetas completas (botón *Nuevo* o arrastrando y soltando), con barra de progreso.
- Carpetas anidadas, renombrar, mover (diálogo o arrastrando sobre una carpeta), copiar, destacar.
- Papelera con restauración y vaciado; búsqueda instantánea por nombre.
- Vista en cuadrícula con miniaturas o en lista; tema claro/oscuro; diseño adaptable a móvil.
- Atajos: `Supr` papelera · `F2` renombrar · `Enter` abrir · `Ctrl/⌘+A` seleccionar todo · `Shift/Ctrl+clic` selección múltiple.

**Vista previa**
- Imágenes, video y audio (con *streaming* por rangos para poder saltar dentro de un video), PDF y texto/código.
- Navegación con ← → entre archivos.

**Compartir**
- Con otras personas de Nuvora por correo, como **Lector** o **Editor** (los editores pueden subir y renombrar dentro de la carpeta).
- **Enlaces públicos** sin necesidad de cuenta: con contraseña opcional, caducidad y opción de desactivar descargas. Contador de visitas.
- Las carpetas se pueden descargar como **ZIP**.

**Sincronización**
- Cambios en **tiempo real** en la web (Server-Sent Events): si subes algo desde otro dispositivo, aparece al instante.
- Cliente de escritorio **`nuvora-sync`**: sincroniza en ambos sentidos una carpeta local con *Mi unidad*, detecta cambios por huella SHA-256, resuelve conflictos conservando las dos versiones y manda los borrados a la papelera.

**Por dentro**
- Almacenamiento direccionado por contenido: los archivos idénticos sólo ocupan espacio una vez.
- Cuota por usuario (15 GB por defecto), contraseñas con *scrypt*, sesiones con cookie `HttpOnly` + protección CSRF, archivos HTML/SVG servidos como texto para evitar XSS.

## Puesta en marcha

Requiere **Node.js 22.13 o superior** (usa el SQLite integrado en Node).

```bash
npm install
npm start            # http://localhost:3000
```

Variables de entorno opcionales:

| Variable           | Por defecto | Descripción                              |
|--------------------|-------------|------------------------------------------|
| `PORT`             | `3000`      | Puerto HTTP                              |
| `HOST`             | `0.0.0.0`   | Interfaz de escucha                      |
| `NUVORA_DATA`      | `./data`    | Carpeta para la base de datos y archivos |
| `NUVORA_QUOTA_GB`  | `15`        | Cuota de almacenamiento por usuario      |

> Para usarlo fuera de tu red local, ponlo detrás de un proxy con HTTPS (Caddy, Nginx…).

## Sincronizar una carpeta del ordenador

```bash
node sync/nuvora-sync.js login --server http://localhost:3000 --email tu@correo.com
node sync/nuvora-sync.js sync ~/Nuvora --watch     # se queda vigilando cambios
node sync/nuvora-sync.js status ~/Nuvora
```

También puedes instalarlo como comando global con `npm link` y usar `nuvora-sync`.

## Pruebas

```bash
npm test
```

Cubren autenticación, subidas, carpetas, papelera, descargas por rangos, ZIP, permisos al compartir, enlaces con contraseña, cuota y la sincronización bidireccional (incluidos conflictos y borrados).

## Estructura

```
server/   API y servidor (Express + node:sqlite)
public/   Aplicación web (HTML/CSS/JS sin compilación) y página de enlaces públicos
sync/     Cliente de sincronización de escritorio
test/     Pruebas de integración
```
