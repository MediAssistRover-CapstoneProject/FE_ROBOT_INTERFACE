// @ts-nocheck
/**
 * Tự động nhận diện góc nghiêng của tường (Wall Alignment) và khung bao hình chữ nhật (Tight Bounding Box)
 * trực tiếp từ dữ liệu ảnh PNG SLAM (ROS2 map_saver) tải về từ Backend.
 *
 * Nguyên lý:
 * 1. Giải mã các chunk IHDR + IDAT của ảnh PNG (zlib/DEFLATE RFC-1951 thuần TypeScript, không phụ thuộc thư viện ngoài).
 * 2. Phân loại các ô lưới SLAM:
 *    - Tường / vật cản (Occupied): độ sáng Y < 95 (màu đen).
 *    - Vùng sàn đi được (Free space): độ sáng Y > 225 (màu trắng).
 *    - Vùng chưa quét (Unknown): độ sáng xung quanh màu nền xám (Y ~ 200-210).
 * 3. Dùng thuật toán Radon Projection Variance + Minimum Bounding Box (Rotating Calipers)
 *    quét góc theta trong [-45°, +45°] để tìm góc xoay chuẩn giúp các bức tường nằm ngang/dọc vuông vắn.
 * 4. Tìm khung bao [xMin, xMax] x [yMin, yMax] ôm trọn toàn bộ tường + sàn (cộng 5% lề an toàn)
 *    để hiển thị FULL MAP mà không bao giờ bị mất viền hay dư mảng xám ở 4 góc.
 */

export interface SlamAutoAlignResult {
  width: number;
  height: number;
  rotationDeg: number;
  rotationRad: number;
  /** Khung bao sau khi xoay quanh tâm ảnh (width/2, height/2) */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  boxWidth: number;
  boxHeight: number;
  /** Khoảng cách BFS (theo ô pixel) tới tường/vật cản gần nhất để lập lộ trình A* */
  wallDist?: Int16Array;
}

// Bảng mã Huffman cố định theo chuẩn RFC-1951 (DEFLATE)
const FIXED_LIT_LENGTHS = new Uint8Array(288);
for (let i = 0; i <= 143; i++) FIXED_LIT_LENGTHS[i] = 8;
for (let i = 144; i <= 255; i++) FIXED_LIT_LENGTHS[i] = 9;
for (let i = 256; i <= 279; i++) FIXED_LIT_LENGTHS[i] = 7;
for (let i = 280; i <= 287; i++) FIXED_LIT_LENGTHS[i] = 8;

const FIXED_DIST_LENGTHS = new Uint8Array(32);
FIXED_DIST_LENGTHS.fill(5);

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31,
  35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2,
  3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193,
  257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6,
  7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface HuffmanTable {
  maxBits: number;
  table: Int32Array;
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  let maxBits = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > maxBits) maxBits = lengths[i];
  }
  if (maxBits === 0) maxBits = 1;

  const blCount = new Int32Array(maxBits + 1);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0) blCount[lengths[i]]++;
  }

  const nextCode = new Int32Array(maxBits + 1);
  let code = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    code = (code + blCount[bits - 1]) << 1;
    nextCode[bits] = code;
  }

  const size = 1 << maxBits;
  const table = new Int32Array(size);
  table.fill(-1);

  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len === 0) continue;
    const c = nextCode[len]++;
    // Đảo bit cho thứ tự đọc LSB-first của DEFLATE
    let rev = 0;
    for (let b = 0; b < len; b++) {
      rev = (rev << 1) | ((c >> b) & 1);
    }
    const step = 1 << len;
    const entry = (sym << 8) | len;
    for (let idx = rev; idx < size; idx += step) {
      table[idx] = entry;
    }
  }

  return { maxBits, table };
}

const FIXED_LIT_TABLE = buildHuffmanTable(FIXED_LIT_LENGTHS);
const FIXED_DIST_TABLE = buildHuffmanTable(FIXED_DIST_LENGTHS);

