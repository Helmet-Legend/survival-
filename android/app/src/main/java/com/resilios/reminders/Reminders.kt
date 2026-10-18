package com.resilios.reminders

import android.Manifest
import android.annotation.SuppressLint
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import com.resilios.R

/**
 * Rappels de péremption : de simples horaires confiés à AlarmManager.
 *
 * Le coffre est chiffré et fermé quand l'application ne tourne pas : rien
 * n'est lu ici. Seuls les horaires sont gardés (pour les reprogrammer après
 * un redémarrage), et la notification reste neutre, sans nom d'article.
 */
object Reminders {
  private const val PREFS = "fenrir_reminders"
  private const val KEY_TIMES = "times"
  private const val CHANNEL_ID = "reminders"
  private const val NOTIFICATION_ID = 4210
  /** Plafond aligné sur `REMINDER_MAX` côté application. */
  const val MAX = 30

  /** Remplace les rappels prévus ; renvoie le nombre programmé. */
  fun schedule(context: Context, times: List<Long>): Int {
    cancelAll(context)
    val now = System.currentTimeMillis()
    val future = times.filter { it > now }.distinct().sorted().take(MAX)
    future.forEachIndexed { index, time -> setAlarm(context, index, time) }
    context
        .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        .edit()
        .putString(KEY_TIMES, future.joinToString(","))
        .apply()
    return future.size
  }

  fun cancelAll(context: Context) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    for (index in 0 until MAX) {
      alarms.cancel(pendingIntent(context, index))
    }
    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply()
  }

  /** Après un redémarrage, les alarmes du système sont perdues. */
  fun restore(context: Context) {
    val stored =
        context
            .getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(KEY_TIMES, "")
            .orEmpty()
    val times = stored.split(",").mapNotNull { it.toLongOrNull() }
    schedule(context, times)
  }

  @SuppressLint("MissingPermission") // vérifiée juste avant l'envoi
  fun notify(context: Context) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
            PackageManager.PERMISSION_GRANTED) {
      return // Notifications refusées : rien à afficher.
    }
    val manager = context.getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
          NotificationChannel(CHANNEL_ID, "Rappels", NotificationManager.IMPORTANCE_DEFAULT)
              .apply { description = "Rappels de péremption, sans détail" })
    }
    val open =
        context.packageManager.getLaunchIntentForPackage(context.packageName)?.let {
          PendingIntent.getActivity(
              context,
              0,
              it,
              PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    val notification =
        NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_reminder)
            .setContentTitle("Fenrir")
            .setContentText("Un rappel vous attend.")
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setAutoCancel(true)
            .setContentIntent(open)
            .build()
    NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, notification)
  }

  private fun setAlarm(context: Context, index: Int, time: Long) {
    val alarms = context.getSystemService(AlarmManager::class.java)
    // Alarme inexacte : pas de permission spéciale, quelques minutes d'écart.
    alarms.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, time, pendingIntent(context, index))
  }

  private fun pendingIntent(context: Context, index: Int): PendingIntent =
      PendingIntent.getBroadcast(
          context,
          index,
          Intent(context, ReminderReceiver::class.java).setAction(ReminderReceiver.ACTION),
          PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
}
