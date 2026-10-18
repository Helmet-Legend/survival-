package com.resilios.scanner

import android.app.Activity
import android.content.Intent
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Lecture de codes-barres par l'écran [ScanActivity] : la caméra et le
 * décodage (ZXing) restent dans le téléphone, sans réseau ni service tiers.
 * Renvoie la liste des lectures `{ code, format }`, ou null si annulé.
 */
class ScannerModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private var pending: Promise? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = "ResiliosScanner"

  @ReactMethod
  fun scan(series: Boolean, promise: Promise) {
    if (pending != null) {
      promise.reject("BUSY", "Une lecture est déjà en cours")
      return
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Application au second plan")
      return
    }
    pending = promise
    try {
      val intent =
          Intent(activity, ScanActivity::class.java).putExtra(ScanActivity.EXTRA_SERIES, series)
      activity.startActivityForResult(intent, REQUEST_SCAN)
    } catch (e: Exception) {
      pending = null
      promise.reject("SCAN_FAILED", e.message ?: "Lecteur indisponible", e)
    }
  }

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?
  ) {
    if (requestCode != REQUEST_SCAN) {
      return
    }
    val promise = pending ?: return
    pending = null
    val codes = data?.getStringArrayListExtra(ScanActivity.RESULT_CODES)
    val formats = data?.getStringArrayListExtra(ScanActivity.RESULT_FORMATS)
    if (resultCode != Activity.RESULT_OK || codes == null || formats == null) {
      val error = data?.getStringExtra(ScanActivity.RESULT_ERROR)
      if (error != null) {
        promise.reject("CAMERA", error)
      } else {
        promise.resolve(null)
      }
      return
    }
    val list = Arguments.createArray()
    codes.forEachIndexed { i, code ->
      list.pushMap(
          Arguments.createMap().apply {
            putString("code", code)
            putString("format", formats.getOrNull(i) ?: "")
          })
    }
    promise.resolve(list)
  }

  override fun onNewIntent(intent: Intent) {}

  companion object {
    private const val REQUEST_SCAN = 0x5250
  }
}
