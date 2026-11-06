import AppKit
import WebKit
import ApplicationServices
import Darwin

private let chromeBundleID = "com.google.Chrome"
private let maxMessageSize = 1_048_576
// All instances recognize replayed events, so two profile helpers cannot
// repeatedly intercept and replay the same unsupported-window shortcut.
private let hotkeyReplayMarker: Int64 = 0x54414250414C4554

private struct PendingHotkey {
    let requestID: String
    let chromePID: pid_t
    let event: CGEvent
    let generation: UInt64
    let timeout: DispatchWorkItem
}

final class NativeTransport {
    private let outputLock = NSLock()
    var onMessage: (([String: Any]) -> Void)?
    var onEOF: (() -> Void)?

    func send(_ object: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(object),
              let body = try? JSONSerialization.data(withJSONObject: object),
              body.count <= maxMessageSize else { return }
        var length = UInt32(body.count).littleEndian
        var frame = withUnsafeBytes(of: &length) { Data($0) }
        frame.append(body)
        outputLock.lock()
        defer { outputLock.unlock() }
        do { try FileHandle.standardOutput.write(contentsOf: frame) }
        catch { DispatchQueue.main.async { NSApp.terminate(nil) } }
    }

    private func readExactly(_ count: Int) throws -> Data? {
        var data = Data()
        while data.count < count {
            guard let part = try FileHandle.standardInput.read(upToCount: count - data.count), !part.isEmpty else {
                if data.isEmpty { return nil }
                throw NSError(domain: "TabPalette", code: 1)
            }
            data.append(part)
        }
        return data
    }

    func start() {
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            guard let self else { return }
            do {
                while let header = try self.readExactly(4) {
                    let length = header.enumerated().reduce(UInt32(0)) { $0 | (UInt32($1.element) << ($1.offset * 8)) }
                    guard length > 0, length <= maxMessageSize,
                          let data = try self.readExactly(Int(length)),
                          let message = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
                        throw NSError(domain: "TabPalette", code: 2)
                    }
                    DispatchQueue.main.async { self.onMessage?(message) }
                }
            } catch {
                // Native messaging stdout is reserved exclusively for framed JSON.
            }
            DispatchQueue.main.async { self.onEOF?() }
        }
    }
}

final class PaletteWebView: WKWebView {
    var commandHandler: ((NSEvent) -> Bool)?
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if commandHandler?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
    override func flagsChanged(with event: NSEvent) {
        super.flagsChanged(with: event)
        if [UInt16(54), UInt16(55)].contains(event.keyCode), !event.modifierFlags.contains(.command) {
            evaluateJavaScript("document.dispatchEvent(new KeyboardEvent('keyup', {key:'Meta',code:'MetaLeft',metaKey:false,bubbles:true}));")
        }
    }
}

final class PalettePanel: NSPanel {
    var commandHandler: ((NSEvent) -> Bool)?
    var dismissHandler: (() -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if commandHandler?(event) == true { return true }
        return super.performKeyEquivalent(with: event)
    }
    override func cancelOperation(_ sender: Any?) { dismissHandler?() }
}

