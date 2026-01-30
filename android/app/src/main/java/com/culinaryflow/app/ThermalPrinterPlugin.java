package com.culinaryflow.app;

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
            if (bluetoothSocket != null && bluetoothSocket.isConnected() && address.equals(bluetoothSocket.getRemoteDevice().getAddress())) {
                call.resolve();
                return;
            }

            disconnect();

            // Stop discovery before connecting
            if (bluetoothAdapter.isDiscovering()) {
                bluetoothAdapter.cancelDiscovery();
            }

            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            bluetoothSocket.connect();
            outputStream = bluetoothSocket.getOutputStream();
            
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
        
        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }

        try {
            // Initialize printer (ESC @)
            outputStream.write(new byte[]{0x1B, 0x40});
            // Select character size normal (GS ! 0)
            outputStream.write(new byte[]{0x1D, 0x21, 0x00});
            // Set left alignment (ESC a 0)
            outputStream.write(new byte[]{0x1B, 0x61, 0x00});
            
            // Write text with specific encoding
            try {
                outputStream.write(text.getBytes(encoding));
            } catch (Exception e) {
                // Fallback to UTF-8
                outputStream.write(text.getBytes(Charset.forName("UTF-8")));
            }
            
            // Mandatory feeds for cutting (LF)
            outputStream.write(new byte[]{0x0A, 0x0A, 0x0A, 0x0A});
            
            Boolean cut = call.getBoolean("cut", false);
            if (cut) {
                // Full cut command (GS V 65 0)
                outputStream.write(new byte[]{0x1D, 0x56, 0x41, 0x03});
            }

            Boolean beep = call.getBoolean("beep", false);
            if (beep) {
                // Beep command (ESC B 2 2)
                outputStream.write(new byte[]{0x1B, 0x42, 0x02, 0x02});
            }

            outputStream.flush();
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Print failed", e);
            call.reject("Print failed: " + e.getMessage());
        }
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
        } catch (IOException e) {
            Log.e(TAG, "Disconnect error", e);
        }
    }
}
