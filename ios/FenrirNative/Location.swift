import CoreLocation
import Foundation
import React

/**
 * Position GPS à la demande (écran Urgence, points de repère) et boussole.
 * Rien n'est suivi en arrière-plan.
 */
@objc(ResiliosLocation)
class ResiliosLocation: NSObject, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?
  private var timer: Timer?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
  }

  @objc func getPosition(
    _ timeoutMs: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if self.resolve != nil {
        reject("BUSY", "Une mesure est déjà en cours", nil)
        return
      }
      guard CLLocationManager.locationServicesEnabled() else {
        reject("DISABLED", "Localisation désactivée dans les réglages du téléphone", nil)
        return
      }
      self.resolve = resolve
      self.reject = reject
      switch self.manager.authorizationStatus {
      case .notDetermined:
        self.manager.requestWhenInUseAuthorization()
      case .denied, .restricted:
        self.finish(nil, error: ("PERMISSION", "Localisation refusée"))
        return
      default:
        self.manager.requestLocation()
      }
      self.timer = Timer.scheduledTimer(withTimeInterval: max(1, timeoutMs / 1000), repeats: false)
      { _ in
        self.finish(nil, error: nil)
      }
    }
  }

  func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
    guard resolve != nil else { return }
    switch manager.authorizationStatus {
    case .authorizedWhenInUse, .authorizedAlways:
      manager.requestLocation()
    case .denied, .restricted:
      finish(nil, error: ("PERMISSION", "Localisation refusée"))
    default:
      break
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    finish(locations.last, error: nil)
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    // Pas encore de position : on attend jusqu'au délai, puis la dernière connue.
  }

  private func finish(_ location: CLLocation?, error: (String, String)?) {
    guard let resolve = resolve, let reject = reject else { return }
    self.resolve = nil
    self.reject = nil
    timer?.invalidate()
    timer = nil
    if let failure = error {
      reject(failure.0, failure.1, nil)
      return
    }
    guard let fix = location ?? manager.location else {
      reject("TIMEOUT", "Aucune position : essayez à l’extérieur, ciel dégagé", nil)
      return
    }
    resolve([
      "latitude": fix.coordinate.latitude,
      "longitude": fix.coordinate.longitude,
      "accuracy": fix.horizontalAccuracy >= 0 ? fix.horizontalAccuracy : -1,
      "time": fix.timestamp.timeIntervalSince1970 * 1000,
      "stale": location == nil,
    ])
  }
}

/** Boussole : cap magnétique, évènement `ResiliosHeading` (comme Android). */
@objc(ResiliosCompass)
class ResiliosCompass: RCTEventEmitter, CLLocationManagerDelegate {
  private let manager = CLLocationManager()
  private var running = false
  private var lastSent: TimeInterval = 0
  private var lastHeading: CLHeading?

  @objc override static func requiresMainQueueSetup() -> Bool { true }

  override init() {
    super.init()
    manager.delegate = self
    manager.headingFilter = 1
  }

  override func supportedEvents() -> [String]! { ["ResiliosHeading"] }

  override func constantsToExport() -> [AnyHashable: Any]! {
    ["available": CLLocationManager.headingAvailable()]
  }

  @objc func start() {
    DispatchQueue.main.async {
      guard CLLocationManager.headingAvailable(), !self.running else { return }
      self.running = true
      if self.manager.authorizationStatus == .notDetermined {
        // Le nord géographique a besoin de la position.
        self.manager.requestWhenInUseAuthorization()
      }
      self.manager.startUpdatingHeading()
    }
  }

  @objc func stop() {
    DispatchQueue.main.async {
      self.running = false
      self.manager.stopUpdatingHeading()
    }
  }

  /**
   * Déclinaison (degrés, positive à l'est) : écart entre nord géographique et
   * magnétique mesuré par le téléphone ici. iOS ne la donne pas pour un
   * autre lieu : `latitude` et `longitude` ne servent pas.
   */
  @objc func declination(
    _ latitude: Double, longitude: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let h = self.lastHeading ?? self.manager.heading, h.trueHeading >= 0 else {
        reject("UNAVAILABLE", "Déclinaison inconnue", nil)
        return
      }
      var d = h.trueHeading - h.magneticHeading
      if d > 180 { d -= 360 }
      if d < -180 { d += 360 }
      resolve(d)
    }
  }

  func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
    lastHeading = newHeading
    let now = Date().timeIntervalSince1970
    guard running, now - lastSent >= 0.12 else { return }
    lastSent = now
    // Précision Android : 3 élevée … 0 non fiable ; iOS : écart en degrés.
    let accuracy: Int
    switch newHeading.headingAccuracy {
    case ..<0: accuracy = 0
    case ..<15: accuracy = 3
    case ..<30: accuracy = 2
    case ..<60: accuracy = 1
    default: accuracy = 0
    }
    sendEvent(
      withName: "ResiliosHeading",
      body: ["heading": newHeading.magneticHeading, "accuracy": accuracy])
  }

  func locationManagerShouldDisplayHeadingCalibration(_ manager: CLLocationManager) -> Bool {
    true
  }

  override func invalidate() {
    stop()
    super.invalidate()
  }
}
