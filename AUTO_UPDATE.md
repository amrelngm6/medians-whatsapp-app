# In-App Update System - BedayaWhatsApp

## Overview
BedayaWhatsApp now includes a fully-featured automatic update system that allows users to update the application without reinstalling. The system uses `electron-updater` to provide seamless updates directly from the app.

## Features

✅ **Automatic Update Checking** - Checks for updates on app startup
✅ **Manual Update Check** - Users can manually check via Settings or menu
✅ **Download Progress** - Real-time download progress with speed and size
✅ **One-Click Install** - Install and restart with a single click
✅ **Release Notes** - View what's new before updating
✅ **Background Updates** - Downloads in the background without interrupting work
✅ **API Support** - Full REST API for programmatic updates

## How It Works

### 1. Update Detection
- App checks for updates 5 seconds after startup (production only)
- Users can manually check via:
  - Settings → Software Updates → "Check for Updates"
  - System Tray → "Check for Updates"
  - API endpoint: `GET /api/updates/check`

### 2. Update Notification
When an update is available:
- Update modal automatically appears
- Shows new version number and release notes
- Provides "Download Update" button
- Can be dismissed with "Later" button

### 3. Download Process
- Click "Download Update" to start
- Progress bar shows download status
- Displays download speed and size
- Download happens in background

### 4. Installation
- When download completes, "Install & Restart" button appears
- Click to install update and restart app
- App closes, updates, and reopens automatically
- All session data is preserved

## User Interface

### Update Modal
Located in the main app window:
- **Version Information**: Shows current and new version
- **Release Notes**: Lists new features and bug fixes
- **Progress Bar**: Visual download progress
- **Download Stats**: Speed (MB/s) and size (MB)
- **Action Buttons**:
  - Download Update
  - Install & Restart
  - Later (dismiss)

### Settings Panel
Software Updates section includes:
- Current version display
- Update status indicator
- "Check for Updates" button

### System Tray
Tray menu includes:
- "Check for Updates" option
- Quick access without opening app

## API Reference

### Check for Updates
```http
GET /api/updates/check
```

**Response:**
```json
{
  "currentVersion": "2.0.0",
  "updateAvailable": true,
  "latestVersion": "2.1.0",
  "updateInfo": {
    "version": "2.1.0",
    "releaseNotes": "New features...",
    "releaseDate": "2026-01-23T00:00:00.000Z"
  }
}
```

### Get Update Status
```http
GET /api/updates/status
```

**Response:**
```json
{
  "currentVersion": "2.0.0",
  "available": true,
  "downloading": false,
  "downloaded": false,
  "error": null,
  "version": "2.1.0",
  "progress": 0
}
```

### Download Update
```http
POST /api/updates/download
```

**Response:**
```json
{
  "success": true,
  "message": "Download started"
}
```

### Install Update
```http
POST /api/updates/install
```

**Response:**
```json
{
  "success": true,
  "message": "Installing update and restarting..."
}
```

## Socket.IO Events

The update system emits real-time events via Socket.IO:

### Events Emitted to Client

**update-checking**
```javascript
socket.on('update-checking', () => {
  // Update check has started
});
```

**update-available**
```javascript
socket.on('update-available', (info) => {
  // info.version - New version number
  // info.releaseNotes - What's new
  // info.releaseDate - Release date
});
```

**update-not-available**
```javascript
socket.on('update-not-available', (info) => {
  // info.version - Current version (already latest)
});
```

**update-download-progress**
```javascript
socket.on('update-download-progress', (progress) => {
  // progress.percent - Download percentage
  // progress.transferred - Bytes downloaded
  // progress.total - Total bytes
  // progress.bytesPerSecond - Download speed
});
```

**update-downloaded**
```javascript
socket.on('update-downloaded', (info) => {
  // Update ready to install
  // info.version - Downloaded version
  // info.releaseNotes - Release notes
});
```

**update-error**
```javascript
socket.on('update-error', (error) => {
  // error.error - Error message
});
```

## Configuration

