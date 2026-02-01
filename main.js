const { app, BrowserWindow, ipcMain, Tray, Menu, shell } = require('electron');
const path = require('path');
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const qrcode = require('qrcode');
const fs = require('fs');
// const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const { Client, LocalAuth, MessageMedia, Buttons, List } = require('whatsapp-web.js');

const axios = require('axios');
const crypto = require('crypto');
const multer = require('multer');
require('dotenv').config();
// Note: We don't actually need puppeteer directly - whatsapp-web.js uses it internally
// We just need to provide the config. Remove the unused import.
const { nativeImage } = require('electron');
const cors = require('cors');
const { autoUpdater } = require('electron-updater');

// Configuration
const PORT = process.env.PORT || 3030;
const AUTH_ENABLED = process.env.AUTH_ENABLED === 'true';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'medians';
const WEBHOOK_URL = process.env.WEBHOOK_URL || '';
const WEBHOOK_TOKEN = process.env.WEBHOOK_TOKEN || '';
const MAX_DEVICES = parseInt(process.env.MAX_DEVICES) || 10;

// Express app setup
const expressApp = express();
const server = http.createServer(expressApp);
const io = socketIo(server);

// Middleware
expressApp.use(cors()); // allow all origins (DEV ONLY)
expressApp.use(express.json());
expressApp.use(express.urlencoded({ extended: true }));
expressApp.use(express.static(path.join(__dirname, 'public')));

// File upload configuration
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, Date.now() + '-' + file.originalname);
    }
});
const upload = multer({ storage: storage });

// Global variables
let whatsappClient = null;
let mainWindow = null;
let tray = null;
let qrCodeData = null;
let isAuthenticated = false;
let isClientReady = false;
let clientState = 'disconnected';
let currentSessionId = null; // Track current session
let isReinitializing = false;
let fallbackPollingActive = false; // Track if fallback polling is running
const authFailureRetries = new Map();

// Session health tracking
let sessionInitStartTime = null;
let sessionHealthCheckInterval = null;
const SESSION_INIT_TIMEOUT_MS = 180000; // 3 minutes max for full initialization
const SESSION_LOADING_TIMEOUT_MS = 120000; // 2 minutes max for loading after auth
const SESSION_STUCK_THRESHOLD_MS = 300000; // 5 minutes absolute max before force cleanup

// Device Management
const devicesFile = path.join(__dirname, 'devices.json');
let registeredDevices = [];

// Session Management
const sessionsFile = path.join(__dirname, 'sessions.json');
let sessions = [];

function getSessionAuthDir(sessionId) {
    // Use the same path as LocalAuth uses
    try {
        const { app } = require('electron');
        return path.join(app.getPath('userData'), 'wwebjs_auth', `session-${sessionId}`);
    } catch (e) {
        // Fallback for when app is not ready
        return path.join(__dirname, '.wwebjs_auth', `session-${sessionId}`);
    }
}

function clearSessionAuthData(sessionId) {
    // Clear from userData path (primary)
    try {
        const { app } = require('electron');
        const userDataSessionDir = path.join(app.getPath('userData'), 'wwebjs_auth', `session-${sessionId}`);
        if (fs.existsSync(userDataSessionDir)) {
            fs.rmSync(userDataSessionDir, { recursive: true, force: true });
            console.log(`Cleared session auth data from userData: ${userDataSessionDir}`);
        }
    } catch (e) {
        console.error('Error clearing userData session:', e.message);
    }
    
    // Also clear from legacy path if exists
    const legacySessionDir = path.join(__dirname, '.wwebjs_auth', `session-${sessionId}`);
    if (fs.existsSync(legacySessionDir)) {
        fs.rmSync(legacySessionDir, { recursive: true, force: true });
        console.log(`Cleared legacy session auth data: ${legacySessionDir}`);
    }
}

// Force cleanup stuck session and reinitialize
async function forceCleanupAndReinitialize(sessionId, reason) {
    console.log(`Force cleanup triggered for session ${sessionId}: ${reason}`);
    
    // Stop health check
    stopSessionHealthCheck();
    
    // Reset fallback polling flag
    fallbackPollingActive = false;
    
    // Destroy current client if exists
    if (whatsappClient) {
        try {
            await whatsappClient.destroy();
        } catch (destroyErr) {
            console.error('Error destroying client during force cleanup:', destroyErr.message);
        }
        whatsappClient = null;
    }
    
    // Reset state
    isClientReady = false;
    isAuthenticated = false;
    clientState = 'disconnected';
    qrCodeData = null;
    
    // Clear the corrupted session data
    clearSessionAuthData(sessionId);
    
    // Notify UI
    io.emit('session-force-cleared', { 
        sessionId: sessionId, 
        reason: reason,
        message: `Session was automatically cleared due to: ${reason}. Please scan QR code again.`
    });
    io.emit('status', { 
        status: 'reconnecting', 
        message: 'Session was corrupted and has been cleared. Reinitializing...' 
    });
    
    // Wait a bit before reinitializing
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Reinitialize with fresh session
    try {
        await initializeWhatsAppClient(sessionId);
    } catch (reinitError) {
        console.error('Failed to reinitialize after force cleanup:', reinitError.message);
        io.emit('error', { message: 'Failed to reinitialize. Please restart the application.' });
    }
}

// Session health monitoring
function startSessionHealthCheck(sessionId) {
    stopSessionHealthCheck(); // Clear any existing interval FIRST
    sessionInitStartTime = Date.now(); // THEN set the start time
    
    console.log(`Starting session health check for: ${sessionId}`);
    
    sessionHealthCheckInterval = setInterval(async () => {
        const elapsed = Date.now() - sessionInitStartTime;
        
        // Check for absolute stuck threshold (5 minutes)
        if (!isClientReady && elapsed > SESSION_STUCK_THRESHOLD_MS) {
            console.log(`Session ${sessionId} stuck for ${elapsed/1000}s - forcing cleanup`);
            clearInterval(sessionHealthCheckInterval);
            sessionHealthCheckInterval = null;
            await forceCleanupAndReinitialize(sessionId, 'Session stuck for too long (5+ minutes)');
            return;
        }
        
        // Check for loading timeout (2 minutes after authentication)
        if (isAuthenticated && !isClientReady && clientState === 'loading') {
            // Find when we authenticated (approximate)
            if (elapsed > SESSION_LOADING_TIMEOUT_MS) {
                console.log(`Session ${sessionId} stuck in loading state - forcing cleanup`);
                clearInterval(sessionHealthCheckInterval);
                sessionHealthCheckInterval = null;
                await forceCleanupAndReinitialize(sessionId, 'Loading took too long after authentication');
                return;
            }
        }
        
        // If ready, stop monitoring
        if (isClientReady) {
            console.log('Session is ready, stopping health check');
            stopSessionHealthCheck();
        }
    }, 10000); // Check every 10 seconds
}

function stopSessionHealthCheck() {
    if (sessionHealthCheckInterval) {
        clearInterval(sessionHealthCheckInterval);
        sessionHealthCheckInterval = null;
    }
    sessionInitStartTime = null;
}

// Auto-Updater Configuration
autoUpdater.autoDownload = false; // Don't auto-download, let user choose
autoUpdater.autoInstallOnAppQuit = true;

// Update status
let updateInfo = {
    available: false,
    downloading: false,
    downloaded: false,
    error: null,
    version: null,
    progress: 0
};

// Configure auto-updater logging
autoUpdater.logger = {
    info: (msg) => console.log('[AutoUpdater]', msg),
    warn: (msg) => console.warn('[AutoUpdater]', msg),
    error: (msg) => console.error('[AutoUpdater]', msg),
    debug: (msg) => console.log('[AutoUpdater Debug]', msg)
};

// Auto-Updater Event Handlers
autoUpdater.on('checking-for-update', () => {
    updateInfo.available = false;
    updateInfo.error = null;
    io.emit('update-checking');
});