/**
 * Giải nén luồng Zlib/DEFLATE (RFC-1950 / RFC-1951) từ các chunk IDAT của PNG
 */
function inflateZlib(data: Uint8Array, expectedSize: number): Uint8Array {
  // Bỏ qua 2 byte header của Zlib (CMF, FLG)
  let bitPos = 16;
  const totalBits = data.length * 8;

  const out = new Uint8Array(expectedSize);
  let outPos = 0;

  const readBits = (n: number): number => {
    let val = 0;
    for (let i = 0; i < n; i++) {
      const byteIdx = (bitPos + i) >> 3;
      if (byteIdx >= data.length) break;
      const bitIdx = (bitPos + i) & 7;
      val |= ((data[byteIdx] >> bitIdx) & 1) << i;
    }
    bitPos += n;
    return val;
  };

  const decodeSymbol = (huff: HuffmanTable): number => {
    let peek = 0;
    const maxB = huff.maxBits;
    for (let i = 0; i < maxB; i++) {
      const byteIdx = (bitPos + i) >> 3;
      if (byteIdx >= data.length) break;
      const bitIdx = (bitPos + i) & 7;
      peek |= ((data[byteIdx] >> bitIdx) & 1) << i;
    }
    const entry = huff.table[peek & ((1 << maxB) - 1)];
    if (entry < 0) {
      throw new Error('Invalid Huffman code in PNG IDAT');
    }
    bitPos += entry & 0xff;
    return entry >> 8;
  };

  let bfinal = 0;
  while (!bfinal && bitPos < totalBits && outPos < expectedSize) {
    bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      // Uncompressed block
      bitPos = (bitPos + 7) & ~7;
      const len = readBits(16);
      readBits(16); // nlen
      let byteIdx = bitPos >> 3;
      for (let i = 0; i < len && outPos < expectedSize && byteIdx < data.length; i++) {
        out[outPos++] = data[byteIdx++];
      }
      bitPos = byteIdx << 3;
    } else if (btype === 1 || btype === 2) {
      let litTable = FIXED_LIT_TABLE;
      let distTable = FIXED_DIST_TABLE;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;

        const clLengths = new Uint8Array(19);
        for (let i = 0; i < hclen; i++) {
          clLengths[CL_ORDER[i]] = readBits(3);
        }
        const clTable = buildHuffmanTable(clLengths);

        const allLengths = new Uint8Array(hlit + hdist);
        let idx = 0;
        while (idx < hlit + hdist) {
          const sym = decodeSymbol(clTable);
          if (sym < 16) {
            allLengths[idx++] = sym;
          } else if (sym === 16) {
            const repeat = readBits(2) + 3;
            const prev = idx > 0 ? allLengths[idx - 1] : 0;
            for (let r = 0; r < repeat && idx < allLengths.length; r++) {
              allLengths[idx++] = prev;
            }
          } else if (sym === 17) {
            const repeat = readBits(3) + 3;
            for (let r = 0; r < repeat && idx < allLengths.length; r++) {
              allLengths[idx++] = 0;
            }
          } else if (sym === 18) {
            const repeat = readBits(7) + 11;
            for (let r = 0; r < repeat && idx < allLengths.length; r++) {
              allLengths[idx++] = 0;
            }
          }
        }

        litTable = buildHuffmanTable(allLengths.subarray(0, hlit));
        distTable = buildHuffmanTable(allLengths.subarray(hlit));
      }

      while (bitPos < totalBits) {
        const sym = decodeSymbol(litTable);
        if (sym === 256) break;
        if (sym < 256) {
          if (outPos < expectedSize) {
            out[outPos++] = sym;
          }
        } else {
          const lenIdx = sym - 257;
          const length = LENGTH_BASE[lenIdx] + readBits(LENGTH_EXTRA[lenIdx]);
          const distSym = decodeSymbol(distTable);
          const distance = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
          for (let i = 0; i < length && outPos < expectedSize; i++) {
            out[outPos] = out[outPos - distance];
            outPos++;
          }
        }
      }
    } else {
      throw new Error('Unsupported DEFLATE block type');
    }
  }

  return out;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

