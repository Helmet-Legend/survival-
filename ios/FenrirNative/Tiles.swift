import Foundation
import React

/** Téléchargement d'une tuile de carte (Géoplateforme IGN seulement). */
@objc(ResiliosTiles)
class ResiliosTiles: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func fetchTile(
    _ url: String, resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    guard url.hasPrefix("https://data.geopf.fr/"), let target = URL(string: url) else {
      reject("URL", "Adresse non autorisée", nil)
      return
    }
    var request = URLRequest(url: target, timeoutInterval: 20)
    request.setValue("Fenrir/1.0 (iOS; cartes hors ligne)", forHTTPHeaderField: "User-Agent")
    request.setValue("image/png,image/jpeg,image/*", forHTTPHeaderField: "Accept")
    URLSession.shared.dataTask(with: request) { data, response, error in
      if let error = error {
        reject("NETWORK", error.localizedDescription, error)
        return
      }
      guard let http = response as? HTTPURLResponse else {
        reject("NETWORK", "Réponse invalide", nil)
        return
      }
      guard http.statusCode == 200 else {
        reject("HTTP", "HTTP \(http.statusCode)", nil)
        return
      }
      let type =
        (http.value(forHTTPHeaderField: "Content-Type") ?? "")
        .split(separator: ";").first.map { $0.trimmingCharacters(in: .whitespaces) } ?? ""
      guard type.hasPrefix("image/") else {
        reject("TYPE", "Réponse inattendue (\(type))", nil)
        return
      }
      guard let data = data, !data.isEmpty else {
        reject("EMPTY", "Tuile vide", nil)
        return
      }
      resolve("data:\(type);base64," + data.base64EncodedString())
    }.resume()
  }
}
