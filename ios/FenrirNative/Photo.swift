import Foundation
import PhotosUI
import React
import UIKit

/**
 * Photo d'un article, d'une arme ou d'un document : appareil photo ou
 * photothèque. L'image est réduite (côté le plus long ≤ 1 600 px), redressée
 * et rendue en JPEG base64 ; elle n'est gardée que dans le coffre chiffré.
 */
@objc(ResiliosPhoto)
class ResiliosPhoto: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate,
  PHPickerViewControllerDelegate
{
  private static let maxSide: CGFloat = 1600
  private static let quality: CGFloat = 0.8
  private var resolve: RCTPromiseResolveBlock?
  private var reject: RCTPromiseRejectBlock?

  @objc static func requiresMainQueueSetup() -> Bool { true }

  private func start(
    _ resolve: @escaping RCTPromiseResolveBlock, _ reject: @escaping RCTPromiseRejectBlock
  ) -> UIViewController? {
    if self.resolve != nil {
      reject("BUSY", "Une photo est déjà en cours", nil)
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

  /** Réduit, redresse (orientation EXIF) et encode en JPEG base64. */
  private static func encode(_ image: UIImage) -> String? {
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
