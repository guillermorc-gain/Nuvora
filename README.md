# ☁ Nuvora

Nuvora es una nube personal estilo Google Drive para **guardar, compartir y sincronizar** archivos, fotos, videos y lo que quieras.

Su icono es **Nube N**: una nube blanca con la N calada sobre un degradado violeta → cian, que da los colores a toda la
interfaz. Comparte con **Memories** la forma de sincronizar (Syncthing entre dispositivos) y las opciones de apariencia.

## Funciones

**Archivos y carpetas**
- Subida de archivos y carpetas completas (botón *Nuevo* o arrastrando y soltando), con barra de progreso.
- Carpetas anidadas, renombrar, mover (diálogo o arrastrando sobre una carpeta), copiar, destacar.
- Papelera con restauración y vaciado; búsqueda instantánea por nombre.
- Vista en cuadrícula con miniaturas o en lista; diseño adaptable a móvil con pestañas abajo y botón «Nuevo» flotante.
- Atajos: `Supr` papelera · `F2` renombrar · `Enter` abrir · `Ctrl/⌘+A` seleccionar todo · `Shift/Ctrl+clic` selección múltiple.

**Apariencia** (como en Memories)
- Temas: Nuvora, Medianoche, Amanecer, Bosque, Océano, Grafito, Pastel, Retro 80 y Mediterráneo, cada uno con su versión clara y oscura.
- Modo claro, oscuro o como el sistema; letra, formas (clásico, redondeado, recto, plano), tamaño del texto,
  cabecera con degradado o lisa, pestañas con nombre o solo icono, animaciones y la vista con la que se abre.
- Anillo que gira alrededor de la foto de perfil mientras se suben o llegan cambios.

**Vista previa**
- Imágenes, video y audio (con *streaming* por rangos para poder saltar dentro de un video), PDF y texto/código.
- Navegación con ← → entre archivos.

**Compartir**
- Con otras personas de Nuvora por correo, como **Lector** o **Editor** (los editores pueden subir y renombrar dentro de la carpeta).
- **Enlaces públicos** sin necesidad de cuenta: con contraseña opcional, caducidad y opción de desactivar descargas. Contador de visitas.
- Las carpetas se pueden descargar como **ZIP**.

**Sincronización**
- Cambios en **tiempo real** en la web (Server-Sent Events): si subes algo desde otro dispositivo, aparece al instante.
- Cliente de escritorio **`nuvora-sync`**: mantiene una carpeta local al día con *Mi unidad*, detecta cambios por huella SHA-256 y resuelve conflictos conservando las dos versiones.
- Como en Memories para ordenador, eliges el **sentido** (en los dos, solo subir como copia de seguridad, o solo bajar)
  y si los **borrados** viajan al otro lado (a la papelera de Nuvora, recuperables). La página *Sincronización* de la web te prepara la orden.

**Por dentro**
- Almacenamiento direccionado por contenido: los archivos idénticos sólo ocupan espacio una vez.
- Cuota por usuario (15 GB por defecto), contraseñas con *scrypt*, sesiones con cookie `HttpOnly` + protección CSRF, archivos HTML/SVG servidos como texto para evitar XSS.

## Descargar

- **Servidor (ordenador):** <https://github.com/guillermorc-gain/Nuvora/releases/latest/download/Nuvora.zip>
- **App de Android:** <https://github.com/guillermorc-gain/Nuvora/releases/latest/download/Nuvora.apk>
- **App para Mac (Apple Silicon):** <https://github.com/guillermorc-gain/Nuvora/releases/latest/download/Nuvora-Mac.dmg>

