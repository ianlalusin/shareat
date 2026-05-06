package net.shareat.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Canvas;
import android.graphics.ColorMatrix;
import android.graphics.ColorMatrixColorFilter;
import android.graphics.Paint;
import android.os.Build;
import android.util.Base64;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.Charset;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN
            }
        ),
        @Permission(
            alias = "bluetooth_connect",
            strings = {
                "android.permission.BLUETOOTH_CONNECT",
                "android.permission.BLUETOOTH_SCAN"
            }
        )
    }
)
public class ThermalPrinterPlugin extends Plugin {
    private static final String TAG = "ThermalPrinter";
    private static final UUID SPP_UUID = UUID.fromString("00001101-0000-1000-8000-00805F9B34FB");

    private BluetoothAdapter bluetoothAdapter;
    private BluetoothSocket bluetoothSocket;
    private OutputStream outputStream;
    private String connectedAddress;
    private static final int MAX_RETRIES = 3;
    private static final int RETRY_DELAY_MS = 1500;
    // Delays before each connect attempt (ms). First attempt is immediate; subsequent
    // ones wait progressively longer for another app (e.g. GrabFood) to release the socket.
    private static final int[] CONNECT_RETRY_DELAYS_MS = {0, 1500, 3000, 5000};

    @Override
    public void load() {
        bluetoothAdapter = BluetoothAdapter.getDefaultAdapter();
    }

