# Quick Start: Auto-Update System

## Installation

Run this command to install the required dependency:

```bash
npm install electron-updater
```

## Usage for Users

### Receiving Updates

1. **Automatic Notification**
   - App checks for updates on startup
   - Modal appears when update is available

2. **Manual Check**
   - Open Settings
   - Go to "Software Updates" section
   - Click "Check for Updates"
   
   OR
   
   - Right-click system tray icon
   - Select "Check for Updates"

3. **Download Update**
   - Click "Download Update" button
   - Progress bar shows download status
   - Continue using app while downloading

4. **Install Update**
   - Click "Install & Restart" when ready
   - App closes, updates, and reopens
   - All data preserved

## Publishing Updates (Developers)

### Quick Guide

```bash
# 1. Update version
# Edit package.json: "version": "2.1.0"

# 2. Build app
npm run build:win

# 3. Create GitHub Release
# - Tag: v2.1.0
# - Upload: BedayaWhatsApp-2.1.0-x64.exe and latest.yml
# - Add release notes

# Done! Users get update automatically
```

### Detailed Steps

1. **Update Version Number**
   ```json
   // package.json
   {
     "version": "2.1.0"
   }
   ```

2. **Build Application**
   ```bash
   # Windows
   npm run build:win
   
   # macOS
   npm run build:mac
   
   # Linux
   npm run build:linux
   ```

3. **Create GitHub Release**
   - Go to your GitHub repository
   - Click "Releases" → "Draft a new release"
   - Tag version: `v2.1.0` (must start with 'v')
   - Release title: `Version 2.1.0`
   - Description: Your release notes (users will see this)
   - Upload files from `dist/` folder:
     - **Windows**: `BedayaWhatsApp-2.1.0-x64.exe` + `latest.yml`
     - **macOS**: `BedayaWhatsApp-2.1.0-mac.dmg` + `latest-mac.yml`
     - **Linux**: `BedayaWhatsApp-2.1.0-linux.AppImage` + `latest-linux.yml`
   - Click "Publish release"

4. **Users Get Notified**
   - Running apps check for updates
   - Users see notification with your release notes
   - They download and install at their convenience

## API Usage

### Check for Updates
```javascript
fetch('/api/updates/check')
  .then(res => res.json())
  .then(data => {
    if (data.updateAvailable) {
      console.log('New version:', data.latestVersion);
    }
  });
```

### Download Update
```javascript
fetch('/api/updates/download', { method: 'POST' })
  .then(res => res.json())
  .then(data => console.log(data.message));
```

### Install Update
```javascript
fetch('/api/updates/install', { method: 'POST' })
  .then(res => res.json())
  .then(() => {
    // App will restart
  });
```

## Configuration

The update system is configured in `package.json`:

```json
{
  "build": {
    "publish": {
      "provider": "github",
      "owner": "your-username",
      "repo": "bedayawhatsapp",
      "releaseType": "release"
    }
  }
}
```

**Important**: Update `owner` to match your GitHub username/organization.

## Testing

### In Development
Updates won't work in dev mode. To test:

1. Build production version:
   ```bash
   npm run build:win
   ```

2. Install the built app

3. Create a test release on GitHub

4. Open installed app - it will check for updates

### Manual Test
```bash
# Start app and check console for:
# "Checking for updates..."
# "Update available: X.X.X" or "No updates available"
```

## Troubleshooting

**No updates showing?**
- Verify internet connection
- Check GitHub repository is public
- Ensure release tag matches version (v2.1.0)
- Check console for error messages

**Download fails?**
- Check firewall/antivirus settings
- Verify disk space
- Try manual download from GitHub releases

**Can't install?**
- Run as administrator (Windows)
- Check file permissions (macOS/Linux)
- Close all app instances

## File Structure

```
BedayaWhatsApp/
├── main.js                 # Auto-updater backend
├── package.json            # Version & publish config
├── AUTO_UPDATE.md          # Full documentation
├── UPDATE_SUMMARY.md       # Implementation details
├── install-updater.bat     # Windows installer
├── install-updater.sh      # Unix installer
└── public/
    ├── index.html          # Update UI
    ├── app.js              # Update logic
    └── styles.css          # Update styling
```

## Features at a Glance

✅ Automatic update detection
✅ Background downloading  
✅ Progress tracking
✅ Release notes display
✅ One-click installation
✅ No reinstall required
✅ Session preservation
✅ Manual check option
✅ API control
✅ Real-time notifications

## Next Steps

1. Install dependencies: `npm install electron-updater`
2. Update GitHub publish config in package.json
3. Build your app: `npm run build:win`
4. Create first release on GitHub
5. Test with installed app

For complete documentation, see [AUTO_UPDATE.md](AUTO_UPDATE.md).

## Support

- Technical docs: AUTO_UPDATE.md
- Implementation: UPDATE_SUMMARY.md
- Issues: GitHub repository issues
- Questions: Check documentation first

---

**Ready to use!** The auto-update system is fully integrated and ready for production.
