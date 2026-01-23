# ChromWhatsApp

Professional WhatsApp Desktop Application with full API and Webhook support. Built with Electron for cross-platform desktop use, featuring a modern dark theme UI inspired by WhatsApp Web.

## Features

### 🖥️ Desktop Application
- Cross-platform: Windows, macOS, Linux
- System tray support with minimized operation
- Native desktop notifications
- Portable and installer versions available
- In-app automatic updates (no reinstall required)

### 💬 Full Chat Functionality
- Real-time messaging with Socket.IO
- Send/receive text messages
- Send/receive media (images, videos, documents, audio)
- Message status indicators (sent, delivered, read)
- Chat search and filtering
- Archive, mute, pin, and delete chats
- New chat with phone number validation

### � Multiple Session Management
- Create and manage multiple WhatsApp sessions
- Switch between different accounts easily
- Session selection screen on startup
- Independent session data storage
- Delete unused sessions
- Visual session management interface

### �🔌 Complete REST API
All WhatsApp features are accessible via REST API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/status` | GET | Get connection status |
| `/api/chats` | GET | Get chat list |
| `/api/messages/:chatId` | GET | Get messages from chat |
| `/api/send-message` | POST | Send text message |
| `/api/send-media` | POST | Send media with file upload |
| `/api/send-media-url` | POST | Send media from URL |
| `/api/contacts` | GET | Get contacts list |
| `/api/conversations` | GET | Get paginated conversations |
| `/api/check-number/:phone` | GET | Check if number is on WhatsApp |
| `/api/chat/:chatId` | GET | Get chat info |
| `/api/chat/:chatId/archive` | POST | Archive chat |
| `/api/chat/:chatId/unarchive` | POST | Unarchive chat |
| `/api/chat/:chatId/mute` | POST | Mute chat |
| `/api/chat/:chatId/unmute` | POST | Unmute chat |
| `/api/chat/:chatId/pin` | POST | Pin chat |
| `/api/chat/:chatId/unpin` | POST | Unpin chat |
| `/api/chat/:chatId` | DELETE | Delete chat |
| `/api/mark-read/:chatId` | POST | Mark chat as read |
| `/api/search` | GET | Search messages |
| `/api/logout` | POST | Logout from WhatsApp |
| `/api/restart` | POST | Restart WhatsApp client |

#### Session Management
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/sessions` | GET | Get all sessions |
| `/api/sessions` | POST | Create new session |
| `/api/sessions/:sessionId` | DELETE | Delete session |
| `/api/sessions/switch/:sessionId` | POST | Switch to session |

#### Software Updates
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/updates/check` | GET | Check for updates |
| `/api/updates/status` | GET | Get update status |
| `/api/updates/download` | POST | Download update |
| `/api/updates/install` | POST | Install update & restart |

### 🔐 Authentication System
- Token-based API authentication
- Admin and device tokens
- OTP-based device activation
- Multi-device support (configurable limit)
- Token expiration support

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/auth/info` | GET | Get auth configuration |
| `/api/auth/request-otp` | POST | Request OTP (admin) |
| `/api/auth/activate` | POST | Activate device with OTP |
| `/api/auth/devices` | GET | List authorized devices |
| `/api/auth/generate-token` | POST | Generate new token |
| `/api/auth/revoke/:tokenPrefix` | DELETE | Revoke token |

### 🔔 Webhook System
Receive real-time notifications for all WhatsApp events:

- `message` - Incoming messages
- `message_sent` - Outgoing messages
- `message_ack` - Message acknowledgements
- `qr_code` - QR code generated
- `authenticated` - Successfully authenticated
- `ready` - Client ready
- `disconnected` - Client disconnected

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/webhook-config` | GET | Get webhook configuration |
| `/api/webhook-config` | POST | Update webhook configuration |
| `/api/webhook-test` | POST | Send test webhook |

## Installation

### Prerequisites
- Node.js 18+ 
- npm or yarn

### Setup

1. **Clone or navigate to the directory:**
```bash
cd ChromWhatsApp
```

2. **Install dependencies:**
```bash
npm install
```

3. **Configure environment (optional):**
```bash
cp .env.example .env
# Edit .env with your settings
```

4. **Run the application:**
```bash
# Run as Electron desktop app
npm start

# Run as development with auto-reload
npm run dev

# Run as server only (no Electron window)
npm run server
```

## Building for Distribution

### Windows
```bash
# Build NSIS installer
npm run build:win

# Build portable version
npm run build:portable
```

### macOS
```bash
npm run build:mac
```

### Linux
```bash
npm run build:linux
```

Built applications will be in the `dist/` folder.

## Software Updates

ChromWhatsApp includes an in-app automatic update system. See [AUTO_UPDATE.md](AUTO_UPDATE.md) for complete documentation.

### For Users

**Automatic Updates:**
1. App checks for updates on startup
2. Notification appears when update is available
3. Click "Download Update" to download in background
4. Click "Install & Restart" when ready

**Manual Check:**
- Settings → Software Updates → "Check for Updates"
- System Tray → "Check for Updates"

**Features:**
- No reinstall required
- Updates in background
- View release notes before updating
- Choose when to install

### For Developers

**Publishing Updates:**
```bash
# 1. Update version in package.json
# 2. Build application
npm run build:win  # or build:mac, build:linux