### package.json
The update system is configured in `package.json` under the `build` section:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "bedayawhatsapp",
      "repo": "bedayawhatsapp",
      "releaseType": "release"
    }
  }
}
```

### Update Server Options

#### GitHub Releases (Default)
- Requires: GitHub repository with releases
- Automatic: Downloads from GitHub releases
- Free: No additional infrastructure needed

#### Custom Update Server
To use a custom server, modify `main.js`:

```javascript
autoUpdater.setFeedURL({
  provider: 'generic',
  url: 'https://your-server.com/updates'
});
```

## Publishing Updates

### 1. Create New Version
Update version in `package.json`:
```json
{
  "version": "2.1.0"
}
```

### 2. Build Application
```bash
npm run build:win
# or
npm run build:mac
# or
npm run build:linux
```

### 3. Create GitHub Release
1. Go to GitHub repository
2. Click "Releases" → "Create new release"
3. Tag version (e.g., `v2.1.0`)
4. Add release notes
5. Upload built files from `dist/` folder
6. Publish release

### 4. Users Get Update
- Users will be notified automatically
- Update downloads from GitHub release
- Installs seamlessly

## Auto-Update Files

When publishing, include these files for each platform:

**Windows:**
- `BedayaWhatsApp-2.1.0-x64.exe` (installer)
- `latest.yml` (auto-generated by electron-builder)

**macOS:**
- `BedayaWhatsApp-2.1.0-mac.dmg`
- `latest-mac.yml`

**Linux:**
- `BedayaWhatsApp-2.1.0-linux.AppImage`
- `latest-linux.yml`

## Development Mode

Update checking is disabled in development mode to prevent errors:

```javascript
if (!process.env.DEV) {
  autoUpdater.checkForUpdates();
}
```

To test updates in development:
1. Remove the DEV check
2. Point to a test update server
3. Or use production builds for testing

## Troubleshooting

### Update Check Fails
- **Cause**: No internet connection or GitHub is down
- **Solution**: User can retry manually via Settings

### Download Fails
- **Cause**: Network interruption
- **Solution**: Click "Download Update" again to retry

### Install Fails
- **Cause**: Insufficient permissions
- **Solution**: Run app as administrator (Windows) or check permissions (macOS/Linux)

### Update Not Found
- **Cause**: No new releases published on GitHub
- **Solution**: Publish new release with version tag

## Security

### Code Signing
For production, sign your releases:

**Windows:**
```json
{
  "build": {
    "win": {
      "certificateFile": "path/to/certificate.pfx",
      "certificatePassword": "password"
    }
  }
}
```

**macOS:**
```json
{
  "build": {
    "mac": {
      "identity": "Developer ID Application: Your Name"
    }
  }
}
```

### Signature Verification
electron-updater automatically verifies update signatures:
- Windows: Authenticode signature
- macOS: Apple notarization
- Linux: SHA512 checksum

## Best Practices

1. **Version Naming**: Use semantic versioning (e.g., 2.1.0)
2. **Release Notes**: Always provide clear release notes
3. **Testing**: Test updates on all platforms before publishing
4. **Gradual Rollout**: Release to small group first, then all users
5. **Backup**: Users should backup data before major updates
6. **Monitoring**: Monitor update success rates

## User Experience

### Minimal Disruption
- Updates download in background
- No interruption to current work
- Install only when user chooses

### Transparency
- Clear version information
- Detailed progress feedback
- Optional update notes

### Control
- Users decide when to update
- Can dismiss and update later
- Manual check option available

## Implementation Files

- **main.js**: Auto-updater configuration and event handlers
- **app.js**: Frontend update logic and UI management
- **index.html**: Update modal and settings UI
- **styles.css**: Update modal styling
- **package.json**: Build and publish configuration

## Future Enhancements

Potential improvements:
- [ ] Auto-install on app quit
- [ ] Scheduled update checks
- [ ] Update history/changelog viewer
- [ ] Beta channel support
- [ ] Update preferences (auto-download, notifications)
- [ ] Rollback to previous version
- [ ] Delta updates (smaller downloads)
