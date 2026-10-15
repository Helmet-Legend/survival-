package com.resilios.photo

import android.app.Activity
import android.content.ActivityNotFoundException
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.media.ExifInterface
import android.net.Uri
import android.provider.MediaStore
import android.util.Base64
import androidx.core.content.FileProvider
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
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
 */
class PhotoModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private var pending: Promise? = null
  private var cameraFile: File? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = "ResiliosPhoto"

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

  override fun onNewIntent(intent: Intent) {}

  private fun start(promise: Promise): Activity? {
    if (pending != null) {
      promise.reject("BUSY", "Une photo est déjà en cours")
      return null
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

  /** Réduit l'image (côté le plus long ≤ MAX_SIDE), la redresse et l'encode. */
  private fun encode(uri: Uri): String {
    val resolver = context.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    resolver.openInputStream(uri).use { BitmapFactory.decodeStream(it, null, bounds) }
    val longest = maxOf(bounds.outWidth, bounds.outHeight)
    if (longest <= 0) {
      throw IllegalArgumentException("Image illisible")
    }
    var sample = 1
    while (longest / (sample * 2) >= MAX_SIDE) {
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

    val scale = minOf(1f, MAX_SIDE.toFloat() / maxOf(decoded.width, decoded.height))
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
    private const val MAX_SIDE = 1600
    private const val JPEG_QUALITY = 82
  }
}
