package net.shareat.pos;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
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
    private static final int MAX_RETRIES = 2;
    private static final int RETRY_DELAY_MS = 500;

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
            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            bluetoothSocket.connect();
            outputStream = bluetoothSocket.getOutputStream();
            connectedAddress = address;
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

    
    private synchronized void reconnect() throws Exception {
        if (connectedAddress == null) {
            throw new IOException("No previous connection address");
        }
        disconnect();
        if (bluetoothAdapter.isDiscovering()) {
            bluetoothAdapter.cancelDiscovery();
        }
        BluetoothDevice device = bluetoothAdapter.getRemoteDevice(connectedAddress);
        bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
        bluetoothSocket.connect();
        outputStream = bluetoothSocket.getOutputStream();
        Thread.sleep(100); // Let printer settle
        Log.d(TAG, "Reconnected to " + connectedAddress);
    }

    private void disconnect() {
        try {
            if (outputStream != null) {
                outputStream.close();
                outputStream = null;
            }
            if (bluetoothSocket != null) {
                bluetoothSocket.close();
                bluetoothSocket = null;
            }
            // Keep connectedAddress so reconnect() can find the printer
        } catch (IOException e) {
            Log.e(TAG, "Disconnect error", e);
        }
    }

    /** Explicit user-initiated disconnect — clears stored address too. */
    @PluginMethod
    public void forgetPrinter(PluginCall call) {
        disconnect();
        connectedAddress = null;
        call.resolve();
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        // Proactively check and reconnect when app returns to foreground
        if (connectedAddress != null && bluetoothSocket != null) {
            try {
                outputStream.write(new byte[0]);
                outputStream.flush();
                Log.d(TAG, "onResume: socket still alive");
            } catch (Exception e) {
                Log.w(TAG, "onResume: socket dead, reconnecting...");
                try {
                    reconnect();
                    Log.d(TAG, "onResume: reconnected successfully");
                } catch (Exception re) {
                    Log.w(TAG, "onResume: reconnect failed, will retry on next print", re);
                }
            }
        }
    }
}
