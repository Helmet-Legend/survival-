package com.resilios.battery

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Niveau et état de charge de la batterie, lus à la demande dans la dernière
 * diffusion ACTION_BATTERY_CHANGED (aucune permission).
 *
 * Branchement et débranchement : récepteur actif seulement pendant qu'un
 * écran regarde la batterie (start / stop), évènement « ResiliosBatteryPlug »
 * pour relire l'état aussitôt.
 */
class BatteryModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private var receiver: BroadcastReceiver? = null

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
    // Branché : secteur, USB ou sans fil. À 100 % ou en charge optimisée,
    // Android dit « pas en charge » alors que le téléphone est branché.
    val plugged = intent.getIntExtra(BatteryManager.EXTRA_PLUGGED, 0) != 0
    val result = Arguments.createMap()
    result.putDouble("level", level * 100.0 / scale)
    result.putBoolean(
        "charging",
        plugged ||
            status == BatteryManager.BATTERY_STATUS_CHARGING ||
            status == BatteryManager.BATTERY_STATUS_FULL)
    promise.resolve(result)
  }

  @ReactMethod
  fun start() {
    if (receiver != null) return
    val next =
        object : BroadcastReceiver() {
          override fun onReceive(ctx: Context, intent: Intent) {
            val map = Arguments.createMap()
            map.putBoolean("plugged", intent.action == Intent.ACTION_POWER_CONNECTED)
            context.emitDeviceEvent(EVENT, map)
          }
        }
    val filter =
        IntentFilter().apply {
          addAction(Intent.ACTION_POWER_CONNECTED)
          addAction(Intent.ACTION_POWER_DISCONNECTED)
        }
    try {
      ContextCompat.registerReceiver(
          context, next, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
      receiver = next
    } catch (_: Exception) {}
  }

  @ReactMethod
  fun stop() {
    receiver?.let {
      try {
        context.unregisterReceiver(it)
      } catch (_: Exception) {}
    }
    receiver = null
  }

  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

  override fun invalidate() {
    stop()
    super.invalidate()
  }

  companion object {
    const val EVENT = "ResiliosBatteryPlug"
  }
}
