#!/bin/bash
# Install electron-updater dependency

echo "Installing electron-updater..."
npm install electron-updater

echo ""
echo "✅ Installation complete!"
echo ""
echo "The auto-update system is now ready to use."
echo "See AUTO_UPDATE.md for full documentation."
echo ""
echo "Quick Start:"
echo "1. Update version in package.json"
echo "2. Build app: npm run build:win"
echo "3. Create GitHub release with built files"
echo "4. Users will auto-receive updates!"
