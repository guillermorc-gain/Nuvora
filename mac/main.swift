// Nuvora para Mac (Apple Silicon).
//
// La app lleva dentro el servidor de Nuvora y Node.js: al abrirla arranca el
// servidor (tus archivos se guardan en este Mac), lo muestra en su ventana y
// sincroniza la carpeta ~/Nuvora con tu cuenta. Se queda en la barra de menús
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
