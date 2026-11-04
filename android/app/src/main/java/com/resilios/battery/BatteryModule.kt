package com.resilios.battery

import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Niveau et état de charge de la batterie, lus à la demande dans la dernière
 * diffusion ACTION_BATTERY_CHANGED (aucune permission, aucun récepteur
 * permanent).
 */
class BatteryModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName() = "ResiliosBattery"

  @ReactMethod
  fun getStatus(promise: Promise) {
    val intent: Intent? =
        context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
    if (intent == null) {
      promise.resolve(null)
      return
    }
    val level = intent.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
    val scale = intent.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
    if (level < 0 || scale <= 0) {
      promise.resolve(null)
      return
    }
    val status = intent.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
    val result = Arguments.createMap()
    result.putDouble("level", level * 100.0 / scale)
    result.putBoolean(
        "charging",
        status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL)
    promise.resolve(result)
  }
}