Cada cambio en la app se prueba y se publica automáticamente en
[Releases](https://github.com/guillermorc-gain/Nuvora/releases) como `v0.1`, `v0.2`… (workflow
`.github/workflows/publicar.yml`). El ZIP ya incluye las dependencias: descomprímelo y abre
**Iniciar Nuvora** con doble clic (Windows: `.bat`; Mac: `.command`). Solo necesitas [Node.js](https://nodejs.org/es/download) 22.13 o superior.

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

## Iniciar sesión con Google

Nuvora tiene su **propio proyecto de Firebase («Nuvora»)**, separado del de Memories. Solo se usa para el inicio de
sesión con Google: los archivos siguen en tu servidor. Con la misma cuenta, el móvil, la web y el ordenador ven los
mismos archivos y los cambios llegan al momento.

Hay tres formas de entrar:

- **Continuar con Google:** en la app de Android (inicio de sesión nativo) y en la web abierta en `http://localhost:3000`.
- **Entrar con otro dispositivo:** el dispositivo nuevo enseña un código de 8 letras; en otro donde ya hayas entrado,
  *foto de perfil → Vincular un dispositivo* y escribes el código (como al vincular el ordenador en Memories).
  Sirve en cualquier navegador y en `nuvora-sync login`.
- **Correo y contraseña**, como antes. Si después entras con Google con el mismo correo, es la misma cuenta.

### Crear el proyecto de Firebase (una vez, gratis, sin tarjeta)

1. En <https://console.firebase.google.com> → **Crear un proyecto** → nombre `Nuvora`. No hace falta Google Analytics.
2. **Authentication → Comenzar → Método de acceso → Google → Habilitar** (elige tu correo de asistencia) → Guardar.
3. **Configuración del proyecto (⚙) → Tus apps → Añadir app → Android**:
   - Nombre del paquete: `com.guillermorc.nuvora`
   - SHA-1: `24:B5:AC:C2:4C:91:BF:97:F4:C5:89:32:99:B0:FB:E3:2A:B1:ED:90`
   - (SHA-256, por si lo pide: `E0:2E:F6:68:92:50:20:F3:9D:56:D3:54:7E:A1:73:63:E1:E5:50:45:72:12:62:F2:94:B6:57:6D:38:D4:F2:26`)
4. Descarga **`google-services.json`** (después del paso 2, para que lleve el cliente web) y súbelo al repo como
   `android/app/google-services.json`. Al subirlo se publica una versión nueva: la APK y el ZIP del servidor ya
   llevan Google configurado (el servidor lee el ID del mismo archivo).
5. **Para la web**: en <https://console.cloud.google.com/apis/credentials> (proyecto *Nuvora*) abre el cliente
   *Web client (auto created by Google Service)* y en **Orígenes autorizados de JavaScript** añade
   `http://localhost` y `http://localhost:3000` (y la dirección `https://…` fija de tu túnel, si tienes una).
   Google solo permite `localhost` o direcciones `https`.

También se puede indicar el cliente a mano: `NUVORA_GOOGLE_CLIENT_ID=<id del cliente web> npm start`.

## Usarlo fuera de casa

```bash
npm run tunel
```

Arranca el servidor y lo publica en internet con un túnel HTTPS gratuito de Cloudflare, sin abrir puertos en el router
(hay que instalar [`cloudflared`](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)).
Muestra una dirección `https://….trycloudflare.com` para escribir en la app (*foto de perfil → Cambiar de servidor*).

Esa dirección cambia cada vez. Para una **fija**, con una cuenta de Cloudflare y un dominio:
`cloudflared tunnel login`, `cloudflared tunnel create nuvora`, `cloudflared tunnel route dns nuvora nuvora.tudominio.com`,
apunta el túnel a `http://localhost:3000` y arranca con `NUVORA_TUNEL=nuvora npm run tunel`.

## App para Mac (Apple Silicon)

`mac/` es Nuvora para Mac: una app nativa en Swift que **lleva dentro el servidor y Node.js**, así que no hay que
instalar nada más. Al abrirla:

- arranca tu Nuvora en el Mac (los archivos se guardan en `~/Library/Application Support/Nuvora`) y lo muestra en su ventana;
- sincroniza la carpeta **`~/Nuvora`** con tu cuenta (con el mismo motor que `nuvora-sync`);
- se queda en la **barra de menús** aunque cierres la ventana, para que el móvil y tus otros dispositivos lo encuentren
  (opción *Abrir al iniciar el Mac*);
- **Continuar con Google** abre tu navegador y la ventana entra sola cuando terminas.

Instalación: abre `Nuvora-Mac.dmg` y arrastra Nuvora a *Aplicaciones*. Va firmada ad hoc (sin certificado de Apple),
así que la primera vez hay que hacer **clic derecho → Abrir**, o en *Ajustes del Sistema → Privacidad y seguridad →
Abrir igualmente*. Si macOS pregunta si Nuvora puede aceptar conexiones entrantes, di que sí: es lo que permite que
el móvil se conecte. Registros en `~/Library/Logs/Nuvora`.

## App de Android

`android/` es la app para el móvil (Kotlin, sin dependencias): abre tu servidor Nuvora con todo lo de la web
y además permite elegir archivos del móvil para subirlos, guarda las descargas en «Descargas», pone el
vídeo a pantalla completa y tiñe la barra de estado con el color del tema.

1. Arranca el servidor en el ordenador: doble clic en **Iniciar Nuvora** (o `npm start`).
   Si Windows pregunta por el cortafuegos, permite el acceso en **redes privadas**.
2. Instala `Nuvora.apk` (hay que permitir instalar apps de origen desconocido). Con el móvil en la misma wifi,
   la app **busca sola tu Nuvora** y se conecta. También se puede escribir la dirección a mano
   (la línea «En el móvil: http://…» del ordenador, o la `https://…` de `npm run tunel` fuera de casa).
3. Entra con **Continuar con Google** (ver *Iniciar sesión con Google*).
4. Para cambiar de servidor: foto de perfil → *Cambiar de servidor*.

Cada versión se compila en GitHub Actions y va firmada con la misma clave (`android/app/nuvora.keystore`),
así que cada APK se instala encima de la anterior.

## Sincronizar una carpeta del ordenador

```bash
node sync/nuvora-sync.js login --server http://localhost:3000   # código que apruebas desde el móvil
# o con correo y contraseña: … login --server http://localhost:3000 --email tu@correo.com
node sync/nuvora-sync.js sync ~/Nuvora --watch     # se queda vigilando cambios
node sync/nuvora-sync.js sync ~/Copia --watch --sentido subir --borrar no   # copia de seguridad
node sync/nuvora-sync.js status ~/Nuvora
```

También puedes instalarlo como comando global con `npm link` y usar `nuvora-sync`.

## Pruebas

```bash
npm test
```

Cubren autenticación, subidas, carpetas, papelera, descargas por rangos, ZIP, permisos al compartir, enlaces con contraseña, cuota y la sincronización (en los dos sentidos, solo subir, solo bajar, conflictos y borrados).


## Estructura

```
server/   API y servidor (Express + node:sqlite)
public/   Aplicación web (HTML/CSS/JS sin compilación) y página de enlaces públicos
sync/     Cliente de sincronización de escritorio
test/     Pruebas de integración
```
