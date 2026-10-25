import AVFoundation
import AudioToolbox
import Foundation
import React
import UIKit

/**
 * Lecteur de codes-barres (EAN, UPC, Data Matrix des médicaments) ou de QR
 * code d'association, avec la caméra arrière, sans rien enregistrer ni
 * envoyer. En série, chaque passage d'un code est compté ; un code qui
 * reste dans le cadre n'est compté qu'une fois. Formats renvoyés avec les
 * mêmes noms que sur Android (EAN_13, DATA_MATRIX, QR_CODE…).
 */
@objc(ResiliosScanner)
class ResiliosScanner: NSObject {
  private var resolve: RCTPromiseResolveBlock?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func scan(
    _ series: Bool, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    start(series: series, qr: false, resolve, reject)
  }

  @objc func scanQr(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    start(series: false, qr: true, resolve, reject)
  }

  private func start(
    series: Bool, qr: Bool, _ resolve: @escaping RCTPromiseResolveBlock,
    _ reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if self.resolve != nil {
        reject("BUSY", "Une lecture est déjà en cours", nil)
        return
      }
      guard let presenter = RCTPresentedViewController() else {
        reject("NO_ACTIVITY", "Application au second plan", nil)
        return
      }
      let open = {
        self.resolve = resolve
        let controller = ScanViewController(series: series, qr: qr) { reads, error in
          self.resolve = nil
          if let error = error {
            reject("CAMERA", error, nil)
          } else {
            resolve(reads)
          }
        }
        controller.modalPresentationStyle = .fullScreen
        presenter.present(controller, animated: true)
      }
      switch AVCaptureDevice.authorizationStatus(for: .video) {
      case .authorized:
        open()
      case .notDetermined:
        AVCaptureDevice.requestAccess(for: .video) { granted in
          DispatchQueue.main.async {
            if granted {
              open()
            } else {
              reject("CAMERA", "Accès à la caméra refusé", nil)
            }
          }
        }
      default:
        reject("CAMERA", "Accès à la caméra refusé dans les réglages", nil)
      }
    }
  }
}

private final class ScanViewController: UIViewController, AVCaptureMetadataOutputObjectsDelegate {
  private let series: Bool
  private let qr: Bool
  private let done: ([[String: String]]?, String?) -> Void
  private let session = AVCaptureSession()
  private var preview: AVCaptureVideoPreviewLayer?
  private let status = UILabel()
  private var reads: [[String: String]] = []
  private var lastCode: String?
  private var lastSeen: TimeInterval = 0
  private var finished = false

  /** Absence minimale d'un code avant de le compter à nouveau. */
  private static let repeatGap: TimeInterval = 1.5

  init(series: Bool, qr: Bool, done: @escaping ([[String: String]]?, String?) -> Void) {
    self.series = series
    self.qr = qr
    self.done = done
    super.init(nibName: nil, bundle: nil)
  }

  required init?(coder: NSCoder) { fatalError("init(coder:) non utilisé") }

  override func viewDidLoad() {
    super.viewDidLoad()
    view.backgroundColor = .black
    guard let camera = AVCaptureDevice.default(for: .video),
      let input = try? AVCaptureDeviceInput(device: camera), session.canAddInput(input)
    else {
      DispatchQueue.main.async { self.close(error: "Caméra indisponible") }
      return
    }
    session.addInput(input)
    let output = AVCaptureMetadataOutput()
    guard session.canAddOutput(output) else {
      DispatchQueue.main.async { self.close(error: "Caméra indisponible") }
      return
    }
    session.addOutput(output)
    output.setMetadataObjectsDelegate(self, queue: .main)
    let wanted: [AVMetadataObject.ObjectType] =
      qr ? [.qr] : [.ean13, .ean8, .upce, .dataMatrix]
    output.metadataObjectTypes = wanted.filter { output.availableMetadataObjectTypes.contains($0) }

    let layer = AVCaptureVideoPreviewLayer(session: session)
    layer.videoGravity = .resizeAspectFill
    view.layer.addSublayer(layer)
    preview = layer

    status.textColor = .white
    status.font = .boldSystemFont(ofSize: 16)
    status.numberOfLines = 0
    status.text =
      qr
      ? "Visez le QR code affiché sur l’autre téléphone."
      : series
        ? "Visez les codes-barres ou les carrés Data Matrix l’un après l’autre."
        : "Visez le code-barres ou le carré Data Matrix."

    let cancel = UIButton(type: .system)
    cancel.setTitle(series ? "Terminer" : "Annuler", for: .normal)
    cancel.titleLabel?.font = .boldSystemFont(ofSize: 17)
    cancel.setTitleColor(.white, for: .normal)
    cancel.backgroundColor = UIColor(white: 1, alpha: 0.18)
    cancel.layer.cornerRadius = 12
    cancel.addTarget(self, action: #selector(stop), for: .touchUpInside)

    let panel = UIStackView(arrangedSubviews: [status, cancel])
    panel.axis = .vertical
    panel.spacing = 16
    panel.isLayoutMarginsRelativeArrangement = true
    panel.layoutMargins = UIEdgeInsets(top: 16, left: 20, bottom: 16, right: 20)
    panel.backgroundColor = UIColor(white: 0, alpha: 0.6)
    panel.translatesAutoresizingMaskIntoConstraints = false
    view.addSubview(panel)
    NSLayoutConstraint.activate([
      panel.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      panel.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      panel.bottomAnchor.constraint(equalTo: view.bottomAnchor),
      cancel.heightAnchor.constraint(equalToConstant: 52),
      cancel.bottomAnchor.constraint(
        equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -12),
    ])

    DispatchQueue.global(qos: .userInitiated).async { self.session.startRunning() }
  }

  override func viewDidLayoutSubviews() {
    super.viewDidLayoutSubviews()
    preview?.frame = view.bounds
  }

  func metadataOutput(
    _ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject],
    from connection: AVCaptureConnection
  ) {
    guard !finished,
      let object = metadataObjects.first as? AVMetadataMachineReadableCodeObject,
      let code = object.stringValue, !code.isEmpty
    else { return }
    let now = Date().timeIntervalSince1970
    if code == lastCode && now - lastSeen < ScanViewController.repeatGap {
      lastSeen = now
      return
    }
    lastCode = code
    lastSeen = now
    reads.append(["code": code, "format": ScanViewController.name(of: object.type)])
    AudioServicesPlaySystemSound(1057)
    UIImpactFeedbackGenerator(style: .light).impactOccurred()
    if !series {
      close(error: nil)
      return
    }
    let n = reads.count
    status.text = "\(n) lecture\(n > 1 ? "s" : "") · dernier code : \(code)"
  }

  /** Noms des formats identiques à ceux de ZXing sur Android. */
  private static func name(of type: AVMetadataObject.ObjectType) -> String {
    switch type {
    case .ean13: return "EAN_13"
    case .ean8: return "EAN_8"
    case .upce: return "UPC_E"
    case .dataMatrix: return "DATA_MATRIX"
    case .qr: return "QR_CODE"
    default: return type.rawValue
    }
  }

  @objc private func stop() {
    // En série, « Terminer » garde les lectures déjà faites.
    if series && !reads.isEmpty {
      close(error: nil)
    } else {
      finished = true
      session.stopRunning()
      dismiss(animated: true) { self.done(nil, nil) }
    }
  }

  private func close(error: String?) {
    guard !finished else { return }
    finished = true
    session.stopRunning()
    let result = reads
    dismiss(animated: true) {
      if let error = error {
        self.done(nil, error)
      } else {
        self.done(result, nil)
      }
    }
  }
}
