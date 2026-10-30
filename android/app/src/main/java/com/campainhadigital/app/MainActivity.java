package com.campainhadigital.app;

import android.Manifest;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.IntentFilter;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.Ringtone;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.DownloadListener;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.annotation.NonNull;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;

import java.io.File;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends AppCompatActivity {

    private static final int PERMISSION_REQ_CODE = 1001;
    private static final int FILE_CHOOSER_REQ_CODE = 2001;

    private WebView webView;
    private Ringtone currentRingtone;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private AudioManager audioManager;
    private ValueCallback<Uri[]> fileUploadCallback;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Manter tela ligada se necessário para chamadas
        getWindow().addFlags(
                android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON |
                android.view.WindowManager.LayoutParams.FLAG_DISMISS_KEYGUARD |
                android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED |
                android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON
        );

        webView = new WebView(this);
        setContentView(webView);

        vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
        audioManager = (AudioManager) getSystemService(Context.AUDIO_SERVICE);

        setupWebView();
        checkAndRequestPermissions();
        requestIgnoreBatteryOptimizations();

        try {
            Intent serviceIntent = new Intent(this, DoorbellService.class);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                startForegroundService(serviceIntent);
            } else {
                startService(serviceIntent);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        // Carrega a interface do morador local nos assets
        webView.loadUrl("file:///android_asset/index.html");
    }

    private void setupWebView() {
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);

        webView.setWebViewClient(new WebViewClient());

        webView.setDownloadListener(new DownloadListener() {
            @Override
            public void onDownloadStart(String url, String userAgent, String contentDisposition, String mimetype, long contentLength) {
                try {
                    Intent i = new Intent(Intent.ACTION_VIEW);
                    i.setData(Uri.parse(url));
                    startActivity(i);
                } catch (Exception e) {
                    e.printStackTrace();
                }
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                // Concede automaticamente permissões WebRTC (Câmera e Microfone)
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        request.grant(request.getResources());
                    }
                });
            }

            // Suporte para selecionar foto de perfil da galeria
            @Override
            public boolean onShowFileChooser(WebView webView, ValueCallback<Uri[]> filePathCallback, FileChooserParams fileChooserParams) {
                if (fileUploadCallback != null) {
                    fileUploadCallback.onReceiveValue(null);
                }
                fileUploadCallback = filePathCallback;

                Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                intent.setType("image/*");
                startActivityForResult(Intent.createChooser(intent, "Selecionar Foto de Perfil"), FILE_CHOOSER_REQ_CODE);
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, final android.webkit.JsResult result) {
                new androidx.appcompat.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("Campainha Digital")
                        .setMessage(message)
                        .setPositiveButton("OK", (dialog, which) -> result.confirm())
                        .setCancelable(false)
                        .create()
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, final android.webkit.JsResult result) {
                new androidx.appcompat.app.AlertDialog.Builder(MainActivity.this)
                        .setTitle("Campainha Digital")
                        .setMessage(message)
                        .setPositiveButton("Sim", (dialog, which) -> result.confirm())
                        .setNegativeButton("Não", (dialog, which) -> result.cancel())
                        .setCancelable(false)
                        .create()
                        .show();
                return true;
            }
        });

        webView.addJavascriptInterface(new WebAppInterface(), "AndroidBridge");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == FILE_CHOOSER_REQ_CODE) {
            if (fileUploadCallback != null) {
                Uri[] results = null;
                if (resultCode == RESULT_OK && data != null) {
                    Uri uri = data.getData();
                    if (uri != null) {
                        results = new Uri[]{uri};
                    }
                }
                fileUploadCallback.onReceiveValue(results);
                fileUploadCallback = null;
            }
        }
    }

    private void checkAndRequestPermissions() {
        List<String> neededPermissions = new ArrayList<>();

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.RECORD_AUDIO);
        }
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
            neededPermissions.add(Manifest.permission.CAMERA);
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                neededPermissions.add(Manifest.permission.POST_NOTIFICATIONS);
            }
        }

        if (!neededPermissions.isEmpty()) {
            ActivityCompat.requestPermissions(this, neededPermissions.toArray(new String[0]), PERMISSION_REQ_CODE);
        }
    }

    private void requestIgnoreBatteryOptimizations() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            try {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null && !pm.isIgnoringBatteryOptimizations(getPackageName())) {
                    Intent intent = new Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + getPackageName()));
                    startActivity(intent);
                }
            } catch (Exception e) {}
        }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, @NonNull String[] permissions, @NonNull int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == PERMISSION_REQ_CODE) {
            webView.reload();
        }
    }

    // Interface JS exposta para o aplicativo
    public class WebAppInterface {

        @JavascriptInterface
        public void setSpeakerphoneOn(final boolean on) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (audioManager != null) {
                            if (on) {
                                audioManager.setMode(AudioManager.MODE_IN_COMMUNICATION);
                                audioManager.setSpeakerphoneOn(true);
                            } else {
                                audioManager.setSpeakerphoneOn(false);
                            }
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void resetAudioMode() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (audioManager != null) {
                            audioManager.setSpeakerphoneOn(false);
                            audioManager.setMode(AudioManager.MODE_NORMAL);
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void playDoorbellRingtone() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        stopDoorbellRingtone();

                        Uri notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
                        if (notificationUri == null) {
                            notificationUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);
                        }
                        currentRingtone = RingtoneManager.getRingtone(MainActivity.this, notificationUri);
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                            AudioAttributes attributes = new AudioAttributes.Builder()
                                    .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                                    .build();
                            currentRingtone.setAudioAttributes(attributes);
                        }
                        currentRingtone.play();

                        if (vibrator != null && vibrator.hasVibrator()) {
                            long[] pattern = {0, 1000, 800, 1000, 800, 1000};
                            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                                vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                            } else {
                                vibrator.vibrate(pattern, 0);
                            }
                        }

                        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                        if (pm != null && (wakeLock == null || !wakeLock.isHeld())) {
                            wakeLock = pm.newWakeLock(PowerManager.SCREEN_BRIGHT_WAKE_LOCK | PowerManager.ACQUIRE_CAUSES_WAKEUP, "Campainha:WakeLock");
                            wakeLock.acquire(30000);
                        }

                        Intent bringToFront = new Intent(MainActivity.this, MainActivity.class);
                        bringToFront.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_REORDER_TO_FRONT | Intent.FLAG_ACTIVITY_SINGLE_TOP);
                        startActivity(bringToFront);

                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopDoorbellRingtone() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        if (currentRingtone != null && currentRingtone.isPlaying()) {
                            currentRingtone.stop();
                            currentRingtone = null;
                        }
                        if (vibrator != null) {
                            vibrator.cancel();
                        }
                        if (wakeLock != null && wakeLock.isHeld()) {
                            wakeLock.release();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void openExternalUrl(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                        startActivity(intent);
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void installApkUpdate(final String url) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        Toast.makeText(MainActivity.this, "Iniciando download da atualização...", Toast.LENGTH_SHORT).show();

                        File downloadDir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
                        if (downloadDir != null && !downloadDir.exists()) {
                            downloadDir.mkdirs();
                        }
                        final File apkFile = new File(downloadDir, "CampainhaDigital_update.apk");
                        if (apkFile.exists()) {
                            apkFile.delete();
                        }

                        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
                        request.setTitle("Campainha Digital");
                        request.setDescription("Baixando atualização do aplicativo...");
                        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
                        request.setDestinationUri(Uri.fromFile(apkFile));
                        request.setMimeType("application/vnd.android.package-archive");

                        final DownloadManager downloadManager = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
                        if (downloadManager == null) {
                            openExternalUrl(url);
                            return;
                        }

                        final long downloadId = downloadManager.enqueue(request);

                        BroadcastReceiver onComplete = new BroadcastReceiver() {
                            @Override
                            public void onReceive(Context context, Intent intent) {
                                long id = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                                if (id == downloadId) {
                                    try {
                                        unregisterReceiver(this);
                                    } catch (Exception ignored) {}

                                    promptInstallApk(apkFile);
                                }
                            }
                        };

                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
                        } else {
                            registerReceiver(onComplete, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE));
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                        openExternalUrl(url);
                    }
                }
            });
        }

        @JavascriptInterface
        public void shareDoorbellInvite(final String message) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent sendIntent = new Intent();
                    sendIntent.setAction(Intent.ACTION_SEND);
                    sendIntent.putExtra(Intent.EXTRA_TEXT, message);
                    sendIntent.setType("text/plain");
                    Intent shareIntent = Intent.createChooser(sendIntent, "Compartilhar Campainha");
                    startActivity(shareIntent);
                }
            });
        }

        @JavascriptInterface
        public void printQrSign() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    PrintManager printManager = (PrintManager) getSystemService(Context.PRINT_SERVICE);
                    if (printManager != null) {
                        PrintDocumentAdapter printAdapter = webView.createPrintDocumentAdapter("Placa_Campainha_Digital");
                        printManager.print("Placa_Campainha_Digital", printAdapter, new PrintAttributes.Builder().build());
                    }
                }
            });
        }

        @JavascriptInterface
        public void copyToClipboard(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    try {
                        ClipboardManager clipboard = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                        ClipData clip = ClipData.newPlainText("Código", text);
                        if (clipboard != null) {
                            clipboard.setPrimaryClip(clip);
                            Toast.makeText(MainActivity.this, "Código copiado: " + text, Toast.LENGTH_SHORT).show();
                        }
                    } catch (Exception e) {
                        e.printStackTrace();
                    }
                }
            });
        }

        @JavascriptInterface
        public void showToast(final String msg) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(MainActivity.this, msg, Toast.LENGTH_SHORT).show();
                }
            });
        }

        @JavascriptInterface
        public int getAppVersionCode() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionCode;
            } catch (Exception e) {
                return 4;
            }
        }

        @JavascriptInterface
        public String getAppVersionName() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "2.2";
            }
        }

        @JavascriptInterface
        public void saveSession(final String residentJson) {
            try {
                getSharedPreferences("doorbell_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .putString("saved_resident", residentJson)
                    .apply();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public String getSavedSession() {
            try {
                return getSharedPreferences("doorbell_prefs", Context.MODE_PRIVATE)
                    .getString("saved_resident", "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void clearSession() {
            try {
                getSharedPreferences("doorbell_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .remove("saved_resident")
                    .apply();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public void saveServerConfig(final String configJson) {
            try {
                getSharedPreferences("doorbell_prefs", Context.MODE_PRIVATE)
                    .edit()
                    .putString("saved_config", configJson)
                    .apply();
            } catch (Exception e) {
                e.printStackTrace();
            }
        }

        @JavascriptInterface
        public String getSavedServerConfig() {
            try {
                return getSharedPreferences("doorbell_prefs", Context.MODE_PRIVATE)
                    .getString("saved_config", "");
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public void saveRecordedCall(final String base64Data, final String filename, final boolean isVideo) {
            new Thread(new Runnable() {
                @Override
                public void run() {
                    try {
                        String pureBase64 = base64Data;
                        if (pureBase64.contains(",")) {
                            pureBase64 = pureBase64.substring(pureBase64.indexOf(",") + 1);
                        }
                        byte[] fileBytes = android.util.Base64.decode(pureBase64, android.util.Base64.DEFAULT);

                        File downloadsDir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
                        File targetDir = new File(downloadsDir, "CampainhaDigital");
                        if (!targetDir.exists()) {
                            targetDir.mkdirs();
                        }
                        File destFile = new File(targetDir, filename);
                        java.io.FileOutputStream fos = new java.io.FileOutputStream(destFile);
                        fos.write(fileBytes);
                        fos.flush();
                        fos.close();

                        android.media.MediaScannerConnection.scanFile(
                                MainActivity.this,
                                new String[]{destFile.getAbsolutePath()},
                                new String[]{isVideo ? "video/mp4" : "audio/webm"},
                                null
                        );

                        runOnUiThread(new Runnable() {
                            @Override
                            public void run() {
                                Toast.makeText(MainActivity.this,
                                        (isVideo ? "📹 Gravação de vídeo salva: " : "🎙️ Gravação de áudio salva: ") +
                                                "Downloads/CampainhaDigital/" + filename,
                                        Toast.LENGTH_LONG).show();
                            }
                        });
                    } catch (final Exception e) {
                        e.printStackTrace();
                    }
                }
            }).start();
        }
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (audioManager != null) {
            audioManager.setSpeakerphoneOn(false);
            audioManager.setMode(AudioManager.MODE_NORMAL);
        }
        if (currentRingtone != null && currentRingtone.isPlaying()) {
            currentRingtone.stop();
        }
        if (vibrator != null) {
            vibrator.cancel();
        }
        if (wakeLock != null && wakeLock.isHeld()) {
            wakeLock.release();
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null) {
            webView.evaluateJavascript("(function() { return (window.handleBackPress && window.handleBackPress()) ? 'true' : 'false'; })();", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String value) {
                    if ("\"true\"".equals(value) || "true".equals(value)) {
                        return; // O evento de voltar foi tratado pela tela ou modal aberta
                    }
                    if (webView.canGoBack()) {
                        webView.goBack();
                    } else {
                        // Minimiza o aplicativo para segundo plano sem matá-lo, mantendo a escuta das chamadas!
                        moveTaskToBack(true);
                    }
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    private void promptInstallApk(File apkFile) {
        try {
            if (!apkFile.exists()) {
                Toast.makeText(this, "Arquivo da atualização não encontrado.", Toast.LENGTH_SHORT).show();
                return;
            }

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                if (!getPackageManager().canRequestPackageInstalls()) {
                    Toast.makeText(this, "Permita a instalação desta fonte nas configurações para concluir a atualização.", Toast.LENGTH_LONG).show();
                    Intent settingsIntent = new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES);
                    settingsIntent.setData(Uri.parse("package:" + getPackageName()));
                    settingsIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    startActivity(settingsIntent);
                    return;
                }
            }

            Uri apkUri = FileProvider.getUriForFile(
                    this,
                    getPackageName() + ".fileprovider",
                    apkFile
            );

            Intent installIntent = new Intent(Intent.ACTION_VIEW);
            installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
            installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(installIntent);
        } catch (Exception e) {
            e.printStackTrace();
            Toast.makeText(this, "Erro ao abrir instalador: " + e.getMessage(), Toast.LENGTH_LONG).show();
        }
    }
}
