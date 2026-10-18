package com.resilios.files

import android.app.Activity
import android.content.Intent
import android.net.Uri
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import kotlin.concurrent.thread

/**
 * Enregistrer ou ouvrir un fichier choisi par l'utilisateur (carte SD, clé
 * USB, dossier Téléchargements…) avec le sélecteur du système : aucune
 * permission de stockage n'est nécessaire. Sert aux sauvegardes chiffrées
 * et à l'export du stock.
 */
class FilesModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private var pending: Promise? = null
  private var content: String? = null

  init {
    context.addActivityEventListener(this)
  }

  override fun getName() = "ResiliosFiles"

  /** Propose d'enregistrer `text` ; résout true si le fichier est écrit. */
  @ReactMethod
  fun saveText(fileName: String, mime: String, text: String, promise: Promise) {
    val activity = start(promise) ?: return
    content = text
    try {
      val intent =
          Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = mime
            putExtra(Intent.EXTRA_TITLE, fileName)
          }
      activity.startActivityForResult(intent, REQUEST_SAVE)
    } catch (e: Exception) {
      fail("SAVE_FAILED", e.message ?: "Enregistrement impossible")
    }
  }

  /** Propose d'ouvrir un fichier ; résout son texte, ou null si annulé. */
  @ReactMethod
  fun openText(promise: Promise) {
    val activity = start(promise) ?: return
    try {
      val intent =
          Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE)
            type = "*/*"
          }
      activity.startActivityForResult(intent, REQUEST_OPEN)
    } catch (e: Exception) {
      fail("OPEN_FAILED", e.message ?: "Ouverture impossible")
    }
  }

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?
  ) {
    if (requestCode != REQUEST_SAVE && requestCode != REQUEST_OPEN) {
      return
    }
    val promise = pending ?: return
    pending = null
    val text = content
    content = null
    val uri: Uri? = data?.data
    if (resultCode != Activity.RESULT_OK || uri == null) {
      promise.resolve(if (requestCode == REQUEST_SAVE) false else null)
      return
    }
    thread(name = "resilios-files") {
      try {
        val resolver = context.contentResolver
        if (requestCode == REQUEST_SAVE) {
          resolver.openOutputStream(uri, "wt").use { out ->
            requireNotNull(out) { "Fichier inaccessible" }
            out.write((text ?: "").toByteArray(Charsets.UTF_8))
          }
          promise.resolve(true)
        } else {
          val read =
              resolver.openInputStream(uri).use { input ->
                requireNotNull(input) { "Fichier inaccessible" }
                input.readBytes()
              }
          if (read.size > MAX_BYTES) {
            promise.reject("TOO_LARGE", "Fichier trop volumineux")
          } else {
            promise.resolve(String(read, Charsets.UTF_8))
          }
        }
      } catch (e: Exception) {
        promise.reject("IO_FAILED", e.message ?: "Lecture ou écriture impossible", e)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {}

  private fun start(promise: Promise): Activity? {
    if (pending != null) {
      promise.reject("BUSY", "Une opération sur un fichier est déjà en cours")
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
    content = null
    pending?.reject(code, message)
    pending = null
  }

  companion object {
    private const val REQUEST_SAVE = 7301
    private const val REQUEST_OPEN = 7302
    /** Au-delà, la sauvegarde ne tiendrait pas en mémoire sur un vieux téléphone. */
    private const val MAX_BYTES = 200L * 1024 * 1024
  }
}
