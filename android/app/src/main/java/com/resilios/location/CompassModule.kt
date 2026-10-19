package com.resilios.location

import android.content.Context
import android.hardware.GeomagneticField
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Build
import android.view.Surface
import android.view.WindowManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

/**
 * Boussole du téléphone (capteur de rotation), seulement pendant qu'un écran
 * la regarde : cap magnétique envoyé en événements « ResiliosHeading »
 * environ 8 fois par seconde. La déclinaison vient du modèle magnétique
 * mondial embarqué dans Android (sans réseau).
 */
class CompassModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context), SensorEventListener {

  private val sensors = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
  private val rotation: Sensor? =
      sensors.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)
          ?: sensors.getDefaultSensor(Sensor.TYPE_GEOMAGNETIC_ROTATION_VECTOR)
  private var running = false
  private var lastSent = 0L
  private val matrix = FloatArray(9)
  private val remapped = FloatArray(9)
  private val angles = FloatArray(3)

  override fun getName() = "ResiliosCompass"

  override fun getConstants(): Map<String, Any> = mapOf("available" to (rotation != null))

  @ReactMethod
  fun start() {
    val sensor = rotation ?: return
    if (!running) {
      running = sensors.registerListener(this, sensor, SensorManager.SENSOR_DELAY_UI)
    }
  }

  @ReactMethod
  fun stop() {
    if (running) {
      sensors.unregisterListener(this)
      running = false
    }
  }

  /** Déclinaison magnétique (degrés, positive à l'est) en ce lieu, aujourd'hui. */
  @ReactMethod
  fun declination(latitude: Double, longitude: Double, promise: Promise) {
    val field =
        GeomagneticField(
            latitude.toFloat(), longitude.toFloat(), 0f, System.currentTimeMillis())
    promise.resolve(field.declination.toDouble())
  }

  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

  override fun invalidate() {
    stop()
    super.invalidate()
  }

  @Suppress("DEPRECATION")
  private fun displayRotation(): Int {
    val activity = context.currentActivity
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && activity != null) {
      activity.display?.rotation ?: Surface.ROTATION_0
    } else {
      (context.getSystemService(Context.WINDOW_SERVICE) as WindowManager).defaultDisplay.rotation
    }
  }

  override fun onSensorChanged(event: SensorEvent) {
    val now = System.currentTimeMillis()
    if (now - lastSent < 120) {
      return
    }
    lastSent = now
    SensorManager.getRotationMatrixFromVector(matrix, event.values)
    // Le cap suit le haut de l'écran, quelle que soit l'orientation.
    val (axisX, axisY) =
        when (displayRotation()) {
          Surface.ROTATION_90 -> SensorManager.AXIS_Y to SensorManager.AXIS_MINUS_X
          Surface.ROTATION_180 -> SensorManager.AXIS_MINUS_X to SensorManager.AXIS_MINUS_Y
          Surface.ROTATION_270 -> SensorManager.AXIS_MINUS_Y to SensorManager.AXIS_X
          else -> SensorManager.AXIS_X to SensorManager.AXIS_Y
        }
    SensorManager.remapCoordinateSystem(matrix, axisX, axisY, remapped)
    SensorManager.getOrientation(remapped, angles)
    val heading = (Math.toDegrees(angles[0].toDouble()) + 360.0) % 360.0
    val payload = Arguments.createMap()
    payload.putDouble("heading", heading)
    payload.putInt("accuracy", event.accuracy)
    context.emitDeviceEvent("ResiliosHeading", payload)
  }

  override fun onAccuracyChanged(sensor: Sensor, accuracy: Int) {}
}
