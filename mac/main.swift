// Nuvora para Mac (Apple Silicon).
//
// La app lleva dentro el servidor de Nuvora, Node.js y Syncthing: al abrirla
// arranca el servidor (tus archivos se guardan en este Mac), lo muestra en su
// ventana, sincroniza la carpeta ~/Nuvora con tu cuenta y, por Syncthing,
// directamente con la app Nuvora de tus móviles (se emparejan con un código). Se queda en la barra de menús
// para que el móvil y los demás dispositivos lo encuentren aunque cierres la ventana.
//
// Se compila en GitHub Actions (workflow «Publicar versión», trabajo «mac»):
//   swiftc -O -target arm64-apple-macos13 main.swift -o Nuvora

import Cocoa
import ServiceManagement
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, NSWindowDelegate,
    WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler, WKDownloadDelegate {

    private let puerto = 3000
    private lazy var base = URL(string: "http://localhost:\(puerto)")!
    private let fm = FileManager.default

    private var ventana: NSWindow!
    private var web: WKWebView!
    private var barra: NSStatusItem!
    private var lineaEstado: NSMenuItem!
    private var opcionInicio: NSMenuItem!

    private var servidor: Process?
    private var sincronizador: Process?
    private var tokenSync: String?
    private var saliendo = false
    private var senal: DispatchSourceSignal?
    private var cargado = false
    private var actualizando = false
    private var avisadaVersion = 0
    private var progresoVentana: NSPanel?
    private var progresoBarra: NSProgressIndicator?
    private var progresoTexto: NSTextField?
    private var observador: NSKeyValueObservation?

    private var recursos: URL { Bundle.main.resourceURL! }
    private var node: URL { recursos.appendingPathComponent("node/bin/node") }
    private var codigo: URL { recursos.appendingPathComponent("servidor") }
    private lazy var soporte: URL = {
        let u = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("Nuvora")
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private lazy var registros: URL = {
        let u = fm.urls(for: .libraryDirectory, in: .userDomainMask)[0].appendingPathComponent("Logs/Nuvora")
        try? fm.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()
    private var carpeta: URL { fm.homeDirectoryForCurrentUser.appendingPathComponent("Nuvora") }

    // MARK: - Arranque

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Si se cierra la app a la fuerza (kill), se cierran también el servidor y la sincronización
        signal(SIGTERM, SIG_IGN)
        senal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        senal?.setEventHandler { NSApp.terminate(nil) }
        senal?.resume()
        crearMenus()
        crearBarra()
        crearVentana()
        arrancarServidor()
        esperarServidor(intentos: 80)
        // La sesión de la ventana decide qué cuenta sincroniza la carpeta ~/Nuvora
        Timer.scheduledTimer(withTimeInterval: 4, repeats: true) { [weak self] _ in self?.revisarSesion() }
        // Actualizaciones: al abrir y cada 6 horas se mira si hay una versión nueva en GitHub
        DispatchQueue.main.asyncAfter(deadline: .now() + 8) { [weak self] in self?.buscarActualizacion(manual: false) }
        Timer.scheduledTimer(withTimeInterval: 6 * 3600, repeats: true) { [weak self] _ in self?.buscarActualizacion(manual: false) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        mostrarVentana()
        return true
    }

    func applicationWillTerminate(_ notification: Notification) {
        saliendo = true
        sincronizador?.terminate()
        servidor?.terminate()
    }

    // MARK: - Servidor y sincronización

    private func entorno(_ extra: [String: String]) -> [String: String] {
        var e = ProcessInfo.processInfo.environment
        for (k, v) in extra { e[k] = v }
        return e
    }

    private func registro(_ nombre: String) -> FileHandle? {
        let url = registros.appendingPathComponent(nombre)
        if !fm.fileExists(atPath: url.path) { fm.createFile(atPath: url.path, contents: nil) }
        let h = try? FileHandle(forWritingTo: url)
        h?.seekToEndOfFile()
        return h
    }

    private func arrancarServidor() {
        // Si ya hay un Nuvora en el puerto (por ejemplo el del ZIP), se usa ese
        comprobar { [weak self] listo in
            guard let self, !listo else { return }
            let p = Process()
            p.executableURL = self.node
            p.arguments = ["--disable-warning=ExperimentalWarning", self.codigo.appendingPathComponent("server/index.js").path]
            p.currentDirectoryURL = self.codigo
            p.environment = self.entorno([
                "NUVORA_APP": "1",
                "PORT": String(self.puerto),
                // Syncthing dentro de la app: ~/Nuvora se sincroniza directamente con tus móviles
                "NUVORA_SYNCTHING": self.recursos.appendingPathComponent("syncthing/syncthing").path,
                "NUVORA_SYNCTHING_HOME": self.soporte.appendingPathComponent("syncthing").path,
                "NUVORA_CARPETA": self.carpeta.path,
                "NUVORA_DATA": self.soporte.appendingPathComponent("datos").path,
            ])
            let log = self.registro("servidor.log")
            p.standardOutput = log
            p.standardError = log
            p.terminationHandler = { [weak self] _ in
                guard let self, !self.saliendo else { return }
                DispatchQueue.main.asyncAfter(deadline: .now() + 2) { self.arrancarServidor() }
            }
            do { try p.run(); self.servidor = p } catch {
                self.avisar("No se pudo arrancar Nuvora", error.localizedDescription)
            }
        }
    }

    private func comprobar(_ hecho: @escaping (Bool) -> Void) {
        var peticion = URLRequest(url: base.appendingPathComponent("api/config"))
        peticion.timeoutInterval = 1.5
        URLSession.shared.dataTask(with: peticion) { datos, respuesta, _ in
            let ok = (respuesta as? HTTPURLResponse)?.statusCode == 200 &&
                (datos.flatMap { String(data: $0, encoding: .utf8) }?.contains("\"nuvora\"") ?? false)
            DispatchQueue.main.async { hecho(ok) }
        }.resume()
    }

    private func esperarServidor(intentos: Int) {
        comprobar { [weak self] listo in
            guard let self else { return }
            if listo {
                self.cargado = true
                self.web.load(URLRequest(url: self.base))
                self.actualizarEstado()
            } else if intentos > 0 {
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.4) { self.esperarServidor(intentos: intentos - 1) }
            } else {
                self.web.loadHTMLString(self.paginaMensaje("No se pudo arrancar Nuvora",
                    "Mira el registro en ~/Library/Logs/Nuvora/servidor.log o vuelve a abrir la app."), baseURL: nil)
            }
        }
    }

    private func revisarSesion() {
        web.configuration.websiteDataStore.httpCookieStore.getAllCookies { [weak self] cookies in
            guard let self else { return }
            let token = cookies.first { $0.name == "nuvora_session" && $0.domain.contains("localhost") }?.value
            if token != self.tokenSync {
                self.tokenSync = token
                self.reiniciarSincronizacion()
            }
        }
    }

    private func reiniciarSincronizacion() {
        sincronizador?.terminationHandler = nil
        sincronizador?.terminate()
        sincronizador = nil
        defer { actualizarEstado() }
        guard let token = tokenSync else { return }
        let config = soporte.appendingPathComponent("sincronizacion.json")
        let json: [String: Any] = ["server": base.absoluteString, "token": token, "email": ""]
        guard let datos = try? JSONSerialization.data(withJSONObject: json) else { return }
        try? datos.write(to: config, options: .atomic)
        try? fm.createDirectory(at: carpeta, withIntermediateDirectories: true)

        let p = Process()
        p.executableURL = node
        p.arguments = [codigo.appendingPathComponent("sync/nuvora-sync.js").path, "sync", carpeta.path, "--watch"]
        p.environment = entorno(["NUVORA_CONFIG": config.path, "NUVORA_APP": "1"])
        let log = registro("sincronizacion.log")
        p.standardOutput = log
        p.standardError = log
        p.terminationHandler = { [weak self] proceso in
            guard let self, !self.saliendo else { return }
            // Si se cae (por ejemplo, sin red un momento), se vuelve a lanzar
            DispatchQueue.main.asyncAfter(deadline: .now() + 5) {
                if self.sincronizador === proceso { self.reiniciarSincronizacion() }
            }
        }
        if (try? p.run()) != nil { sincronizador = p }
    }

    // MARK: - Ventana

    private func crearVentana() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        if #available(macOS 12.3, *) { config.preferences.isElementFullscreenEnabled = true }
        let puente = """
        window.NuvoraMac = {
          abrirNavegador(url) { webkit.messageHandlers.nuvoraMac.postMessage({ accion: 'abrirNavegador', url }); },
          abrirCarpeta() { webkit.messageHandlers.nuvoraMac.postMessage({ accion: 'abrirCarpeta' }); },
        };
        """
        config.userContentController.addUserScript(WKUserScript(source: puente, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "nuvoraMac")

        web = WKWebView(frame: .zero, configuration: config)
        web.navigationDelegate = self
        web.uiDelegate = self
        web.allowsBackForwardNavigationGestures = true
        web.setValue(false, forKey: "drawsBackground")
        web.loadHTMLString(paginaMensaje("Abriendo Nuvora…", "Arrancando tu nube en este Mac."), baseURL: nil)

        ventana = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1240, height: 800),
                           styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                           backing: .buffered, defer: false)
        ventana.title = "Nuvora"
        ventana.titlebarAppearsTransparent = true
        ventana.minSize = NSSize(width: 420, height: 520)
        ventana.contentView = web
        ventana.delegate = self
        ventana.isReleasedWhenClosed = false
        ventana.setFrameAutosaveName("VentanaNuvora")
        if !ventana.setFrameUsingName("VentanaNuvora") { ventana.center() }
        ventana.makeKeyAndOrderFront(nil)
    }

    private func mostrarVentana() {
        ventana.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func paginaMensaje(_ titulo: String, _ texto: String) -> String {
        """
        <html><body style="margin:0;height:100vh;display:grid;place-items:center;font:15px -apple-system,sans-serif;
        background:#F4F6FA;color:#1A2233"><div style="text-align:center"><h2 style="margin:0 0 8px">\(titulo)</h2>
        <p style="color:#566173;margin:0">\(texto)</p></div></body></html>
        """
    }

    // MARK: - Barra de menús

    private func crearBarra() {
        barra = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        let icono = NSImage(systemSymbolName: "icloud.and.arrow.up", accessibilityDescription: "Nuvora")
        icono?.isTemplate = true
        barra.button?.image = icono
        let menu = NSMenu()
        menu.addItem(withTitle: "Abrir Nuvora", action: #selector(abrir), keyEquivalent: "")
        menu.addItem(withTitle: "Abrir la carpeta Nuvora", action: #selector(abrirCarpeta), keyEquivalent: "")
        menu.addItem(.separator())
        lineaEstado = NSMenuItem(title: "Arrancando…", action: nil, keyEquivalent: "")
        lineaEstado.isEnabled = false
        menu.addItem(lineaEstado)
        menu.addItem(withTitle: "Dirección para el móvil…", action: #selector(direccionMovil), keyEquivalent: "")
        menu.addItem(withTitle: "Buscar actualizaciones…", action: #selector(buscarActualizacionManual), keyEquivalent: "")
        menu.addItem(.separator())
        opcionInicio = NSMenuItem(title: "Abrir al iniciar el Mac", action: #selector(alternarInicio), keyEquivalent: "")
        opcionInicio.state = SMAppService.mainApp.status == .enabled ? .on : .off
        menu.addItem(opcionInicio)
        menu.addItem(withTitle: "Salir de Nuvora", action: #selector(salir), keyEquivalent: "q")
        barra.menu = menu
    }

    private func actualizarEstado() {
        if !cargado { lineaEstado.title = "Arrancando…" }
        else if tokenSync == nil { lineaEstado.title = "Entra en tu cuenta para sincronizar ~/Nuvora" }
        else { lineaEstado.title = "Sincronizando ~/Nuvora" }
    }

    @objc private func abrir() { mostrarVentana() }

    @objc private func abrirCarpeta() {
        try? fm.createDirectory(at: carpeta, withIntermediateDirectories: true)
        NSWorkspace.shared.open(carpeta)
    }

    @objc private func direccionMovil() {
        let ips = Host.current().addresses.filter {
            $0.hasPrefix("192.168.") || $0.hasPrefix("10.") || $0.range(of: #"^172\.(1[6-9]|2\d|3[01])\."#, options: .regularExpression) != nil
        }
        let texto = ips.isEmpty
            ? "Este Mac no está conectado a ninguna red."
            : ips.map { "http://\($0):\(puerto)" }.joined(separator: "\n") +
              "\n\nCon el móvil en la misma wifi, la app de Nuvora encuentra este Mac sola. Si no, escribe esta dirección."
        avisar("Dirección para el móvil", texto)
    }

    @objc private func alternarInicio() {
        do {
            if SMAppService.mainApp.status == .enabled { try SMAppService.mainApp.unregister() }
            else { try SMAppService.mainApp.register() }
        } catch {
            avisar("No se pudo cambiar", "Actívalo en Ajustes del Sistema → General → Ítems de inicio.")
        }
        opcionInicio.state = SMAppService.mainApp.status == .enabled ? .on : .off
    }

    @objc private func salir() { NSApp.terminate(nil) }

    private func avisar(_ titulo: String, _ texto: String) {
        let a = NSAlert()
        a.messageText = titulo
        a.informativeText = texto
        NSApp.activate(ignoringOtherApps: true)
        a.runModal()
    }

    private func crearMenus() {
        let principal = NSMenu()
        let app = NSMenuItem()
        let menuApp = NSMenu()
        menuApp.addItem(withTitle: "Acerca de Nuvora", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        menuApp.addItem(withTitle: "Buscar actualizaciones…", action: #selector(buscarActualizacionManual), keyEquivalent: "")
        menuApp.addItem(.separator())
        menuApp.addItem(withTitle: "Ocultar Nuvora", action: #selector(NSApplication.hide(_:)), keyEquivalent: "h")
        menuApp.addItem(withTitle: "Salir de Nuvora", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        app.submenu = menuApp
        principal.addItem(app)

        // Sin el menú Edición no funcionan ⌘C, ⌘V ni ⌘A dentro de la ventana
        let edicion = NSMenuItem()
        let menuEdicion = NSMenu(title: "Edición")
        menuEdicion.addItem(withTitle: "Deshacer", action: Selector(("undo:")), keyEquivalent: "z")
        menuEdicion.addItem(withTitle: "Rehacer", action: Selector(("redo:")), keyEquivalent: "Z")
        menuEdicion.addItem(.separator())
        menuEdicion.addItem(withTitle: "Cortar", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        menuEdicion.addItem(withTitle: "Copiar", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        menuEdicion.addItem(withTitle: "Pegar", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        menuEdicion.addItem(withTitle: "Seleccionar todo", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        edicion.submenu = menuEdicion
        principal.addItem(edicion)

        let vista = NSMenuItem()
        let menuVista = NSMenu(title: "Ver")
        menuVista.addItem(withTitle: "Recargar", action: #selector(recargar), keyEquivalent: "r")
        menuVista.addItem(withTitle: "Pantalla completa", action: #selector(NSWindow.toggleFullScreen(_:)), keyEquivalent: "f")
        vista.submenu = menuVista
        principal.addItem(vista)

        let ventanaMenu = NSMenuItem()
        let menuVentana = NSMenu(title: "Ventana")
        menuVentana.addItem(withTitle: "Minimizar", action: #selector(NSWindow.performMiniaturize(_:)), keyEquivalent: "m")
        menuVentana.addItem(withTitle: "Cerrar", action: #selector(NSWindow.performClose(_:)), keyEquivalent: "w")
        ventanaMenu.submenu = menuVentana
        principal.addItem(ventanaMenu)
        NSApp.windowsMenu = menuVentana
        NSApp.mainMenu = principal
    }

    @objc private func recargar() { if cargado { web.reload() } }

    // MARK: - Actualizaciones (desde dentro de la app)

    private struct Nueva { let numero: Int; let nombre: String; let url: URL; let notas: String }

    private var versionActual: Int { Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") ?? 0 }
    private var nombreActual: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "?" }

    @objc private func buscarActualizacionManual() { buscarActualizacion(manual: true) }

    private func buscarActualizacion(manual: Bool) {
        guard !actualizando else { return mostrarProgreso() }
        var peticion = URLRequest(url: URL(string: "https://api.github.com/repos/guillermorc-gain/Nuvora/releases/latest")!)
        peticion.setValue("application/vnd.github+json", forHTTPHeaderField: "Accept")
        peticion.timeoutInterval = 15
        URLSession.shared.dataTask(with: peticion) { [weak self] datos, respuesta, _ in
            let nueva = Self.leerVersion(datos, respuesta)
            DispatchQueue.main.async {
                guard let self else { return }
                if let n = nueva, n.numero > self.versionActual {
                    // Solo se insiste una vez por versión; con «Buscar actualizaciones…» siempre
                    if manual || n.numero != self.avisadaVersion { self.ofrecer(n) }
                } else if manual {
                    if datos == nil { self.avisar("No se pudo comprobar", "¿Tiene internet este Mac?") }
                    else { self.avisar("Nuvora está al día", "Tienes la última versión (\(self.nombreActual)).") }
                }
            }
        }.resume()
    }

    private static func leerVersion(_ datos: Data?, _ respuesta: URLResponse?) -> Nueva? {
        guard (respuesta as? HTTPURLResponse)?.statusCode == 200, let datos,
              let j = try? JSONSerialization.jsonObject(with: datos) as? [String: Any],
              let etiqueta = j["tag_name"] as? String,
              let numero = Int(etiqueta.split(separator: ".").last ?? ""),
              let assets = j["assets"] as? [[String: Any]],
              // El .dmg se sube unos minutos después de crear la versión: sin él, aún no hay nada que instalar
              let dmg = assets.first(where: { $0["name"] as? String == "Nuvora-Mac.dmg" }),
              let texto = dmg["browser_download_url"] as? String, let url = URL(string: texto) else { return nil }
        let cuerpo = j["body"] as? String ?? ""
        let novedades = (cuerpo.components(separatedBy: "## Novedades").dropFirst().first ?? "")
            .components(separatedBy: "## ").first ?? ""
        let notas = novedades.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { $0.hasPrefix("- ") }.prefix(8).map { "• " + String($0.dropFirst(2)) }.joined(separator: "\n")
        return Nueva(numero: numero, nombre: String(etiqueta.dropFirst()), url: url, notas: notas)
    }

    private func ofrecer(_ n: Nueva) {
        avisadaVersion = n.numero
        let a = NSAlert()
        a.messageText = "Nuvora \(n.nombre) está disponible"
        a.informativeText = "Tienes la \(nombreActual). Se descarga e instala sola y Nuvora se vuelve a abrir." +
            (n.notas.isEmpty ? "" : "\n\nNovedades:\n\(n.notas)")
        a.addButton(withTitle: "Actualizar")
        a.addButton(withTitle: "Más tarde")
        NSApp.activate(ignoringOtherApps: true)
        if a.runModal() == .alertFirstButtonReturn { descargar(n) }
    }

    private func mostrarProgreso() {
        if progresoVentana == nil {
            let panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 360, height: 96),
                                styleMask: [.titled], backing: .buffered, defer: false)
            panel.title = "Actualizando Nuvora"
            let texto = NSTextField(labelWithString: "Descargando…")
            texto.frame = NSRect(x: 20, y: 56, width: 320, height: 20)
            let barra = NSProgressIndicator(frame: NSRect(x: 20, y: 24, width: 320, height: 20))
            barra.isIndeterminate = false
            barra.minValue = 0
            barra.maxValue = 1
            panel.contentView?.addSubview(texto)
            panel.contentView?.addSubview(barra)
            panel.isReleasedWhenClosed = false
            panel.center()
            progresoVentana = panel
            progresoBarra = barra
            progresoTexto = texto
        }
        progresoVentana?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func fallo(_ texto: String) {
        actualizando = false
        observador = nil
        progresoVentana?.orderOut(nil)
        avisar("No se pudo actualizar", texto)
    }

    private func descargar(_ n: Nueva) {
        actualizando = true
        mostrarProgreso()
        progresoTexto?.stringValue = "Descargando Nuvora \(n.nombre)…"
        progresoBarra?.doubleValue = 0
        let tarea = URLSession.shared.downloadTask(with: n.url) { [weak self] archivo, respuesta, error in
            // El archivo temporal se borra al salir de aquí: se mueve antes de nada
            var dmg: URL?
            if let archivo, (respuesta as? HTTPURLResponse)?.statusCode == 200 {
                let destino = FileManager.default.temporaryDirectory.appendingPathComponent("Nuvora-\(n.nombre).dmg")
                try? FileManager.default.removeItem(at: destino)
                if (try? FileManager.default.moveItem(at: archivo, to: destino)) != nil { dmg = destino }
            }
            DispatchQueue.main.async {
                guard let self else { return }
                guard let dmg else { return self.fallo(error?.localizedDescription ?? "La descarga no terminó. Inténtalo otra vez.") }
                self.instalar(dmg, n)
            }
        }
        observador = tarea.progress.observe(\.fractionCompleted) { [weak self] p, _ in
            DispatchQueue.main.async {
                self?.progresoBarra?.doubleValue = p.fractionCompleted
                self?.progresoTexto?.stringValue = "Descargando Nuvora \(n.nombre)… \(Int(p.fractionCompleted * 100)) %"
            }
        }
        tarea.resume()
    }

    @discardableResult
    private func ejecutar(_ programa: String, _ argumentos: [String]) -> Int32 {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: programa)
        p.arguments = argumentos
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        guard (try? p.run()) != nil else { return -1 }
        p.waitUntilExit()
        return p.terminationStatus
    }

    private func instalar(_ dmg: URL, _ n: Nueva) {
        progresoTexto?.stringValue = "Instalando Nuvora \(n.nombre)…"
        progresoBarra?.isIndeterminate = true
        progresoBarra?.startAnimation(nil)
        let trabajo = soporte.appendingPathComponent("actualizacion")
        let montaje = trabajo.appendingPathComponent("dmg")
        let nueva = trabajo.appendingPathComponent("Nuvora.app")
        // Dónde está la app ahora. Si se abrió desde el .dmg o desde Descargas sin moverla
        // (macOS la «traslada» a una carpeta temporal), se instala en Aplicaciones.
        var destino = Bundle.main.bundleURL
        if destino.path.hasPrefix("/Volumes/") || destino.path.contains("/AppTranslocation/") {
            destino = URL(fileURLWithPath: "/Applications/Nuvora.app")
        }
        let pid = ProcessInfo.processInfo.processIdentifier
        DispatchQueue.global().async { [weak self] in
            guard let self else { return }
            let fm = FileManager.default
            try? fm.removeItem(at: trabajo)
            try? fm.createDirectory(at: montaje, withIntermediateDirectories: true)
            var error: String?
            if self.ejecutar("/usr/bin/hdiutil", ["attach", "-nobrowse", "-readonly", "-noautoopen", "-mountpoint", montaje.path, dmg.path]) != 0 {
                error = "No se pudo abrir el .dmg descargado."
            } else {
                if self.ejecutar("/usr/bin/ditto", [montaje.appendingPathComponent("Nuvora.app").path, nueva.path]) != 0 {
                    error = "No se pudo copiar la versión nueva."
                }
                self.ejecutar("/usr/bin/hdiutil", ["detach", "-force", montaje.path])
            }
            try? fm.removeItem(at: dmg)
            let info = NSDictionary(contentsOf: nueva.appendingPathComponent("Contents/Info.plist"))
            if error == nil, Int(info?["CFBundleVersion"] as? String ?? "") != n.numero { error = "La descarga no es la versión esperada." }
            if error == nil, !fm.isWritableFile(atPath: destino.deletingLastPathComponent().path) {
                error = "No hay permiso para escribir en \(destino.deletingLastPathComponent().path). Arrastra Nuvora a tu carpeta Aplicaciones y vuelve a intentarlo."
            }
            DispatchQueue.main.async {
                if let error { return self.fallo(error) }
                self.relanzar(nueva: nueva, destino: destino, pid: pid)
            }
        }
    }

    /// Un pequeño script espera a que Nuvora se cierre, pone la versión nueva en su sitio y la vuelve a abrir.
    private func relanzar(nueva: URL, destino: URL, pid: Int32) {
        func q(_ s: String) -> String { "'" + s.replacingOccurrences(of: "'", with: "'\\''") + "'" }
        let viejo = destino.path + ".anterior"
        let script = """
        #!/bin/sh
        while kill -0 \(pid) 2>/dev/null; do sleep 0.3; done
        # Que el servidor y Syncthing de la versión anterior suelten sus puertos
        for i in $(seq 1 30); do nc -z 127.0.0.1 \(puerto) 2>/dev/null || break; sleep 0.5; done
        rm -rf \(q(viejo))
        [ -e \(q(destino.path)) ] && mv \(q(destino.path)) \(q(viejo))
        if ditto \(q(nueva.path)) \(q(destino.path)); then rm -rf \(q(viejo)); else rm -rf \(q(destino.path)); mv \(q(viejo)) \(q(destino.path)); fi
        xattr -dr com.apple.quarantine \(q(destino.path)) 2>/dev/null
        rm -rf \(q(nueva.deletingLastPathComponent().path))
        open \(q(destino.path))
        """
        let archivo = fm.temporaryDirectory.appendingPathComponent("nuvora-actualizar.sh")
        do {
            try script.write(to: archivo, atomically: true, encoding: .utf8)
            let p = Process()
            p.executableURL = URL(fileURLWithPath: "/bin/sh")
            p.arguments = [archivo.path]
            p.standardOutput = registro("actualizacion.log")
            p.standardError = registro("actualizacion.log")
            try p.run()
        } catch {
            return fallo(error.localizedDescription)
        }
        progresoTexto?.stringValue = "Reiniciando Nuvora…"
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { NSApp.terminate(nil) }
    }

    // MARK: - Lo que pide la página (window.NuvoraMac)

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let datos = message.body as? [String: Any], let accion = datos["accion"] as? String else { return }
        switch accion {
        case "abrirNavegador":
            if let texto = datos["url"] as? String, let url = URL(string: texto) { NSWorkspace.shared.open(url) }
        case "abrirCarpeta":
            abrirCarpeta()
        default:
            break
        }
    }

    // MARK: - Navegación, archivos y descargas

    private func esLocal(_ url: URL) -> Bool {
        ["localhost", "127.0.0.1"].contains(url.host ?? "") || ["about", "data", "blob"].contains(url.scheme ?? "")
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        guard let url = action.request.url else { return decisionHandler(.allow) }
        if esLocal(url) { return decisionHandler(.allow) }
        // Los enlaces a otras webs se abren en el navegador
        NSWorkspace.shared.open(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse,
                 decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        let disposicion = (response.response as? HTTPURLResponse)?.value(forHTTPHeaderField: "Content-Disposition") ?? ""
        if disposicion.lowercased().hasPrefix("attachment") || !response.canShowMIMEType { decisionHandler(.download) }
        else { decisionHandler(.allow) }
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) {
        download.delegate = self
    }

    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) {
        download.delegate = self
    }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String,
                  completionHandler: @escaping (URL?) -> Void) {
        let descargas = fm.urls(for: .downloadsDirectory, in: .userDomainMask)[0]
        let nombre = (suggestedFilename as NSString).deletingPathExtension
        let ext = (suggestedFilename as NSString).pathExtension
        var destino = descargas.appendingPathComponent(suggestedFilename)
        var n = 1
        while fm.fileExists(atPath: destino.path) {
            destino = descargas.appendingPathComponent(ext.isEmpty ? "\(nombre) (\(n))" : "\(nombre) (\(n)).\(ext)")
            n += 1
        }
        completionHandler(destino)
    }

    func downloadDidFinish(_ download: WKDownload) {
        // Hace saltar la pila de Descargas del Dock
        DistributedNotificationCenter.default().post(name: .init("com.apple.DownloadFileFinished"),
            object: fm.urls(for: .downloadsDirectory, in: .userDomainMask)[0].path)
    }

    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.canChooseDirectories = parameters.allowsDirectories
        panel.canChooseFiles = true
        panel.beginSheetModal(for: ventana) { r in completionHandler(r == .OK ? panel.urls : nil) }
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // window.open y enlaces con target=_blank: al navegador
        if let url = action.request.url { NSWorkspace.shared.open(url) }
        return nil
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        avisar("Nuvora", message)
        completionHandler()
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {}
}

let app = NSApplication.shared
let delegado = AppDelegate()
app.delegate = delegado
app.setActivationPolicy(.regular)
app.run()
