package net.shareat.pos;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.os.Build;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Cashier birthday song. The web side plays the bundled MP3s; this plugin only holds
 * media audio focus while they play so other music apps on the tablet pause.
 */
@CapacitorPlugin(name = "BirthdaySong")
public class BirthdaySongPlugin extends Plugin {
    private AudioManager audioManager;
    private AudioFocusRequest focusRequest; // API 26+
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> { };

    @Override
    public void load() {
        audioManager = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
    }

    /** Takes media audio focus: apps that honour it (Spotify, YouTube, Chrome) pause. */
    @PluginMethod
    public void requestAudioFocus(PluginCall call) {
        int result;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                .setAudioAttributes(new AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_MEDIA)
                    .setContentType(AudioAttributes.CONTENT_TYPE_MUSIC)
                    .build())
                .setOnAudioFocusChangeListener(focusListener)
                .build();
            result = audioManager.requestAudioFocus(focusRequest);
        } else {
            result = audioManager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
        }
        JSObject ret = new JSObject();
        ret.put("granted", result == AudioManager.AUDIOFOCUS_REQUEST_GRANTED);
        call.resolve(ret);
    }

    @PluginMethod
    public void abandonAudioFocus(PluginCall call) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            if (focusRequest != null) audioManager.abandonAudioFocusRequest(focusRequest);
            focusRequest = null;
        } else {
            audioManager.abandonAudioFocus(focusListener);
        }
        call.resolve();
    }
}
