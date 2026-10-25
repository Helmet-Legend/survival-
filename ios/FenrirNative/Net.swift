import Foundation
import Network
import React

/**
 * Liaison directe entre deux téléphones du foyer sur le réseau local (même
 * Wi-Fi ou partage de connexion), sans internet ni serveur. Même protocole
 * que sur Android : chaque message est précédé de sa longueur (4 octets,
 * gros-boutiste) et son contenu est déjà chiffré par Fenrir.
 *
 * Découverte Bonjour sous le type neutre `_fnr._tcp`. Un téléphone trouvé
 * est rendu avec l'hôte « bonjour:<nom> », que `connect` sait joindre.
 *
 * Évènements `ResiliosNet` : open, message, close, found.
 */
@objc(ResiliosNet)
class ResiliosNet: RCTEventEmitter {
  private static let event = "ResiliosNet"
  private static let serviceType = "_fnr._tcp"
  /** 64 Mio : un envoi complet avec photos tient dans un message. */
  private static let maxFrame = 64 * 1024 * 1024

  private let queue = DispatchQueue(label: "fenrir.net")
  private var listener: NWListener?
  private var browser: NWBrowser?
  private var connections: [Int: NWConnection] = [:]
  private var nextId = 1

  @objc override static func requiresMainQueueSetup() -> Bool { false }

  override func supportedEvents() -> [String]! { [ResiliosNet.event] }

  private func emit(_ body: [String: Any]) {
    sendEvent(withName: ResiliosNet.event, body: body)
  }

  // --- Connexions -----------------------------------------------------------

