package com.culinaryflow.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothSocket;
import android.os.Build;
import android.util.Log;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

import org.json.JSONArray;

import java.io.IOException;
import java.io.OutputStream;
import java.util.Set;
import java.util.UUID;

@CapacitorPlugin(
    name = "ThermalPrinter",
    permissions = {
        @Permission(
            alias = "bluetooth",
            strings = {
                Manifest.permission.BLUETOOTH,
                Manifest.permission.BLUETOOTH_ADMIN,
                Manifest.permission.BLUETOOTH_SCAN,
                Manifest.permission.BLUETOOTH_CONNECT
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

    @PluginMethod
    public void listBluetoothPrinters(PluginCall call) {
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

    @PluginMethod
    public void connectBluetoothPrinter(PluginCall call) {
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

            BluetoothDevice device = bluetoothAdapter.getRemoteDevice(address);
            bluetoothSocket = device.createRfcommSocketToServiceRecord(SPP_UUID);
            bluetoothSocket.connect();
            outputStream = bluetoothSocket.getOutputStream();
            
            call.resolve();
        } catch (Exception e) {
            Log.e(TAG, "Connection failed", e);
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
        if (outputStream == null) {
            call.reject("Printer not connected.");
            return;
        }

        try {
            // Initialize printer
            outputStream.write(new byte[]{0x1B, 0x40});
            // Reset character size
            outputStream.write(new byte[]{0x1D, 0x21, 0x00});
            
            // Write text
            outputStream.write(text.getBytes("UTF-8"));
            
            // Feed and cut if requested
            outputStream.write(new byte[]{0x0A, 0x0A, 0x0A, 0x0A});
            
            Boolean cut = call.getBoolean("cut", false);
            if (cut) {
                outputStream.write(new byte[]{0x1D, 0x56, 0x41, 0x03});
            }

            Boolean beep = call.getBoolean("beep", false);
            if (beep) {
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
