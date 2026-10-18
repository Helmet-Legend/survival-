package com.resilios.reminders

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/** Programmation des rappels depuis l'application (horaires seulement). */
class ReminderModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName() = "ResiliosReminders"

  @ReactMethod
  fun schedule(times: ReadableArray, promise: Promise) {
    val list = (0 until times.size()).map { times.getDouble(it).toLong() }
    promise.resolve(Reminders.schedule(context, list))
  }

  @ReactMethod
  fun cancelAll(promise: Promise) {
    Reminders.cancelAll(context)
    promise.resolve(null)
  }
}
