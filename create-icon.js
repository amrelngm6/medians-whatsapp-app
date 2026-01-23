const fs = require('fs');
const path = require('path');

// Create a proper 32x32 PNG WhatsApp-style icon (green circle with white W)
// This is a valid PNG binary created programmatically
function createPNG() {
    // PNG signature
    const signature = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]);
    
    // IHDR chunk (32x32, 8-bit RGBA)
    const width = 32;
    const height = 32;
    const ihdrData = Buffer.alloc(13);
    ihdrData.writeUInt32BE(width, 0);
    ihdrData.writeUInt32BE(height, 4);
    ihdrData[8] = 8;  // bit depth
    ihdrData[9] = 6;  // color type (RGBA)
    ihdrData[10] = 0; // compression
    ihdrData[11] = 0; // filter
    ihdrData[12] = 0; // interlace
    
    const ihdr = createChunk('IHDR', ihdrData);
    
    // Create image data (green circle on transparent background)
    const rawData = [];
    const centerX = 16;
    const centerY = 16;
    const radius = 14;
    
    for (let y = 0; y < height; y++) {
        rawData.push(0); // filter byte for each row
        for (let x = 0; x < width; x++) {
            const dx = x - centerX;
            const dy = y - centerY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            
            if (dist <= radius) {
                // WhatsApp green color
                rawData.push(0x25); // R
                rawData.push(0xD3); // G
                rawData.push(0x66); // B
                rawData.push(0xFF); // A (fully opaque)
            } else {
                // Transparent
                rawData.push(0x00);
                rawData.push(0x00);
                rawData.push(0x00);
                rawData.push(0x00);
            }
        }
    }
    
    // Compress with zlib
    const zlib = require('zlib');
    const compressed = zlib.deflateSync(Buffer.from(rawData));
    
    const idat = createChunk('IDAT', compressed);
    
    // IEND chunk
    const iend = createChunk('IEND', Buffer.alloc(0));
    
    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    
    const typeBuffer = Buffer.from(type);
    const crcData = Buffer.concat([typeBuffer, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    
    return Buffer.concat([length, typeBuffer, data, crc]);
}

function crc32(data) {
    let crc = 0xFFFFFFFF;
    const table = [];
    
    for (let i = 0; i < 256; i++) {
        let c = i;
        for (let j = 0; j < 8; j++) {
            c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        }
        table[i] = c;
    }
    
    for (let i = 0; i < data.length; i++) {
        crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    
    return (crc ^ 0xFFFFFFFF) >>> 0;
}

const pngBuffer = createPNG();
fs.writeFileSync(path.join(__dirname, 'icon.png'), pngBuffer);
fs.writeFileSync(path.join(__dirname, 'public', 'icon.png'), pngBuffer);

console.log('Icon files created successfully!');
