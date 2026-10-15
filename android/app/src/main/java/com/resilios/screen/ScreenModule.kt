package com.resilios.screen

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/** Réglage « Autoriser les captures d'écran », depuis l'application. */
class ScreenModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName() = "ResiliosScreen"

  @ReactMethod
  fun isCaptureAllowed(promise: Promise) {
    promise.resolve(ScreenCapture.isAllowed(context))
  }

  @ReactMethod
  fun setCaptureAllowed(allowed: Boolean, promise: Promise) {
    ScreenCapture.setAllowed(context, allowed)
    val activity = context.currentActivity
    if (activity == null) {
      promise.resolve(allowed)
      return
    }
    activity.runOnUiThread {
      ScreenCapture.apply(activity)
      promise.resolve(allowed)
    }
  }
}
