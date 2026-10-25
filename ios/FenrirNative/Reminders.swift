import Foundation
import React
import UserNotifications

/**
 * Rappels de péremption : notifications locales programmées aux heures
 * données, au texte neutre (rien sur le contenu du coffre). iOS en garde
 * 64 au plus ; les plus proches sont programmées en premier.
 */
@objc(ResiliosReminders)
class ResiliosReminders: NSObject {
  private static let prefix = "fenrir-reminder-"

  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func schedule(
    _ times: [NSNumber], resolver resolve: @escaping RCTPromiseResolveBlock,
    rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    let center = UNUserNotificationCenter.current()
    center.requestAuthorization(options: [.alert, .sound]) { granted, _ in
      self.removeAll(center) {
        guard granted else {
          resolve(0)
          return
        }
        let now = Date().timeIntervalSince1970 * 1000
        let future = times.map { $0.doubleValue }.filter { $0 > now }.sorted().prefix(64)
        let group = DispatchGroup()
        var count = 0
        let lock = NSLock()
        for (index, ms) in future.enumerated() {
          let content = UNMutableNotificationContent()
          content.title = "Fenrir"
          content.body = "Un rappel vous attend."
          content.sound = .default
          let trigger = UNTimeIntervalNotificationTrigger(
            timeInterval: max(1, (ms - now) / 1000), repeats: false)
          let request = UNNotificationRequest(
            identifier: "\(ResiliosReminders.prefix)\(index)", content: content, trigger: trigger)
          group.enter()
          center.add(request) { error in
            if error == nil {
              lock.lock()
              count += 1
              lock.unlock()
            }
            group.leave()
          }
        }
        group.notify(queue: .main) { resolve(count) }
      }
    }
  }

  @objc func cancelAll(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    removeAll(UNUserNotificationCenter.current()) { resolve(nil) }
  }

  private func removeAll(_ center: UNUserNotificationCenter, then done: @escaping () -> Void) {
    center.getPendingNotificationRequests { requests in
      let ids = requests.map { $0.identifier }.filter { $0.hasPrefix(ResiliosReminders.prefix) }
      center.removePendingNotificationRequests(withIdentifiers: ids)
      done()
    }
  }
}