/**
 * Giải mã ảnh PNG thành mảng độ sáng Grayscale (0..255) kích thước width x height
 */
export function decodePngGrayscale(bytes: Uint8Array): {
  width: number;
  height: number;
  gray: Uint8Array;
} | null {
  if (bytes.length < 32 || bytes[0] !== 0x89 || bytes[1] !== 0x50) {
    return null;
  }

  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  const idatChunks: Uint8Array[] = [];
  let totalIdatLen = 0;

  let offset = 8;
  while (offset + 8 <= bytes.length) {
    const length =
      ((bytes[offset] << 24) |
        (bytes[offset + 1] << 16) |
        (bytes[offset + 2] << 8) |
        bytes[offset + 3]) >>>
      0;
    const type = String.fromCharCode(
      bytes[offset + 4],
      bytes[offset + 5],
      bytes[offset + 6],
      bytes[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > bytes.length) break;

    if (type === 'IHDR') {
      width =
        ((bytes[dataStart] << 24) |
          (bytes[dataStart + 1] << 16) |
          (bytes[dataStart + 2] << 8) |
          bytes[dataStart + 3]) >>>
        0;
      height =
        ((bytes[dataStart + 4] << 24) |
          (bytes[dataStart + 5] << 16) |
          (bytes[dataStart + 6] << 8) |
          bytes[dataStart + 7]) >>>
        0;
      bitDepth = bytes[dataStart + 8];
      colorType = bytes[dataStart + 9];
      interlace = bytes[dataStart + 12];
    } else if (type === 'PLTE') {
      palette = bytes.subarray(dataStart, dataEnd);
    } else if (type === 'IDAT') {
      idatChunks.push(bytes.subarray(dataStart, dataEnd));
      totalIdatLen += length;
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // +4 CRC
  }

  if (width <= 0 || height <= 0 || interlace !== 0 || totalIdatLen === 0) {
    return null;
  }

  const channels =
    colorType === 0 ? 1 : colorType === 2 ? 3 : colorType === 3 ? 1 : colorType === 4 ? 2 : 4;
  const bpp = Math.max(1, Math.ceil((channels * bitDepth) / 8));
  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedRawSize = height * (1 + rowBytes);

  const combinedIdat = new Uint8Array(totalIdatLen);
  let pos = 0;
  for (const chunk of idatChunks) {
    combinedIdat.set(chunk, pos);
    pos += chunk.length;
  }

  const raw = inflateZlib(combinedIdat, expectedRawSize);
  const recon = new Uint8Array(height * rowBytes);

  for (let y = 0; y < height; y++) {
    const filterType = raw[y * (1 + rowBytes)];
    const srcOffset = y * (1 + rowBytes) + 1;
    const dstOffset = y * rowBytes;
    const prevOffset = (y - 1) * rowBytes;

    for (let i = 0; i < rowBytes; i++) {
      const xByte = raw[srcOffset + i];
      const a = i >= bpp ? recon[dstOffset + i - bpp] : 0;
      const b = y > 0 ? recon[prevOffset + i] : 0;
      const c = y > 0 && i >= bpp ? recon[prevOffset + i - bpp] : 0;

      if (filterType === 0) {
        recon[dstOffset + i] = xByte;
      } else if (filterType === 1) {
        recon[dstOffset + i] = (xByte + a) & 0xff;
      } else if (filterType === 2) {
        recon[dstOffset + i] = (xByte + b) & 0xff;
      } else if (filterType === 3) {
        recon[dstOffset + i] = (xByte + ((a + b) >> 1)) & 0xff;
      } else {
        recon[dstOffset + i] = (xByte + paethPredictor(a, b, c)) & 0xff;
      }
    }
  }

  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    const rowStart = y * rowBytes;
    for (let x = 0; x < width; x++) {
      if (bitDepth === 8) {
        if (colorType === 0 || colorType === 4) {
          gray[y * width + x] = recon[rowStart + x * channels];
        } else if (colorType === 2 || colorType === 6) {
          const idx = rowStart + x * channels;
          gray[y * width + x] = (recon[idx] * 77 + recon[idx + 1] * 150 + recon[idx + 2] * 29) >> 8;
        } else if (colorType === 3 && palette) {
          const pIdx = recon[rowStart + x] * 3;
          gray[y * width + x] =
            (palette[pIdx] * 77 + palette[pIdx + 1] * 150 + palette[pIdx + 2] * 29) >> 8;
        }
      } else {
        // Fallback cho bitDepth < 8
        const bitsPerPixel = bitDepth * channels;
        const bitIndex = x * bitsPerPixel;
        const byteIndex = rowStart + (bitIndex >> 3);
        const shift = 8 - bitsPerPixel - (bitIndex & 7);
        const mask = (1 << bitsPerPixel) - 1;
        const val = (recon[byteIndex] >> shift) & mask;
        gray[y * width + x] = Math.round((val * 255) / mask);
      }
    }
  }

  return { width, height, gray };
}

/**
 * Phân tích ảnh SLAM để tìm góc xoay tường chuẩn xác (thetaDeg) và khung bao hình chữ nhật
 * ôm khít toàn bộ viền tường + sàn của bản đồ.
 */
export function analyzeSlamMapGeometry(
  width: number,
  height: number,
  gray: Uint8Array
): SlamAutoAlignResult {
  const cx = width / 2;
  const cy = height / 2;

  // Lấy màu nền chưa quét (unknown) từ 4 góc ảnh (thường là 205 trong ROS map_saver)
  const cornerSamples = [
    gray[0],
    gray[width - 1],
    gray[(height - 1) * width],
    gray[height * width - 1],
  ].sort((a, b) => a - b);
  const bgVal = cornerSamples[1];

  const wallPointsX: number[] = [];
  const wallPointsY: number[] = [];
  const activePointsX: number[] = [];
  const activePointsY: number[] = [];

  for (let v = 0; v < height; v++) {
    const rowOffset = v * width;
    for (let u = 0; u < width; u++) {
      const val = gray[rowOffset + u];
      const dx = u - cx;
      const dy = v - cy;

      // Pixel tường đen (occupied cell)
      if (val < 100) {
        wallPointsX.push(dx);
        wallPointsY.push(dy);
        activePointsX.push(dx);
        activePointsY.push(dy);
      } else if (val > 230 || Math.abs(val - bgVal) > 22) {
        // Pixel sàn trắng (free cell)
        activePointsX.push(dx);
        activePointsY.push(dy);
      }
    }
  }

  // Nếu ảnh quá ít điểm tường, trả về khung gốc
  if (wallPointsX.length < 15) {
    return {
      width,
      height,
      rotationDeg: 0,
      rotationRad: 0,
      xMin: -cx,
      xMax: cx,
      yMin: -cy,
      yMax: cy,
      boxWidth: width,
      boxHeight: height,
    };
  }

  const diag = Math.ceil(Math.hypot(width, height)) + 4;
  const halfDiag = diag >> 1;
  const histX = new Int32Array(diag);
  const histY = new Int32Array(diag);

  // Hàm chấm điểm độ thẳng hàng ngang/dọc của các bức tường tại góc deg
  const scoreAngle = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const c = Math.cos(rad);
    const s = Math.sin(rad);
    histX.fill(0);
    histY.fill(0);

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (let i = 0; i < wallPointsX.length; i++) {
      const wx = wallPointsX[i];
      const wy = wallPointsY[i];
      const rx = c * wx - s * wy;
      const ry = s * wx + c * wy;

      if (rx < minX) minX = rx;
      if (rx > maxX) maxX = rx;
      if (ry < minY) minY = ry;
      if (ry > maxY) maxY = ry;

      const bx = Math.round(rx) + halfDiag;
      const by = Math.round(ry) + halfDiag;
      if (bx >= 0 && bx < diag) histX[bx]++;
      if (by >= 0 && by < diag) histY[by]++;
    }

    // Tổng bình phương chiều cao cột histogram đạt cực đại khi tường thẳng hàng dọc/ngang
    let energy = 0;
    for (let i = 1; i < diag - 1; i++) {
      const sx = histX[i - 1] * 0.25 + histX[i] + histX[i + 1] * 0.25;
      const sy = histY[i - 1] * 0.25 + histY[i] + histY[i + 1] * 0.25;
      energy += sx * sx + sy * sy;
    }

    // Kết hợp phạt diện tích hình chữ nhật bao ngoài để ưu tiên góc ôm khít nhất
    const area = Math.max(10, (maxX - minX) * (maxY - minY));
    return energy / Math.pow(area, 0.35);
  };

  // Bước 1: Quét thô từ -45° đến +45° (bước 1°)
  let bestDeg = 0;
  let bestScore = -1;
  for (let deg = -45; deg <= 45; deg += 1) {
    const sc = scoreAngle(deg);
    if (sc > bestScore) {
      bestScore = sc;
      bestDeg = deg;
    }
  }

  // Bước 2: Tinh chỉnh mịn quanh bestDeg (bước 0.25°)
  const coarseBest = bestDeg;
  for (let deg = coarseBest - 1.5; deg <= coarseBest + 1.5; deg += 0.25) {
    const sc = scoreAngle(deg);
    if (sc > bestScore) {
      bestScore = sc;
      bestDeg = deg;
    }
  }

  // Bước 3: Kiểm tra xem xoay 0° hay xoay thêm 90° giúp bản đồ nằm ngang (Landscape) đẹp hơn
  const checkRad = (bestDeg * Math.PI) / 180;
  const cc = Math.cos(checkRad);
  const cs = Math.sin(checkRad);
  let testMinX = Infinity;
  let testMaxX = -Infinity;
  let testMinY = Infinity;
  let testMaxY = -Infinity;

  for (let i = 0; i < wallPointsX.length; i++) {
    const rx = cc * wallPointsX[i] - cs * wallPointsY[i];
    const ry = cs * wallPointsX[i] + cc * wallPointsY[i];
    if (rx < testMinX) testMinX = rx;
    if (rx > testMaxX) testMaxX = rx;
    if (ry < testMinY) testMinY = ry;
    if (ry > testMaxY) testMaxY = ry;
  }

  // Bước 4: Tính khung bao chính xác (Bounding Box) của toàn bộ tường + sàn tại góc bestDeg
  const finalRad = (bestDeg * Math.PI) / 180;
  const fc = Math.cos(finalRad);
  const fs = Math.sin(finalRad);

  let xMin = Infinity;
  let xMax = -Infinity;
  let yMin = Infinity;
  let yMax = -Infinity;

  const ptsX = activePointsX.length > 0 ? activePointsX : wallPointsX;
  const ptsY = activePointsY.length > 0 ? activePointsY : wallPointsY;

  for (let i = 0; i < ptsX.length; i++) {
    const rx = fc * ptsX[i] - fs * ptsY[i];
    const ry = fs * ptsX[i] + fc * ptsY[i];
    if (rx < xMin) xMin = rx;
    if (rx > xMax) xMax = rx;
    if (ry < yMin) yMin = ry;
    if (ry > yMax) yMax = ry;
  }

  // Cộng thêm 4.5% lề đệm (padding) ở cả 4 phía để thấy rõ trọn vẹn viền tường đen quanh góc
  const rawW = Math.max(10, xMax - xMin);
  const rawH = Math.max(10, yMax - yMin);
  const padX = Math.max(4, rawW * 0.045);
  const padY = Math.max(4, rawH * 0.045);

  xMin -= padX;
  xMax += padX;
  yMin -= padY;
  yMax += padY;

  // Bước 5: Tính trường khoảng cách tới tường/vật cản (BFS Distance Transform) cho A*
  const totalCells = width * height;
  const wallDist = new Int16Array(totalCells);
  wallDist.fill(999);
  const bfsQueue = new Int32Array(totalCells);
  let qHead = 0;
  let qTail = 0;

  for (let i = 0; i < totalCells; i++) {
    // Tường đen (< 140) hoặc vùng chưa quét ngoài sàn (< 218) coi là biên cản
    if (gray[i] < 218) {
      wallDist[i] = 0;
      bfsQueue[qTail++] = i;
    }
  }

  while (qHead < qTail) {
    const cur = bfsQueue[qHead++];
    const ux = cur % width;
    const uy = (cur / width) | 0;
    const nextDist = wallDist[cur] + 1;

    if (ux > 0 && wallDist[cur - 1] > nextDist) {
      wallDist[cur - 1] = nextDist;
      bfsQueue[qTail++] = cur - 1;
    }
    if (ux + 1 < width && wallDist[cur + 1] > nextDist) {
      wallDist[cur + 1] = nextDist;
      bfsQueue[qTail++] = cur + 1;
    }
    if (uy > 0 && wallDist[cur - width] > nextDist) {
      wallDist[cur - width] = nextDist;
      bfsQueue[qTail++] = cur - width;
    }
    if (uy + 1 < height && wallDist[cur + width] > nextDist) {
      wallDist[cur + width] = nextDist;
      bfsQueue[qTail++] = cur + width;
    }
  }

  return {
    width,
    height,
    rotationDeg: bestDeg,
    rotationRad: finalRad,
    xMin,
    xMax,
    yMin,
    yMax,
    boxWidth: xMax - xMin,
    boxHeight: yMax - yMin,
    wallDist,
  };
}

