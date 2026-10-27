package com.resilios.photo

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailabilityLight
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.concurrent.thread

/**
 * Photo d'une arme ou d'un document, prise avec l'appareil photo du
 * téléphone ou choisie dans ses images. L'image est réduite, renvoyée en
 * JPEG base64 pour être stockée dans la base chiffrée, et le fichier
 * temporaire de l'appareil photo est aussitôt effacé : aucune copie en
 * clair ne reste sur le téléphone.
 *
 * L'appareil photo du système est utilisé par intention : l'application
 * n'a pas besoin de la permission CAMERA.
 *
 * Scan de document : le scanner de Google Play (bords, redressement,
 * filtres, plusieurs pages), traité sur le téléphone. Absent sans les
 * services Google ; « Photographier » reste alors disponible.
 */
class PhotoModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private var pending: Promise? = null
  private var cameraFile: File? = null
  private val handler = Handler(Looper.getMainLooper())

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = "ResiliosPhoto"

  override fun getConstants(): Map<String, Any> =
      mapOf(
          "canScanDocuments" to
              (GoogleApiAvailabilityLight.getInstance().isGooglePlayServicesAvailable(context) ==
                  ConnectionResult.SUCCESS))

  /** Pages scannées (JPEG base64, une par page), ou null si annulé. */
  @ReactMethod
  fun scanDocument(maxPages: Double, promise: Promise) {
    val activity = start(promise) ?: return
    // Le scanner de Google Play se lance depuis le fil de l'interface ; une
    // erreur à son lancement est rendue à l'écran au lieu de laisser la
    // demande ouverte (ce qui bloquait ensuite les photos).
    activity.runOnUiThread {
      try {
        launchScanner(activity, promise, maxPages.toInt().coerceIn(1, 100))
      } catch (e: Throwable) {
        if (pending === promise) {
          fail("SCAN_FAILED", scanError(e))
        }
      }
    }
  }

  private fun launchScanner(activity: Activity, waiting: Promise, maxPages: Int) {
    val options =
        GmsDocumentScannerOptions.Builder()
            .setGalleryImportAllowed(false)
            .setPageLimit(maxPages)
            .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
            .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
            .build()
    // Premier usage : Google Play télécharge le scanner, ce qui peut ne jamais
    // aboutir hors connexion. Sans réponse, la demande est abandonnée.
    val timeout = Runnable {
      if (pending === waiting) {
        fail(
            "SCAN_UNAVAILABLE",
            "Scanner indisponible pour l’instant (il s’installe au premier usage, avec une connexion). Utilisez « Photographier ».")
      }
    }
    handler.postDelayed(timeout, SCAN_START_TIMEOUT_MS)
    GmsDocumentScanning.getClient(options)
        .getStartScanIntent(activity)
        .addOnSuccessListener { sender ->
          handler.removeCallbacks(timeout)
          if (pending !== waiting) {
            return@addOnSuccessListener
          }
          try {
            activity.startIntentSenderForResult(sender, REQUEST_SCAN, null, 0, 0, 0)
          } catch (e: Throwable) {
            fail("SCAN_FAILED", scanError(e))
          }
        }
        .addOnFailureListener { e ->
          handler.removeCallbacks(timeout)
          if (pending === waiting) {
            fail("SCAN_UNAVAILABLE", scanError(e))
          }
        }
  }

  /** Message lisible, avec le type d'erreur pour pouvoir la diagnostiquer. */
  private fun scanError(e: Throwable): String =
      "Scanner indisponible (${e.javaClass.simpleName}${e.message?.let { " : $it" } ?: ""}). Utilisez « Photographier »."

  @ReactMethod
  fun takePhoto(promise: Promise) {
    val activity = start(promise) ?: return
    try {
      val dir = File(context.cacheDir, "photos").apply { mkdirs() }
      dir.listFiles()?.forEach { it.delete() }
      val file = File(dir, "capture.jpg")
      cameraFile = file
      val uri = FileProvider.getUriForFile(context, "${context.packageName}.updates", file)
      val intent =
          Intent(MediaStore.ACTION_IMAGE_CAPTURE).apply {
            putExtra(MediaStore.EXTRA_OUTPUT, uri)
            addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
          }
      activity.startActivityForResult(intent, REQUEST_CAMERA)
    } catch (e: ActivityNotFoundException) {
      fail("NO_CAMERA", "Aucune application d’appareil photo")
    } catch (e: Exception) {
      fail("CAMERA_FAILED", e.message ?: "Appareil photo indisponible")
    }
  }

  @ReactMethod
  fun pickPhoto(promise: Promise) {
    val activity = start(promise) ?: return
    try {
      val intent =
          Intent(Intent.ACTION_GET_CONTENT).apply {
            type = "image/*"
            addCategory(Intent.CATEGORY_OPENABLE)
          }
      activity.startActivityForResult(intent, REQUEST_PICK)
    } catch (e: Exception) {
      fail("PICK_FAILED", e.message ?: "Sélection d’image impossible")
    }
  }

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?
  ) {
    if (requestCode == REQUEST_SCAN) {
      onScanResult(resultCode, data)
      return
    }
    if (requestCode != REQUEST_CAMERA && requestCode != REQUEST_PICK) {
      return
    }
    val promise = pending ?: return
    pending = null
    val file = cameraFile
    cameraFile = null
    if (resultCode != Activity.RESULT_OK) {
      file?.delete()
      promise.resolve(null)
      return
    }
    val source: Uri? = if (requestCode == REQUEST_CAMERA) file?.let { Uri.fromFile(it) } else data?.data
    if (source == null) {
      file?.delete()
      promise.resolve(null)
      return
    }
    thread(name = "resilios-photo") {
      try {
        promise.resolve(encode(source))
      } catch (e: Exception) {
        promise.reject("PHOTO_FAILED", e.message ?: "Image illisible", e)
      } finally {
        file?.delete()
      }
    }
  }

  private fun onScanResult(resultCode: Int, data: Intent?) {
    val promise = pending ?: return
    pending = null
    val pages =
        if (resultCode == Activity.RESULT_OK) {
          data
              ?.let { GmsDocumentScanningResult.fromActivityResultIntent(it) }
              ?.pages
              .orEmpty()
              .map { it.imageUri }
        } else {
          emptyList()
        }
    if (pages.isEmpty()) {
      promise.resolve(null)
      return
    }
    thread(name = "resilios-scan") {
      try {
        val out = WritableNativeArray()
        for (uri in pages) {
          out.pushString(encode(uri, SCAN_MAX_SIDE))
        }
        promise.resolve(out)
      } catch (e: Exception) {
        promise.reject("SCAN_FAILED", e.message ?: "Page illisible", e)
      } finally {
        // Les pages du scanner sont dans le cache de l'application : effacées.
        for (uri in pages) {
          if (uri.scheme == "file") {
            uri.path?.let { File(it).delete() }
          }
        }
      }
    }
  }

  override fun onNewIntent(intent: Intent) {}

  private fun start(promise: Promise): Activity? {
    // Une demande précédente restée sans réponse (scan interrompu, écran
    // quitté pendant la prise) bloquerait toutes les suivantes : un nouvel
    // appui de l'utilisateur l'abandonne.
    pending?.let {
      pending = null
      cameraFile?.delete()
      cameraFile = null
      runCatching { it.reject("CANCELLED", "Photo précédente abandonnée") }
    }
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Application au second plan")
      return null
    }
    pending = promise
    return activity
  }

  private fun fail(code: String, message: String) {
    cameraFile?.delete()
    cameraFile = null
    pending?.reject(code, message)
    pending = null
  }

  /** Réduit l'image (côté le plus long ≤ maxSide), la redresse et l'encode. */
  private fun encode(uri: Uri, maxSide: Int = MAX_SIDE): String {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) {
      throw IllegalArgumentException("Image illisible")
    }
    var sample = 1
    while (longest / (sample * 2) >= maxSide) {
      sample *= 2
    }
    val decoded =
        resolver.openInputStream(uri).use {
          BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: throw IllegalArgumentException("Image illisible")

    val rotation =
        resolver.openInputStream(uri)?.use {
          when (ExifInterface(it).getAttributeInt(
              ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
          }
        } ?: 0f

    val scale = minOf(1f, maxSide.toFloat() / maxOf(decoded.width, decoded.height))
    val matrix =
        Matrix().apply {
          postScale(scale, scale)
          postRotate(rotation)
        }
    val bitmap = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
    val out = ByteArrayOutputStream()
    bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
    if (bitmap !== decoded) {
      bitmap.recycle()
    }
    decoded.recycle()
    return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
  }

  companion object {
    private const val REQUEST_CAMERA = 0x5245
    private const val REQUEST_PICK = 0x5246
    private const val REQUEST_SCAN = 0x5247
    private const val SCAN_START_TIMEOUT_MS = 20_000L
    private const val MAX_SIDE = 1600
    /** Pages de documents : assez fines pour être réimprimées en A4. */
    private const val SCAN_MAX_SIDE = 2500
    private const val JPEG_QUALITY = 82
  }
}
