# Multiple Instance Setup Guide

This guide explains how to run multiple instances of ChromWhatsApp on the same device using different ports.

## Quick Setup

### Method 1: Using Portable Versions (Recommended)

1. **Download/Build Portable Version:**
   ```bash
   npm run build:portable
   ```

2. **Create Multiple Folders:**
   ```
   ChromWhatsApp-Instance1/
   ChromWhatsApp-Instance2/
   ChromWhatsApp-Instance3/
   ```

3. **Copy the portable app to each folder**

4. **Configure Port for Each Instance:**
   
   **Option A - Via UI (Easier):**
   - Launch each instance
   - Open Settings → Server Configuration
   - Set different ports:
     - Instance1: 3030
     - Instance2: 3031
     - Instance3: 3032
   - Click "Save & Restart"

   **Option B - Via File (Faster):**
   Create/edit `settings.json` in each instance folder:
   
   Instance1 - `settings.json`:
   ```json
   {
     "port": 3030
   }
   ```
   
   Instance2 - `settings.json`:
   ```json
   {
     "port": 3031
   }
   ```
   
   Instance3 - `settings.json`:
   ```json
   {
     "port": 3032
   }
   ```

5. **Launch All Instances:**
   - Run each portable executable
   - Each will start on its configured port
   - Access via:
     - http://localhost:3030
     - http://localhost:3031
     - http://localhost:3032

### Method 2: Development Mode

1. **Clone Repository Multiple Times:**
   ```bash
   git clone <repo> ChromWhatsApp-1
   git clone <repo> ChromWhatsApp-2
   git clone <repo> ChromWhatsApp-3
   ```

2. **Install Dependencies in Each:**
   ```bash
   cd ChromWhatsApp-1 && npm install
   cd ChromWhatsApp-2 && npm install
   cd ChromWhatsApp-3 && npm install
   ```

3. **Create settings.json in Each:**
   ```bash
   # ChromWhatsApp-1/settings.json
   {"port": 3030}
   
   # ChromWhatsApp-2/settings.json
   {"port": 3031}
   
   # ChromWhatsApp-3/settings.json
   {"port": 3032}
   ```

4. **Run All Instances:**
   ```bash
   # Terminal 1
   cd ChromWhatsApp-1 && npm start
   
   # Terminal 2
   cd ChromWhatsApp-2 && npm start
   
   # Terminal 3
   cd ChromWhatsApp-3 && npm start
   ```

## Use Cases

### Business with Multiple WhatsApp Accounts
- Customer Support: Port 3030
- Sales: Port 3031
- Marketing: Port 3032

### Development & Testing
- Production: Port 3030
- Staging: Port 3031
- Testing: Port 3032

### Multiple Clients
- Client A: Port 3030
- Client B: Port 3031
- Client C: Port 3032

## Features Per Instance

Each instance maintains:
- ✅ Independent WhatsApp session
- ✅ Separate authentication data
- ✅ Unique webhook configuration
- ✅ Individual device tokens
- ✅ Isolated message history
- ✅ Independent API access

## API Access

Each instance has its own API endpoint:

```javascript
// Instance 1 (Port 3030)
fetch('http://localhost:3030/api/send-message', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-device-token': 'token_for_instance_1'
    },
    body: JSON.stringify({
        phone: '1234567890',
        message: 'Hello from Instance 1!'
    })
});

// Instance 2 (Port 3031)
fetch('http://localhost:3031/api/send-message', {
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'x-device-token': 'token_for_instance_2'
    },
    body: JSON.stringify({
        phone: '1234567890',
        message: 'Hello from Instance 2!'
    })
});
```

## Troubleshooting

### Port Already in Use
**Error:** `EADDRINUSE: address already in use`

**Solution:**
1. Check if another instance is using the port
2. Change to a different port in settings.json
3. Restart the application

**Check ports in use (Windows):**
```powershell
netstat -ano | findstr :3030
```

**Check ports in use (Linux/Mac):**
```bash
lsof -i :3030
```

### Can't Access Other Instances
- Make sure each instance has a unique port
- Check firewall settings
- Verify each instance started successfully

### Settings Not Saving
- Ensure you have write permissions to the app folder
- Check if settings.json exists and is valid JSON
- Try running as administrator (Windows)

## Best Practices

1. **Use Sequential Ports:** 3030, 3031, 3032, etc. for easy tracking
2. **Label Instances:** Rename folders to indicate purpose
3. **Document Ports:** Keep a list of which port serves which purpose
4. **Backup Sessions:** Regularly backup the `.wwebjs_auth` folders
5. **Monitor Resources:** Each instance uses memory - monitor system resources

## Port Range Recommendations

- **Development:** 3030-3039
- **Staging:** 3040-3049
- **Production:** 3050-3059
- **Testing:** 3060-3069

Always use ports between 1024-65535 (privileged ports 1-1023 require admin rights).
