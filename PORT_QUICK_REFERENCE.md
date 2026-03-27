# Quick Reference: Port Configuration

## 🚀 Quick Start

### Change Port via UI
```
Settings (⚙️) → Server Configuration → Enter Port → Save & Restart
```

### Change Port via File
```json
// Edit: settings.json
{
  "port": 3031
}
```
Then restart the application.

---

## 📋 Port Ranges

| Range | Purpose | Example |
|-------|---------|---------|
| 3030-3039 | Development | Dev environment |
| 3040-3049 | Staging | Pre-production testing |
| 3050-3059 | Production | Live instances |
| 3060-3069 | Testing | QA and automated tests |

---

## 🔢 Multiple Instances Example

```
Instance 1 (Support)
├── Port: 3030
└── URL: http://localhost:3030

Instance 2 (Sales)
├── Port: 3031
└── URL: http://localhost:3031

Instance 3 (Marketing)
├── Port: 3032
└── URL: http://localhost:3032
```

---

## ⚙️ API Endpoints

```javascript
// Get Settings
GET /api/settings

// Update Port
POST /api/settings
Body: { "port": 3031 }

// Restart App
POST /api/restart
```

---

## ⚠️ Important Notes

- ✅ Valid Ports: **1024-65535**
- ❌ Ports 1-1023 require admin rights
- 🔄 Changes require **application restart**
- 💾 Settings saved in `settings.json`
- 🔒 Each instance is **independent**

---

## 🐛 Troubleshooting

### Port Already in Use
```powershell
# Windows - Check port usage
netstat -ano | findstr :3030

# Linux/Mac - Check port usage
lsof -i :3030
```

**Solution**: Choose a different port number

### Settings Not Saving
- Check file permissions
- Ensure valid JSON format
- Try running as administrator

### Can't Connect After Restart
- Verify new port in settings.json
- Check if app restarted successfully
- Update bookmarks/API calls with new port

---

## 📞 Support

For detailed documentation, see:
- **README.md** - General configuration
- **MULTIPLE_INSTANCES.md** - Running multiple instances
- **PORT_CONFIGURATION.md** - Implementation details
