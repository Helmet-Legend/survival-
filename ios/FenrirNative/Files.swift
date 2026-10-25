import Foundation
import React
import UIKit
import UniformTypeIdentifiers

/**
 * Fichiers choisis par l'utilisateur (sauvegarde chiffrée, export CSV) avec
 * le sélecteur de l'app Fichiers, et impression d'une page HTML (imprimante
 * AirPrint ou PDF), sans réseau.
 */
@objc(ResiliosFiles)
class ResiliosFiles: NSObject, UIDocumentPickerDelegate {
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?
  private var exporting: URL?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  private func start(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock
  ) -> UIViewController? {
    if self.resolve != nil {
      reject("BUSY", "Un fichier est déjà en cours", nil)
      return nil
    }
    guard let presenter = RCTPresentedViewController() else {
      reject("NO_ACTIVITY", "Application au second plan", nil)
      return nil
    }
    self.resolve = resolve
    self.reject = reject
    return presenter
  }

  private func settle(_ value: Any?) {
    let done = resolve
    resolve = nil
    reject = nil
    if let url = exporting {
      try? FileManager.default.removeItem(at: url)
      exporting = nil
    }
    done?(value)
  }

  /** Propose d'enregistrer `text` ; résout true si le fichier est écrit. */
  @objc func saveText(
    _ fileName: String, mime: String, text: String,
    resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let presenter = self.start(resolve, reject) else { return }
      do {
        let safe = fileName.replacingOccurrences(of: "/", with: "-")
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(safe)
        try text.write(to: url, atomically: true, encoding: .utf8)
        self.exporting = url
        let picker = UIDocumentPickerViewController(forExporting: [url], asCopy: true)
        picker.delegate = self
        presenter.present(picker, animated: true)
      } catch {
        self.resolve = nil
        self.reject = nil
        reject("SAVE_FAILED", error.localizedDescription, error)
      }
    }
  }

  /** Propose d'ouvrir un fichier ; résout son texte, ou null si annulé. */
  @objc func openText(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let presenter = self.start(resolve, reject) else { return }
      let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
      picker.delegate = self
      picker.allowsMultipleSelection = false
      presenter.present(picker, animated: true)
    }
  }

  func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL])
  {
    if exporting != nil {
      settle(true)
      return
    }
    guard let url = urls.first else {
      settle(nil)
      return
    }
    let access = url.startAccessingSecurityScopedResource()
    defer { if access { url.stopAccessingSecurityScopedResource() } }
    do {
      let text = try String(contentsOf: url, encoding: .utf8)
      settle(text)
    } catch {
      let fail = reject
      resolve = nil
      reject = nil
      fail?("OPEN_FAILED", "Fichier illisible", error)
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    settle(exporting != nil ? false : nil)
  }

  /** Impression du système sur `html` ; résout quand elle est terminée ou annulée. */
  @objc func printHtml(
    _ jobName: String, html: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let controller = UIPrintInteractionController.shared
      let info = UIPrintInfo(dictionary: nil)
      info.jobName = jobName
      info.outputType = .general
      controller.printInfo = info
      controller.printFormatter = UIMarkupTextPrintFormatter(markupText: html)
      controller.present(animated: true) { _, _, error in
        if let error = error {
          reject("PRINT_FAILED", error.localizedDescription, error)
        } else {
          resolve(nil)
        }
      }
    }
  }
}
