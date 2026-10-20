package com.resilios.files

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.CancellationSignal
import android.os.ParcelFileDescriptor
import android.print.PageRange
import android.print.PrintAttributes
import android.print.PrintDocumentAdapter
import android.print.PrintManager
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.UiThreadUtil
import kotlin.concurrent.thread

/**
 * Enregistrer ou ouvrir un fichier choisi par l'utilisateur (carte SD, clé
 * USB, dossier Téléchargements…) avec le sélecteur du système : aucune
 * permission de stockage n'est nécessaire. Sert aux sauvegardes chiffrées
 * et à l'export du stock. Imprime aussi une page HTML (imprimante ou PDF)
 * avec le service d'impression du système.
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

  /** Page en cours d'impression : gardée tant que le système la lit. */
  private var printView: WebView? = null

  /**
   * Ouvre l'impression du système sur `html` (sans JavaScript ni réseau) ;
   * résout quand l'impression est terminée ou annulée.
   */
  @ReactMethod
  fun printHtml(jobName: String, html: String, promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Application au second plan")
      return
    }
    UiThreadUtil.runOnUiThread {
      try {
        val view = WebView(activity)
        view.settings.javaScriptEnabled = false
        view.settings.blockNetworkLoads = true
        view.settings.allowFileAccess = false
        var started = false
        view.webViewClient =
            object : WebViewClient() {
              override fun shouldOverrideUrlLoading(
                  v: WebView,
                  request: WebResourceRequest
              ) = true

              override fun onPageFinished(v: WebView, url: String?) {
                if (started) {
                  return
                }
                started = true
                try {
                  print(activity, v, jobName, promise)
                } catch (e: Exception) {
                  printView = null
                  promise.reject("PRINT_FAILED", e.message ?: "Impression impossible", e)
                }
              }
            }
        printView = view
        view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null)
      } catch (e: Exception) {
        printView = null
        promise.reject("PRINT_FAILED", e.message ?: "Impression impossible", e)
      }
    }
  }

  private fun print(activity: Activity, view: WebView, jobName: String, promise: Promise) {
    val manager = activity.getSystemService(Context.PRINT_SERVICE) as PrintManager
    val inner = view.createPrintDocumentAdapter(jobName)
    val adapter =
        object : PrintDocumentAdapter() {
          override fun onStart() = inner.onStart()

          override fun onLayout(
              oldAttributes: PrintAttributes?,
              newAttributes: PrintAttributes,
              cancellationSignal: CancellationSignal?,
              callback: LayoutResultCallback,
              extras: Bundle?
          ) = inner.onLayout(oldAttributes, newAttributes, cancellationSignal, callback, extras)

          override fun onWrite(
              pages: Array<out PageRange>,
              destination: ParcelFileDescriptor,
              cancellationSignal: CancellationSignal?,
              callback: WriteResultCallback
          ) = inner.onWrite(pages, destination, cancellationSignal, callback)

          override fun onFinish() {
            inner.onFinish()
            printView = null
            promise.resolve(null)
          }
        }
    manager.print(
        jobName,
        adapter,
        PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4).build())
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
