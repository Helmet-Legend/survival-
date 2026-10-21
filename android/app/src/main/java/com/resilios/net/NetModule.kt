package com.resilios.net

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import android.net.wifi.WifiManager
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import java.io.BufferedInputStream
import java.io.BufferedOutputStream
import java.io.DataInputStream
import java.io.DataOutputStream
import java.net.Inet4Address
import java.net.InetSocketAddress
import java.net.NetworkInterface
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger
import kotlin.concurrent.thread

/**
 * Liaison directe entre deux téléphones du foyer sur le réseau local (même
 * Wi-Fi ou partage de connexion), sans internet ni serveur.
 *
 * - Connexion TCP : chaque message est précédé de sa longueur (4 octets).
 *   Le contenu est déjà chiffré par Fenrir (côté JavaScript) : ce module ne
 *   voit passer que la poignée de main publique et des messages chiffrés.
 * - Découverte (NSD / mDNS) : nom de service neutre, annoncé seulement
 *   pendant que l'écran de partage est ouvert.
 *
 * Évènements `ResiliosNet` : open, message, close, found.
 */
class NetModule(private val context: ReactApplicationContext) :
    ReactContextBaseJavaModule(context) {

  private val sockets = ConcurrentHashMap<Int, Socket>()
  private val outputs = ConcurrentHashMap<Int, DataOutputStream>()
  private val nextId = AtomicInteger(1)
  private var server: ServerSocket? = null

  private val nsd: NsdManager by lazy {
    context.getSystemService(Context.NSD_SERVICE) as NsdManager
  }
  private var registration: NsdManager.RegistrationListener? = null
  private var discovery: NsdManager.DiscoveryListener? = null
  private var multicastLock: WifiManager.MulticastLock? = null

  override fun getName() = "ResiliosNet"

  // Requis par NativeEventEmitter.
  @ReactMethod fun addListener(@Suppress("UNUSED_PARAMETER") eventName: String) {}

  @ReactMethod fun removeListeners(@Suppress("UNUSED_PARAMETER") count: Double) {}

  private fun emit(type: String, id: Int? = null, fill: (com.facebook.react.bridge.WritableMap) -> Unit = {}) {
    val map = Arguments.createMap()
    map.putString("type", type)
    if (id != null) map.putInt("id", id)
    fill(map)
    context.emitDeviceEvent(EVENT, map)
  }

  // --- Connexions -----------------------------------------------------------

  /** Attend les connexions ; résout le port choisi par le système. */
  @ReactMethod
  fun startServer(promise: Promise) {
    try {
      server?.close()
      val socket = ServerSocket(0)
      server = socket
      thread(name = "fenrir-accept", isDaemon = true) {
        while (!socket.isClosed) {
          try {
            track(socket.accept(), incoming = true)
          } catch (_: Exception) {
            break
          }
        }
      }
      promise.resolve(socket.localPort)
    } catch (e: Exception) {
      promise.reject("SERVER_FAILED", e.message ?: "Écoute impossible")
    }
  }

  @ReactMethod
  fun stopServer() {
    try {
      server?.close()
    } catch (_: Exception) {}
    server = null
  }

  /** Se connecte à l'autre téléphone ; résout l'identifiant de connexion. */
  @ReactMethod
  fun connect(host: String, port: Double, promise: Promise) {
    thread(name = "fenrir-connect", isDaemon = true) {
      try {
        val socket = Socket()
        socket.connect(InetSocketAddress(host, port.toInt()), CONNECT_TIMEOUT_MS)
        promise.resolve(track(socket, incoming = false))
      } catch (e: Exception) {
        promise.reject("CONNECT_FAILED", e.message ?: "Téléphone injoignable")
      }
    }
  }

  private fun track(socket: Socket, incoming: Boolean): Int {
    val id = nextId.getAndIncrement()
    socket.tcpNoDelay = true
    sockets[id] = socket
    outputs[id] = DataOutputStream(BufferedOutputStream(socket.getOutputStream()))
    emit("open", id) { it.putBoolean("incoming", incoming) }
    thread(name = "fenrir-read-$id", isDaemon = true) {
      var error: String? = null
      try {
        val input = DataInputStream(BufferedInputStream(socket.getInputStream()))
        while (true) {
          val length = input.readInt()
          if (length < 0 || length > MAX_FRAME) {
            error = "Message trop long"
            break
          }
          val bytes = ByteArray(length)
          input.readFully(bytes)
          val text = String(bytes, Charsets.UTF_8)
          emit("message", id) { it.putString("text", text) }
        }
      } catch (e: java.io.EOFException) {
        // Fermeture normale par l'autre téléphone.
      } catch (e: Exception) {
        if (sockets.containsKey(id)) error = e.message ?: "Connexion interrompue"
      }
      drop(id)
      emit("close", id) { map -> error?.let { map.putString("error", it) } }
    }
    return id
  }

  @ReactMethod
  fun send(id: Double, text: String, promise: Promise) {
    val key = id.toInt()
    val out = outputs[key]
    if (out == null) {
      promise.reject("CLOSED", "Connexion fermée")
      return
    }
    thread(name = "fenrir-write-$key", isDaemon = true) {
      try {
        val bytes = text.toByteArray(Charsets.UTF_8)
        synchronized(out) {
          out.writeInt(bytes.size)
          out.write(bytes)
          out.flush()
        }
        promise.resolve(null)
      } catch (e: Exception) {
        promise.reject("SEND_FAILED", e.message ?: "Envoi impossible")
      }
    }
  }

  @ReactMethod
  fun close(id: Double) {
    val key = id.toInt()
    val socket = sockets[key]
    drop(key)
    try {
      socket?.close()
    } catch (_: Exception) {}
  }

  private fun drop(id: Int) {
    sockets.remove(id)
    outputs.remove(id)
  }

  /** Adresses IPv4 de ce téléphone sur les réseaux locaux. */
  @ReactMethod
  fun localAddresses(promise: Promise) {
    try {
      val list = Arguments.createArray()
      for (nic in NetworkInterface.getNetworkInterfaces()) {
        if (!nic.isUp || nic.isLoopback) continue
        for (address in nic.inetAddresses) {
          if (address is Inet4Address && !address.isLoopbackAddress) {
            list.pushString(address.hostAddress)
          }
        }
      }
      promise.resolve(list)
    } catch (e: Exception) {
      promise.reject("ADDRESSES_FAILED", e.message ?: "Réseau introuvable")
    }
  }

  // --- Découverte -----------------------------------------------------------

  @ReactMethod
  fun advertise(name: String, port: Double, promise: Promise) {
    stopAdvertise()
    val info =
        NsdServiceInfo().apply {
          serviceName = name
          serviceType = SERVICE_TYPE
          setPort(port.toInt())
        }
    val listener =
        object : NsdManager.RegistrationListener {
          override fun onServiceRegistered(info: NsdServiceInfo) {
            promise.resolve(info.serviceName)
          }

          override fun onRegistrationFailed(info: NsdServiceInfo, code: Int) {
            registration = null
            promise.reject("ADVERTISE_FAILED", "Annonce impossible ($code)")
          }

          override fun onServiceUnregistered(info: NsdServiceInfo) {}

          override fun onUnregistrationFailed(info: NsdServiceInfo, code: Int) {}
        }
    registration = listener
    try {
      nsd.registerService(info, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: Exception) {
      registration = null
      promise.reject("ADVERTISE_FAILED", e.message ?: "Annonce impossible")
    }
  }

  @ReactMethod
  fun stopAdvertise() {
    registration?.let {
      try {
        nsd.unregisterService(it)
      } catch (_: Exception) {}
    }
    registration = null
  }

  /** Cherche les téléphones qui s'annoncent ; évènements `found`. */
  @ReactMethod
  fun discover(promise: Promise) {
    stopDiscovery()
    acquireMulticast()
    val resolving = java.util.concurrent.atomic.AtomicBoolean(false)
    val queue = java.util.concurrent.ConcurrentLinkedQueue<NsdServiceInfo>()
    lateinit var resolveNext: () -> Unit
    resolveNext = {
      val next = queue.poll()
      if (next == null) {
        resolving.set(false)
      } else {
        @Suppress("DEPRECATION")
        nsd.resolveService(
            next,
            object : NsdManager.ResolveListener {
              override fun onServiceResolved(info: NsdServiceInfo) {
                val host = info.host?.hostAddress
                if (host != null) {
                  emit("found") {
                    it.putString("name", info.serviceName)
                    it.putString("host", host)
                    it.putInt("port", info.port)
                  }
                }
                resolveNext()
              }

              override fun onResolveFailed(info: NsdServiceInfo, code: Int) {
                resolveNext()
              }
            },
        )
      }
    }
    val listener =
        object : NsdManager.DiscoveryListener {
          override fun onDiscoveryStarted(type: String) {
            promise.resolve(null)
          }

          override fun onStartDiscoveryFailed(type: String, code: Int) {
            discovery = null
            releaseMulticast()
            promise.reject("DISCOVER_FAILED", "Recherche impossible ($code)")
          }

          override fun onServiceFound(info: NsdServiceInfo) {
            queue.add(info)
            if (resolving.compareAndSet(false, true)) resolveNext()
          }

          override fun onServiceLost(info: NsdServiceInfo) {}

          override fun onDiscoveryStopped(type: String) {}

          override fun onStopDiscoveryFailed(type: String, code: Int) {}
        }
    discovery = listener
    try {
      nsd.discoverServices(SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, listener)
    } catch (e: Exception) {
      discovery = null
      releaseMulticast()
      promise.reject("DISCOVER_FAILED", e.message ?: "Recherche impossible")
    }
  }

  @ReactMethod
  fun stopDiscovery() {
    discovery?.let {
      try {
        nsd.stopServiceDiscovery(it)
      } catch (_: Exception) {}
    }
    discovery = null
    releaseMulticast()
  }

  private fun acquireMulticast() {
    try {
      val wifi = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
      multicastLock =
          wifi.createMulticastLock("fenrir-sync").apply {
            setReferenceCounted(false)
            acquire()
          }
    } catch (_: Exception) {}
  }

  private fun releaseMulticast() {
    try {
      multicastLock?.release()
    } catch (_: Exception) {}
    multicastLock = null
  }

  override fun invalidate() {
    stopDiscovery()
    stopAdvertise()
    stopServer()
    for (id in sockets.keys.toList()) close(id.toDouble())
    super.invalidate()
  }

  companion object {
    const val EVENT = "ResiliosNet"
    /** Type neutre : ne cite pas l'application sur le réseau. */
    const val SERVICE_TYPE = "_fnr._tcp."
    const val CONNECT_TIMEOUT_MS = 5000
    /** 64 Mio : un envoi complet avec photos tient dans un message. */
    const val MAX_FRAME = 64 * 1024 * 1024
  }
}
