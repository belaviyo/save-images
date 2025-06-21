/* eslint no-var: 0 */

var size = {};
var type = {};

var hex = (uint8a, start, end) => {
  return [...uint8a.slice(start, end)].map(x => x.toString(16).padStart(2, '0')).join('');
};

// https://github.com/image-size/image-size/blob/main/lib/types/png.ts
type.png = uint8a => {
  const b = String.fromCharCode(...uint8a.slice(0, 10));
  if (b.slice(1, 8) === 'PNG\r\n\x1a\n') {
    return true;
  }

  return false;
};
size.png = uint8a => {
  const b = String.fromCharCode(...uint8a.slice(0, 40));
  const view = new DataView(uint8a.buffer);

  if (b.slice(12, 16) === 'CgBI') {
    return {
      type: 'image/png',
      width: view.getUint32(36, false),
      height: view.getUint32(32, false)
    };
  }
  else {
    return {
      type: 'image/png',
      width: view.getUint32(16, false),
      height: view.getUint32(20, false)
    };
  }
};

// https://github.com/image-size/image-size/blob/main/lib/types/gif.ts
type.gif = uint8a => {
  const b = String.fromCharCode(...uint8a.slice(0, 6));

  return /^GIF8[79]a/.test(b);
};
size.gif = uint8a => {
  const view = new DataView(uint8a.buffer);
  return {
    type: 'image/gif',
    width: view.getUint16(6, true),
    height: view.getUint16(8, true)
  };
};

// https://github.com/image-size/image-size/blob/main/lib/types/bmp.ts
type.bmp = uint8a => {
  const b = String.fromCharCode(...uint8a.slice(0, 2));
  return b === 'BM';
};
size.bmp = uint8a => {
  const view = new DataView(uint8a.buffer);
  return {
    type: 'image/bmp',
    height: Math.abs(view.getUint32(22, true)),
    width: view.getUint32(18, true)
  };
};

// https://github.com/image-size/image-size/blob/main/lib/types/webp.ts
type.webp = uint8a => {
  const b = String.fromCharCode(...uint8a.slice(0, 16));
  const riffHeader = 'RIFF' === b.slice(0, 4);
  const webpHeader = 'WEBP' === b.slice(8, 12);
  const vp8Header = 'VP8' === b.slice(12, 15);

  return (riffHeader && webpHeader && vp8Header);
};
size.webp = uint8a => {
  const view = new DataView(uint8a.buffer.slice(20, 30));
  const chunkHeader = String.fromCharCode(...uint8a.slice(12, 16));

  // Extended webp stream signature
  if (chunkHeader === 'VP8X') {
    console.warn('VP8X is not yet supported');
  }
  // Lossless webp stream signature
  if (chunkHeader === 'VP8 ' && uint8a[0] !== 0x2f) {
    return {
      type: 'image/webp',
      height: view.getInt16(8, true) & 0x3fff,
      width: view.getInt32(6, true) & 0x3fff
    };
  }
  // Lossy webp stream signature
  const signature = String.fromCharCode(...uint8a.slice(3, 6));
  if (chunkHeader === 'VP8L' && signature !== '9d012a') {
    return {
      type: 'image/webp',
      height: 1 + (((uint8a[24] & 0xF) << 10) | (uint8a[23] << 2) | ((uint8a[22] & 0xC0) >> 6)),
      width: 1 + (((uint8a[22] & 0x3F) << 8) | uint8a[21])
    };
  }
};

// https://github.com/image-size/image-size/blob/main/lib/types/jpg.ts
type.jpg = uint8a => {
  const SOIMarker = hex(uint8a, 0, 2);
  return SOIMarker === 'ffd8';
};
size.jpg = uint8a => {
  const view = new DataView(uint8a.buffer);
  for (let offset = 4; offset < uint8a.byteLength;) {
    // read length of the next block
    const i = view.getUint16(offset, false);


    const next = uint8a[offset + i + 1];
    if (next === 0xC0 || next === 0xC1 || next === 0xC2) {
      const view = new DataView(uint8a.buffer.slice(offset + i + 5));

      return {
        type: 'image/jpeg',
        height: view.getUint16(0, false),
        width: view.getUint16(2, false)
      };
    }
    // move to the next block
    offset += i + 2;
  }
};
