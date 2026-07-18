import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { inflateSync } from "node:zlib";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readPngHeader(relativePath) {
  const path = join(root, relativePath);
  const bytes = readFileSync(path);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(pngSignature)) {
    throw new Error(`${relativePath} is not a valid PNG`);
  }
  if (bytes.toString("ascii", 12, 16) !== "IHDR") {
    throw new Error(`${relativePath} has no leading IHDR chunk`);
  }
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    bitDepth: bytes[24],
    colorType: bytes[25],
  };
}

function expectPng(relativePath, width, height, colorType, label) {
  const header = readPngHeader(relativePath);
  if (
    header.width !== width ||
    header.height !== height ||
    header.bitDepth !== 8 ||
    header.colorType !== colorType
  ) {
    throw new Error(
      `${relativePath} must be ${width}x${height} 8-bit ${label}; received ` +
        `${header.width}x${header.height}, depth ${header.bitDepth}, type ${header.colorType}`,
    );
  }
}

function expectRgba(relativePath, width, height) {
  expectPng(relativePath, width, height, 6, "RGBA");
}

function expectRgb(relativePath, width, height) {
  expectPng(relativePath, width, height, 2, "RGB");
}

function expectWebp(relativePath, width, height) {
  const bytes = readFileSync(join(root, relativePath));
  if (
    bytes.length < 30 ||
    bytes.toString("ascii", 0, 4) !== "RIFF" ||
    bytes.toString("ascii", 8, 12) !== "WEBP" ||
    bytes.toString("ascii", 12, 16) !== "VP8 " ||
    bytes[23] !== 0x9d ||
    bytes[24] !== 0x01 ||
    bytes[25] !== 0x2a
  ) {
    throw new Error(`${relativePath} is not the expected lossy WebP asset`);
  }
  const actualWidth = bytes.readUInt16LE(26) & 0x3fff;
  const actualHeight = bytes.readUInt16LE(28) & 0x3fff;
  if (actualWidth !== width || actualHeight !== height) {
    throw new Error(
      `${relativePath} must be ${width}x${height}; received ${actualWidth}x${actualHeight}`,
    );
  }
}

function expectSha256(relativePath, expected) {
  const actual = createHash("sha256")
    .update(readFileSync(join(root, relativePath)))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(`${relativePath} does not match its reviewed authored asset digest`);
  }
}

function paethPredictor(left, up, upperLeft) {
  const estimate = left + up - upperLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upperLeftDistance = Math.abs(estimate - upperLeft);
  if (leftDistance <= upDistance && leftDistance <= upperLeftDistance) {
    return left;
  }
  return upDistance <= upperLeftDistance ? up : upperLeft;
}

function readRgbaPixels(relativePath) {
  const bytes = readFileSync(join(root, relativePath));
  const header = readPngHeader(relativePath);
  if (header.bitDepth !== 8 || header.colorType !== 6 || bytes[28] !== 0) {
    throw new Error(`${relativePath} must be a non-interlaced 8-bit RGBA PNG`);
  }

  const compressed = [];
  let offset = 8;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) {
      throw new Error(`${relativePath} contains a truncated PNG chunk`);
    }
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") {
      compressed.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset = end;
    if (type === "IEND") {
      break;
    }
  }
  if (compressed.length === 0) {
    throw new Error(`${relativePath} has no image data`);
  }

  const packed = inflateSync(Buffer.concat(compressed));
  const bytesPerPixel = 4;
  const stride = header.width * bytesPerPixel;
  const expectedLength = (stride + 1) * header.height;
  if (packed.length !== expectedLength) {
    throw new Error(`${relativePath} has an unexpected decoded pixel length`);
  }

  const pixels = Buffer.alloc(stride * header.height);
  let sourceOffset = 0;
  for (let y = 0; y < header.height; y += 1) {
    const filter = packed[sourceOffset];
    sourceOffset += 1;
    const rowOffset = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const encoded = packed[sourceOffset + x];
      const left = x >= bytesPerPixel ? pixels[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? pixels[rowOffset + x - stride] : 0;
      const upperLeft =
        y > 0 && x >= bytesPerPixel
          ? pixels[rowOffset + x - stride - bytesPerPixel]
          : 0;
      let predictor;
      switch (filter) {
        case 0:
          predictor = 0;
          break;
        case 1:
          predictor = left;
          break;
        case 2:
          predictor = up;
          break;
        case 3:
          predictor = Math.floor((left + up) / 2);
          break;
        case 4:
          predictor = paethPredictor(left, up, upperLeft);
          break;
        default:
          throw new Error(`${relativePath} uses unsupported PNG filter ${filter}`);
      }
      pixels[rowOffset + x] = (encoded + predictor) & 0xff;
    }
    sourceOffset += stride;
  }

  return { ...header, pixels };
}