    private boolean checkBluetoothPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return getPermissionState("bluetooth_connect") == PermissionState.GRANTED;
        } else {
            return getPermissionState("bluetooth") == PermissionState.GRANTED;
        }
    }

    @PluginMethod
    public void listBluetoothPrinters(PluginCall call) {
        if (!checkBluetoothPermissions()) {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth_connect" : "bluetooth", call, "permissionCallback");
            return;
        }
        if (bluetoothAdapter == null) {
            call.reject("Bluetooth not supported on this device.");
            return;
        }
        Set<BluetoothDevice> pairedDevices = bluetoothAdapter.getBondedDevices();
        JSONArray devicesArray = new JSONArray();
        for (BluetoothDevice device : pairedDevices) {
            JSObject deviceObj = new JSObject();
            deviceObj.put("name", device.getName());
            deviceObj.put("address", device.getAddress());
            devicesArray.put(deviceObj);
        }
        JSObject ret = new JSObject();
        ret.put("devices", devicesArray);
        call.resolve(ret);
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        if (checkBluetoothPermissions()) {
            if ("listBluetoothPrinters".equals(call.getMethodName())) {
                listBluetoothPrinters(call);
            } else {
                call.resolve();
            }
        } else {
            call.reject("Bluetooth permissions are required for printing.");
        }
    }

    @PluginMethod
    public void connectBluetoothPrinter(PluginCall call) {
        if (!checkBluetoothPermissions()) {
            requestPermissionForAlias(Build.VERSION.SDK_INT >= Build.VERSION_CODES.S ? "bluetooth_connect" : "bluetooth", call, "permissionCallback");
            return;
        }
        String address = call.getString("address");
        if (address == null) {
            call.reject("Printer address is required.");
            return;
        }
        try {
            // Reuse existing connection if healthy
            if (bluetoothSocket != null && bluetoothSocket.isConnected() && address.equals(bluetoothSocket.getRemoteDevice().getAddress())) {
                // Verify socket is truly alive with a zero-byte write
                try {
                    outputStream.write(new byte[0]);
                    outputStream.flush();
                    call.resolve();
                    return;
                } catch (Exception ignored) {
                    // Socket is dead — fall through to reconnect
                    disconnect();
                }
            }
            disconnect();
            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }
            connectWithRetry(address);
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Connection failed", e);
            disconnect();
            call.reject("Connection failed: " + e.getMessage());
        }
    }

    @PluginMethod
    public void disconnectBluetoothPrinter(PluginCall call) {
        disconnect();
        call.resolve();
    }

    @PluginMethod
    public void printReceipt(PluginCall call) {
        String text = call.getString("text");
        String encoding = call.getString("encoding", "CP437");
        Boolean skipInit = call.getBoolean("skipInit", false);
        Boolean cut = call.getBoolean("cut", false);
        Boolean beep = call.getBoolean("beep", false);

        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }

        Exception lastError = null;
        for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                if (!skipInit) {
                    outputStream.write(new byte[]{0x1B, 0x40});
                }
                outputStream.write(new byte[]{0x1D, 0x21, 0x00});
                outputStream.write(new byte[]{0x1B, 0x61, 0x00});
                try {
                    outputStream.write(text.getBytes(encoding));
                } catch (Exception e) {
                    outputStream.write(text.getBytes(Charset.forName("UTF-8")));
                }
                outputStream.write(new byte[]{0x0A, 0x0A, 0x0A, 0x0A});
                if (cut) {
                    outputStream.write(new byte[]{0x1D, 0x56, 0x41, 0x03});
                }
                if (beep) {
                    outputStream.write(new byte[]{0x1B, 0x42, 0x02, 0x02});
                }
                outputStream.flush();
                call.resolve();
                return;
            } catch (IOException e) {
                lastError = e;
                Log.w(TAG, "printReceipt attempt " + (attempt + 1) + " failed: " + e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try {
                        Thread.sleep(RETRY_DELAY_MS);
                        reconnect();
                    } catch (Exception re) {
                        Log.e(TAG, "Reconnect failed", re);
                    }
                }
            } catch (Exception e) {
                call.reject("Print failed: " + e.getMessage());
                return;
            }
        }
        call.reject("Print failed after retries: " + (lastError != null ? lastError.getMessage() : "unknown"));
    }

    @PluginMethod
    public void printPinSlip(PluginCall call) {
        String topText    = call.getString("top", "");
        String bottomText = call.getString("bottom", "");
        String qrData     = call.getString("qrData", "https://customer.shareat.net");
        int    qrSize     = call.getInt("qrSize", 4);
        String encoding   = call.getString("encoding", "CP437");

        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }

        Exception lastError = null;
        for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Init + slow down print speed
            outputStream.write(new byte[]{0x1B, 0x40});
            outputStream.flush();
            Thread.sleep(300);

            // TOP TEXT — normal size, centered
            if (topText != null && !topText.isEmpty()) {
                outputStream.write(new byte[]{0x1B, 0x61, 0x01}); // center
                outputStream.write(new byte[]{0x1D, 0x21, 0x00}); // normal size
                try { outputStream.write(topText.getBytes(encoding)); }
                catch (Exception e) { outputStream.write(topText.getBytes("UTF-8")); }
                outputStream.write(new byte[]{0x0A});
            }
            outputStream.flush();
            Thread.sleep(400);

            // QR CODE
            byte[] qrBytes = qrData.getBytes("UTF-8");
            int storeLen = qrBytes.length + 3;
            byte pL = (byte)(storeLen & 0xFF);
            byte pH = (byte)((storeLen >> 8) & 0xFF);
            outputStream.write(new byte[]{0x1B, 0x61, 0x01}); // center
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00}); // model 2
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, (byte) qrSize}); // size
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31}); // ECC M
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30}); // store data
            outputStream.write(qrBytes);
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30}); // print
            outputStream.write(new byte[]{0x0A, 0x0A});
            outputStream.flush();
            Thread.sleep(500);

            // BOTTOM TEXT — PIN line gets double height/width, rest normal
            if (bottomText != null && !bottomText.isEmpty()) {
                outputStream.write(new byte[]{0x1B, 0x61, 0x01}); // center
                // Split bottom text to find PIN line (all caps, 6 chars)
                String[] bottomLines = bottomText.split("\n");
                for (String line : bottomLines) {
                    String trimmed = line.trim();
                    // Detect PIN line: 6 uppercase alphanumeric chars
                    boolean isPinLine = trimmed.matches("[A-Z0-9]{6}");
                    if (isPinLine) {
                        // Double width + double height for PIN
                        outputStream.write(new byte[]{0x1D, 0x21, 0x11});
                        outputStream.write(new byte[]{0x1B, 0x45, 0x01}); // bold on
                    } else {
                        outputStream.write(new byte[]{0x1D, 0x21, 0x00}); // normal
                        outputStream.write(new byte[]{0x1B, 0x45, 0x00}); // bold off
                    }
                    try { outputStream.write((line + "\n").getBytes(encoding)); }
                    catch (Exception e) { outputStream.write((line + "\n").getBytes("UTF-8")); }
                }
                // Reset to normal
                outputStream.write(new byte[]{0x1D, 0x21, 0x00});
                outputStream.write(new byte[]{0x1B, 0x45, 0x00});
            }

            // Feed + cut
            outputStream.write(new byte[]{0x0A, 0x0A, 0x0A, 0x0A});
            outputStream.write(new byte[]{0x1D, 0x56, 0x41, 0x03});
            outputStream.flush();
            call.resolve();
                return;
            } catch (IOException e) {
                lastError = e;
                Log.w(TAG, "printPinSlip attempt " + (attempt + 1) + " failed: " + e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try {
                        Thread.sleep(RETRY_DELAY_MS);
                        reconnect();
                    } catch (Exception re) {
                        Log.e(TAG, "Reconnect failed", re);
                    }
                }
            } catch (Exception e) {
                call.reject("printPinSlip failed: " + e.getMessage());
                return;
            }
        }
        call.reject("printPinSlip failed after retries: " + (lastError != null ? lastError.getMessage() : "unknown"));
    }

    @PluginMethod
    public void printQRCode(PluginCall call) {
        String data = call.getString("data");
        int size = call.getInt("size", 4);

        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }
        if (data == null || data.isEmpty()) {
            call.reject("QR data is required.");
            return;
        }

        Exception lastError = null;
        for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
            byte[] dataBytes = data.getBytes("UTF-8");
            int dataLen = dataBytes.length;
            outputStream.write(new byte[]{0x1B, 0x61, 0x01});
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00});
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, (byte) size});
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31});
            int storeLen = dataLen + 3;
            byte pL = (byte)(storeLen & 0xFF);
            byte pH = (byte)((storeLen >> 8) & 0xFF);
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30});
            outputStream.write(dataBytes);
            outputStream.write(new byte[]{0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30});
            outputStream.write(new byte[]{0x1B, 0x61, 0x00});
            outputStream.write(new byte[]{0x0A});
            outputStream.flush();
            call.resolve();
                return;
            } catch (IOException e) {
                lastError = e;
                Log.w(TAG, "printQRCode attempt " + (attempt + 1) + " failed: " + e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try {
                        Thread.sleep(RETRY_DELAY_MS);
                        reconnect();
                    } catch (Exception re) {
                        Log.e(TAG, "Reconnect failed", re);
                    }
                }
            } catch (Exception e) {
                call.reject("QR print failed: " + e.getMessage());
                return;
            }
        }
        call.reject("QR print failed after retries: " + (lastError != null ? lastError.getMessage() : "unknown"));
    }

    @PluginMethod
    public void printImage(PluginCall call) {
        String base64 = call.getString("base64");
        int widthMm = call.getInt("widthMm", 80);
        String align = call.getString("align", "center");

        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }
        if (base64 == null || base64.isEmpty()) {
            call.reject("base64 image data is required.");
            return;
        }

        Exception lastError = null;
        for (int attempt = 0; attempt <= MAX_RETRIES; attempt++) {
            try {
                // Decode base64 to bitmap
                byte[] imageBytes = Base64.decode(base64, Base64.DEFAULT);
                Bitmap original = BitmapFactory.decodeByteArray(imageBytes, 0, imageBytes.length);
                if (original == null) {
                    call.reject("Failed to decode image.");
                    return;
                }

                // Max print width in dots (203 dpi): 58mm ≈ 384 dots, 80mm ≈ 576 dots
                int maxWidthPx = widthMm == 58 ? 384 : 576;

                // Scale image to fit printer width while keeping aspect ratio
                int scaledWidth = Math.min(original.getWidth(), maxWidthPx);
                float ratio = (float) scaledWidth / original.getWidth();
                int scaledHeight = Math.round(original.getHeight() * ratio);
                Bitmap scaled = Bitmap.createScaledBitmap(original, scaledWidth, scaledHeight, true);
                original.recycle();

                // Convert to monochrome (1-bit) using Floyd-Steinberg dithering
                Bitmap mono = toMonochrome(scaled, scaledWidth, scaledHeight);
                scaled.recycle();

                // Build ESC/POS raster data
                byte[] rasterData = bitmapToEscPosRaster(mono, maxWidthPx);
                mono.recycle();

                // Set alignment
                byte alignByte = 0x01; // center
                if ("left".equals(align)) alignByte = 0x00;
                else if ("right".equals(align)) alignByte = 0x02;
                outputStream.write(new byte[]{0x1B, 0x61, alignByte});

                // Write raster data
                outputStream.write(rasterData);

                // Reset alignment to left
                outputStream.write(new byte[]{0x1B, 0x61, 0x00});
                outputStream.flush();
                call.resolve();
                return;
            } catch (IOException e) {
                lastError = e;
                Log.w(TAG, "printImage attempt " + (attempt + 1) + " failed: " + e.getMessage());
                if (attempt < MAX_RETRIES) {
                    try {
                        Thread.sleep(RETRY_DELAY_MS);
                        reconnect();
                    } catch (Exception re) {
                        Log.e(TAG, "Reconnect failed", re);
                    }
                }
            } catch (Exception e) {
                call.reject("printImage failed: " + e.getMessage());
                return;
            }
        }
        call.reject("printImage failed after retries: " + (lastError != null ? lastError.getMessage() : "unknown"));
    }

    /**
     * Convert a bitmap to monochrome using simple threshold with ordered dithering.
     */
    private Bitmap toMonochrome(Bitmap src, int w, int h) {
        // Convert to grayscale
        Bitmap grayscale = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        Canvas canvas = new Canvas(grayscale);
        Paint paint = new Paint();
        ColorMatrix cm = new ColorMatrix();
        cm.setSaturation(0);
        paint.setColorFilter(new ColorMatrixColorFilter(cm));
        canvas.drawBitmap(src, 0, 0, paint);

        // Threshold to 1-bit
        int[] pixels = new int[w * h];
        grayscale.getPixels(pixels, 0, w, 0, 0, w, h);
        grayscale.recycle();

        Bitmap mono = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888);
        int[] monoPixels = new int[w * h];
        for (int i = 0; i < pixels.length; i++) {
            int gray = pixels[i] & 0xFF; // blue channel (same as R and G after desaturation)
            monoPixels[i] = gray < 128 ? 0xFF000000 : 0xFFFFFFFF;
        }
        mono.setPixels(monoPixels, 0, w, 0, 0, w, h);
        return mono;
    }

    /**
     * Convert a monochrome bitmap to ESC/POS GS v 0 raster bit-image format.
     * Each row is padded to maxWidthPx (printer's full dot width).
     */
    private byte[] bitmapToEscPosRaster(Bitmap mono, int maxWidthPx) {
        int imgWidth = mono.getWidth();
        int imgHeight = mono.getHeight();

        // Bytes per row — must cover full printer width for proper centering
        int bytesPerRow = (maxWidthPx + 7) / 8;
        int imgBytesPerRow = (imgWidth + 7) / 8;
        int leftPadBytes = (bytesPerRow - imgBytesPerRow) / 2;

        // GS v 0: 1D 76 30 m xL xH yL yH [data]
        // m=0 (normal), xL/xH = bytes per row, yL/yH = rows
        byte xL = (byte) (bytesPerRow & 0xFF);
        byte xH = (byte) ((bytesPerRow >> 8) & 0xFF);
        byte yL = (byte) (imgHeight & 0xFF);
        byte yH = (byte) ((imgHeight >> 8) & 0xFF);

        ByteArrayOutputStream baos = new ByteArrayOutputStream();
        // Command header
        baos.write(0x1D); // GS
        baos.write(0x76); // v
        baos.write(0x30); // 0
        baos.write(0x00); // m = normal density
        baos.write(xL);
        baos.write(xH);
        baos.write(yL);
        baos.write(yH);

        // Pixel data, row by row
        int[] rowPixels = new int[imgWidth];
        for (int y = 0; y < imgHeight; y++) {
            mono.getPixels(rowPixels, 0, imgWidth, 0, y, imgWidth, 1);

            byte[] rowBytes = new byte[bytesPerRow]; // zero-filled = white padding

            for (int x = 0; x < imgWidth; x++) {
                // Black pixel = bit set to 1
                if ((rowPixels[x] & 0xFF) == 0) { // black
                    int byteIndex = leftPadBytes + (x / 8);
                    int bitIndex = 7 - (x % 8);
                    if (byteIndex < bytesPerRow) {
                        rowBytes[byteIndex] |= (1 << bitIndex);
                    }
                }
            }
            baos.write(rowBytes, 0, bytesPerRow);
        }

        return baos.toByteArray();
    }

    /**
     * Attempts to connect to {@code address}, retrying with increasing delays so that
     * a competing app (e.g. GrabFood) has time to release the BT socket between tries.
     * Also tries the hidden createRfcommSocket(1) reflection path when SDP-based connect fails.
     */
    private void connectWithRetry(String address) throws Exception {
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
        Exception lastError = null;
        for (int i = 0; i < CONNECT_RETRY_DELAYS_MS.length; i++) {
            if (CONNECT_RETRY_DELAYS_MS[i] > 0) {
                Log.w(TAG, "BT connect retry " + i + " — waiting " + CONNECT_RETRY_DELAYS_MS[i] + "ms for socket to free up");
                Thread.sleep(CONNECT_RETRY_DELAYS_MS[i]);
            }
            try {
                BluetoothSocket socket = createSocket(device);
                socket.connect();
                bluetoothSocket = socket;
                outputStream = bluetoothSocket.getOutputStream();
                connectedAddress = address;
                Thread.sleep(80);
                Log.d(TAG, "Connected to " + address + " on attempt " + (i + 1));
                return;
            } catch (Exception e) {
                lastError = e;
                Log.w(TAG, "Connect attempt " + (i + 1) + " failed: " + e.getMessage());
                if (bluetoothSocket != null) {
                    try { bluetoothSocket.close(); } catch (Exception ignored) {}
                    bluetoothSocket = null;
                    outputStream = null;
                }
            }
        }
        throw lastError != null ? lastError : new IOException("Connection failed after retries");
    }

    /**
     * Creates an RFCOMM socket using the standard UUID path; falls back to the
     * hidden createRfcommSocket(channel=1) on devices where SDP lookup fails.
     */
    @SuppressWarnings({"JavaReflectionMemberAccess", "PrivateApi"})
    private BluetoothSocket createSocket(BluetoothDevice device) throws Exception {
        try {
            return device.createRfcommSocketToServiceRecord(SPP_UUID);
        } catch (IOException e) {
            Log.w(TAG, "createRfcommSocketToServiceRecord failed, trying reflection fallback: " + e.getMessage());
            try {
                java.lang.reflect.Method m = device.getClass().getMethod("createRfcommSocket", int.class);
                return (BluetoothSocket) m.invoke(device, 1);
            } catch (Exception ex) {
                throw e; // rethrow original if reflection also fails
            }
        }
    }

    private synchronized void reconnect() throws Exception {
        if (connectedAddress == null) {
            throw new IOException("No previous connection address");
        }
        disconnect();
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(connectedAddress);
        BluetoothSocket socket = createSocket(device);
        socket.connect();
        bluetoothSocket = socket;
        outputStream = bluetoothSocket.getOutputStream();
        Thread.sleep(100);
        Log.d(TAG, "Reconnected to " + connectedAddress);
    }

    private void disconnect() {
        if (outputStream != null) {
            try { outputStream.close(); } catch (IOException e) { Log.w(TAG, "Stream close error", e); }
            outputStream = null;
        }
        if (bluetoothSocket != null) {
            try { bluetoothSocket.close(); } catch (IOException e) { Log.w(TAG, "Socket close error", e); }
            bluetoothSocket = null;
        }
        // Keep connectedAddress so reconnect() can find the printer
    }

    /** Explicit user-initiated disconnect — clears stored address too. */
    @PluginMethod
    public void forgetPrinter(PluginCall call) {
        disconnect();
        connectedAddress = null;
        call.resolve();
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        // Release the socket when the app goes to background so other apps (e.g. GrabFood)
        // can connect to the same printer without being blocked by a stale held socket.
        if (bluetoothSocket != null) {
            Log.d(TAG, "onPause: releasing socket for other apps");
            disconnect();
        }
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // Drop any held socket when the app returns to foreground — it may have been
        // invalidated while we were paused. Connect fresh on the next print job.
        if (bluetoothSocket != null) {
            Log.d(TAG, "onResume: releasing stale socket — will reconnect on next print");
            disconnect();
        }
    }
}
