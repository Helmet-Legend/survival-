package com.resilios.scanner

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.Typeface
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.SystemClock
import android.util.Size
import android.util.TypedValue
import android.view.Gravity
import android.view.HapticFeedbackConstants
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.LinearLayout
import android.widget.TextView
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.google.zxing.BarcodeFormat
import com.google.zxing.BinaryBitmap
import com.google.zxing.DecodeHintType
import com.google.zxing.MultiFormatReader
import com.google.zxing.PlanarYUVLuminanceSource
import com.google.zxing.ReaderException
import com.google.zxing.Result
import com.google.zxing.common.HybridBinarizer
import zxingcpp.BarcodeReader as CppReader
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * Écran de lecture : aperçu de la caméra arrière et décodage EAN/UPC par
 * ZXing, image par image, sans rien enregistrer ni envoyer. En mode série,
 * chaque passage d'un code devant la caméra est compté ; un code qui reste
 * dans le cadre n'est compté qu'une fois.
 */
class ScanActivity : AppCompatActivity() {

  private lateinit var previewView: PreviewView
  private lateinit var status: TextView
  private val executor: ExecutorService = Executors.newSingleThreadExecutor()
  private val codes = ArrayList<String>()
  private val formats = ArrayList<String>()
  private var series = false
  private var lastCode: String? = null
  private var lastSeen = 0L
  private var tone: ToneGenerator? = null
  @Volatile private var finished = false

  /** QR code d'association d'un autre téléphone (partage du foyer). */
  private val qrOnly by lazy { intent.getBooleanExtra(EXTRA_QR, false) }

  private val reader by lazy {
      MultiFormatReader().apply {
        setHints(
            mapOf(
                DecodeHintType.POSSIBLE_FORMATS to
                    if (qrOnly) listOf(BarcodeFormat.QR_CODE)
                    else
                        listOf(
                            BarcodeFormat.EAN_13,
                            BarcodeFormat.EAN_8,
                            BarcodeFormat.UPC_A,
                            BarcodeFormat.UPC_E,
                            // Boîtes de médicaments : code, lot et péremption (GS1).
                            BarcodeFormat.DATA_MATRIX,
                            // Étiquettes des boîtes de rangement Fenrir.
                            BarcodeFormat.QR_CODE),
                DecodeHintType.TRY_HARDER to true,
                DecodeHintType.ALSO_INVERTED to true))
      }
  }

  /**
   * Lecteur principal (zxing-cpp) : bien plus fiable sur les petits Data
   * Matrix des boîtes de médicaments, même avec du texte imprimé à côté.
   * Le lecteur Java ci-dessus reste en secours si la bibliothèque native
   * ne se charge pas ou ne trouve rien.
   */
  private val cppReader: CppReader? by lazy {
      runCatching {
            CppReader().apply {
              options.formats =
                  if (qrOnly) setOf(CppReader.Format.QR_CODE)
                  else
                      setOf(
                          CppReader.Format.EAN_13,
                          CppReader.Format.EAN_8,
                          CppReader.Format.UPC_A,
                          CppReader.Format.UPC_E,
                          CppReader.Format.DATA_MATRIX,
                          CppReader.Format.QR_CODE)
              options.tryHarder = true
              options.tryRotate = true
              options.tryDownscale = true
              // Codes imprimés en blanc sur fond noir (fréquent sur les
              // médicaments) : désactivé par défaut dans zxing-cpp.
              options.tryInvert = true
              // Texte brut : les séparateurs GS1 (GS) restent dans le texte.
              options.textMode = CppReader.TextMode.PLAIN
            }
          }
          .getOrNull()
  }