final class Companion: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate, NSWindowDelegate {
    private let transport = NativeTransport()
    private var panel: PalettePanel!
    private var webView: PaletteWebView!
    private var eventTap: CFMachPort?
    private var runLoopSource: CFRunLoopSource?
    private var trustTimer: Timer?
    private var pageReady = false
    private var queuedResponses: [[String: Any]] = []
    private var wasTrusted: Bool?
    private var setupOnly = false
    private var selfTestOnly = false
    private var selfTestFinished = false
    private var selfTestLastChecks: [String:Any] = [:]
    private var paletteGeneration: UInt64 = 0
    private var executeGenerations: [String:UInt64] = [:]
    private var pendingHotkey: PendingHotkey?
    private var returnApplication: NSRunningApplication?
    private var assetDirectory: URL!
    private var paletteDocumentURL: URL {
        let native = assetDirectory.appendingPathComponent("palette-native.html")
        return FileManager.default.fileExists(atPath:native.path) ? native : assetDirectory.appendingPathComponent("palette.html")
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        selfTestOnly = CommandLine.arguments.contains("--self-test")
        if selfTestOnly {
            // This path deliberately never constructs an NSWindow, activates
            // an application, queries Accessibility, starts native messaging,
            // or creates/polls an event tap.
            NSApp.setActivationPolicy(.prohibited)
            guard let assets = locateAssets() else {
                finishSelfTest(["ok":false,"error":"Palette assets are missing"], status:1)
                return
            }
            assetDirectory = assets
            makeSelfTestView()
            DispatchQueue.main.asyncAfter(deadline:.now() + 8) { [weak self] in
                guard let self else { return }
                self.finishSelfTest(["ok":false,"error":"WKWebView self-test timed out after 8 seconds","checks":self.selfTestLastChecks], status:1)
            }
            return
        }
        NSApp.setActivationPolicy(.accessory)
        setupOnly = CommandLine.arguments.contains("--setup")
        guard let assets = locateAssets() else {
            if setupOnly { showProblem("The palette files are missing. Rebuild the companion after the extension files are present.") }
            else { transport.send(["type": "error", "payload": ["message": "Palette assets are missing. Rebuild the companion."]]) }
            NSApp.terminate(nil)
            return
        }
        assetDirectory = assets
        makePanel()
        updateEventTap()
        trustTimer = Timer.scheduledTimer(withTimeInterval: 3, repeats: true) { [weak self] _ in self?.updateEventTap() }
        if setupOnly {
            showSetup()
        } else {
            transport.onMessage = { [weak self] message in self?.handleNativeMessage(message) }
            transport.onEOF = { [weak self] in
                self?.cancelPendingHotkey(replay:true)
                NSApp.terminate(nil)
            }
            transport.send(["type": "ready", "payload": statusPayload()])
            transport.start()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        cancelPendingHotkey(replay:true)
        trustTimer?.invalidate()
        if let tap = eventTap { CGEvent.tapEnable(tap: tap, enable: false) }
        if let source = runLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        eventTap = nil
    }

    private func locateAssets() -> URL? {
        let fm = FileManager.default
        var candidates: [URL] = []
        if let value = ProcessInfo.processInfo.environment["TAB_PALETTE_ASSET_DIR"] {
            candidates.append(URL(fileURLWithPath: value))
        }
        if let resources = Bundle.main.resourceURL { candidates.append(resources.appendingPathComponent("extension")) }
        // Development fallback: companion/App.app and its sibling ../extension.
        candidates.append(Bundle.main.bundleURL.deletingLastPathComponent().deletingLastPathComponent().appendingPathComponent("extension"))
        return candidates.first { fm.fileExists(atPath: $0.appendingPathComponent("palette.html").path) }
    }

    private func makePanel() {
        let controller = WKUserContentController()
        controller.add(self, name: "palette")
        controller.addUserScript(WKUserScript(source: "window.TAB_PALETTE_MODE = 'native';", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        let configuration = WKWebViewConfiguration()
        configuration.userContentController = controller
        configuration.websiteDataStore = .nonPersistent()
        webView = PaletteWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.setValue(false, forKey: "drawsBackground")
        webView.commandHandler = { [weak self] event in self?.handleCommandKey(event) ?? false }
        panel = PalettePanel(contentRect: NSRect(x: 0, y: 0, width: 704, height: 520),
                             styleMask: [.borderless, .fullSizeContentView], backing: .buffered, defer: false)
        panel.title = "Tab Palette"
        panel.isFloatingPanel = true
        panel.level = .floating
        panel.collectionBehavior = [.moveToActiveSpace, .fullScreenAuxiliary]
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isMovableByWindowBackground = false
        panel.delegate = self
        panel.contentView = webView
        panel.commandHandler = { [weak self] event in self?.handleCommandKey(event) ?? false }
        panel.dismissHandler = { [weak self] in self?.dismiss() }
        webView.loadFileURL(paletteDocumentURL, allowingReadAccessTo: assetDirectory)
    }

    private func makeSelfTestView() {
        let controller = WKUserContentController()
        controller.add(self, name:"palette")
        let script = """
        window.TAB_PALETTE_MODE = 'native';
        window.__paletteSelfTestErrors = [];
        window.addEventListener('error', event => window.__paletteSelfTestErrors.push(String(event.message || event.target?.src || 'resource error')),true);
        window.addEventListener('unhandledrejection', event => window.__paletteSelfTestErrors.push(String(event.reason || 'unhandled rejection')));
        """
        controller.addUserScript(WKUserScript(source:script,injectionTime:.atDocumentStart,forMainFrameOnly:true))
        let config = WKWebViewConfiguration()
        config.userContentController = controller
        config.websiteDataStore = .nonPersistent()
        webView = PaletteWebView(frame:NSRect(x:0,y:0,width:784,height:600),configuration:config)
        webView.navigationDelegate = self
        webView.loadFileURL(paletteDocumentURL, allowingReadAccessTo:assetDirectory)
    }

    private func finishSelfTest(_ result:[String:Any], status:Int32) {
        guard !selfTestFinished else { return }
        selfTestFinished = true
        var output = result
        output["mode"] = "self-test"
        output["visibleWindowCreated"] = false
        output["accessibilityQueried"] = false
        output["eventTapCreated"] = false
        if let data = try? JSONSerialization.data(withJSONObject:output, options:[.sortedKeys]),
           let string = String(data:data,encoding:.utf8) { print(string) }
        else { print("{\"ok\":false,\"mode\":\"self-test\",\"error\":\"Could not encode result\"}") }
        fflush(stdout)
        Darwin.exit(status)
    }

    private func checkSelfTestReadiness() {
        guard !selfTestFinished else { return }
        let script = """
        (() => ({
          receiveReady:typeof window.paletteReceive === 'function',
          showReady:typeof window.paletteShow === 'function',
          inputReady:Boolean(document.querySelector('input#query')),
          bridgeReady:Boolean(window.webkit?.messageHandlers?.palette),
          mode:window.TAB_PALETTE_MODE,
          errors:window.__paletteSelfTestErrors || []
        }))()
        """
        webView.evaluateJavaScript(script) { [weak self] result, error in
            guard let self, !self.selfTestFinished else { return }
            if let error { self.finishSelfTest(["ok":false,"error":error.localizedDescription],status:1); return }
            guard let checks = result as? [String:Any] else {
                self.finishSelfTest(["ok":false,"error":"Unexpected JavaScript readiness response"],status:1); return
            }
            self.selfTestLastChecks = checks
            let errors = checks["errors"] as? [String] ?? []
            let ok = checks["receiveReady"] as? Bool == true && checks["showReady"] as? Bool == true
                && checks["inputReady"] as? Bool == true && checks["bridgeReady"] as? Bool == true
                && errors.isEmpty
            if ok || !errors.isEmpty { self.finishSelfTest(["ok":ok,"checks":checks],status:ok ? 0 : 1) }
            else { DispatchQueue.main.asyncAfter(deadline:.now() + 0.1) { [weak self] in self?.checkSelfTestReadiness() } }
        }
    }

    private func statusPayload() -> [String: Any] {
        ["accessibilityTrusted": AXIsProcessTrusted(),
         "tapActive": eventTap.map { CGEvent.tapIsEnabled(tap:$0) } ?? false,
         "hostVersion": Bundle.main.object(forInfoDictionaryKey:"CFBundleShortVersionString") as? String ?? "unknown",
         "platform": "mac", "shortcut": "Command+T"]
    }

    private func updateEventTap() {
        let trusted = AXIsProcessTrusted()
        if trusted && eventTap == nil {
            let context = UnsafeMutableRawPointer(Unmanaged.passUnretained(self).toOpaque())
            eventTap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap,
                options: .defaultTap, eventsOfInterest: CGEventMask(1 << CGEventType.keyDown.rawValue),
                callback: { _, type, event, refcon in
                    guard let refcon else { return Unmanaged.passUnretained(event) }
                    let companion = Unmanaged<Companion>.fromOpaque(refcon).takeUnretainedValue()
                    if type == .tapDisabledByTimeout || type == .tapDisabledByUserInput {
                        if let tap = companion.eventTap { CGEvent.tapEnable(tap: tap, enable: true) }
                        return Unmanaged.passUnretained(event)
                    }
                    if event.getIntegerValueField(.eventSourceUserData) == hotkeyReplayMarker {
                        return Unmanaged.passUnretained(event)
                    }
                    let flags = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
                    if type == .keyDown, flags == .maskCommand,
                       event.getIntegerValueField(.keyboardEventKeycode) == 17,
                       let chrome = NSWorkspace.shared.frontmostApplication,
                       chrome.bundleIdentifier == chromeBundleID {
                        if event.getIntegerValueField(.keyboardEventAutorepeat) != 0 { return nil }
                        guard let captured = event.copy() else { return Unmanaged.passUnretained(event) }
                        DispatchQueue.main.async { companion.openFromHotkey(captured, chromePID:chrome.processIdentifier) }
                        return nil
                    }
                    return Unmanaged.passUnretained(event)
                }, userInfo: context)
            if let tap = eventTap {
                runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
                if let source = runLoopSource { CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes) }
                CGEvent.tapEnable(tap: tap, enable: true)
            }
        } else if !trusted, let tap = eventTap {
            CGEvent.tapEnable(tap: tap, enable: false)
            if let source = runLoopSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
            eventTap = nil
            runLoopSource = nil
        }
        if wasTrusted != trusted {
            wasTrusted = trusted
            if !setupOnly { transport.send(["type": "status", "payload": statusPayload()]) }
        }
    }

    private func openFromHotkey(_ event:CGEvent, chromePID:pid_t) {
        // Do not display data from the connected profile until that extension
        // confirms it owns the actually focused normal non-Incognito window.
        // A second physical press while checking toggles the pending opening
        // off; autorepeat is discarded in the tap callback above.
        if pendingHotkey != nil { cancelPendingHotkey(replay:false); return }
        let requestID = "native-hotkey-" + UUID().uuidString
        let timeout = DispatchWorkItem { [weak self] in self?.finishHotkey(requestID:requestID, payload:nil) }
        pendingHotkey = PendingHotkey(requestID:requestID, chromePID:chromePID, event:event,
                                     generation:paletteGeneration, timeout:timeout)
        DispatchQueue.main.asyncAfter(deadline:.now() + 1.2, execute:timeout)
        transport.send(["type":"hotkey-snapshot","requestId":requestID])
    }

    private func finishHotkey(requestID:String, payload:[String:Any]?) {
        guard let pending = pendingHotkey, pending.requestID == requestID else { return }
        pending.timeout.cancel()
        pendingHotkey = nil
        let chromeStillFocused = NSWorkspace.shared.frontmostApplication?.processIdentifier == pending.chromePID
        if let payload, payload["eligible"] as? Bool == true, chromeStillFocused,
           paletteGeneration == pending.generation, !panel.isVisible {
            show()
            deliver(["type":"snapshot","payload":payload])
        } else { replayHotkey(pending) }
    }

    private func cancelPendingHotkey(replay:Bool) {
        guard let pending = pendingHotkey else { return }
        pending.timeout.cancel()
        pendingHotkey = nil
        if replay { replayHotkey(pending) }
    }

    private func replayHotkey(_ pending:PendingHotkey) {
        // A user who changed apps or opened a new palette while the browser
        // checked eligibility must not have their new context disturbed.
        guard NSWorkspace.shared.frontmostApplication?.processIdentifier == pending.chromePID,
              paletteGeneration == pending.generation, panel?.isVisible != true else { return }
        pending.event.setIntegerValueField(.eventSourceUserData, value:hotkeyReplayMarker)
        pending.event.postToPid(pending.chromePID)
        if let release = pending.event.copy() {
            release.type = .keyUp
            release.postToPid(pending.chromePID)
        }
    }

    private func show() {
        cancelPendingHotkey(replay:false)
        paletteGeneration &+= 1
        returnApplication = NSWorkspace.shared.frontmostApplication
        let frame = preferredScreen().visibleFrame
        let width = min(CGFloat(704), frame.width - 40)
        let height = min(CGFloat(520), frame.height - 60)
        panel.setFrame(NSRect(x: frame.midX - width / 2, y: frame.maxY - height - max(CGFloat(40), frame.height * 0.12), width: width, height: height), display: true)
        NSApp.activate(ignoringOtherApps: true)
        panel.makeKeyAndOrderFront(nil)
        panel.makeFirstResponder(webView)
        webView.evaluateJavaScript("window.dispatchEvent(new CustomEvent('palette-open')); document.querySelector('input')?.focus();")
    }

    private func preferredScreen() -> NSScreen {
        if let chrome = NSRunningApplication.runningApplications(withBundleIdentifier: chromeBundleID).first,
           AXIsProcessTrusted() {
            let application = AXUIElementCreateApplication(chrome.processIdentifier)
            var windowValue: CFTypeRef?
            if AXUIElementCopyAttributeValue(application, kAXFocusedWindowAttribute as CFString, &windowValue) == .success,
               let window = windowValue {
                var positionValue: CFTypeRef?
                if AXUIElementCopyAttributeValue(window as! AXUIElement, kAXPositionAttribute as CFString, &positionValue) == .success,
                   let raw = positionValue, CFGetTypeID(raw) == AXValueGetTypeID() {
                    var point = CGPoint.zero
                    if AXValueGetValue(raw as! AXValue, .cgPoint, &point), let primary = NSScreen.screens.first {
                        let cocoa = NSPoint(x: point.x + 100, y: primary.frame.maxY - point.y - 100)
                        if let screen = NSScreen.screens.first(where: { $0.frame.contains(cocoa) }) { return screen }
                    }
                }
            }
        }
        let mouse = NSEvent.mouseLocation
        return NSScreen.screens.first(where: { $0.frame.contains(mouse) }) ?? NSScreen.main ?? NSScreen.screens[0]
    }

    private func dismiss(restoreFocus: Bool = true) {
        guard panel.isVisible else { return }
        panel.orderOut(nil)
        if restoreFocus {
            let chrome = NSRunningApplication.runningApplications(withBundleIdentifier: chromeBundleID).first
            (chrome ?? returnApplication)?.activate(options: [])
        }
    }

    func windowDidResignKey(_ notification: Notification) {
        // Switching to another app closes the palette without taking focus back.
        if panel.isVisible { dismiss(restoreFocus: false) }
    }

    private func handleCommandKey(_ event: NSEvent) -> Bool {
        guard panel.isKeyWindow, event.type == .keyDown else { return false }
        if event.keyCode == 53 { dismiss(); return true }
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        guard flags.contains(.command), !flags.contains(.control), !flags.contains(.option) else { return false }
        // Match Arc: a second plain ⌘T closes the focused palette. Modified
        // variants continue through the existing keyboard handling below.
        if event.keyCode == 17, !flags.contains(.shift), !flags.contains(.function) {
            if event.isARepeat { return true }
            dismiss()
            return true
        }
        let key = event.charactersIgnoringModifiers?.lowercased() ?? ""
        let map: [UInt16: String] = [0:"KeyA",1:"KeyS",2:"KeyD",3:"KeyF",4:"KeyH",5:"KeyG",6:"KeyZ",7:"KeyX",8:"KeyC",9:"KeyV",11:"KeyB",12:"KeyQ",13:"KeyW",14:"KeyE",15:"KeyR",16:"KeyY",17:"KeyT",18:"Digit1",19:"Digit2",20:"Digit3",21:"Digit4",22:"Digit6",23:"Digit5",25:"Digit9",26:"Digit7",28:"Digit8",29:"Digit0",31:"KeyO",32:"KeyU",34:"KeyI",35:"KeyP",37:"KeyL",38:"KeyJ",40:"KeyK",45:"KeyN",46:"KeyM"]
        guard let code = map[event.keyCode] else { return false }
        let object: [String: Any] = ["key":key,"code":code,"metaKey":true,"ctrlKey":false,"altKey":false,"shiftKey":flags.contains(.shift),"bubbles":true,"cancelable":true]
        if let data = try? JSONSerialization.data(withJSONObject: object), let json = String(data:data,encoding:.utf8) {
            webView.evaluateJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', \(json)));")
        }
        return true
    }

    private func handleNativeMessage(_ message: [String: Any]) {
        let type = message["type"] as? String ?? ""
        if let requestID = message["requestId"] as? String,
           pendingHotkey?.requestID == requestID,
           type == "hotkey-snapshot" || type == "error" {
            finishHotkey(requestID:requestID, payload:type == "hotkey-snapshot" ? message["payload"] as? [String:Any] : nil)
            return
        }
        switch type {
        case "open":
            show()
            if let payload = message["payload"] as? [String: Any] {
                deliver(["type":"snapshot","payload":payload])
            } else { transport.send(["type":"snapshot","requestId":"native-open-" + UUID().uuidString]) }
        case "executed":
            // An execution started in a previous invocation may finish after
            // the user has reopened the palette. Resolve its JS promise, but
            // never let that old response dismiss the new invocation.
            if let id = requestIdentifier(message["requestId"]),
               let generation = executeGenerations.removeValue(forKey:id),
               generation == paletteGeneration, panel.isVisible {
                dismiss()
            }
            deliver(message)
        case "close":
            dismiss()
            deliver(message)
        case "status":
            transport.send(["type":"status","requestId":message["requestId"] ?? "", "payload":statusPayload()])
        default:
            if type == "error", let id = requestIdentifier(message["requestId"]) {
                executeGenerations.removeValue(forKey:id)
            }
            deliver(message)
        }
    }

    private func requestIdentifier(_ value: Any?) -> String? {
        if let value = value as? String { return "string:" + value }
        if let value = value as? NSNumber { return "number:" + value.stringValue }
        return nil
    }

    private func deliver(_ message: [String: Any]) {
        guard pageReady else { queuedResponses.append(message); return }
        guard let data = try? JSONSerialization.data(withJSONObject: message), let json = String(data:data,encoding:.utf8) else { return }
        webView.evaluateJavaScript("window.paletteReceive?.(\(json));")
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.frameInfo.isMainFrame, let object = message.body as? [String: Any],
              let type = object["type"] as? String,
              ["snapshot","search","execute","close"].contains(type) else { return }
        if selfTestOnly {
            let payload:[String:Any] = type == "snapshot"
                ? ["tabs":[],"mode":"native","shortcutModifier":"⌘"]
                : (type == "search" ? ["suggestions":[],"query":object["query"] ?? ""] : ["ok":true])
            deliver(["type":type == "execute" ? "executed" : type,"requestId":object["requestId"] ?? "","payload":payload])
            return
        }
        if type == "close" {
            dismiss()
            deliver(["type":"close","requestId":object["requestId"] ?? "", "payload":["ok":true]])
            return
        }
        if type == "execute", let id = requestIdentifier(object["requestId"]) {
            executeGenerations[id] = paletteGeneration
        }
        transport.send(object)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        queuedResponses.forEach { deliver($0) }
        queuedResponses.removeAll()
        if selfTestOnly {
            checkSelfTestReadiness()
            return
        }
        if panel.isVisible { webView.evaluateJavaScript("document.querySelector('input')?.focus();") }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        if selfTestOnly { finishSelfTest(["ok":false,"error":error.localizedDescription],status:1) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        if selfTestOnly { finishSelfTest(["ok":false,"error":error.localizedDescription],status:1) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if let url = navigationAction.request.url, url.isFileURL,
           url.standardizedFileURL.path.hasPrefix(assetDirectory.standardizedFileURL.path + "/") {
            decisionHandler(.allow)
        } else { decisionHandler(.cancel) }
    }

    private func showProblem(_ message: String) {
        let alert = NSAlert()
        alert.messageText = "Tab Palette setup"
        alert.informativeText = message
        alert.runModal()
    }

    private func showSetup() {
        NSApp.activate(ignoringOtherApps: true)
        let alert = NSAlert()
        alert.messageText = "Tab Palette companion"
        let trusted = AXIsProcessTrusted()
        alert.informativeText = trusted
            ? "Accessibility is enabled. Chrome launches this companion when the Tab Palette extension connects. Close this setup window and reload the extension to connect."
            : "Exact ⌘T interception needs Accessibility access. Open Accessibility settings, add this Tab Palette Companion application, and enable it. Then reload the extension in Chrome. The companion only intercepts ⌘T while Chrome is frontmost."
        if !trusted { alert.addButton(withTitle: "Open Accessibility Settings") }
        alert.addButton(withTitle: "Close")
        let response = alert.runModal()
        if !trusted && response == .alertFirstButtonReturn,
           let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
        NSApp.terminate(nil)
    }
}

let application = NSApplication.shared
let companion = Companion()
application.delegate = companion
application.run()