export interface GridMetricMeta {
  widthPx: number;
  heightPx: number;
  resolution: number;
  originX: number;
  originY: number;
  originYaw: number;
}

/**
 * Tìm lộ trình dẫn đường trên lưới SLAM Occupancy Grid (A* + Line-of-Sight String Pulling)
 * đi dọc giữa hành lang, tránh tường đen giống hệt bộ lập kế hoạch Nav2 của BE/Pi.
 */
export function planPathOnSlamGrid(
  align: SlamAutoAlignResult | null | undefined,
  meta: GridMetricMeta,
  start: { xM: number; yM: number },
  goal: { xM: number; yM: number }
): { xM: number; yM: number }[] | null {
  if (!align || !align.wallDist || align.width <= 0 || align.height <= 0) {
    return null;
  }

  const width = align.width;
  const height = align.height;
  const wallDist = align.wallDist;
  const cosO = Math.cos(meta.originYaw || 0);
  const sinO = Math.sin(meta.originYaw || 0);
  const res = Math.max(0.001, meta.resolution || 0.025);

  const mapToPixel = (xM: number, yM: number) => {
    const dx = xM - meta.originX;
    const dy = yM - meta.originY;
    const u = Math.round((cosO * dx + sinO * dy) / res);
    const v = Math.round(height - (-sinO * dx + cosO * dy) / res);
    return {
      u: Math.max(0, Math.min(width - 1, u)),
      v: Math.max(0, Math.min(height - 1, v)),
    };
  };

  const pixelToMap = (u: number, v: number) => {
    const x = (u + 0.5) * res;
    const y = (height - (v + 0.5)) * res;
    return {
      xM: Number((meta.originX + cosO * x - sinO * y).toFixed(4)),
      yM: Number((meta.originY + sinO * x + cosO * y).toFixed(4)),
    };
  };

  // Nếu điểm đầu/cuối sát tường, kéo nhẹ ra ô sàn trống gần nhất
  const snapToFreeCell = (u0: number, v0: number, minClearance = 2) => {
    const idx0 = v0 * width + u0;
    if (wallDist[idx0] >= minClearance) return { u: u0, v: v0 };
    let bestU = u0;
    let bestV = v0;
    let bestD = wallDist[idx0];
    for (let r = 1; r <= 14; r++) {
      for (let dv = -r; dv <= r; dv++) {
        for (let du = -r; du <= r; du++) {
          const nu = u0 + du;
          const nv = v0 + dv;
          if (nu < 0 || nu >= width || nv < 0 || nv >= height) continue;
          const wd = wallDist[nv * width + nu];
          if (wd >= minClearance) {
            return { u: nu, v: nv };
          }
          if (wd > bestD) {
            bestD = wd;
            bestU = nu;
            bestV = nv;
          }
        }
      }
    }
    return { u: bestU, v: bestV };
  };

  const rawS = mapToPixel(start.xM, start.yM);
  const rawG = mapToPixel(goal.xM, goal.yM);
  const s = snapToFreeCell(rawS.u, rawS.v, 2);
  const g = snapToFreeCell(rawG.u, rawG.v, 2);

  const startIdx = s.v * width + s.u;
  const goalIdx = g.v * width + g.u;
  if (startIdx === goalIdx) {
    return [
      { xM: start.xM, yM: start.yM },
      { xM: goal.xM, yM: goal.yM },
    ];
  }

  const total = width * height;
  const gScore = new Float32Array(total);
  gScore.fill(1e9);
  const parent = new Int32Array(total);
  parent.fill(-1);
  const closed = new Uint8Array(total);

  gScore[startIdx] = 0;
  const open: number[] = [startIdx];

  const d8: [number, number, number][] = [
    [-1, 0, 1],
    [1, 0, 1],
    [0, -1, 1],
    [0, 1, 1],
    [-1, -1, 1.4142],
    [1, -1, 1.4142],
    [-1, 1, 1.4142],
    [1, 1, 1.4142],
  ];

  let found = false;
  while (open.length > 0) {
    let bestI = 0;
    let bestF = 1e9;
    for (let i = 0; i < open.length; i++) {
      const idx = open[i];
      const ux = idx % width;
      const uy = (idx / width) | 0;
      const f = gScore[idx] + Math.hypot(ux - g.u, uy - g.v);
      if (f < bestF) {
        bestF = f;
        bestI = i;
      }
    }

    const cur = open.splice(bestI, 1)[0];
    if (cur === goalIdx) {
      found = true;
      break;
    }
    if (closed[cur]) continue;
    closed[cur] = 1;

    const ux = cur % width;
    const uy = (cur / width) | 0;

    for (let k = 0; k < 8; k++) {
      const [dx, dy, stepCost] = d8[k];
      const nx = ux + dx;
      const ny = uy + dy;
      if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
      const nIdx = ny * width + nx;
      if (closed[nIdx]) continue;
      const wd = wallDist[nIdx];
      if (wd < 1) continue; // Không đi xuyên tường

      // Phạt các ô quá sát tường để đường đi luôn bám chính giữa hành lang
      const clearancePenalty =
        wd === 1 ? 14 : wd < 7 ? (7 - wd) * 1.9 : 0;
      const tentativeG = gScore[cur] + stepCost + clearancePenalty;
      if (tentativeG < gScore[nIdx]) {
        gScore[nIdx] = tentativeG;
        parent[nIdx] = cur;
        open.push(nIdx);
      }
    }
  }

  if (!found) {
    return null;
  }

  const rawCells: { u: number; v: number }[] = [];
  let trace = goalIdx;
  while (trace !== -1) {
    rawCells.push({ u: trace % width, v: (trace / width) | 0 });
    trace = parent[trace];
  }
  rawCells.reverse();

  if (rawCells.length < 2) {
    return [
      { xM: start.xM, yM: start.yM },
      { xM: goal.xM, yM: goal.yM },
    ];
  }

  // Kiểm tra tầm nhìn thẳng (Line-of-Sight) trên hành lang để làm mượt bậc thang pixel
  const hasClearLineOfSight = (
    a: { u: number; v: number },
    b: { u: number; v: number },
    minClearance = 3
  ): boolean => {
    const du = b.u - a.u;
    const dv = b.v - a.v;
    const steps = Math.max(Math.abs(du), Math.abs(dv)) * 2;
    if (steps <= 1) return true;
    for (let sIdx = 1; sIdx < steps; sIdx++) {
      const t = sIdx / steps;
      const cu = Math.round(a.u + du * t);
      const cv = Math.round(a.v + dv * t);
      if (cu < 0 || cu >= width || cv < 0 || cv >= height) return false;
      if (wallDist[cv * width + cu] < minClearance) return false;
    }
    return true;
  };

  // String-pulling nhưng vẫn giữ các điểm neo cách nhau ~0.20m dọc hành lang để dẫn đường mượt
  const smoothedCells: { u: number; v: number }[] = [rawCells[0]];
  let anchor = 0;
  while (anchor < rawCells.length - 1) {
    let furthest = anchor + 1;
    for (let probe = rawCells.length - 1; probe > anchor + 1; probe--) {
      if (hasClearLineOfSight(rawCells[anchor], rawCells[probe], 3)) {
        furthest = probe;
        break;
      }
    }
    const aCell = rawCells[anchor];
    const bCell = rawCells[furthest];
    const segDistPx = Math.hypot(bCell.u - aCell.u, bCell.v - aCell.v);
    const subSteps = Math.max(1, Math.round(segDistPx / 8));
    for (let sIdx = 1; sIdx <= subSteps; sIdx++) {
      const t = sIdx / subSteps;
      smoothedCells.push({
        u: aCell.u + (bCell.u - aCell.u) * t,
        v: aCell.v + (bCell.v - aCell.v) * t,
      });
    }
    anchor = furthest;
  }

  const metricPoints = smoothedCells.map((c) => pixelToMap(c.u, c.v));
  metricPoints[0] = { xM: Number(start.xM.toFixed(4)), yM: Number(start.yM.toFixed(4)) };
  metricPoints[metricPoints.length - 1] = {
    xM: Number(goal.xM.toFixed(4)),
    yM: Number(goal.yM.toFixed(4)),
  };

  return metricPoints;
}

/**
 * Lộ trình hành lang dự phòng khi ảnh PNG đang tải (chưa giải mã xong)
 */
export function planFallbackCorridorPath(
  start: { xM: number; yM: number },
  goal: { xM: number; yM: number }
): { xM: number; yM: number }[] {
  const dx = goal.xM - start.xM;
  const dy = goal.yM - start.yM;
  if (Math.hypot(dx, dy) < 0.05) {
    return [
      { xM: start.xM, yM: start.yM },
      { xM: goal.xM, yM: goal.yM },
    ];
  }

  // Nếu cùng trục hành lang (chênh lệch X < 0.25m hoặc Y < 0.25m) -> đi thẳng
  if (Math.abs(dx) < 0.25 || Math.abs(dy) < 0.25) {
    return [
      { xM: start.xM, yM: start.yM },
      { xM: goal.xM, yM: goal.yM },
    ];
  }

  // Đi theo hành lang chữ L hoặc chữ Z qua lối thông giữa bản đồ (y ~ 1.75m hoặc y ~ 2.95m)
  const corner = { xM: start.xM, yM: goal.yM };
  return [
    { xM: start.xM, yM: start.yM },
    corner,
    { xM: goal.xM, yM: goal.yM },
  ];
}