  private val permission =
      registerForActivityResult(ActivityResultContracts.RequestPermission()) { granted ->
        if (granted) {
          startCamera()
        } else {
          fail("Accès à la caméra refusé : autorisez-le dans les réglages du téléphone.")
        }
      }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    series = intent.getBooleanExtra(EXTRA_SERIES, false)
    setContentView(buildLayout())
    tone = runCatching { ToneGenerator(AudioManager.STREAM_NOTIFICATION, 60) }.getOrNull()
    onBackPressedDispatcher.addCallback(
        this,
        object : OnBackPressedCallback(true) {
          override fun handleOnBackPressed() {
            // En série, le retour garde les lectures déjà faites.
            if (codes.isEmpty()) cancel() else finishWithCodes()
          }
        })
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
        PackageManager.PERMISSION_GRANTED) {
      startCamera()
    } else {
      permission.launch(Manifest.permission.CAMERA)
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    finished = true
    executor.shutdown()
    tone?.release()
    tone = null
  }

  private fun dp(value: Int): Int =
      TypedValue.applyDimension(
              TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics)
          .toInt()

  private fun buildLayout(): View {
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    previewView =
        PreviewView(this).apply {
          scaleType = PreviewView.ScaleType.FILL_CENTER
          implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        }
    root.addView(
        previewView,
        FrameLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT))

    // Ligne de visée au centre de l'écran.
    val aim = View(this).apply { setBackgroundColor(Color.parseColor("#FF9D1C")) }
    root.addView(
        aim,
        FrameLayout.LayoutParams(
                (resources.displayMetrics.widthPixels * 0.8).toInt(), dp(2))
            .apply { gravity = Gravity.CENTER })

    val panel =
        LinearLayout(this).apply {
          orientation = LinearLayout.VERTICAL
          setBackgroundColor(Color.parseColor("#CC0B0F14"))
          setPadding(dp(16), dp(16), dp(16), dp(16))
        }
    status =
        TextView(this).apply {
          setTextColor(Color.WHITE)
          setTextSize(TypedValue.COMPLEX_UNIT_SP, 16f)
          typeface = Typeface.DEFAULT_BOLD
          text =
              if (qrOnly) "Visez le QR code affiché sur l’autre téléphone."
              else if (series) "Visez les codes-barres ou les carrés Data Matrix l’un après l’autre."
              else "Visez le code-barres ou le carré Data Matrix."
        }
    panel.addView(status)
    val buttons =
        LinearLayout(this).apply {
          orientation = LinearLayout.HORIZONTAL
          setPadding(0, dp(12), 0, 0)
        }
    val cancelButton =
        Button(this).apply {
          text = "Annuler"
          setOnClickListener { cancel() }
        }
    buttons.addView(
        cancelButton,
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
    if (series) {
      val done =
          Button(this).apply {
            text = "Terminer"
            setOnClickListener { finishWithCodes() }
          }
      buttons.addView(
          done,
          LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f).apply {
            marginStart = dp(12)
          })
    }
    panel.addView(buttons)
    root.addView(
        panel,
        FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            .apply { gravity = Gravity.BOTTOM })
    ViewCompat.setOnApplyWindowInsetsListener(panel) { view, insets ->
      val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
      view.setPadding(dp(16), dp(16), dp(16), dp(16) + bars.bottom)
      insets
    }
    return root
  }

  private fun startCamera() {
    val future = ProcessCameraProvider.getInstance(this)
    future.addListener(
        {
          try {
            val provider = future.get()
            val preview =
                Preview.Builder().build().also {
                  it.setSurfaceProvider(previewView.surfaceProvider)
                }
            val analysis =
                ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(
                                ResolutionStrategy(
                                    // Assez de pixels pour un Data Matrix d'1 cm.
                                    Size(1920, 1080),
                                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                            .build())
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .build()
            analysis.setAnalyzer(executor) { image -> analyze(image) }
            provider.unbindAll()
            provider.bindToLifecycle(
                this, CameraSelector.DEFAULT_BACK_CAMERA, preview, analysis)
          } catch (e: Exception) {
            fail("Caméra indisponible : ${e.message ?: "erreur inconnue"}")
          }
        },
        ContextCompat.getMainExecutor(this))
  }

  private fun analyze(image: ImageProxy) {
    try {
      if (finished) {
        return
      }
      val found =
          runCatching { cppReader?.read(image) }
              .getOrNull()
              ?.firstOrNull { accepted(it.text ?: "", it.format.name) }
      val cppCode = found?.text
      if (found != null && !cppCode.isNullOrEmpty()) {
        val format = found.format.name
        runOnUiThread { onRead(cppCode, format) }
        return
      }
      // Plan de luminance (Y) seul, sans le pas de ligne du capteur.
      val plane = image.planes[0]
      val width = image.width
      val height = image.height
      val stride = plane.rowStride
      val buffer = plane.buffer
      val data = ByteArray(width * height)
      for (row in 0 until height) {
        buffer.position(row * stride)
        buffer.get(data, row * width, width)
      }
      // Le capteur est souvent tourné par rapport à l'écran : essayer les
      // deux orientations pour lire un code tenu à l'horizontale ou debout.
      val result = decode(data, width, height) ?: decode(rotate(data, width, height), height, width)
      if (result != null) {
        val code = result.text
        val format = result.barcodeFormat.name
        runOnUiThread { onRead(code, format) }
      }
    } catch (e: Exception) {
      // Image illisible : la suivante sera essayée.
    } finally {
      image.close()
    }
  }

  private fun decode(data: ByteArray, width: Int, height: Int): Result? {
    val source = PlanarYUVLuminanceSource(data, width, height, 0, 0, width, height, false)
    return try {
      reader.decodeWithState(BinaryBitmap(HybridBinarizer(source)))
    } catch (e: ReaderException) {
      null
    } finally {
      reader.reset()
    }
  }

  /** Rotation de 90° dans le sens horaire. */
  private fun rotate(data: ByteArray, width: Int, height: Int): ByteArray {
    val out = ByteArray(data.size)
    for (y in 0 until height) {
      for (x in 0 until width) {
        out[x * height + (height - 1 - y)] = data[y * width + x]
      }
    }
    return out
  }

  /**
   * Lecture d'articles : seuls les QR codes des étiquettes de boîtes
   * comptent ; ceux des emballages (publicité, sites) sont ignorés.
   */
  private fun accepted(code: String, format: String): Boolean =
      qrOnly || format != "QR_CODE" || code.startsWith(BOX_QR_PREFIX)

  private fun onRead(code: String, format: String) {
    if (finished) {
      return
    }
    if (!accepted(code, format)) {
      return
    }
    val now = SystemClock.elapsedRealtime()
    // Même code encore dans le cadre : ne pas le compter deux fois.
    if (code == lastCode && now - lastSeen < REPEAT_GAP_MS) {
      lastSeen = now
      return
    }
    lastCode = code
    lastSeen = now
    codes.add(code)
    formats.add(format)
    previewView.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY)
    tone?.startTone(ToneGenerator.TONE_PROP_BEEP, 120)
    if (!series) {
      finishWithCodes()
      return
    }
    val n = codes.size
    status.text = "$n lecture${if (n > 1) "s" else ""} · dernier code : $code"
  }

  private fun finishWithCodes() {
    finished = true
    setResult(
        RESULT_OK,
        Intent()
            .putStringArrayListExtra(RESULT_CODES, codes)
            .putStringArrayListExtra(RESULT_FORMATS, formats))
    finish()
  }

  private fun cancel() {
    finished = true
    setResult(RESULT_CANCELED)
    finish()
  }

  private fun fail(message: String) {
    finished = true
    setResult(RESULT_CANCELED, Intent().putExtra(RESULT_ERROR, message))
    finish()
  }

  companion object {
    const val EXTRA_SERIES = "series"
    const val EXTRA_QR = "qr"
    const val RESULT_CODES = "codes"
    const val RESULT_FORMATS = "formats"
    const val RESULT_ERROR = "error"
    /** Début du texte des étiquettes de boîtes (voir boxRepository.ts). */
    private const val BOX_QR_PREFIX = "fenrir:boite:"
    /** Absence minimale d'un code avant de le compter à nouveau. */
    private const val REPEAT_GAP_MS = 1500L
  }
}
