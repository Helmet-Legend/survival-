package com.resilios.torch

import android.content.Context
import android.hardware.camera2.CameraCharacteristics
import android.hardware.camera2.CameraManager
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.ReadableArray

/**
 * Lampe du flash en signal SOS. Le motif (allumé, éteint, allumé…) est joué
 * sur un fil à part pour garder un rythme régulier, et répété jusqu'à
 * `stop()`. Aucune permission : le mode lampe n'ouvre pas l'appareil photo.
 */
class TorchModule(context: ReactApplicationContext) : ReactContextBaseJavaModule(context) {

  private val cameras = context.getSystemService(Context.CAMERA_SERVICE) as CameraManager

  /** Flash arrière, sinon n'importe quel flash ; null : aucune lampe. */
  private val torchId: String? by lazy {
    runCatching {
          val ids = cameras.cameraIdList.filter {
            cameras.getCameraCharacteristics(it).get(CameraCharacteristics.FLASH_INFO_AVAILABLE) ==
                true
          }
          ids.firstOrNull {
            cameras.getCameraCharacteristics(it).get(CameraCharacteristics.LENS_FACING) ==
                CameraCharacteristics.LENS_FACING_BACK
          } ?: ids.firstOrNull()
        }
        .getOrNull()
  }

  /**
   * Change à chaque démarrage ou arrêt : un ancien fil le voit et s'arrête.
   * Lu et modifié sous `lock` avec chaque allumage, pour qu'un arrêt ne
   * puisse jamais être suivi d'un dernier allumage du fil arrêté.
   */
  private var generation = 0
  private val lock = Any()

  override fun getName() = "ResiliosTorch"

  override fun getConstants(): Map<String, Any> = mapOf("available" to (torchId != null))

  @ReactMethod
  fun blink(pattern: ReadableArray, promise: Promise) {
    val id = torchId
    if (id == null) {
      promise.reject("NO_TORCH", "Pas de lampe sur ce téléphone")
      return
    }
    val durations =
        (0 until pattern.size()).map { pattern.getDouble(it).toLong().coerceIn(10, 10_000) }
    if (durations.isEmpty()) {
      promise.reject("PATTERN", "Motif vide")
      return
    }
    val mine: Int
    try {
      synchronized(lock) {
        generation++
        mine = generation
        cameras.setTorchMode(id, false)
      }
    } catch (e: Exception) {
      promise.reject("BUSY", "Lampe indisponible : l’appareil photo est peut-être utilisé.")
      return
    }
    Thread {
          try {
            var index = 0
            while (true) {
              synchronized(lock) {
                if (generation != mine) {
                  return@Thread
                }
                cameras.setTorchMode(id, index % 2 == 0)
              }
              Thread.sleep(durations[index])
              index = (index + 1) % durations.size
            }
          } catch (_: Exception) {
            // Appareil photo pris par une autre application : le signal s'arrête.
          } finally {
            synchronized(lock) {
              if (generation == mine) {
                generation++
                runCatching { cameras.setTorchMode(id, false) }
              }
            }
          }
        }
        .apply { name = "fenrir-sos" }
        .start()
    promise.resolve(null)
  }

  @ReactMethod
  fun stop(promise: Promise) {
    turnOff()
    promise.resolve(null)
  }

  private fun turnOff() {
    val id = torchId ?: return
    synchronized(lock) {
      generation++
      runCatching { cameras.setTorchMode(id, false) }
    }
  }

  override fun invalidate() {
    turnOff()
    super.invalidate()
  }
}
