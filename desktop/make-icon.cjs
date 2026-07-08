// Regenerates build/icon.ico from the repo logo SVG. Run once after a logo
// change: `npm run icon`. Committed output means normal builds don't need
// sharp/png-to-ico installed.

const fs = require('fs');
const path = require('path');

async function main() {
  const sharp = require('sharp');
  const pngToIco = require('png-to-ico');

  const svg = fs.readFileSync(path.join(__dirname, '..', 'assets', 'sageflight-logo.svg'));
  const outDir = path.join(__dirname, 'build');
  fs.mkdirSync(outDir, { recursive: true });

  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = [];
  for (const s of sizes) {
    const buf = await sharp(svg, { density: 300 }).resize(s, s).png().toBuffer();
    pngs.push(buf);
  }
  const ico = await pngToIco(pngs);
  fs.writeFileSync(path.join(outDir, 'icon.ico'), ico);

  // 512px PNG for linux/mac targets later.
  fs.writeFileSync(
    path.join(outDir, 'icon.png'),
    await sharp(svg, { density: 300 }).resize(512, 512).png().toBuffer()
  );
  console.log('[icon] wrote build/icon.ico + build/icon.png');
}

main().catch(e => { console.error(e); process.exit(1); });