autoUpdater.on('update-available', (info) => {
    updateInfo.available = true;
    updateInfo.version = info.version;
    updateInfo.releaseNotes = info.releaseNotes;
    updateInfo.releaseDate = info.releaseDate;
    io.emit('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes,
        releaseDate: info.releaseDate
    });
});

autoUpdater.on('update-not-available', (info) => {
    updateInfo.available = false;
    io.emit('update-not-available', { version: info.version });
});

autoUpdater.on('download-progress', (progress) => {
    updateInfo.downloading = true;
    updateInfo.progress = progress.percent;
    console.log(`Download progress: ${progress.percent}%`);
    io.emit('update-download-progress', {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond
    });
});

autoUpdater.on('update-downloaded', (info) => {
    updateInfo.downloading = false;
    updateInfo.downloaded = true;
    io.emit('update-downloaded', {
        version: info.version,
        releaseNotes: info.releaseNotes
    });
});

autoUpdater.on('error', (err) => {
    console.error('Auto-updater error:', err);
    updateInfo.error = err.message;
    updateInfo.downloading = false;
    io.emit('update-error', { error: err.message });
});

// Load registered devices
function loadDevices() {
    if (fs.existsSync(devicesFile)) {
        try {
            const data = fs.readFileSync(devicesFile, 'utf-8');
            registeredDevices = JSON.parse(data);
        } catch (err) {
            console.error('Error loading devices:', err);
            registeredDevices = [];
        }
    }
}

// Save registered devices
function saveDevices() {
    try {
        fs.writeFileSync(devicesFile, JSON.stringify(registeredDevices, null, 2));
    } catch (err) {
        console.error('Error saving devices:', err);
    }
}

// Load sessions
function loadSessions() {
    if (fs.existsSync(sessionsFile)) {
        try {
            const data = fs.readFileSync(sessionsFile, 'utf-8');
            sessions = JSON.parse(data);
        } catch (err) {
            console.error('Error loading sessions:', err);
            sessions = [];
        }
    }
    
    // Add default session if none exist
    if (sessions.length === 0) {
        sessions.push({
            id: 'default',
            name: 'Default Session',
            createdAt: new Date().toISOString(),
            active: false
        });
        saveSessions();
    }
}

// Save sessions
function saveSessions() {
    try {
        fs.writeFileSync(sessionsFile, JSON.stringify(sessions, null, 2));
    } catch (err) {
        console.error('Error saving sessions:', err);
    }
}

// Generate OTP
function generateOTP() {
    return crypto.randomBytes(3).toString('hex').toUpperCase();
}

// Generate device token
function generateDeviceToken() {
    return crypto.randomBytes(32).toString('hex');
}

// Verify admin token
function verifyAdminToken(req, res, next) {
    if (!AUTH_ENABLED) {
        return next();
    }

    const token = req.headers['x-admin-token'] || req.query.admin_token;
    if (token === ADMIN_TOKEN) {
        return next();
    }

    res.status(401).json({ error: 'Unauthorized: Invalid admin token' });
}

// Verify device token
function verifyDeviceToken(req, res, next) {
    if (!AUTH_ENABLED) {
        return next();
    }

    const token = req.headers['x-device-token'] || req.query.device_token;
    const device = registeredDevices.find(d => d.token === token && d.active);

    if (device) {
        req.device = device;
        return next();
    }

    res.status(401).json({ error: 'Unauthorized: Invalid or inactive device token' });
}

// Send webhook notification
async function sendWebhook(event, data) {
    console.log('Webhook', WEBHOOK_URL,event,data, data);
    if (!WEBHOOK_URL) return;

    try {
        await axios.post(WEBHOOK_URL, {
            event: event,
            data: data,
            timestamp: new Date().toISOString()
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Token': WEBHOOK_TOKEN
            },
            timeout: 5000
        });
    } catch (err) {
        console.error('Webhook error:', err.message);
    }
}

