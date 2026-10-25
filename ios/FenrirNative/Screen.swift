import Foundation
import React
import UIKit

/**
 * Discrétion de l'écran. iOS ne permet pas d'interdire les captures : quand
 * elles sont « refusées », le contenu est masqué dès que Fenrir quitte le
 * premier plan (sélecteur d'applications) et pendant l'enregistrement de
 * l'écran ou la recopie vidéo.
 */
@objc(ResiliosScreen)
class ResiliosScreen: NSObject {
  private static let key = "fenrir_capture_allowed"
  private static var cover: UIView?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  override init() {
    super.init()
    let center = NotificationCenter.default
    center.addObserver(
      self, selector: #selector(hide), name: UIApplication.willResignActiveNotification,
      object: nil)
    center.addObserver(
      self, selector: #selector(show), name: UIApplication.didBecomeActiveNotification,
      object: nil)
    center.addObserver(
      self, selector: #selector(capturedChanged), name: UIScreen.capturedDidChangeNotification,
      object: nil)
  }

  private static var allowed: Bool {
    UserDefaults.standard.object(forKey: key) as? Bool ?? false
  }

  @objc func isCaptureAllowed(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    resolve(ResiliosScreen.allowed)
  }

  @objc func setCaptureAllowed(
    _ allowed: Bool, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    UserDefaults.standard.set(allowed, forKey: ResiliosScreen.key)
    resolve(allowed)
  }

  @objc private func hide() {
    DispatchQueue.main.async { ResiliosScreen.cover(true) }
  }

  @objc private func show() {
    DispatchQueue.main.async {
      ResiliosScreen.cover(UIScreen.main.isCaptured && !ResiliosScreen.allowed)
    }
  }

  @objc private func capturedChanged() {
    DispatchQueue.main.async {
      ResiliosScreen.cover(UIScreen.main.isCaptured && !ResiliosScreen.allowed)
    }
  }

  /** Voile opaque aux couleurs de l'application, par-dessus tout le contenu. */
  private static func cover(_ visible: Bool) {
    guard visible, !allowed else {
      cover?.removeFromSuperview()
      cover = nil
      return
    }
    guard cover == nil,
      let window = UIApplication.shared.connectedScenes
        .compactMap({ ($0 as? UIWindowScene)?.windows.first(where: { $0.isKeyWindow }) })
        .first
    else { return }
    let view = UIView(frame: window.bounds)
    view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.backgroundColor = UIColor(red: 3 / 255, green: 9 / 255, blue: 13 / 255, alpha: 1)
    window.addSubview(view)
    cover = view
  }
}