function expectDistinctVisibleQuadrants(relativePath) {
  const { width, height, pixels } = readRgbaPixels(relativePath);
  if (width % 2 !== 0 || height % 2 !== 0) {
    throw new Error(`${relativePath} must divide into an exact 2-by-2 pose grid`);
  }
  const tileWidth = width / 2;
  const tileHeight = height / 2;
  const digests = new Set();
  for (let index = 0; index < 4; index += 1) {
    const startX = (index % 2) * tileWidth;
    const startY = Math.floor(index / 2) * tileHeight;
    const hash = createHash("sha256");
    let visible = false;
    for (let y = startY; y < startY + tileHeight; y += 1) {
      const rowStart = (y * width + startX) * 4;
      const rowEnd = rowStart + tileWidth * 4;
      const row = pixels.subarray(rowStart, rowEnd);
      hash.update(row);
      for (let alpha = 3; alpha < row.length; alpha += 4) {
        if (row[alpha] !== 0) {
          visible = true;
          break;
        }
      }
    }
    if (!visible) {
      throw new Error(`${relativePath} frame ${index} has no visible pixels`);
    }
    const digest = hash.digest("hex");
    if (digests.has(digest)) {
      throw new Error(`${relativePath} frame ${index} duplicates an earlier pose`);
    }
    digests.add(digest);
  }
}

function expectAnimatedAtlasCells(relativePath) {
  const { width, pixels } = readRgbaPixels(relativePath);
  const cellSize = 512;
  const padding = 18;
  for (let kind = 0; kind < 6; kind += 1) {
    const frameDigests = new Set();
    for (let frame = 0; frame < 4; frame += 1) {
      const startX = (kind % 3) * cellSize;
      const startY = (frame * 2 + Math.floor(kind / 3)) * cellSize;
      const hash = createHash("sha256");
      let visible = false;
      let clipped = false;
      for (let y = 0; y < cellSize; y += 1) {
        const rowStart = ((startY + y) * width + startX) * 4;
        const row = pixels.subarray(rowStart, rowStart + cellSize * 4);
        hash.update(row);
        for (let x = 0; x < cellSize; x += 1) {
          if (row[x * 4 + 3] === 0) {
            continue;
          }
          visible = true;
          clipped ||=
            x < padding ||
            x >= cellSize - padding ||
            y < padding ||
            y >= cellSize - padding;
        }
      }
      if (!visible) {
        throw new Error(`${relativePath} kind ${kind} frame ${frame} is empty`);
      }
      if (clipped) {
        throw new Error(
          `${relativePath} kind ${kind} frame ${frame} enters its safety padding`,
        );
      }
      const digest = hash.digest("hex");
      if (frameDigests.has(digest)) {
        throw new Error(
          `${relativePath} kind ${kind} frame ${frame} duplicates an earlier frame`,
        );
      }
      frameDigests.add(digest);
    }
  }
}

expectRgba("assets/sprites/brainrot-enemies-canonical.png", 1536, 4096);
expectSha256(
  "assets/sprites/brainrot-enemies-canonical.png",
  "a37f297a7becf621acb0fa02b812961f5fbc2a70d75794d59acdabb63e4e6da9",
);
expectAnimatedAtlasCells("assets/sprites/brainrot-enemies-canonical.png");
expectRgba("assets/sprites/tower-defenders.png", 1536, 1024);
expectRgb("assets/maps/backyard-wifi.png", 1672, 941);
expectWebp("assets/maps/backyard-wifi.webp", 1672, 941);
expectSha256(
  "assets/maps/backyard-wifi.png",
  "481cbdfb19e2023f482d545c77a29c880644e8ac90a251cc65374103df20cac7",
);
expectSha256(
  "assets/maps/backyard-wifi.webp",
  "f4961e85ac02de9079a14cedf36733df40a85728885e681602794adf263bac99",
);
expectRgb("assets/maps/school-hallway-rush-v2.png", 1672, 941);
expectWebp("assets/maps/school-hallway-rush-v2.webp", 1672, 941);
expectSha256(
  "assets/maps/school-hallway-rush-v2.png",
  "ee1628d0efa61f75b8f65a1cf507e47b96dd3576a969ef57117a7ad99b435f27",
);
expectSha256(
  "assets/maps/school-hallway-rush-v2.webp",
  "eb9ae4a1d76d18cb3efe469fc27019ab7b8cc06e0ec0b2272cb6255fb6faa3c6",
);

for (const filename of [
  "tralalero.png",
  "cappuccino.png",
  "tung.png",
  "ballerina.png",
  "boneca.png",
  "la-vaca.png",
]) {
  expectRgba(`assets/sprites/featured-enemies/${filename}`, 1254, 1254);
}

for (const [filename, digest] of [
  ["tralalero.png", "53146e7bbe69f0d9944ad815124cc4371d60eb19356e6148246064adfba826c3"],
  ["cappuccino.png", "ef65c2f5a3b1042989fe077e9a1f6249118a7e21ebfc6636022deb7a50f9d62d"],
  ["tung.png", "57a7c1e279ab3a74a750c86b58afcaf735c953215b83c4612b1368aa99c6c9e2"],
  ["ballerina.png", "c81e4c539c448b304ab0f9a0cab0f5ba3816a9eb0d89ddb605eeea97128c29fe"],
  ["boneca.png", "300eb2402498b2c122b4b067a65696bdf03b8750a4d49bc12c11d081ae484044"],
  ["la-vaca.png", "31ff92807452aaacc98c41e9532e5c46f49517f12aa68cd29d40d43fdf942b84"],
]) {
  const path = `assets/sprites/featured-enemies/animation-sheets/${filename}`;
  expectRgba(path, 1254, 1254);
  expectSha256(path, digest);
  expectDistinctVisibleQuadrants(path);
}

console.log(
  "reviewed source maps, runtime WebPs, tower atlas, four-frame enemy atlas, and six reviewed animation sheets match their authored asset contracts",
);
