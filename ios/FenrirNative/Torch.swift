import AVFoundation
import Foundation
import React

/**
 * Lampe du flash en signal SOS. Le motif est joué sur une file à part pour
 * garder un rythme régulier, et répété jusqu'à `stop()`. Le mode lampe
 * n'ouvre pas l'appareil photo : aucune autorisation n'est demandée.
 */
@objc(ResiliosTorch)
class ResiliosTorch: NSObject {
  private let queue = DispatchQueue(label: "fenrir.sos")
  private let lock = NSLock()
  /** Change à chaque démarrage ou arrêt : un ancien cycle s'arrête de lui-même. */
  private var generation = 0

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private var device: AVCaptureDevice? {
    guard let d = AVCaptureDevice.default(for: .video), d.hasTorch else { return nil }
    return d
  }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    ["available": device != nil]
  }

  /** Sous `lock` : un arrêt ne peut pas être suivi d'un dernier allumage. */
  private func setTorch(_ on: Bool, ifGeneration expected: Int?) -> Bool {
    lock.lock()
    defer { lock.unlock() }
    if let expected = expected, expected != generation { return false }
    guard let d = device, (try? d.lockForConfiguration()) != nil else { return false }
    d.torchMode = on ? .on : .off
    d.unlockForConfiguration()
    return true
  }

  @objc func blink(
    _ pattern: [NSNumber], resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let durations = pattern.map { min(max($0.doubleValue, 10), 10_000) / 1000 }
    guard device != nil else {
      reject("NO_TORCH", "Pas de lampe sur ce téléphone", nil)
      return
    }
    guard !durations.isEmpty else {
      reject("PATTERN", "Motif vide", nil)
      return
    }
    lock.lock()
    generation += 1
    let mine = generation
    lock.unlock()
    queue.async { [weak self] in
      var index = 0
      while let self = self, self.setTorch(index % 2 == 0, ifGeneration: mine) {
        Thread.sleep(forTimeInterval: durations[index])
        index = (index + 1) % durations.count
      }
      if let self = self {
        self.lock.lock()
        let current = self.generation == mine
        self.lock.unlock()
        if current { self.stopNow() }
      }
    }
    resolve(nil)
  }

  @objc func stop(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    stopNow()
    resolve(nil)
  }

  private func stopNow() {
    lock.lock()
    generation += 1
    lock.unlock()
    _ = setTorch(false, ifGeneration: nil)
  }

  deinit {
    stopNow()
  }
}
