/**
 * ChromWhatsApp - Preload Script
 * Secure bridge between renderer and main process
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // App info
    getAppInfo: () => ({
        name: 'ChromWhatsApp',
        version: '2.0.0'
    }),

    // Window controls
    minimizeWindow: () => ipcRenderer.send('window-minimize'),
    maximizeWindow: () => ipcRenderer.send('window-maximize'),
    closeWindow: () => ipcRenderer.send('window-close'),

    // WhatsApp status listener
    onWhatsAppStatus: (callback) => {
        ipcRenderer.on('whatsapp-status', (event, data) => callback(data));
    },

    // Notifications
    showNotification: (title, body) => {
        ipcRenderer.send('show-notification', { title, body });
    },

    // Open external link
    openExternal: (url) => {
        ipcRenderer.send('open-external', url);
    },

    // Platform info
    platform: process.platform
});
