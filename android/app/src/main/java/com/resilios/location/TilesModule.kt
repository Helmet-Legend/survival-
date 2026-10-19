package com.resilios.location

import android.util.Base64
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

/**
 * Téléchargement d'une tuile de carte (Plan IGN), seulement quand
 * l'utilisateur demande une zone : l'image est rendue en URI `data:` pour
 * être gardée dans le coffre. Quatre requêtes au plus en même temps.
 */
class TilesModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private val executor = Executors.newFixedThreadPool(4)

  override fun getName() = "ResiliosTiles"

  @ReactMethod
  fun fetchTile(url: String, promise: Promise) {
    executor.execute {
      var connection: HttpURLConnection? = null
      try {
        if (!url.startsWith("https://data.geopf.fr/")) {
          promise.reject("URL", "Adresse non autorisée")
          return@execute
        }
        connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = 15_000
        connection.readTimeout = 20_000
        connection.setRequestProperty("User-Agent", "Fenrir/1.0 (Android; cartes hors ligne)")
        connection.setRequestProperty("Accept", "image/png,image/jpeg,image/*")
        val code = connection.responseCode
        if (code != 200) {
          promise.reject("HTTP", "HTTP $code")
          return@execute
        }
        val type = (connection.contentType ?: "").substringBefore(';').trim()
        if (!type.startsWith("image/")) {
          promise.reject("TYPE", "Réponse inattendue ($type)")
          return@execute
        }
        val bytes = connection.inputStream.use { it.readBytes() }
        if (bytes.isEmpty()) {
          promise.reject("EMPTY", "Tuile vide")
          return@execute
        }
        promise.resolve("data:$type;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
      } catch (e: Exception) {
        promise.reject("NETWORK", e.javaClass.simpleName + (e.message?.let { " : $it" } ?: ""))
      } finally {
        connection?.disconnect()
      }
    }
  }

  override fun invalidate() {
    executor.shutdownNow()
    super.invalidate()
  }
}