  @objc func startServer(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.listener?.cancel()
      do {
        let listener = try NWListener(using: .tcp, on: .any)
        var settled = false
        listener.stateUpdateHandler = { state in
          switch state {
          case .ready:
            if !settled, let port = listener.port {
              settled = true
              resolve(Int(port.rawValue))
            }
          case .failed(let error):
            if !settled {
              settled = true
              reject("SERVER_FAILED", error.localizedDescription, error)
            }
          default:
            break
          }
        }
        listener.newConnectionHandler = { connection in
          connection.start(queue: self.queue)
          self.track(connection, incoming: true)
        }
        self.listener = listener
        listener.start(queue: self.queue)
      } catch {
        reject("SERVER_FAILED", error.localizedDescription, error)
      }
    }
  }

  @objc func stopServer() {
    queue.async {
      self.listener?.cancel()
      self.listener = nil
    }
  }

  @objc func connect(
    _ host: String, port: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      let endpoint: NWEndpoint
      if host.hasPrefix("bonjour:") {
        endpoint = .service(
          name: String(host.dropFirst("bonjour:".count)), type: ResiliosNet.serviceType,
          domain: "local.", interface: nil)
      } else {
        guard let p = NWEndpoint.Port(rawValue: UInt16(clamping: Int(port))) else {
          reject("CONNECT_FAILED", "Port invalide", nil)
          return
        }
        endpoint = .hostPort(host: NWEndpoint.Host(host), port: p)
      }
      let connection = NWConnection(to: endpoint, using: .tcp)
      var settled = false
      let fail: (String) -> Void = { message in
        guard !settled else { return }
        settled = true
        connection.cancel()
        reject("CONNECT_FAILED", message, nil)
      }
      connection.stateUpdateHandler = { state in
        switch state {
        case .ready:
          if !settled {
            settled = true
            resolve(self.track(connection, incoming: false))
          }
        case .failed(let error):
          fail(error.localizedDescription)
        case .waiting(let error):
          fail(error.localizedDescription)
        default:
          break
        }
      }
      connection.start(queue: self.queue)
      self.queue.asyncAfter(deadline: .now() + 5) { fail("Téléphone injoignable") }
    }
  }

  @discardableResult
  private func track(_ connection: NWConnection, incoming: Bool) -> Int {
    let id = nextId
    nextId += 1
    connections[id] = connection
    emit(["type": "open", "id": id, "incoming": incoming])
    connection.stateUpdateHandler = { state in
      if case .failed(let error) = state {
        self.closed(id, error: error.localizedDescription)
      }
    }
    receive(id, connection)
    return id
  }

  private func receive(_ id: Int, _ connection: NWConnection) {
    connection.receive(minimumIncompleteLength: 4, maximumLength: 4) { data, _, done, error in
      if let error = error {
        self.closed(id, error: error.localizedDescription)
        return
      }
      guard let header = data, header.count == 4 else {
        self.closed(id, error: done ? nil : "Connexion interrompue")
        return
      }
      let length = header.reduce(0) { ($0 << 8) | Int($1) }
      guard length >= 0, length <= ResiliosNet.maxFrame else {
        self.closed(id, error: "Message trop long")
        return
      }
      if length == 0 {
        self.emit(["type": "message", "id": id, "text": ""])
        self.receive(id, connection)
        return
      }
      connection.receive(minimumIncompleteLength: length, maximumLength: length) {
        body, _, _, error in
        if let error = error {
          self.closed(id, error: error.localizedDescription)
          return
        }
        guard let body = body, body.count == length else {
          self.closed(id, error: "Connexion interrompue")
          return
        }
        self.emit(["type": "message", "id": id, "text": String(decoding: body, as: UTF8.self)])
        self.receive(id, connection)
      }
    }
  }

  private func closed(_ id: Int, error: String?) {
    guard let connection = connections.removeValue(forKey: id) else { return }
    connection.cancel()
    var body: [String: Any] = ["type": "close", "id": id]
    if let error = error { body["error"] = error }
    emit(body)
  }

  @objc func send(
    _ id: Double, text: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let connection = self.connections[Int(id)] else {
        reject("CLOSED", "Connexion fermée", nil)
        return
      }
      let bytes = Data(text.utf8)
      var length = UInt32(bytes.count).bigEndian
      var frame = Data(bytes: &length, count: 4)
      frame.append(bytes)
      connection.send(
        content: frame,
        completion: .contentProcessed { error in
          if let error = error {
            reject("SEND_FAILED", error.localizedDescription, error)
          } else {
            resolve(nil)
          }
        })
    }
  }

  @objc func close(_ id: Double) {
    queue.async {
      if let connection = self.connections.removeValue(forKey: Int(id)) {
        connection.cancel()
      }
    }
  }

  /** Adresses IPv4 de ce téléphone sur les réseaux locaux. */
  @objc func localAddresses(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    var list: [String] = []
    var head: UnsafeMutablePointer<ifaddrs>?
    guard getifaddrs(&head) == 0, let first = head else {
      reject("ADDRESSES_FAILED", "Réseau introuvable", nil)
      return
    }
    defer { freeifaddrs(head) }
    var cursor: UnsafeMutablePointer<ifaddrs>? = first
    while let entry = cursor {
      let flags = Int32(entry.pointee.ifa_flags)
      if let address = entry.pointee.ifa_addr, address.pointee.sa_family == UInt8(AF_INET),
        flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0
      {
        var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        if getnameinfo(
          address, socklen_t(address.pointee.sa_len), &host, socklen_t(host.count), nil, 0,
          NI_NUMERICHOST) == 0
        {
          let text = String(cString: host)
          // Adresses d'auto-configuration (169.254…) : inutilisables.
          if !text.hasPrefix("169.254.") { list.append(text) }
        }
      }
      cursor = entry.pointee.ifa_next
    }
    resolve(list)
  }

  // --- Découverte -----------------------------------------------------------

  @objc func advertise(
    _ name: String, port: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let listener = self.listener else {
        reject("ADVERTISE_FAILED", "Annonce impossible : pas d’écoute en cours", nil)
        return
      }
      listener.service = NWListener.Service(name: name, type: ResiliosNet.serviceType)
      resolve(name)
    }
  }

  @objc func stopAdvertise() {
    queue.async { self.listener?.service = nil }
  }

  @objc func discover(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.browser?.cancel()
      let browser = NWBrowser(
        for: .bonjour(type: ResiliosNet.serviceType, domain: nil), using: .tcp)
      var settled = false
      browser.stateUpdateHandler = { state in
        switch state {
        case .ready:
          if !settled {
            settled = true
            resolve(nil)
          }
        case .failed(let error):
          if !settled {
            settled = true
            reject("DISCOVER_FAILED", error.localizedDescription, error)
          }
        default:
          break
        }
      }
      browser.browseResultsChangedHandler = { _, changes in
        for change in changes {
          if case .added(let result) = change,
            case .service(let name, _, _, _) = result.endpoint
          {
            self.emit(["type": "found", "name": name, "host": "bonjour:\(name)", "port": 0])
          }
        }
      }
      self.browser = browser
      browser.start(queue: self.queue)
    }
  }

  @objc func stopDiscovery() {
    queue.async {
      self.browser?.cancel()
      self.browser = nil
    }
  }

  override func invalidate() {
    queue.async {
      self.browser?.cancel()
      self.listener?.cancel()
      self.connections.values.forEach { $0.cancel() }
      self.connections.removeAll()
    }
    super.invalidate()
  }
}
