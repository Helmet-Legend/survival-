package com.resilios.photo

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import android.provider.OpenableColumns
import android.util.Base64
import com.facebook.react.bridge.ActivityEventListener
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableNativeArray
import com.facebook.react.bridge.WritableNativeMap
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.util.UUID
import java.util.concurrent.Executors

/**
 * PDF ouvert le temps d'un import ou d'une lecture : une « session » par
 * fichier, désignée par un jeton.
 *
 * - `openPdf` : PDF choisi dans les fichiers du téléphone, copié dans le
 *   dossier privé de l'application le temps de la session ;
 * - `beginPdf` / `appendPdf` / `loadPdf` : PDF reconstitué depuis le coffre
 *   (morceaux base64), pour le lire ;
 * - `renderPdfPages` : quelques pages en JPEG base64, à la demande, pour ne
 *   jamais charger tout un livre en mémoire ;
 * - `readPdf` : morceau des octets du fichier, pour le ranger dans le coffre ;
 * - `closePdf` : ferme et efface la copie.
 *
 * Les copies vivent dans le cache privé de l'application (illisible des
 * autres applications) et sont effacées à la fermeture, et au démarrage
 * s'il en reste.
 */
class PdfModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), ActivityEventListener {

  private class Session(val file: File) {
    var descriptor: ParcelFileDescriptor? = null
    var renderer: PdfRenderer? = null

    fun close() {
      try {
        renderer?.close()
      } catch (_: Exception) {}
      try {
        descriptor?.close()
      } catch (_: Exception) {}
      renderer = null
      descriptor = null
      file.delete()
    }
  }

  private val sessions = HashMap<String, Session>()
  /** Un seul fil : le moteur PDF d'Android n'accepte pas d'appels croisés. */
  private val worker = Executors.newSingleThreadExecutor()
  private var pending: Promise? = null

  private val dir: File
    get() = File(context.cacheDir, "pdf").apply { mkdirs() }

  init {
    context.addActivityEventListener(this)
    worker.execute { dir.listFiles()?.forEach { it.delete() } }
  }

  override fun getName() = "ResiliosPdf"

