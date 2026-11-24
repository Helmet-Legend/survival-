import Foundation
import PDFKit
import React
import UIKit
import UniformTypeIdentifiers

/**
 * PDF ouvert le temps d'un import ou d'une lecture : une « session » par
 * fichier, désignée par un jeton (mêmes appels que sur Android).
 *
 * Les copies vivent dans le dossier temporaire de l'application (illisible
 * des autres applications) et sont effacées à la fermeture, et au
 * démarrage s'il en reste.
 */
@objc(ResiliosPdf)
class ResiliosPdf: NSObject, UIDocumentPickerDelegate {
  private final class Session {
    let url: URL
    var document: PDFDocument?
    init(url: URL) { self.url = url }
    func close() {
      document = nil
      try? FileManager.default.removeItem(at: url)
    }
  }

  private static let quality: CGFloat = 0.82
  private static let maxChunk = 4 * 1024 * 1024
  private static let protectedMessage =
    "Ce PDF est protégé par un mot de passe : Fenrir ne peut pas l’ouvrir."

  /** Un seul fil pour toutes les sessions. */
  private let queue = DispatchQueue(label: "fenrir.pdf")
  private var sessions: [String: Session] = [:]
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?

  private lazy var dir: URL = {
    let url = FileManager.default.temporaryDirectory.appendingPathComponent(
      "pdf", isDirectory: true)
    try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
  }()

  override init() {
    super.init()
    queue.async {
      let files = (try? FileManager.default.contentsOfDirectory(
        at: self.dir, includingPropertiesForKeys: nil)) ?? []
      files.forEach { try? FileManager.default.removeItem(at: $0) }
    }
  }

  @objc static func requiresMainQueueSetup() -> Bool { false }

  private func newURL() -> URL {
    dir.appendingPathComponent("\(UUID().uuidString).pdf")
  }

  /** Ouvre le document ; nil si illisible, erreur si protégé. */
  private func openDocument(_ session: Session) -> (PDFDocument?, Bool) {
    guard let document = PDFDocument(url: session.url) else { return (nil, false) }
    if document.isLocked && !document.unlock(withPassword: "") {
      return (nil, true)
    }
    session.document = document
    return (document, false)
  }

  // MARK: - Choix d'un PDF

  @objc func openPdf(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      if let stale = self.reject {
        self.resolve = nil
        self.reject = nil
        stale("CANCELLED", "Choix précédent abandonné", nil)
      }
      guard let presenter = RCTPresentedViewController() else {
        reject("NO_ACTIVITY", "Application au second plan", nil)
        return
      }
      self.resolve = resolve
      self.reject = reject
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.pdf], asCopy: true)
      picker.allowsMultipleSelection = false
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
    let done = resolve
    let fail = reject
    resolve = nil
    reject = nil
    guard let picked = urls.first else {
      done?(nil)
      return
    }
    queue.async {
      let session = Session(url: self.newURL())
      do {
        try FileManager.default.moveItem(at: picked, to: session.url)
      } catch {
        try? FileManager.default.removeItem(at: picked)
        fail?("PDF_FAILED", "PDF illisible", error)
        return
      }
      let (document, locked) = self.openDocument(session)
      guard let opened = document else {
        session.close()
        if locked {
          fail?("PDF_PROTECTED", ResiliosPdf.protectedMessage, nil)
        } else {
          fail?("PDF_FAILED", "PDF illisible", nil)
        }
        return
      }
      let token = UUID().uuidString
      self.sessions[token] = session
      let attributes = try? FileManager.default.attributesOfItem(atPath: session.url.path)
      let bytes = (attributes?[.size] as? NSNumber)?.doubleValue ?? 0
      done?([
        "token": token,
        "name": picked.lastPathComponent,
        "pageCount": opened.pageCount,
        "bytes": bytes,
      ])
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let done = resolve
    resolve = nil
    reject = nil
    done?(nil)
  }

  // MARK: - PDF reconstitué depuis le coffre

  @objc func beginPdf(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      let session = Session(url: self.newURL())
      guard FileManager.default.createFile(atPath: session.url.path, contents: nil) else {
        reject("PDF_FAILED", "Stockage impossible", nil)
        return
      }
      let token = UUID().uuidString
      self.sessions[token] = session
      resolve(token)
    }
  }

  @objc func appendPdf(
    _ token: String, base64: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let session = self.sessions[token], session.document == nil else {
        reject("PDF_CLOSED", "Document fermé", nil)
        return
      }
      guard let data = Data(base64Encoded: base64, options: .ignoreUnknownCharacters),
        let handle = try? FileHandle(forWritingTo: session.url)
      else {
        reject("PDF_FAILED", "Écriture impossible", nil)
        return
      }
      defer { try? handle.close() }
      do {
        try handle.seekToEnd()
        try handle.write(contentsOf: data)
        resolve(nil)
      } catch {
        reject("PDF_FAILED", "Écriture impossible", error)
      }
    }
  }

  @objc func loadPdf(
    _ token: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let session = self.sessions[token] else {
        reject("PDF_CLOSED", "Document fermé", nil)
        return
      }
      if let document = session.document {
        resolve(["pageCount": document.pageCount])
        return
      }
      let (document, locked) = self.openDocument(session)
      guard let opened = document else {
        self.sessions[token] = nil
        session.close()
        if locked {
          reject("PDF_PROTECTED", ResiliosPdf.protectedMessage, nil)
        } else {
          reject("PDF_FAILED", "PDF illisible", nil)
        }
        return
      }
      resolve(["pageCount": opened.pageCount])
    }
  }

  // MARK: - Pages et octets

  @objc func renderPdfPages(
    _ token: String, from: Double, count: Double, maxSide: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let document = self.sessions[token]?.document else {
        reject("PDF_CLOSED", "Document fermé", nil)
        return
      }
      let first = max(0, Int(from))
      let last = min(document.pageCount, first + min(20, max(1, Int(count))))
      let side = CGFloat(min(3000, max(400, maxSide)))
      var pages: [String] = []
      if first < last {
        for index in first..<last {
          autoreleasepool {
            guard let page = document.page(at: index) else { return }
            let box = page.bounds(for: .mediaBox)
            let turned = page.rotation % 180 != 0
            let width = turned ? box.height : box.width
            let height = turned ? box.width : box.height
            let scale = side / max(width, height, 1)
            let image = page.thumbnail(
              of: CGSize(width: width * scale, height: height * scale), for: .mediaBox)
            if let data = image.jpegData(compressionQuality: ResiliosPdf.quality) {
              pages.append(data.base64EncodedString())
            }
          }
        }
      }
      resolve(pages)
    }
  }

  @objc func readPdf(
    _ token: String, offset: Double, length: Double,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      guard let session = self.sessions[token],
        let handle = try? FileHandle(forReadingFrom: session.url)
      else {
        reject("PDF_CLOSED", "Document fermé", nil)
        return
      }
      defer { try? handle.close() }
      do {
        try handle.seek(toOffset: UInt64(max(0, offset)))
        let size = min(ResiliosPdf.maxChunk, max(1, Int(length)))
        let data = try handle.read(upToCount: size) ?? Data()
        resolve(data.base64EncodedString())
      } catch {
        reject("PDF_FAILED", "Lecture impossible", error)
      }
    }
  }

  @objc func closePdf(
    _ token: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    queue.async {
      self.sessions.removeValue(forKey: token)?.close()
      resolve(nil)
    }
  }
}
