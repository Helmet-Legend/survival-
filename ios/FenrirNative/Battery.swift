import Foundation
import React
import UIKit

/** Niveau et état de charge de la batterie, lus à la demande. */
@objc(ResiliosBattery)
class ResiliosBattery: NSObject {
  @objc static func requiresMainQueueSetup() -> Bool { false }

  @objc func getStatus(
    _ resolve: @escaping RCTPromiseResolveBlock, rejecter reject: @escaping RCTPromiseRejectBlock
  ) {
    DispatchQueue.main.async {
      let device = UIDevice.current
      device.isBatteryMonitoringEnabled = true
      let level = device.batteryLevel
      if level < 0 {
        resolve(nil)
        return
      }
      let state = device.batteryState
      resolve([
        "level": Double(level) * 100,
        "charging": state == .charging || state == .full,
      ])
    }
  }
}
