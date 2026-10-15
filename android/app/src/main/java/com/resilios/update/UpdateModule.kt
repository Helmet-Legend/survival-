package com.resilios.update

import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import androidx.core.content.pm.PackageInfoCompat
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Mise à jour de l'application : version installée, téléchargement de l'APK
 * publié sur GitHub et ouverture de l'installateur Android (qui demande une
 * confirmation à l'utilisateur et vérifie que la signature est la même).
 */
class UpdateModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  override fun getName() = "ResiliosUpdate"

  @ReactMethod
  fun getVersionCode(promise: Promise) {
    try {
      val info = context.packageManager.getPackageInfo(context.packageName, 0)
      promise.resolve(PackageInfoCompat.getLongVersionCode(info).toDouble())
    } catch (e: Exception) {
      promise.reject("VERSION_UNAVAILABLE", e)
    }
  }

  @ReactMethod
  fun downloadAndInstall(url: String, promise: Promise) {
    thread(name = "resilios-update") {
      try {
        val dir = File(context.cacheDir, "updates").apply { mkdirs() }
        dir.listFiles()?.forEach { it.delete() }
        val apk = File(dir, "update.apk")
        download(url, apk)

        val uri =
            FileProvider.getUriForFile(context, "${context.packageName}.updates", apk)
        val intent =
            Intent(Intent.ACTION_VIEW).apply {
              setDataAndType(uri, "application/vnd.android.package-archive")
              addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
              addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        context.startActivity(intent)
        promise.resolve(true)
      } catch (e: Exception) {
        promise.reject("UPDATE_FAILED", e.message ?: "Téléchargement impossible", e)
      }
    }
  }

  /** Vrai si Android autorise déjà cette app à installer des mises à jour. */
  @ReactMethod
  fun canInstall(promise: Promise) {
    promise.resolve(
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O ||
            context.packageManager.canRequestPackageInstalls())
  }

  /** Suit les redirections (GitHub renvoie vers son stockage de fichiers). */
  private fun download(source: String, target: File) {
    var url = URL(source)
    repeat(5) {
      val connection = url.openConnection() as HttpURLConnection
      connection.instanceFollowRedirects = false
      connection.connectTimeout = 15_000
      connection.readTimeout = 60_000
      connection.setRequestProperty("Accept", "application/octet-stream")
      val code = connection.responseCode
      if (code in 300..399) {
        url = URL(url, connection.getHeaderField("Location"))
        connection.disconnect()
        return@repeat
      }
      if (code != HttpURLConnection.HTTP_OK) {
        connection.disconnect()
        throw IllegalStateException("Réponse HTTP $code")
      }
      connection.inputStream.use { input ->
        target.outputStream().use { output -> input.copyTo(output) }
      }
      connection.disconnect()
      return
    }
    throw IllegalStateException("Trop de redirections")
  }
}