# 3. Create GitHub release with tag (e.g., v2.1.0)
# 4. Upload built files from dist/ folder
# 5. Users automatically receive update notification
```

**API Endpoints:**
- `GET /api/updates/check` - Check for updates
- `GET /api/updates/status` - Get current update status
- `POST /api/updates/download` - Download update
- `POST /api/updates/install` - Install and restart

For detailed implementation, see [AUTO_UPDATE.md](AUTO_UPDATE.md).

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | 3030 | Server port |
| `HOST` | 127.0.0.1 | Server host |
| `AUTH_ENABLED` | true | Enable API authentication |
| `ADMIN_TOKEN` | medians | Admin authentication token |
| `MAX_DEVICES` | 10 | Maximum authorized devices |
| `WEBHOOK_ENABLED` | false | Enable webhook notifications |
| `WEBHOOK_URL` | - | Webhook endpoint URL |
| `WEBHOOK_TOKEN` | - | Webhook authentication token |

## API Usage Examples

### Send a Text Message
```javascript
fetch('http://localhost:3030/api/send-message', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-auth-token': 'medians'
    },
    body: JSON.stringify({
        chatId: '1234567890@c.us',
        message: 'Hello from ChromWhatsApp!'
    })
});
```

### Send a Message by Phone Number
```javascript
fetch('http://localhost:3030/api/send-message', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-auth-token': 'medians'
    },
    body: JSON.stringify({
        phone: '1234567890',
        message: 'Hello!'
    })
});
```

### Send Media from URL
```javascript
fetch('http://localhost:3030/api/send-media-url', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-auth-token': 'medians'
    },
    body: JSON.stringify({
        phone: '1234567890',
        url: 'https://example.com/image.jpg',
        caption: 'Check out this image!'
    })
});
```

### Check if Number is on WhatsApp
```javascript
fetch('http://localhost:3030/api/check-number/1234567890', {
    headers: {
        'x-auth-token': 'medians'
    }
});
```

### Configure Webhook
```javascript
fetch('http://localhost:3030/api/webhook-config', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-auth-token': 'medians'
    },
    body: JSON.stringify({
        url: 'https://your-server.com/webhook',
        token: 'your-secret-token',
        enabled: true
    })
});
```

### Session Management

#### Get All Sessions
```javascript
fetch('http://localhost:3030/api/sessions')
    .then(res => res.json())
    .then(data => console.log(data.sessions));
```

#### Create New Session
```javascript
fetch('http://localhost:3030/api/sessions', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json'
    },
    body: JSON.stringify({
        name: 'Work Account'
    })
});
```

#### Switch to Session
```javascript
fetch('http://localhost:3030/api/sessions/switch/session-123456', {
    method: 'POST'
});
```

#### Delete Session
```javascript
fetch('http://localhost:3030/api/sessions/session-123456', {
    method: 'DELETE'
});
```

## Webhook Payload Format

```json
{
    "event": "message",
    "data": {
        "id": "message_id",
        "body": "Hello!",
        "from": "1234567890@c.us",
        "to": "0987654321@c.us",
        "chatId": "1234567890@c.us",
        "timestamp": 1705000000,
        "fromMe": false,
        "hasMedia": false,
        "type": "chat",
        "senderName": "John Doe"
    },
    "timestamp": 1705000000000,
    "source": "ChromWhatsApp"
}
```

## Project Structure

```
ChromWhatsApp/
├── main.js              # Main Electron + Express server
├── preload.js           # Electron preload script
├── package.json         # Project configuration
├── .env                 # Environment variables
├── .env.example         # Example environment file
├── devices.json         # Registered devices
├── sessions.json        # Session management
├── .wwebjs_auth/        # WhatsApp session data (multi-session)
└── public/              # Frontend assets
    ├── index.html       # Main HTML
    ├── app.js           # Client JavaScript
    ├── styles.css       # Styles
    └── icon.png         # App icon
```

## Using Multiple Sessions

ChromWhatsApp now supports multiple WhatsApp sessions, allowing you to manage multiple accounts from a single application.

### On First Launch
1. The app will display a **Session Selection Screen**
2. You'll see the default session or create a new one
3. Click "Create New Session" to add additional accounts
4. Select a session to connect your WhatsApp account

### Session Features
- **Multiple Accounts**: Run multiple WhatsApp accounts independently
- **Easy Switching**: Switch between sessions without logging out
- **Data Isolation**: Each session has its own authentication and chat data
- **Visual Management**: See all sessions with creation dates and last used times
- **Session Deletion**: Remove unused sessions and their data

### Session Data Storage
Each session stores its data in `.wwebjs_auth/session-{sessionId}/`:
- Authentication tokens
- Chat history cache
- Media files
- Browser profile data

## Security Notes

1. **Change the default admin token** in production
2. **Use HTTPS** when exposing the API externally
3. **Configure CORS** appropriately for your use case
4. **Protect your webhook endpoint** with token validation
5. **Session data** is stored in `.wwebjs_auth/` - keep this secure

## Troubleshooting

### QR Code not appearing
- Check if Puppeteer/Chrome is properly installed
- Try running with `--no-sandbox` flag enabled (already configured)

### Message sending fails
- Ensure the phone number includes country code
- Check if the number is registered on WhatsApp

### Electron window not showing
- Check console for errors
- Try running `npm run server` to test the server alone

## License

MIT License - See LICENSE file for details.

## Disclaimer

This project is not affiliated with WhatsApp or Meta. Use responsibly and in accordance with WhatsApp's Terms of Service.
#   m e d i a n s - w h a t s a p p - a p p  
 