import Foundation
import PDFKit
import PhotosUI
import React
import UIKit
import UniformTypeIdentifiers
import VisionKit

/**
 * Photo d'un article, d'une arme ou d'un document : appareil photo ou
 * photothèque. L'image est réduite (côté le plus long ≤ 1 600 px), redressée
 * et rendue en JPEG base64 ; elle n'est gardée que dans le coffre chiffré.
 *
 * PDF : choisi dans Fichiers, chaque page est convertie en image par PDFKit,
 * sans réseau ; la copie temporaire du fichier est effacée aussitôt.
 */
@objc(ResiliosPhoto)
class ResiliosPhoto: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate,
  PHPickerViewControllerDelegate, VNDocumentCameraViewControllerDelegate,
  UIDocumentPickerDelegate
{
  private static let maxSide: CGFloat = 1600
  /** Pages de documents : assez fines pour être réimprimées en A4. */
  private static let scanMaxSide: CGFloat = 2500
  private var scanLimit = 30
  private var pdfLimit = 30
  /** Pages de PDF : lisibles en zoomant, sans alourdir le coffre. */
  private static let pdfMaxSide: CGFloat = 1800
  private static let quality: CGFloat = 0.8
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  @objc func constantsToExport() -> [AnyHashable: Any]! {
    ["canScanDocuments": VNDocumentCameraViewController.isSupported]
  }

  /** Scanner de documents d'Apple (bords, redressement, plusieurs pages). */
  @objc func scanDocument(
    _ maxPages: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard VNDocumentCameraViewController.isSupported else {
        reject("SCAN_UNAVAILABLE", "Scanner de documents indisponible", nil)
        return
      }
      guard let presenter = self.start(resolve, reject) else { return }
      self.scanLimit = max(1, Int(maxPages))
      let scanner = VNDocumentCameraViewController()
      scanner.delegate = self
      presenter.present(scanner, animated: true)
    }
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController, didFinishWith scan: VNDocumentCameraScan
  ) {
    controller.dismiss(animated: true)
    let images = (0..<min(scan.pageCount, scanLimit)).map { scan.imageOfPage(at: $0) }
    let done = resolve
    let fail = reject
    resolve = nil
    reject = nil
    DispatchQueue.global(qos: .userInitiated).async {
      let pages = images.compactMap { ResiliosPhoto.encode($0, maxSide: ResiliosPhoto.scanMaxSide) }
      if pages.count == images.count {
        done?(pages.isEmpty ? nil : pages)
      } else {
        fail?("SCAN_FAILED", "Page illisible", nil)
      }
    }
  }

  func documentCameraViewControllerDidCancel(_ controller: VNDocumentCameraViewController) {
    controller.dismiss(animated: true)
    finish(nil)
  }

  func documentCameraViewController(
    _ controller: VNDocumentCameraViewController, didFailWithError error: Error
  ) {
    controller.dismiss(animated: true)
    let fail = reject
    resolve = nil
    reject = nil
    fail?("SCAN_FAILED", error.localizedDescription, error)
  }

  private func start(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock
  ) -> UIViewController? {
    // Une demande restée sans réponse (fenêtre fermée d'un glissement)
    // bloquerait les suivantes : un nouvel appui l'abandonne.
    if let stale = self.reject {
      self.resolve = nil
      self.reject = nil
      stale("CANCELLED", "Photo précédente abandonnée", nil)
    }
    guard let presenter = RCTPresentedViewController() else {
      reject("NO_ACTIVITY", "Application au second plan", nil)
      return nil
    }
    self.resolve = resolve
    self.reject = reject
    return presenter
  }

  private func finish(_ image: UIImage?) {
    let done = resolve
    let fail = reject
    resolve = nil
    reject = nil
    guard let image = image else {
      done?(nil)
      return
    }
    DispatchQueue.global(qos: .userInitiated).async {
      if let data = ResiliosPhoto.encode(image) {
        done?(data)
      } else {
        fail?("PHOTO_FAILED", "Image illisible", nil)
      }
    }
  }

  @objc func takePhoto(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard UIImagePickerController.isSourceTypeAvailable(.camera) else {
        reject("NO_CAMERA", "Appareil photo indisponible", nil)
        return
      }
      guard let presenter = self.start(resolve, reject) else { return }
      let picker = UIImagePickerController()
      picker.sourceType = .camera
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  @objc func pickPhoto(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let presenter = self.start(resolve, reject) else { return }
      var config = PHPickerConfiguration()
      config.filter = .images
      config.selectionLimit = 1
      let picker = PHPickerViewController(configuration: config)
      picker.delegate = self
      presenter.present(picker, animated: true)
    }
  }

  func imagePickerController(
    _ picker: UIImagePickerController,
    didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
  ) {
    picker.dismiss(animated: true)
    finish(info[.originalImage] as? UIImage)
  }

  func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
    picker.dismiss(animated: true)
    finish(nil)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    picker.dismiss(animated: true)
    guard let provider = results.first?.itemProvider, provider.canLoadObject(ofClass: UIImage.self)
    else {
      finish(nil)
      return
    }
    provider.loadObject(ofClass: UIImage.self) { object, _ in
      DispatchQueue.main.async { self.finish(object as? UIImage) }
    }
  }

  /** PDF choisi dans Fichiers : { name, pageCount, pages }, ou null si annulé. */
  @objc func pickPdf(
    _ maxPages: Double, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      guard let presenter = self.start(resolve, reject) else { return }
      self.pdfLimit = max(1, Int(maxPages))
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
    guard let url = urls.first else {
      done?(nil)
      return
    }
    let limit = pdfLimit
    DispatchQueue.global(qos: .userInitiated).async {
      defer { try? FileManager.default.removeItem(at: url) }
      guard let document = PDFDocument(url: url) else {
        fail?("PDF_FAILED", "PDF illisible", nil)
        return
      }
      if document.isLocked && !document.unlock(withPassword: "") {
        fail?("PDF_PROTECTED", "Ce PDF est protégé par un mot de passe : Fenrir ne peut pas l’ouvrir.", nil)
        return
      }
      var pages: [String] = []
      for index in 0..<min(document.pageCount, limit) {
        guard let page = document.page(at: index) else { continue }
        let box = page.bounds(for: .mediaBox)
        let turned = page.rotation % 180 != 0
        let width = turned ? box.height : box.width
        let height = turned ? box.width : box.height
        let scale = ResiliosPhoto.pdfMaxSide / max(width, height, 1)
        let image = page.thumbnail(
          of: CGSize(width: width * scale, height: height * scale), for: .mediaBox)
        if let data = image.jpegData(compressionQuality: ResiliosPhoto.quality) {
          pages.append(data.base64EncodedString())
        }
      }
      done?([
        "name": url.lastPathComponent,
        "pageCount": document.pageCount,
        "pages": pages,
      ])
    }
  }

  func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
    let done = resolve
    resolve = nil
    reject = nil
    done?(nil)
  }

  /** Réduit, redresse (orientation EXIF) et encode en JPEG base64. */
  private static func encode(_ image: UIImage, maxSide: CGFloat = ResiliosPhoto.maxSide) -> String? {
    let longest = max(image.size.width, image.size.height)
    let scale = min(1, maxSide / max(longest, 1))
    let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
    let format = UIGraphicsImageRendererFormat.default()
    format.scale = 1
    let rendered = UIGraphicsImageRenderer(size: size, format: format).image { _ in
      image.draw(in: CGRect(origin: .zero, size: size))
    }
    return rendered.jpegData(compressionQuality: quality)?.base64EncodedString()
  }
}