  /** PDF choisi : { token, name, pageCount, bytes }, ou null si annulé. */
  @ReactMethod
  fun openPdf(promise: Promise) {
    val activity = context.currentActivity
    if (activity == null) {
      promise.reject("NO_ACTIVITY", "Application au second plan")
      return
    }
    // Une demande restée sans réponse bloquerait les suivantes.
    pending?.let { runCatching { it.reject("CANCELLED", "Choix précédent abandonné") } }
    pending = promise
    try {
      val intent =
          Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            type = "application/pdf"
            addCategory(Intent.CATEGORY_OPENABLE)
          }
      activity.startActivityForResult(intent, REQUEST_OPEN)
    } catch (e: Exception) {
      pending = null
      promise.reject("PICK_FAILED", e.message ?: "Sélection de fichier impossible")
    }
  }

  override fun onActivityResult(
      activity: Activity,
      requestCode: Int,
      resultCode: Int,
      data: Intent?
  ) {
    if (requestCode != REQUEST_OPEN) {
      return
    }
    val promise = pending ?: return
    pending = null
    val uri = if (resultCode == Activity.RESULT_OK) data?.data else null
    if (uri == null) {
      promise.resolve(null)
      return
    }
    worker.execute {
      val session = Session(File(dir, "${UUID.randomUUID()}.pdf"))
      try {
        val name = copyFrom(uri, session.file)
        val token = start(session)
        promise.resolve(
            WritableNativeMap().apply {
              putString("token", token)
              putString("name", name)
              putInt("pageCount", session.renderer!!.pageCount)
              putDouble("bytes", session.file.length().toDouble())
            })
      } catch (e: SecurityException) {
        session.close()
        promise.reject("PDF_PROTECTED", PDF_PROTECTED, e)
      } catch (e: Exception) {
        session.close()
        promise.reject("PDF_FAILED", e.message ?: "PDF illisible", e)
      }
    }
  }

  override fun onNewIntent(intent: Intent) {}

  private fun copyFrom(uri: Uri, target: File): String {
    val resolver = context.contentResolver
    val name =
        resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
          if (it.moveToFirst()) it.getString(0) else null
        } ?: "document.pdf"
    val input = resolver.openInputStream(uri) ?: throw IllegalArgumentException("PDF illisible")
    input.use { source -> FileOutputStream(target).use { source.copyTo(it) } }
    return name
  }

  /** Ouvre le moteur PDF sur la copie (SecurityException si protégé). */
  private fun openRenderer(session: Session) {
    val descriptor = ParcelFileDescriptor.open(session.file, ParcelFileDescriptor.MODE_READ_ONLY)
    session.descriptor = descriptor
    session.renderer = PdfRenderer(descriptor)
  }

  /** Ouvre le moteur PDF sur la copie et enregistre la session. */
  private fun start(session: Session): String {
    openRenderer(session)
    val token = UUID.randomUUID().toString()
    sessions[token] = session
    return token
  }

  /** Session vide, à remplir avec `appendPdf` puis ouvrir avec `loadPdf`. */
  @ReactMethod
  fun beginPdf(promise: Promise) {
    worker.execute {
      try {
        val session = Session(File(dir, "${UUID.randomUUID()}.pdf"))
        session.file.createNewFile()
        val token = UUID.randomUUID().toString()
        sessions[token] = session
        promise.resolve(token)
      } catch (e: Exception) {
        promise.reject("PDF_FAILED", e.message ?: "Stockage impossible", e)
      }
    }
  }

  @ReactMethod
  fun appendPdf(token: String, base64: String, promise: Promise) {
    worker.execute {
      val session = sessions[token]
      if (session == null || session.renderer != null) {
        promise.reject("PDF_CLOSED", "Document fermé")
        return@execute
      }
      try {
        FileOutputStream(session.file, true).use {
          it.write(Base64.decode(base64, Base64.DEFAULT))
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("PDF_FAILED", e.message ?: "Écriture impossible", e)
      }
    }
  }

  /** Ouvre la session remplie : { pageCount }. */
  @ReactMethod
  fun loadPdf(token: String, promise: Promise) {
    worker.execute {
      val session = sessions[token]
      if (session == null) {
        promise.reject("PDF_CLOSED", "Document fermé")
        return@execute
      }
      try {
        if (session.renderer == null) {
          openRenderer(session)
        }
        promise.resolve(
            WritableNativeMap().apply { putInt("pageCount", session.renderer!!.pageCount) })
      } catch (e: SecurityException) {
        sessions.remove(token)
        session.close()
        promise.reject("PDF_PROTECTED", PDF_PROTECTED, e)
      } catch (e: Exception) {
        sessions.remove(token)
        session.close()
        promise.reject("PDF_FAILED", e.message ?: "PDF illisible", e)
      }
    }
  }

  /** Pages `from` à `from + count - 1`, en JPEG base64 (côté ≤ maxSide). */
  @ReactMethod
  fun renderPdfPages(token: String, from: Double, count: Double, maxSide: Double, promise: Promise) {
    worker.execute {
      val renderer = sessions[token]?.renderer
      if (renderer == null) {
        promise.reject("PDF_CLOSED", "Document fermé")
        return@execute
      }
      try {
        val first = from.toInt().coerceAtLeast(0)
        val last = minOf(renderer.pageCount, first + count.toInt().coerceIn(1, 20))
        val side = maxSide.toInt().coerceIn(400, 3000)
        val pages = WritableNativeArray()
        for (index in first until last) {
          pages.pushString(render(renderer, index, side))
        }
        promise.resolve(pages)
      } catch (e: Exception) {
        promise.reject("PDF_FAILED", e.message ?: "Page illisible", e)
      }
    }
  }

  private fun render(renderer: PdfRenderer, index: Int, maxSide: Int): String {
    val page = renderer.openPage(index)
    try {
      val scale = maxSide.toFloat() / maxOf(page.width, page.height, 1)
      val width = maxOf(1, (page.width * scale).toInt())
      val height = maxOf(1, (page.height * scale).toInt())
      val bitmap = Bitmap.createBitmap(width, height, Bitmap.Config.ARGB_8888)
      bitmap.eraseColor(Color.WHITE)
      page.render(bitmap, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      val out = ByteArrayOutputStream()
      bitmap.compress(Bitmap.CompressFormat.JPEG, JPEG_QUALITY, out)
      bitmap.recycle()
      return Base64.encodeToString(out.toByteArray(), Base64.NO_WRAP)
    } finally {
      page.close()
    }
  }

  /** Octets `offset` à `offset + length - 1` du fichier, en base64. */
  @ReactMethod
  fun readPdf(token: String, offset: Double, length: Double, promise: Promise) {
    worker.execute {
      val session = sessions[token]
      if (session == null) {
        promise.reject("PDF_CLOSED", "Document fermé")
        return@execute
      }
      try {
        RandomAccessFile(session.file, "r").use { file ->
          val start = offset.toLong().coerceAtLeast(0)
          val size = minOf(length.toLong().coerceIn(1, MAX_CHUNK), file.length() - start)
          if (size <= 0) {
            promise.resolve("")
            return@use
          }
          val bytes = ByteArray(size.toInt())
          file.seek(start)
          file.readFully(bytes)
          promise.resolve(Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
      } catch (e: Exception) {
        promise.reject("PDF_FAILED", e.message ?: "Lecture impossible", e)
      }
    }
  }

  @ReactMethod
  fun closePdf(token: String, promise: Promise) {
    worker.execute {
      sessions.remove(token)?.close()
      promise.resolve(null)
    }
  }

  companion object {
    private const val REQUEST_OPEN = 0x524A
    private const val JPEG_QUALITY = 82
    private const val MAX_CHUNK = 4L * 1024 * 1024
    private const val PDF_PROTECTED =
        "Ce PDF est protégé par un mot de passe : Fenrir ne peut pas l’ouvrir."
  }
}
