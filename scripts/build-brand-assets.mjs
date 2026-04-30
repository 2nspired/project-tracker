#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "brand-source/source.png");

const COLOR = {
	dark: "#0a0a0a",
	light: "#fafafa",
	indigo: "#4338ca",
	indigoBg: "#312e81",
	indigoBgEnd: "#1e1b4b",
};

async function ensureDir(filePath) {
	await mkdir(dirname(filePath), { recursive: true });
}

async function recolor(srcBuffer, hex) {
	const meta = await sharp(srcBuffer).metadata();
	return sharp({
		create: {
			width: meta.width,
			height: meta.height,
			channels: 4,
			background: hex,
		},
	})
		.composite([{ input: srcBuffer, blend: "dest-in" }])
		.png()
		.toBuffer();
}

async function resizePng(buffer, size, opts = {}) {
	return sharp(buffer)
		.resize(size, size, {
			fit: "contain",
			background: opts.background ?? { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();
}

async function writePng(outPath, buffer) {
	// ROOT is the worktree root (parent of scripts/); resolve outPath inside it.
	const abs = resolve(ROOT, outPath);
	await ensureDir(abs);
	await writeFile(abs, buffer);
	console.log(`  → ${outPath}`);
}

async function buildLogoVariants(srcBuffer) {
	console.log("Logo variants:");
	const dark = await recolor(srcBuffer, COLOR.dark);
	const light = await recolor(srcBuffer, COLOR.light);

	// Starlight light/dark variants — 512px native, scales down crisply
	await writePng("docs-site/src/assets/logo-dark.png", await resizePng(dark, 512));
	await writePng("docs-site/src/assets/logo-light.png", await resizePng(light, 512));

	// README hero — 256px is plenty (display width 84)
	await writePng("docs-site/src/assets/logo-readme.png", await resizePng(dark, 256));
}

async function buildFavicons(srcBuffer) {
	console.log("Favicons:");
	const indigo = await recolor(srcBuffer, COLOR.indigo);

	// Browser tab + PWA sizes — indigo so it reads on both light + dark chrome
	for (const size of [32, 192, 512]) {
		const buf = await resizePng(indigo, size);
		await writePng(`docs-site/public/favicon-${size}.png`, buf);
	}
	// Primary favicon — 32px is the Starlight default
	await writePng("docs-site/public/favicon.png", await resizePng(indigo, 32));

	// Apple touch icon — solid white bg (Apple convention; iOS clips to rounded square)
	const appleBg = sharp({
		create: { width: 180, height: 180, channels: 4, background: "#ffffff" },
	});
	const appleGlyph = await resizePng(indigo, 140);
	const appleComposite = await appleBg
		.composite([{ input: appleGlyph, gravity: "center" }])
		.png()
		.toBuffer();
	await writePng("docs-site/public/apple-touch-icon.png", appleComposite);

	// Next.js App Router conventions — drop straight into src/app/
	await writePng("src/app/icon.png", await resizePng(indigo, 32));
	await writePng("src/app/apple-icon.png", appleComposite);
}

function buildOgSvg() {
	const W = 1200;
	const H = 630;
	const TEXT_X = 500;
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${COLOR.indigoBg}"/>
      <stop offset="100%" stop-color="${COLOR.indigoBgEnd}"/>
    </linearGradient>
    <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="rgba(255,255,255,0.04)" stroke-width="1"/>
    </pattern>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>
  <rect width="${W}" height="${H}" fill="url(#grid)"/>
  <text x="${TEXT_X}" y="220" font-family="-apple-system, system-ui, 'Segoe UI', sans-serif"
        font-size="26" font-weight="500" letter-spacing="3" fill="rgba(255,255,255,0.55)">
    PIGEON · LOCAL-FIRST MCP KANBAN
  </text>
  <text x="${TEXT_X}" y="320" font-family="-apple-system, system-ui, 'Segoe UI', sans-serif"
        font-size="62" font-weight="700" fill="#ffffff">
    Carries context between
  </text>
  <text x="${TEXT_X}" y="395" font-family="-apple-system, system-ui, 'Segoe UI', sans-serif"
        font-size="62" font-weight="700" fill="#ffffff">
    AI coding sessions.
  </text>
  <text x="${TEXT_X}" y="475" font-family="-apple-system, system-ui, 'Segoe UI', sans-serif"
        font-size="24" font-weight="400" fill="rgba(255,255,255,0.65)">
    SQLite on disk · No accounts · No cloud sync
  </text>
</svg>`;
}

async function buildOgImage(srcBuffer) {
	console.log("OG card:");
	const W = 1200;
	const H = 630;

	// Backdrop SVG (gradient + grid + text)
	const bgPng = await sharp(Buffer.from(buildOgSvg())).png().toBuffer();

	// Pigeon glyph — white silhouette, sized to fit the left panel
	const white = await recolor(srcBuffer, COLOR.light);
	const GLYPH = 380;
	const glyph = await sharp(white)
		.resize(GLYPH, GLYPH, {
			fit: "contain",
			background: { r: 0, g: 0, b: 0, alpha: 0 },
		})
		.png()
		.toBuffer();

	const composite = await sharp(bgPng)
		.composite([{ input: glyph, top: Math.round((H - GLYPH) / 2), left: 70 }])
		.png({ compressionLevel: 9 })
		.toBuffer();

	// Docs-site OG
	await writePng("docs-site/public/og.png", composite);

	// Next.js App Router OG — file convention auto-injects metadata
	await writePng("src/app/opengraph-image.png", composite);
	await writePng("src/app/twitter-image.png", composite);
}

async function main() {
	const srcBuffer = await sharp(SOURCE).png().toBuffer();
	const meta = await sharp(srcBuffer).metadata();
	console.log(`Source: ${SOURCE} (${meta.width}×${meta.height}, alpha=${meta.hasAlpha})\n`);

	await buildLogoVariants(srcBuffer);
	await buildFavicons(srcBuffer);
	await buildOgImage(srcBuffer);

	console.log("\nDone.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
