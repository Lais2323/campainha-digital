package com.campainhadigital.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

public class DoorbellService extends Service {

    public static final String CHANNEL_ID = "CampainhaForegroundChannel";
    public static final String CALLS_CHANNEL_ID = "CampainhaCallsChannel";
    private PowerManager.WakeLock wakeLock;

    @Override
    public void onCreate() {
        super.onCreate();
        createNotificationChannels();
        try {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            if (pm != null) {
                wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "CampainhaDigital:ForegroundWakeLock");
                wakeLock.acquire();
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Intent notificationIntent = new Intent(this, MainActivity.class);
        notificationIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pendingIntent = PendingIntent.getActivity(
                this, 0, notificationIntent,
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ? PendingIntent.FLAG_IMMUTABLE : 0
        );

        Notification notification = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle("Campainha Digital Ativa em Segundo Plano")
                .setContentText("Pronta para receber chamadas do portão 24h...")
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentIntent(pendingIntent)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(1, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(1, notification);
        }
        return START_STICKY;
    }

    private void createNotificationChannels() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            if (manager != null) {
                // Canal de monitoramento em segundo plano
                NotificationChannel serviceChannel = new NotificationChannel(
                        CHANNEL_ID,
                        "Monitoramento em Segundo Plano",
                        NotificationManager.IMPORTANCE_LOW
                );
                manager.createNotificationChannel(serviceChannel);

                // Canal de alta prioridade para CHAMADAS DA CAMPAINHA
                NotificationChannel callChannel = new NotificationChannel(
                        CALLS_CHANNEL_ID,
                        "Chamadas da Campainha do Portão",
                        NotificationManager.IMPORTANCE_HIGH
                );
                callChannel.setDescription("Alertas urgentes quando alguém toca a campainha");
                callChannel.enableVibration(true);
                callChannel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
                callChannel.setBypassDnd(true);
                manager.createNotificationChannel(callChannel);
            }
        }
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        super.onTaskRemoved(rootIntent);
        // Reinicia o serviço se o app for limpo da lista de recentes
        try {
            Intent restartService = new Intent(getApplicationContext(), DoorbellService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartService);
            } else {
                startService(restartService);
            }
        } catch (Exception ignored) {}
    }

    @Override
    public void onDestroy() {
        super.onDestroy();
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
        try {
            Intent restartService = new Intent(getApplicationContext(), DoorbellService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(restartService);
            } else {
                startService(restartService);
            }
        } catch (Exception e) {}
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
