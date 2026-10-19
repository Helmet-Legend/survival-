package com.resilios.location

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Handler
import android.os.Looper
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Position à la demande (écrans Urgence et Position), sans services
 * Google : GPS et localisation réseau du téléphone, la première mesure
 * gagne ; à défaut, la dernière position connue. Rien n'est enregistré ni
 * suivi en arrière-plan ; une seule mesure par appui.
 */
class LocationModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName() = "ResiliosLocation"

  @SuppressLint("MissingPermission") // vérifiée au début
  @ReactMethod
  fun getPosition(timeoutMs: Double, promise: Promise) {
    val granted =
        ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(
                context, Manifest.permission.ACCESS_COARSE_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
    if (!granted) {
      promise.reject("PERMISSION", "Localisation refusée")
      return
    }
    val manager = context.getSystemService(LocationManager::class.java)
    val providers =
        listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER).filter {
          runCatching { manager.isProviderEnabled(it) }.getOrDefault(false)
        }
    if (providers.isEmpty()) {
      promise.reject("DISABLED", "Localisation désactivée dans les réglages du téléphone")
      return
    }
    val last =
        providers
            .mapNotNull { runCatching { manager.getLastKnownLocation(it) }.getOrNull() }
            .maxByOrNull { it.time }
    val done = AtomicBoolean(false)
    val main = Handler(Looper.getMainLooper())
    lateinit var listener: LocationListener

    fun finish(location: Location?) {
      if (!done.compareAndSet(false, true)) {
        return
      }
      runCatching { manager.removeUpdates(listener) }
      val fix = location ?: last
      if (fix == null) {
        promise.reject("TIMEOUT", "Aucune position : essayez à l’extérieur, ciel dégagé")
        return
      }
      val result = Arguments.createMap()
      result.putDouble("latitude", fix.latitude)
      result.putDouble("longitude", fix.longitude)
      result.putDouble("accuracy", if (fix.hasAccuracy()) fix.accuracy.toDouble() else -1.0)
      result.putDouble("time", fix.time.toDouble())
      result.putBoolean("stale", location == null)
      promise.resolve(result)
    }

    listener = LocationListener { finish(it) }
    main.post {
      // Tous les fournisseurs actifs à la fois, la première mesure gagne :
      // le réseau (Wi-Fi, antennes) répond en quelques secondes là où le GPS
      // seul peut ne rien capter à l'intérieur.
      var requested = 0
      for (provider in providers) {
        try {
          @Suppress("DEPRECATION")
          manager.requestLocationUpdates(provider, 0L, 0f, listener, Looper.getMainLooper())
          requested++
        } catch (e: Exception) {
          // Fournisseur refusé (ex. GPS avec la seule position approximative).
        }
      }
      if (requested == 0) {
        finish(null)
      }
    }
    main.postDelayed({ finish(null) }, timeoutMs.toLong().coerceIn(5_000L, 120_000L))
  }
}
