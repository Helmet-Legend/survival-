package com.resilios.reminders

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/** Affiche un rappel à l'heure prévue, ou reprogramme après redémarrage. */
class ReminderReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> Reminders.restore(context)
      ACTION -> Reminders.notify(context)
    }
  }

  companion object {
    const val ACTION = "com.resilios.reminders.REMIND"
  }
}