// Socket.IO connection
io.on('connection', (socket) => {

    // Send current state including sessions
    socket.emit('state', {
        state: clientState,
        authenticated: isAuthenticated,
        ready: isClientReady,
        qr: qrCodeData,
        sessions: sessions,
        currentSession: currentSessionId
    });

    // Handle session selection
    socket.on('selectSession', async (sessionId) => {
        try {
            const session = sessions.find(s => s.id === sessionId);
            if (!session) {
                socket.emit('session-init-failed', { message: 'Session not found' });
                return;
            }

            // Stop any existing health check
            stopSessionHealthCheck();

            // Disconnect current client if exists
            if (whatsappClient) {
                try {
                    await whatsappClient.destroy();
                } catch (destroyErr) {
                    console.error('Error destroying existing client:', destroyErr.message);
                }
                whatsappClient = null;
                isClientReady = false;
                isAuthenticated = false;
                clientState = 'disconnected';
            }

            // Emit session selected first so UI knows we're connecting
            socket.emit('sessionSelected', { sessionId: sessionId });
            io.emit('status', { status: 'connecting', message: 'Initializing WhatsApp client...' });

            // Start session health monitoring (will auto-cleanup if stuck)
            startSessionHealthCheck(sessionId);

            // Initialize with selected session
            try {
                await initializeWhatsAppClient(sessionId);
            } catch (initError) {
                console.error('Session initialization error:', initError.message);
                // If initialization fails, check if we should clear the session
                if (initError.message.includes('timeout') || initError.message.includes('Target closed') || initError.message.includes('Session')) {
                    console.log('Initialization failed with recoverable error - clearing session');
                    clearSessionAuthData(sessionId);
                    io.emit('session-init-failed', { 
                        message: 'Session data was corrupted and has been cleared. Please try again.',
                        sessionId: sessionId 
                    });
                } else {
                    throw initError;
                }
            }
        } catch (error) {
            console.error('Session selection error:', error.message);
            stopSessionHealthCheck();
            socket.emit('session-init-failed', { message: error.message });
        }
    });

    // Handle clear session (clears auth data but keeps session)
    socket.on('clearSession', async (sessionId) => {
        try {
            const session = sessions.find(s => s.id === sessionId);
            if (!session) {
                socket.emit('error', { message: 'Session not found' });
                return;
            }

            // If this is the current session, disconnect first
            if (sessionId === currentSessionId && whatsappClient) {
                try {
                    await whatsappClient.destroy();
                } catch (destroyErr) {
                    console.error('Error destroying client:', destroyErr.message);
                }
                whatsappClient = null;
                isClientReady = false;
                isAuthenticated = false;
                clientState = 'disconnected';
                currentSessionId = null;
            }

            // Clear auth data
            clearSessionAuthData(sessionId);
            
            // Mark session as inactive
            session.active = false;
            saveSessions();

            socket.emit('sessionCleared', { sessionId: sessionId, message: 'Session cleared successfully' });
            io.emit('sessionsUpdated', { sessions: sessions });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    // Handle create new session
    socket.on('createSession', (sessionName) => {
        try {
            const sessionId = `session-${Date.now()}`;
            const newSession = {
                id: sessionId,
                name: sessionName,
                createdAt: new Date().toISOString(),
                active: false
            };

            sessions.push(newSession);
            saveSessions();

            io.emit('sessionsUpdated', { sessions: sessions });
            socket.emit('sessionCreated', { session: newSession });
        } catch (error) {
            socket.emit('error', { message: error.message });
        }
    });

    socket.on('disconnect', () => {
        console.log('Client disconnected');
    });
});

// Fallback polling function for when loading_screen event doesn't fire
async function startFallbackReadyPolling() {
    if (fallbackPollingActive || isClientReady) {
        console.log('Fallback polling skipped - already active or client ready');
        return;
    }
    
    fallbackPollingActive = true;
    let pollAttempts = 0;
    const maxPollAttempts = 60; // 60 attempts * 2 seconds = 120 seconds max
    
    const pollInterval = setInterval(async () => {
        pollAttempts++;
        console.log(`Fallback polling for client state (attempt ${pollAttempts}/${maxPollAttempts})...`);
        
        if (isClientReady) {
            console.log('Client became ready, stopping fallback poll');
            clearInterval(pollInterval);
            fallbackPollingActive = false;
            return;
        }
        
        // Check if whatsappClient still exists
        if (!whatsappClient) {
            console.log('WhatsApp client was destroyed, stopping fallback poll');
            clearInterval(pollInterval);
            fallbackPollingActive = false;
            return;
        }
        
        try {
            // Use getState() which is more reliable
            const state = await whatsappClient.getState();
            console.log(`Fallback poll - Client state: ${state}`);
            
            if (state === 'CONNECTED') {
                const info = whatsappClient.info;
                if (info && info.wid) {
                    console.log('Client info available via fallback polling - triggering ready manually');
                    clearInterval(pollInterval);
                    fallbackPollingActive = false;
                    stopSessionHealthCheck();
                    
                    isClientReady = true;
                    clientState = 'ready';
                    qrCodeData = null;
                    if (currentSessionId) {
                        authFailureRetries.delete(currentSessionId);
                    }
                    
                    console.log('Logged in as:', info.pushname);
                    io.emit('ready', {
                        pushname: info.pushname,
                        number: info.wid.user
                    });
                    await sendWebhook('ready', {
                        pushname: info.pushname,
                        number: info.wid.user
                    });
                } else {
                    console.log('State is CONNECTED but info not yet available, will retry...');
                }
            }
        } catch (err) {
            console.log('Fallback poll - Client state check failed:', err.message);
        }
        
        if (pollAttempts >= maxPollAttempts) {
            console.log('Fallback polling max attempts reached');
            clearInterval(pollInterval);
            fallbackPollingActive = false;
        }
    }, 2000);
}

// Setup WhatsApp client event listeners
function setupClientEventListeners(client) {
    // QR Code event
    client.on('qr', async (qr) => {
        console.log('QR Code received');
        qrCodeData = await qrcode.toDataURL(qr);
        clientState = 'qr';
        io.emit('qr', qrCodeData);
        await sendWebhook('qr_generated', { qr: qr });
    });

    // Authenticated event
    client.on('authenticated', () => {
        console.log('Client authenticated');
        isAuthenticated = true;
        clientState = 'authenticated';
        io.emit('authenticated');
        // Emit status to show user that we're loading after authentication
        io.emit('status', { status: 'loading', message: 'Authenticated! Loading WhatsApp data...' });
        sendWebhook('authenticated', {});
        
        // Start a fallback polling mechanism in case loading_screen event doesn't fire
        // This handles cases where cached sessions skip the loading_screen event
        setTimeout(() => {
            if (!isClientReady && whatsappClient) {
                console.log('Starting fallback polling after authentication...');
                startFallbackReadyPolling();
            }
        }, 5000); // Wait 5 seconds after auth before starting fallback
    });

    // Loading screen event - tracks WhatsApp loading progress
    client.on('loading_screen', (percent, message) => {
        console.log(`WhatsApp loading: ${percent}% - ${message}`);
        clientState = 'loading';
        io.emit('status', { status: 'loading', message: `Loading WhatsApp: ${percent}% - ${message}` });
        
        // When loading reaches 100%, start polling for client state (fallback for ready event)
        if (percent >= 100 && !isClientReady) {
            console.log('Loading complete, starting client state polling...');
            let pollAttempts = 0;
            const maxPollAttempts = 45; // 45 attempts * 2 seconds = 90 seconds max
            
            const pollInterval = setInterval(async () => {
                pollAttempts++;
                console.log(`Polling for client state (attempt ${pollAttempts}/${maxPollAttempts})...`);
                
                if (isClientReady) {
                    console.log('Client became ready, stopping poll');
                    clearInterval(pollInterval);
                    stopSessionHealthCheck(); // Stop health monitoring
                    return;
                }
                
                // Check if whatsappClient still exists (might have been destroyed during cleanup)
                if (!whatsappClient) {
                    console.log('WhatsApp client was destroyed, stopping poll');
                    clearInterval(pollInterval);
                    return;
                }
                
                try {
                    // Use getState() which is more reliable than checking client.info directly
                    const state = await whatsappClient.getState();
                    console.log(`Client state: ${state}`);
                    
                    if (state === 'CONNECTED') {
                        // Client is connected, now check for info
                        const info = whatsappClient.info;
                        if (info && info.wid) {
                            console.log('Client info available via polling - triggering ready manually');
                            clearInterval(pollInterval);
                            stopSessionHealthCheck(); // Stop health monitoring
                            
                            isClientReady = true;
                            clientState = 'ready';
                            qrCodeData = null;
                            if (currentSessionId) {
                                authFailureRetries.delete(currentSessionId);
                            }
                            
                            console.log('Logged in as:', info.pushname);
                            io.emit('ready', {
                                pushname: info.pushname,
                                number: info.wid.user
                            });
                            await sendWebhook('ready', {
                                pushname: info.pushname,
                                number: info.wid.user
                            });
                        } else {
                            console.log('State is CONNECTED but info not yet available, will retry...');
                        }
                    }
                } catch (err) {
                    console.log('Client state check failed:', err.message);
                }
                
                if (pollAttempts >= maxPollAttempts) {
                    console.log('Max poll attempts reached after loading complete - triggering session cleanup');
                    clearInterval(pollInterval);
                    // Let the health check handle the cleanup if it's still running
                    // or trigger manual cleanup
                    if (currentSessionId && !isClientReady) {
                        io.emit('status', { 
                            status: 'error', 
                            message: 'Client failed to become ready. Automatically clearing session...' 
                        });
                        // Trigger cleanup after a short delay
                        setTimeout(async () => {
                            if (!isClientReady && currentSessionId) {
                                await forceCleanupAndReinitialize(currentSessionId, 'Client info polling exhausted after loading complete');
                            }
                        }, 3000);
                    }
                }
            }, 2000); // Poll every 2 seconds
        }
    });

    // Ready event
    client.on('ready', async () => {
        console.log('WhatsApp client is ready');
        isClientReady = true;
        clientState = 'ready';
        qrCodeData = null;
        stopSessionHealthCheck(); // Stop health monitoring - client is ready
        if (currentSessionId) {
            authFailureRetries.delete(currentSessionId);
        }

        try {
            // Use whatsappClient as fallback if client.info is not available
            const activeClient = whatsappClient || client;
            const info = activeClient.info;
            if (info && info.wid) {
                console.log('Logged in as:', info.pushname);
                io.emit('ready', {
                    pushname: info.pushname,
                    number: info.wid.user
                });
                await sendWebhook('ready', {
                    pushname: info.pushname,
                    number: info.wid.user
                });
            } else {
                // Fallback: emit ready without user info
                console.log('Client ready but info not immediately available');
                io.emit('ready', {
                    pushname: 'Unknown',
                    number: 'Unknown'
                });
            }
        } catch (err) {
            console.error('Error getting client info:', err);
            // Still emit ready even if we can't get info
            io.emit('ready', {
                pushname: 'Unknown',
                number: 'Unknown'
            });
        }
    });

    // Message received event
    client.on('message', async (message) => {
        console.log('Message received:', message);
        io.emit('message', {
            from: message.from,
            body: message.body,
            timestamp: message.timestamp,
            hasMedia: message.hasMedia,
            type: message.type
        });
        handleMsgWebhook(message, 'message_received');
    });

    // Message sent event
    client.on('message_create', async (message) => {
        if (message.fromMe) {
            console.log('Message sent:', message.to, message.body);
            io.emit('message_sent', {
                to: message.to,
                body: message.body,
                timestamp: message.timestamp,
                hasMedia: message.hasMedia,
                type: message.type
            });

            try {
                
                await handleMsgWebhook(message, 'message_sent');
                
            } catch (error) {
                console.error('Error processing sent message webhook:', error);
            }
        }
    });

    // Message acknowledgement event
    client.on('message_ack', async (message, ack) => {
        io.emit('message_ack', {
            id: message.id._serialized,
            ack: ack
        });
    });

    // Authentication failure event
    client.on('auth_failure', async (msg) => {
        console.error('Authentication failure:', msg);
        clientState = 'auth_failure';
        stopSessionHealthCheck(); // Stop health monitoring
        io.emit('auth_failure', { message: msg });
        await sendWebhook('auth_failure', { message: msg });

        const sessionId = currentSessionId;
        if (!sessionId || isReinitializing) return;

        const retryCount = authFailureRetries.get(sessionId) || 0;
        if (retryCount >= 1) {
            // Already retried once, clear session completely
            console.log('Auth failure after retry - clearing session completely');
            clearSessionAuthData(sessionId);
            io.emit('status', { status: 'error', message: 'Authentication failed multiple times. Session has been cleared. Please scan QR code again.' });
            return;
        }

        authFailureRetries.set(sessionId, retryCount + 1);
        isReinitializing = true;

        try {
            if (whatsappClient) {
                try {
                    await whatsappClient.destroy();
                } catch (destroyErr) {
                    console.error('Error destroying client after auth failure:', destroyErr.message);
                }
                whatsappClient = null;
            }

            isAuthenticated = false;
            isClientReady = false;
            clientState = 'disconnected';
            qrCodeData = null;

            clearSessionAuthData(sessionId);
            io.emit('status', { status: 'disconnected', message: 'Session reset. Generating new QR...' });

            // Start health check for new attempt
            startSessionHealthCheck(sessionId);
            await initializeWhatsAppClient(sessionId);
        } catch (reinitErr) {
            console.error('Failed to reinitialize after auth failure:', reinitErr.message);
            stopSessionHealthCheck();
        } finally {
            isReinitializing = false;
        }
    });

    // Disconnected event
    client.on('disconnected', async (reason) => {
        console.log('Client disconnected:', reason);
        isAuthenticated = false;
        isClientReady = false;
        clientState = 'disconnected';
        stopSessionHealthCheck(); // Stop health monitoring
        io.emit('disconnected', { reason: reason });
        await sendWebhook('disconnected', { reason: reason });
        
        // If disconnected due to session issues, auto-clear
        if (reason === 'NAVIGATION' || reason === 'LOGOUT' || reason === 'CONFLICT') {
            console.log(`Disconnected due to ${reason} - clearing session cache`);
            if (currentSessionId) {
                clearSessionAuthData(currentSessionId);
            }
        }
    });
}

// Initialize WhatsApp Client with robust Puppeteer configuration for Windows
async function initializeWhatsAppClient(sessionId = 'default') {
    try {
        console.log(`Initializing WhatsApp client for session: ${sessionId}...`);
        currentSessionId = sessionId;
        
        // Update session as active
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            sessions.forEach(s => s.active = false);
            session.active = true;
            session.lastUsed = new Date().toISOString();
            saveSessions();
        }
        
        // Find Chrome executable - prefer system Chrome to avoid corruption issues
        let chromePath = null;
        const possibleChromePaths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env.PROGRAMFILES + '\\Google\\Chrome\\Application\\chrome.exe',
            process.env['PROGRAMFILES(X86)'] + '\\Google\\Chrome\\Application\\chrome.exe'
        ];

        // First, try to find system Chrome
        for (const p of possibleChromePaths) {
            if (p && fs.existsSync(p)) {
                chromePath = p;
                console.log('Using system Chrome:', chromePath);
                break;
            }
        }

        // If system Chrome not found, try Microsoft Edge as fallback
        if (!chromePath) {
            const edgePaths = [
                'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
                'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
                process.env.LOCALAPPDATA + '\\Microsoft\\Edge\\Application\\msedge.exe'
            ];
            for (const edgePath of edgePaths) {
                if (edgePath && fs.existsSync(edgePath)) {
                    chromePath = edgePath;
                    console.log('Using Microsoft Edge:', chromePath);
                    break;
                }
            }
        }

        const puppeteerConfig = {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu',
                '--disable-web-security',
                '--disable-features=IsolateOrigins',
                '--disable-site-isolation-trials',
                '--disable-blink-features=AutomationControlled',
                '--disable-extensions',
                '--disable-background-timer-throttling',
                '--disable-backgrounding-occluded-windows',
                '--disable-renderer-backgrounding'
            ],
            ignoreDefaultArgs: ['--enable-automation'],
            defaultViewport: null,
            handleSIGINT: false,
            handleSIGTERM: false,
            handleSIGHUP: false
        };

        // Set Chrome executable path
        if (chromePath) {
            puppeteerConfig.executablePath = chromePath;
        } else {
            throw new Error('Chrome executable not found. Please install Google Chrome.');
        }
        
        const authPath = path.join(app.getPath('userData'), 'wwebjs_auth');
        whatsappClient = new Client({
            authStrategy: new LocalAuth({
                clientId: sessionId,
                dataPath: authPath
            }),
            puppeteer: puppeteerConfig,
            authTimeoutMs: 120000,
            qrTimeoutMs: 60000,
            restartOnAuthFail: true,
            takeoverOnConflict: false,
            takeoverTimeoutMs: 0
        });

        // Setup event listeners
        setupClientEventListeners(whatsappClient);

        // Initialize the client with retry logic
        let retries = 3;
        let initialized = false;
        
        while (retries > 0 && !initialized) {
            try {
                console.log(`Attempting to initialize WhatsApp client... (${4 - retries}/3)`);
                await whatsappClient.initialize();
                console.log('WhatsApp client initialization started successfully');
                initialized = true;
            } catch (initError) {
                retries--;
                console.error(`Initialization attempt failed: ${initError.message}`);
                
                if (retries > 0) {
                    console.log(`Retrying in 5 seconds... (${retries} attempts remaining)`);
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    
                    // Destroy and recreate client for retry
                    if (whatsappClient) {
                        try {
                            await whatsappClient.destroy();
                        } catch (e) {
                            console.error('Error destroying client:', e.message);
                        }
                    }
                    
                    // Recreate client for retry
                    whatsappClient = new Client({
                        authStrategy: new LocalAuth({
                            clientId: sessionId,
                            dataPath: authPath
                        }),
                        puppeteer: puppeteerConfig,
                        authTimeoutMs: 120000,
                        qrTimeoutMs: 60000,
                        restartOnAuthFail: true,
                        takeoverOnConflict: false,
                        takeoverTimeoutMs: 0
                    });
                    
                    // Re-attach event listeners
                    setupClientEventListeners(whatsappClient);
                } else {
                    throw initError;
                }
            }
        }

    } catch (error) {
        console.error('Failed to initialize WhatsApp client:', error);
        clientState = 'error';
        io.emit('error', { message: error.message });
        await sendWebhook('initialization_error', { error: error.message });
        throw error;
    }
}

