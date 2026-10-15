package com.guillermorc.nuvora.sync

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import com.google.firebase.auth.FirebaseAuth
import com.guillermorc.nuvora.R
import com.guillermorc.nuvora.ui.AppActivity
import kotlinx.coroutines.CoroutineExceptionHandler
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Mantiene la sincronización encendida aunque cierres la app, con un aviso fijo
 * y discreto (Android lo exige para trabajar en segundo plano).
 */
class SincronizacionService : Service() {
    private val alcance = CoroutineScope(SupervisorJob() + Dispatchers.IO + CoroutineExceptionHandler { _, _ -> })
    private var multicast: WifiManager.MulticastLock? = null

    companion object {
        private const val CANAL = "sincronizacion"
        private const val AVISO = 1

        fun arrancar(context: Context) {
            if (FirebaseAuth.getInstance().currentUser == null) return
            runCatching {
                val i = Intent(context, SincronizacionService::class.java)
                if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(i) else context.startService(i)
            }
        }

        fun parar(context: Context) {
            context.stopService(Intent(context, SincronizacionService::class.java))
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(NotificationChannel(CANAL, "Sincronización", NotificationManager.IMPORTANCE_MIN).apply {
            description = "Aviso fijo mientras Nuvora sincroniza con tus otros dispositivos"
            setShowBadge(false)
        })
        val abrir = PendingIntent.getActivity(
            this, 0, Intent(this, AppActivity::class.java), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val aviso = Notification.Builder(this, CANAL)
            .setSmallIcon(R.drawable.ic_sync)
            .setContentTitle("Nuvora")
            .setContentText("Sincronizando con tus dispositivos")
            .setContentIntent(abrir)
            .setOngoing(true)
            .build()
        if (Build.VERSION.SDK_INT >= 29) startForeground(AVISO, aviso, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
        else startForeground(AVISO, aviso)

        // Para encontrar a tus dispositivos en la misma wifi
        multicast = getSystemService(WifiManager::class.java)?.createMulticastLock("Nuvora")?.apply {
            setReferenceCounted(false)
            runCatching { acquire() }
        }
        alcance.launch { Sincronizador.ejecutar(applicationContext) }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int = START_STICKY

    override fun onDestroy() {
        alcance.cancel()
        runCatching { multicast?.release() }
        super.onDestroy()
    }
}

/** Al encender el móvil o actualizar la app, vuelve a sincronizar. */
class ArranqueReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences("ajustes", Context.MODE_PRIVATE)
        if (prefs.getBoolean("segundoPlano", true)) SincronizacionService.arrancar(context)
    }
}
