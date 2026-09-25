// Generates the PWA icons and the favicon from the DGK logo (§15). Dev only: `npm run icons`.
// The PNGs are committed, so builds never need sharp.
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const CREAM = "#f9f8f6"; // --background

// Mirrors src/components/dgk-logo.tsx (64 × 64 view box).
const MARK = `
  <circle cx="32" cy="32" r="29" fill="none" stroke="#0ec5b0" stroke-width="4"/>
  <text x="32" y="39.5" text-anchor="middle" font-size="20" font-weight="700" font-family="Inter, Arial, Helvetica, sans-serif">
    <tspan fill="#0ec5b0">D</tspan><tspan fill="#ff7614" font-family="Georgia, 'Times New Roman', serif">G</tspan><tspan fill="#02693e">K</tspan>
  </text>`;

/** The mark centred on a cream square, with `padding` (a fraction of the size) on each side. */
function iconSvg(size, padding) {
  const offset = size * padding;
  const scale = (size - 2 * offset) / 64;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">` +
      `<rect width="${size}" height="${size}" fill="${CREAM}"/>` +
      `<g transform="translate(${offset} ${offset}) scale(${scale})">${MARK}</g></svg>`,
  );
}

const icons = fileURLToPath(new URL("../public/icons/", import.meta.url));
await mkdir(icons, { recursive: true });

// Maskable icons keep the mark inside the central 80% safe zone.
for (const [name, size, padding] of [
  ["icon-192.png", 192, 0.06],
  ["icon-512.png", 512, 0.06],
  ["maskable-512.png", 512, 0.16],
  ["apple-touch-icon.png", 180, 0.1],
]) {
  await sharp(iconSvg(size, padding)).png().toFile(`${icons}${name}`);
  console.log(`public/icons/${name}`);
}

// favicon.ico: one 32 × 32 PNG inside an ICO container (sharp doesn't write ICO).
const png = await sharp(iconSvg(32, 0.02)).png().toBuffer();
const header = Buffer.alloc(22);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(1, 4); // one image
header.writeUInt8(32, 6); // width
header.writeUInt8(32, 7); // height
header.writeUInt16LE(1, 10); // colour planes
header.writeUInt16LE(32, 12); // bits per pixel
header.writeUInt32LE(png.length, 14);
header.writeUInt32LE(22, 18); // image offset
await writeFile(fileURLToPath(new URL("../src/app/favicon.ico", import.meta.url)), Buffer.concat([header, png]));
console.log("src/app/favicon.ico");