// API Routes

// Health check
expressApp.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Session Management APIs
// Get all sessions
expressApp.get('/api/sessions', (req, res) => {
    res.json({ sessions: sessions, currentSession: currentSessionId });
});

// Create new session
expressApp.post('/api/sessions', (req, res) => {
    try {
        const { name } = req.body;
        if (!name) {
            return res.status(400).json({ error: 'Session name is required' });
        }

        const sessionId = `session-${Date.now()}`;
        const newSession = {
            id: sessionId,
            name: name,
            createdAt: new Date().toISOString(),
            active: false
        };

        sessions.push(newSession);
        saveSessions();

        res.json({ success: true, session: newSession });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Clear session auth data (keeps session but clears authentication)
expressApp.post('/api/sessions/:sessionId/clear', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = sessions.find(s => s.id === sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Stop health check
        stopSessionHealthCheck();

        // If this is the current session, disconnect first
        if (sessionId === currentSessionId && whatsappClient) {
            try {
                await whatsappClient.destroy();
            } catch (destroyErr) {
                console.error('Error destroying client:', destroyErr.message);
            }
            whatsappClient = null;
            isClientReady = false;
            isAuthenticated = false;
            clientState = 'disconnected';
            currentSessionId = null;
            qrCodeData = null;
        }

        // Clear auth data
        clearSessionAuthData(sessionId);
        
        // Mark session as inactive
        session.active = false;
        saveSessions();

        io.emit('sessionsUpdated', { sessions: sessions });
        io.emit('status', { status: 'disconnected', message: 'Session cleared successfully' });
        res.json({ success: true, message: 'Session auth data cleared successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Force clear and reinitialize a stuck session
expressApp.post('/api/sessions/:sessionId/force-clear', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = sessions.find(s => s.id === sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        console.log(`Force clear requested for session: ${sessionId}`);
        
        // Stop health check
        stopSessionHealthCheck();
        
        // Force destroy client
        if (whatsappClient) {
            try {
                await whatsappClient.destroy();
            } catch (destroyErr) {
                console.error('Error force destroying client:', destroyErr.message);
            }
            whatsappClient = null;
        }
        
        // Reset all state
        isClientReady = false;
        isAuthenticated = false;
        clientState = 'disconnected';
        qrCodeData = null;
        currentSessionId = null;
        isReinitializing = false;
        authFailureRetries.delete(sessionId);
        
        // Clear auth data completely
        clearSessionAuthData(sessionId);
        
        // Mark session as inactive
        session.active = false;
        saveSessions();

        io.emit('sessionsUpdated', { sessions: sessions });
        io.emit('status', { status: 'disconnected', message: 'Session force-cleared. Ready to reconnect.' });
        io.emit('session-force-cleared', { sessionId: sessionId, reason: 'Manual force clear' });
        
        res.json({ success: true, message: 'Session force-cleared successfully. Please reconnect.' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get session health status
expressApp.get('/api/sessions/health', (req, res) => {
    const healthInfo = {
        currentSession: currentSessionId,
        clientState: clientState,
        isAuthenticated: isAuthenticated,
        isClientReady: isClientReady,
        isReinitializing: isReinitializing,
        sessionInitStartTime: sessionInitStartTime,
        elapsedMs: sessionInitStartTime ? Date.now() - sessionInitStartTime : null,
        healthCheckActive: sessionHealthCheckInterval !== null,
        thresholds: {
            initTimeoutMs: SESSION_INIT_TIMEOUT_MS,
            loadingTimeoutMs: SESSION_LOADING_TIMEOUT_MS,
            stuckThresholdMs: SESSION_STUCK_THRESHOLD_MS
        }
    };
    res.json(healthInfo);
});

// Delete session
expressApp.delete('/api/sessions/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        // Don't allow deleting active session
        if (sessionId === currentSessionId) {
            return res.status(400).json({ error: 'Cannot delete active session. Switch to another session first.' });
        }

        const sessionIndex = sessions.findIndex(s => s.id === sessionId);
        if (sessionIndex === -1) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Remove session data from all possible locations
        clearSessionAuthData(sessionId);

        sessions.splice(sessionIndex, 1);
        saveSessions();

        io.emit('sessionsUpdated', { sessions: sessions });
        res.json({ success: true, message: 'Session deleted successfully' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Switch session
expressApp.post('/api/sessions/switch/:sessionId', async (req, res) => {
    try {
        const { sessionId } = req.params;
        
        const session = sessions.find(s => s.id === sessionId);
        if (!session) {
            return res.status(404).json({ error: 'Session not found' });
        }

        // Stop existing health check
        stopSessionHealthCheck();

        // Disconnect current client if exists
        if (whatsappClient) {
            try {
                await whatsappClient.destroy();
            } catch (e) {
                console.error('Error destroying client during switch:', e.message);
            }
            whatsappClient = null;
            isClientReady = false;
            isAuthenticated = false;
            clientState = 'disconnected';
            qrCodeData = null;
        }

        // Start health monitoring for new session
        startSessionHealthCheck(sessionId);

        // Initialize with new session
        await initializeWhatsAppClient(sessionId);

        res.json({ success: true, message: 'Switching to session', sessionId: sessionId });
    } catch (error) {
        stopSessionHealthCheck();
        res.status(500).json({ error: error.message });
    }
});

// Update Management APIs
// Check for updates
expressApp.get('/api/updates/check', async (req, res) => {
    try {
        const result = await autoUpdater.checkForUpdates();
        res.json({
            currentVersion: app.getVersion(),
            updateAvailable: updateInfo.available,
            latestVersion: updateInfo.version,
            updateInfo: result?.updateInfo || null
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get update status
expressApp.get('/api/updates/status', (req, res) => {
    res.json({
        currentVersion: app.getVersion(),
        ...updateInfo
    });
});

// Download update
expressApp.post('/api/updates/download', async (req, res) => {
    try {
        if (!updateInfo.available) {
            return res.status(400).json({ error: 'No update available' });
        }
        
        if (updateInfo.downloaded) {
            return res.json({ success: true, message: 'Update already downloaded' });
        }

        await autoUpdater.downloadUpdate();
        res.json({ success: true, message: 'Download started' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Install update and restart
expressApp.post('/api/updates/install', (req, res) => {
    try {
        if (!updateInfo.downloaded) {
            return res.status(400).json({ error: 'No update downloaded' });
        }

        res.json({ success: true, message: 'Installing update and restarting...' });
        
        // Give the response time to send
        setTimeout(() => {
            autoUpdater.quitAndInstall(false, true);
        }, 1000);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get status
expressApp.get('/api/status', verifyDeviceToken, async (req, res) => {
    let clientInfo = null;
    if (isClientReady && whatsappClient && whatsappClient.info) {
        clientInfo = {
            pushname: whatsappClient.info.pushname,
            number: whatsappClient.info.wid?.user,
            platform: whatsappClient.info.platform
        };
    }
    

    res.json({
        state: clientState,
        authenticated: isAuthenticated,
        ready: isClientReady,
        qr: qrCodeData,
        clientInfo: clientInfo,
        pushname: clientInfo?.pushname
    });
});

// Get QR code
expressApp.get('/api/qr', verifyDeviceToken, (req, res) => {
    if (qrCodeData) {
        res.json({ qr: qrCodeData });
    } else {
        res.status(404).json({ error: 'No QR code available' });
    }
});

// Logout
expressApp.post('/api/logout', verifyDeviceToken, async (req, res) => {
    try {
        if (whatsappClient) {
            await whatsappClient.logout();
            res.json({ success: true, message: 'Logged out successfully' });
        } else {
            res.status(400).json({ error: 'Client not initialized' });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get chats
expressApp.get('/api/chats', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        let chatList = [];
        
        try {
            // Try to get chats using a more robust direct method
            const rawChats = await whatsappClient.pupPage.evaluate(async () => {
                const chats = window.Store.Chat.getModelsArray();
                return chats.map(chat => {
                    try {
                        const lastMsg = chat.lastReceivedKey 
                            ? window.Store.Msg.get(chat.lastReceivedKey._serialized) 
                            : null;
                        
                        return {
                            id: chat.id?._serialized || '',
                            name: chat.name || chat.formattedTitle || chat.contact?.pushname || chat.contact?.name || 'Unknown',
                            isGroup: chat.isGroup || false,
                            unreadCount: chat.unreadCount || 0,
                            timestamp: chat.t || Date.now() / 1000,
                            archived: chat.archive || false,
                            pinned: chat.pin ? true : false,
                            isMuted: chat.mute?.expiration !== 0,
                            isReadOnly: chat.isReadOnly || false,
                            lastMessage: lastMsg ? {
                                body: lastMsg.body || '',
                                timestamp: lastMsg.t || Date.now() / 1000,
                                from: lastMsg.from?._serialized || '',
                                fromMe: lastMsg.id?.fromMe || false
                            } : null
                        };
                    } catch (e) {
                        return {
                            id: chat.id?._serialized || '',
                            name: chat.name || 'Unknown',
                            isGroup: false,
                            unreadCount: 0,
                            timestamp: Date.now() / 1000,
                            archived: false,
                            pinned: false,
                            isMuted: false,
                            isReadOnly: false,
                            lastMessage: null
                        };
                    }
                });
            });
            
            chatList = rawChats.filter(c => c && c.id);
            console.log(`Loaded ${chatList.length} chats successfully`);
            
        } catch (directError) {
            console.error('Direct chat fetch failed:', directError.message);
            
            // Fallback: try the standard method with individual error handling
            try {
                const chats = await whatsappClient.getChats();
                for (const chat of chats) {
                    try {
                        const chatId = chat.id?._serialized || chat.id?.user || '';
                        const lastMsg = chat.lastMessage || null;
                        
                        chatList.push({
                            id: chatId,
                            name: chat.name || chat.pushname || chat.formattedTitle || 'Unknown',
                            isGroup: chat.isGroup || false,
                            unreadCount: chat.unreadCount || 0,
                            timestamp: chat.timestamp || chat.t || Date.now(),
                            archived: chat.archived || chat.archive || false,
                            pinned: chat.pinned || chat.pin || false,
                            isMuted: chat.isMuted || false,
                            isReadOnly: chat.isReadOnly || false,
                            lastMessage: lastMsg ? {
                                body: lastMsg.body || '',
                                timestamp: lastMsg.timestamp || Date.now(),
                                from: lastMsg.from || '',
                                fromMe: lastMsg.fromMe || false
                            } : null
                        });
                    } catch (chatError) {
                        console.warn('Error processing individual chat:', chatError.message);
                    }
                }
            } catch (fallbackError) {
                console.error('Fallback chat fetch also failed:', fallbackError.message);
                return res.status(500).json({ error: 'Failed to load chats. Please try reconnecting.' });
            }
        }

        res.json({ chats: chatList });
    } catch (error) {
        console.error('Get chats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get Message by ID
expressApp.get('/api/message/:messageId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }
        const { messageId } = req.params;
        const withMedia = req.query.withMedia == 'true';
        const message = await whatsappClient.getMessageById(messageId);
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        const messageData = {
            id: message.id._serialized,
            body: message.body,
            from: message.from,
            to: message.to,
            fromMe: message.fromMe,
            timestamp: message.timestamp,
            hasMedia: message.hasMedia,
            type: message.type,
            ack: message.ack
        };
        // Download media if available
        if (message.hasMedia && withMedia === true) {
            try {
                const media = await message.downloadMedia();
                messageData.media = {
                    data: media.data,
                    mimetype: media.mimetype,
                    filename: media.filename
                };
                console.log(`Media downloaded for message ${message.id._serialized}`);         

            } catch (mediaError) {
                console.error(`Failed to download media for message ${message.id._serialized}:`, mediaError);
                messageData.mediaError = 'Failed to download media';
            }
        }
        res.json({ message: messageData });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get messages from a chat
expressApp.get('/api/messages/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const limit = parseInt(req.query.limit) || 50;
        const withMedia = req.query.withMedia === 'true';
        console.log(`Fetching up to ${limit} messages from chat ${chatId} (withMedia=${withMedia})`);
        const chat = await whatsappClient.getChatById(chatId);
        const messages = await chat.fetchMessages({ limit: limit });
        // Process messages and download media
        const messageList = [];
        
        for (const msg of messages) {
            const messageData = {
                id: msg.id._serialized,
                body: msg.body,
                from: msg.from,
                to: msg.to,
                fromMe: msg.fromMe,
                timestamp: msg.timestamp,
                hasMedia: msg.hasMedia,
                type: msg.type,
                ack: msg.ack
            };

            // Download media if available - call on original msg object
            if (msg.hasMedia && withMedia === true) {
                try {
                    const media = await msg.downloadMedia();
                    messageData.media = {
                        data: media.data,
                        mimetype: media.mimetype,
                        filename: media.filename
                    };
                } catch (mediaError) {
                    console.error(`Failed to download media for message ${msg.id._serialized}:`, mediaError);
                    messageData.mediaError = 'Failed to download media';
                }
            }

            messageList.push(messageData);
        }

        res.json({ messages: messageList });
    } catch (error) {
        res.status(500).json({ error: error + " Errors" });
    }
});

// Send text message
expressApp.post('/api/send-message', verifyDeviceToken, async (req, res) => {
    try {
        console.log('Send message request:', req.body);
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { number, chatId: providedChatId, message } = req.body;
        const recipient = providedChatId || number;

        if (!recipient || !message) {
            return res.status(400).json({ error: 'Number/chatId and message are required' });
        }

        // Format number to WhatsApp format
        const chatId = recipient.includes('@') ? recipient : `${recipient}@c.us`;

        // Verify chat exists before sending
        let chat = null;
        try {
            chat = await whatsappClient.getChatById(chatId);
        } catch (chatError) {
            console.warn('Chat not found, will attempt to send anyway:', chatError.message);
        }

        console.log('Sending message:');

        const sentMessage = await whatsappClient.sendMessage(chatId, message, {
            sendSeen: false
        });

        const messageId = sentMessage.id?._serialized || sentMessage.id || 'unknown';
        
        res.json({
            success: true,
            messageId: messageId,
            timestamp: sentMessage.timestamp
        });

        await handleMsgWebhook(sentMessage, 'message_sent');

    } catch (error) {
        console.error('Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Send button message
expressApp.post('/api/send-buttons', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        req.body = {
            "number": "201096869285",
            "text": "Welcome to Medians 👋\nHow can we help you?",
            "footer": "Medians Support",
            "buttons": [
                "📦 Track Order",
                "💬 Talk to Agent",
                "❌ Cancel"
            ]
        };

        const { number, text, footer, buttons } = req.body;

        if (!number || !text || !buttons || !buttons.length) {
            return res.status(400).json({ error: 'number, text and buttons are required' });
        }

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;

        const btns = buttons.map((b, i) => ({
            buttonId: `btn_${i}`,
            buttonText: { displayText: b },
            type: 1
        }));

        const buttonMessage = new Buttons(
            text,
            btns,
            'Choose an option',
            footer || ''
        );

        const sent = await whatsappClient.sendMessage(chatId, buttonMessage);

        res.json({
            success: true,
            messageId: sent.id._serialized
        });

    } catch (error) {
        console.error('Button send error:', error);
        res.status(500).json({ error: error.message });
    }
});


// Send media message
expressApp.post('/api/send-media', verifyDeviceToken, upload.single('file'), async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { number, caption } = req.body;
        const file = req.file;

        if (!number || !file) {
            return res.status(400).json({ error: 'Number and file are required' });
        }

        const chatId = number.includes('@c.us') ? number : `${number}@c.us`;
        
        const media = MessageMedia.fromFilePath(file.path);
        const sentMessage = await whatsappClient.sendMessage(chatId, media, {
            caption: caption || ''
        });

        // Clean up uploaded file
        fs.unlinkSync(file.path);

        res.json({
            success: true,
            messageId: sentMessage.id._serialized,
            timestamp: sentMessage.timestamp
        });

        await handleMsgWebhook(sentMessage, 'media_sent');

    } catch (error) {
        if (req.file) {
            fs.unlinkSync(req.file.path);
        }
        res.status(500).json({ error: error.message });
    }
});

// Get contacts
expressApp.get('/api/contacts', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const contacts = await whatsappClient.getContacts();
        const contactList = contacts.map(contact => ({
            id: contact.id._serialized,
            name: contact.name,
            pushname: contact.pushname,
            number: contact.number,
            isMyContact: contact.isMyContact,
            isBlocked: contact.isBlocked
        }));

        res.json({ contacts: contactList });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get contact by number
expressApp.get('/api/contact/:number', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { number } = req.params;
        const contactId = number.includes('@c.us') ? number : `${number}@c.us`;

        const contact = await whatsappClient.getContactById(contactId);

        res.json({
            id: contact.id._serialized,
            name: contact.name,
            pushname: contact.pushname,
            number: contact.number,
            isMyContact: contact.isMyContact,
            isBlocked: contact.isBlocked
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mark chat as read
expressApp.post('/api/mark-read/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        
        if (!chatId) {
            return res.status(400).json({ error: 'Chat ID is required' });
        }

        const chat = await whatsappClient.getChatById(chatId);
        
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }

        // Check if sendSeen method exists
        if (typeof chat.sendSeen === 'function') {
            // await chat.sendSeen();
        } else {
            console.warn('sendSeen method not available for chat:', chatId);
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Mark read error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get profile picture
expressApp.get('/api/profile-pic/:contactId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { contactId } = req.params;
        const profilePicUrl = await whatsappClient.getProfilePicUrl(contactId);

        res.json({ url: profilePicUrl || null });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Check if number is registered on WhatsApp
expressApp.get('/api/check-number/:phone', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { phone } = req.params;
        const numberId = await whatsappClient.getNumberId(phone);

        if (numberId) {
            res.json({
                isRegistered: true,
                number: numberId._serialized,
                user: numberId.user
            });
        } else {
            res.json({
                isRegistered: false,
                number: phone
            });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ========================================================================
// WEBHOOK CONFIGURATION ROUTES
// ========================================================================

// Webhook config file path
const webhookConfigFile = path.join(__dirname, 'webhook-config.json');

// Load webhook config
function loadWebhookConfig() {
    if (fs.existsSync(webhookConfigFile)) {
        try {
            return JSON.parse(fs.readFileSync(webhookConfigFile, 'utf-8'));
        } catch (err) {
            console.error('Error loading webhook config:', err);
        }
    }
    return { url: '', token: '', enabled: false };
}

// Save webhook config
function saveWebhookConfig(config) {
    try {
        fs.writeFileSync(webhookConfigFile, JSON.stringify(config, null, 2));
        return true;
    } catch (err) {
        console.error('Error saving webhook config:', err);
        return false;
    }
}

// Get webhook configuration
expressApp.get('/api/webhook-config', verifyDeviceToken, (req, res) => {
    const config = loadWebhookConfig();
    res.json(config);
});

// Save webhook configuration
expressApp.post('/api/webhook-config', verifyDeviceToken, (req, res) => {
    const { url, token, enabled } = req.body;
    
    const config = {
        url: url || '',
        token: token || '',
        enabled: enabled === true
    };
    
    if (saveWebhookConfig(config)) {
        // Update global webhook settings
        process.env.WEBHOOK_URL = config.enabled ? config.url : '';
        process.env.WEBHOOK_TOKEN = config.token;
        res.json({ success: true, message: 'Webhook configuration saved' });
    } else {
        res.status(500).json({ error: 'Failed to save webhook configuration' });
    }
});

// Test webhook
expressApp.post('/api/webhook-test', verifyDeviceToken, async (req, res) => {
    const config = loadWebhookConfig();
    
    if (!config.url) {
        return res.status(400).json({ error: 'Webhook URL not configured' });
    }
    
    try {
        await axios.post(config.url, {
            event: 'test',
            data: { message: 'Webhook test from BedayaWhatsApp' },
            timestamp: new Date().toISOString()
        }, {
            headers: {
                'Content-Type': 'application/json',
                'X-Webhook-Token': config.token || ''
            },
            timeout: 10000
        });
        
        res.json({ success: true, message: 'Test webhook sent successfully' });
    } catch (error) {
        res.status(500).json({ error: `Webhook test failed: ${error.message}` });
    }
});

// ========================================================================
// AUTH ROUTES (for app.js compatibility)
// ========================================================================

// Generate new device token
expressApp.post('/api/auth/generate-token', verifyAdminToken, (req, res) => {
    const { deviceName } = req.body;

    if (!deviceName) {
        return res.status(400).json({ error: 'Device name is required' });
    }

    if (registeredDevices.length >= MAX_DEVICES) {
        return res.status(400).json({ error: 'Maximum number of devices reached' });
    }

    const deviceId = crypto.randomBytes(16).toString('hex');
    const token = generateDeviceToken();

    const device = {
        id: deviceId,
        name: deviceName,
        token: token,
        active: true,
        createdAt: new Date().toISOString(),
        activatedAt: new Date().toISOString(),
        lastUsed: new Date().toISOString()
    };

    registeredDevices.push(device);
    saveDevices();

    res.json({
        success: true,
        token: token,
        deviceId: deviceId,
        deviceName: deviceName
    });
});

// Get all devices (for app.js compatibility)
expressApp.get('/api/auth/devices', verifyAdminToken, (req, res) => {
    const devices = registeredDevices.map(d => ({
        id: d.id,
        deviceName: d.name,
        isAdmin: d.name === 'admin' || d.id === registeredDevices[0]?.id,
        active: d.active,
        createdAt: d.createdAt,
        lastUsed: d.lastUsed || d.activatedAt || d.createdAt
    }));

    res.json({
        devices: devices,
        count: devices.length,
        maxDevices: MAX_DEVICES
    });
});

// ========================================================================
// CHAT OPERATIONS
// ========================================================================

// Archive chat
expressApp.post('/api/archive-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.archive();

        res.json({ success: true, message: 'Chat archived' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unarchive chat
expressApp.post('/api/unarchive-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.unarchive();

        res.json({ success: true, message: 'Chat unarchived' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Pin chat
expressApp.post('/api/pin-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.pin();

        res.json({ success: true, message: 'Chat pinned' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unpin chat
expressApp.post('/api/unpin-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.unpin();

        res.json({ success: true, message: 'Chat unpinned' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Mute chat
expressApp.post('/api/mute-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const { duration } = req.body; // duration in seconds, null for forever
        const chat = await whatsappClient.getChatById(chatId);
        
        const unmuteDate = duration ? new Date(Date.now() + duration * 1000) : null;
        await chat.mute(unmuteDate);

        res.json({ success: true, message: 'Chat muted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Unmute chat
expressApp.post('/api/unmute-chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.unmute();

        res.json({ success: true, message: 'Chat unmuted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete chat
expressApp.delete('/api/chat/:chatId', verifyDeviceToken, async (req, res) => {
    try {
        if (!isClientReady) {
            return res.status(400).json({ error: 'Client not ready' });
        }

        const { chatId } = req.params;
        const chat = await whatsappClient.getChatById(chatId);
        await chat.delete();

        res.json({ success: true, message: 'Chat deleted' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Device Management Routes (Admin only)

// Request device activation
expressApp.post('/api/admin/request-device', verifyAdminToken, (req, res) => {
    const { deviceName } = req.body;

    if (!deviceName) {
        return res.status(400).json({ error: 'Device name is required' });
    }

    if (registeredDevices.length >= MAX_DEVICES) {
        return res.status(400).json({ error: 'Maximum number of devices reached' });
    }

    const otp = generateOTP();
    const deviceId = crypto.randomBytes(16).toString('hex');

    const device = {
        id: deviceId,
        name: deviceName,
        otp: otp,
        otpExpiry: Date.now() + (5 * 60 * 1000), // 5 minutes
        token: null,
        active: false,
        createdAt: new Date().toISOString()
    };

    registeredDevices.push(device);
    saveDevices();

    res.json({
        success: true,
        deviceId: deviceId,
        otp: otp,
        expiresIn: 300 // seconds
    });
});

// Activate device with OTP
expressApp.post('/api/admin/activate-device', verifyAdminToken, (req, res) => {
    const { deviceId, otp } = req.body;

    if (!deviceId || !otp) {
        return res.status(400).json({ error: 'Device ID and OTP are required' });
    }

    const device = registeredDevices.find(d => d.id === deviceId);

    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }

    if (device.active) {
        return res.status(400).json({ error: 'Device already activated' });
    }

    if (Date.now() > device.otpExpiry) {
        return res.status(400).json({ error: 'OTP expired' });
    }

    if (device.otp !== otp.toUpperCase()) {
        return res.status(400).json({ error: 'Invalid OTP' });
    }

    // Activate device
    device.token = generateDeviceToken();
    device.active = true;
    device.activatedAt = new Date().toISOString();
    delete device.otp;
    delete device.otpExpiry;

    saveDevices();

    res.json({
        success: true,
        token: device.token,
        deviceId: device.id,
        deviceName: device.name
    });
});

// List all devices
expressApp.get('/api/admin/devices', verifyAdminToken, (req, res) => {
    const devices = registeredDevices.map(d => ({
        id: d.id,
        name: d.name,
        active: d.active,
        createdAt: d.createdAt,
        activatedAt: d.activatedAt || null
    }));

    res.json({ devices: devices });
});

// Deactivate device
expressApp.post('/api/admin/deactivate-device', verifyAdminToken, (req, res) => {
    const { deviceId } = req.body;

    if (!deviceId) {
        return res.status(400).json({ error: 'Device ID is required' });
    }

    const device = registeredDevices.find(d => d.id === deviceId);

    if (!device) {
        return res.status(404).json({ error: 'Device not found' });
    }

    device.active = false;
    saveDevices();

    res.json({ success: true, message: 'Device deactivated' });
});

// Delete device
expressApp.delete('/api/admin/device/:deviceId', verifyAdminToken, (req, res) => {
    const { deviceId } = req.params;

    const index = registeredDevices.findIndex(d => d.id === deviceId);

    if (index === -1) {
        return res.status(404).json({ error: 'Device not found' });
    }

    registeredDevices.splice(index, 1);
    saveDevices();

    res.json({ success: true, message: 'Device deleted' });
});

// Electron App

let splashWindow = null;

function createSplashScreen() {
    splashWindow = new BrowserWindow({
        width: 600,
        height: 400,
        transparent: true,
        frame: false,
        alwaysOnTop: true,
        resizable: false,
        skipTaskbar: false,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        },
        icon: path.join(__dirname, 'icon.png'),
        backgroundColor: '#0a1014'
    });

    splashWindow.loadFile(path.join(__dirname, 'splash.html'));
    splashWindow.center();
    splashWindow.show();
}

function closeSplashScreen() {
    if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1400,
        height: 900,
        minWidth: 1000,
        minHeight: 600,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.js')
        },
        icon: path.join(__dirname, 'icon.png'),
        frame: true,
        backgroundColor: '#0a1014',
        show: false
    });

    mainWindow.loadURL(`http://localhost:${PORT}`);

    mainWindow.once('ready-to-show', () => {
        // Close splash screen and show main window
        closeSplashScreen();
        mainWindow.show();
    });

    mainWindow.on('close', (event) => {
        if (!app.isQuitting) {
            event.preventDefault();
            mainWindow.hide();
        }
        return false;
    });

    mainWindow.on('closed', () => {
        mainWindow = null;
    });

    // Open external links in browser
    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
    });

    // IPC Handlers for updates
    ipcMain.handle('check-for-updates', async () => {
        try {
            const result = await autoUpdater.checkForUpdates();
            return {
                success: true,
                currentVersion: app.getVersion(),
                updateAvailable: updateInfo.available,
                updateInfo: result?.updateInfo || null
            };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('download-update', async () => {
        try {
            await autoUpdater.downloadUpdate();
            return { success: true };
        } catch (error) {
            return { success: false, error: error.message };
        }
    });

    ipcMain.handle('install-update', () => {
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
    });

    ipcMain.handle('get-app-version', () => {
        return app.getVersion();
    });
}

async function handleMsgWebhook(message, event)
{
    
        try {
            const webhookData = {
                from: message.from,
                to: message.to,
                body: message.body,
                caption: message.hasMedia ? (message._data.caption || '') : '',
                direction: message.fromMe ? 'outgoing' : 'incoming',
                timestamp: message.timestamp,
                notifyName: message._data.notifyName || '',
                hasMedia: message.hasMedia,
                type: message.type,
                id: message.id._serialized
            };

            // Handle different message types
            if (message.hasMedia) {
                try {
                    const media = await message.downloadMedia();
                    if (media) {
                        webhookData.body = media.data; // base64 encoded media
                        webhookData.mediaType = media.mimetype;
                        webhookData.mediaFilename = media.filename || '';
                    }
                } catch (mediaError) {
                    console.error('Error downloading media:', mediaError);
                }
            } else if (message.type === 'location' && message.location) {
                webhookData.location = {
                    latitude: message.location.latitude,
                    longitude: message.location.longitude,
                    description: message.location.description || ''
                };
            } else if (message.type === 'vcard' || message.type === 'contact_card' || message.type === 'contact_card_multi') {
                webhookData.vcard = message.body;
                webhookData.contacts = message._data.vcardList || [message.body];
            } else if (message.type === 'poll_creation') {
                webhookData.pollName = message._data.pollName || '';
                webhookData.pollOptions = message._data.pollOptions || [];
            }

            await sendWebhook(event, webhookData);
        } catch (error) {
            console.error('Error processing message webhook:', error);
        }
}


function createTray() {
    const iconPath = path.join(__dirname, 'icon.png');
   
    if (!fs.existsSync(iconPath)) {
        console.error('Tray icon not found:', iconPath);
        return;
    }

    const trayIcon = nativeImage.createFromPath(iconPath);

    if (trayIcon.isEmpty()) {
        console.error('Tray icon failed to load (invalid image):', iconPath);
        return;
    }

    tray = new Tray(trayIcon);
    const contextMenu = Menu.buildFromTemplate([
        {
            label: 'Show App',
            click: () => {
                if (mainWindow) {
                    mainWindow.show();
                }
            }
        },
        {
            label: 'Hide App',
            click: () => {
                if (mainWindow) {
                    mainWindow.hide();
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Check for Updates',
            click: async () => {
                try {
                    await autoUpdater.checkForUpdates();
                } catch (error) {
                    console.log('Update check failed:', error.message);
                }
            }
        },
        { type: 'separator' },
        {
            label: 'Quit',
            click: () => {
                app.isQuitting = true;
                app.quit();
            }
        }
    ]);

    tray.setToolTip('BedayaWhatsApp');
    tray.setContextMenu(contextMenu);

    tray.on('double-click', () => {
        if (mainWindow) {
            mainWindow.show();
        }
    });
}

// App ready
app.whenReady().then(async () => {
    try {
        // Load devices and sessions
        loadDevices();
        loadSessions();

        // Start Express server
        server.listen({
            port: PORT,
            reuseAddress: true
        }, () => {
            console.log(`Server running on http://localhost:${PORT}`);
        });

        // Show splash screen immediately
        createSplashScreen();

        // Don't auto-initialize - wait for user to select session
        // The client will request session list and choose one
        
        // Create Electron window (will load in background while splash shows)
        createWindow();
        createTray();

        // Check for updates after a delay (give app time to fully load)
        setTimeout(() => {
            if (!process.env.DEV) { // Don't check in dev mode
                console.log('Checking for updates...');
                autoUpdater.checkForUpdates().catch(err => {
                    console.log('Update check failed (this is normal in dev):', err.message);
                });
            }
        }, 5000);

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) {
                createWindow();
            }
        });

    } catch (error) {
        console.error('Error during app initialization:', error);
        app.quit();
    }
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        // Don't quit, just hide
    }
    if (server) server.close();
    app.quit();
});

app.on('before-quit', () => {
    app.isQuitting = true;
    server.close(() => {
        console.log('Server closed');
    });
});

// Handle IPC messages
ipcMain.on('minimize', () => {
    if (mainWindow) {
        mainWindow.minimize();
    }
});

ipcMain.on('maximize', () => {
    if (mainWindow) {
        if (mainWindow.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow.maximize();
        }
    }
});

ipcMain.on('close', () => {
    if (mainWindow) {
        mainWindow.hide();
    }
});
