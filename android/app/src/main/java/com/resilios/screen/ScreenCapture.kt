package com.resilios.screen

import android.app.Activity
import android.content.Context
import android.view.WindowManager

/**
 * Protection contre les captures d'écran (FLAG_SECURE). Active par défaut ;
 * l'utilisateur peut l'enlever dans les Réglages. Le choix est conservé
 * hors du coffre pour s'appliquer dès l'écran de code.
 */
object ScreenCapture {
  private const val PREFS = "fenrir_screen"
  private const val KEY_ALLOWED = "capture_allowed"

  fun isAllowed(context: Context): Boolean =
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getBoolean(KEY_ALLOWED, false)

  fun setAllowed(context: Context, allowed: Boolean) {
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putBoolean(KEY_ALLOWED, allowed)
        .apply()
  }

  /** À appeler sur le fil principal. */
  fun apply(activity: Activity) {
    if (isAllowed(activity)) {
      activity.window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE)
    } else {
      activity.window.setFlags(
          WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE)
    }
  }
}
