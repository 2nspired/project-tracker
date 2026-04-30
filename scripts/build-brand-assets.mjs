#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SOURCE = resolve(ROOT, "brand-source/source.png");

// Single threshold gates the silhouette: alpha >= STENCIL_THRESHOLD becomes
// solid color, everything else becomes transparent. 240 cleanly removes the
// anti-alias outline ring and keeps the sunglass lens + X cut-outs visible
// as holes through the body. Verified by Read after generation.
const STENCIL_THRESHOLD = 240;

async function ensureDir(filePath) {
	await mkdir(dirname(filePath), { recursive: true });
}

// Convert the source PNG into a flat-color silhouette with the sunglass
// lenses (and X marks) as transparent holes. The source is white-on-
// transparent with the lens shapes drawn into the alpha channel; we threshold
// alpha to drop the soft outline ring, then paint the resulting mask into
// `hex`. Output is RGBA at the source's native size.
async function makeStencil(srcBuffer, hex) {
	const meta = await sharp(srcBuffer).metadata();
	const W = meta.width;
	const H = meta.height;

	const { data: maskRaw } = await sharp(srcBuffer)
		.extractChannel("alpha")
		.threshold(STENCIL_THRESHOLD)
		.raw()
		.toBuffer({ resolveWithObject: true });

	const r = parseInt(hex.slice(1, 3), 16);
	const g = parseInt(hex.slice(3, 5), 16);
	const b = parseInt(hex.slice(5, 7), 16);

	const rgba = Buffer.alloc(W * H * 4);
	for (let i = 0; i < W * H; i++) {
		rgba[i * 4] = r;
		rgba[i * 4 + 1] = g;
		rgba[i * 4 + 2] = b;
		rgba[i * 4 + 3] = maskRaw[i];
	}

	return sharp(rgba, { raw: { width: W, height: H, channels: 4 } })
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
	const abs = resolve(ROOT, outPath);
	await ensureDir(abs);
	await writeFile(abs, buffer);
	console.log(`  → ${outPath}`);
}

async function buildLogoVariants(srcBuffer) {
	console.log("Logo variants:");
	const blackStencil = await makeStencil(srcBuffer, "#000000");
	const whiteStencil = await makeStencil(srcBuffer, "#ffffff");

	// Starlight: logo-dark renders on light theme, logo-light on dark theme.
	await writePng(
		"docs-site/src/assets/logo-dark.png",
		await resizePng(blackStencil, 512),
	);
	await writePng(
		"docs-site/src/assets/logo-light.png",
		await resizePng(whiteStencil, 512),
	);
	// README hero — typically rendered on light backgrounds.
	await writePng(
		"docs-site/src/assets/logo-readme.png",
		await resizePng(blackStencil, 256),
	);
}

async function buildFavicons(srcBuffer) {
	console.log("Favicons:");
	const blackStencil = await makeStencil(srcBuffer, "#000000");

	for (const size of [32, 192, 512]) {
		await writePng(
			`docs-site/public/favicon-${size}.png`,
			await resizePng(blackStencil, size),
		);
	}
	await writePng(
		"docs-site/public/favicon.png",
		await resizePng(blackStencil, 32),
	);

	// Apple touch icon — solid white background, black stencil glyph.
	const appleBg = sharp({
		create: { width: 180, height: 180, channels: 4, background: "#ffffff" },
	});
	const appleGlyph = await resizePng(blackStencil, 140);
	const appleComposite = await appleBg
		.composite([{ input: appleGlyph, gravity: "center" }])
		.png()
		.toBuffer();
	await writePng("docs-site/public/apple-touch-icon.png", appleComposite);

	// Next.js App Router conventions.
	await writePng("src/app/icon.png", await resizePng(blackStencil, 32));
	await writePng("src/app/apple-icon.png", appleComposite);
}

function buildOgSvg() {
	const W = 1200;
	const H = 630;

	// Pure flat. No grid, no frame, no rails, no rules, no annotations.
	const BG = "#0a0a0a";
	const INK = "#fafafa";
	const INK_DIM = "rgba(250,250,250,0.6)";

	const SANS =
		"-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

	// Wordmark + tagline anchored to a single optical baseline.
	const TEXT_X = 540;

	return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${BG}"/>

  <text x="${TEXT_X}" y="318" font-family="${SANS}"
        font-size="156" font-weight="600"
        letter-spacing="-3.5" fill="${INK}">Pigeon</text>

  <text x="${TEXT_X}" y="380" font-family="${SANS}"
        font-size="32" font-weight="400"
        letter-spacing="-0.2" fill="${INK_DIM}">Carries context between AI coding sessions.</text>
</svg>`;
}

async function buildOgImage(srcBuffer) {
	console.log("OG card:");
	const W = 1200;
	const H = 630;

	const bgPng = await sharp(Buffer.from(buildOgSvg())).png().toBuffer();

	// White stencil silhouette on the dark backdrop.
	const whiteStencil = await makeStencil(srcBuffer, "#ffffff");
	const GLYPH = 380;
	const glyph = await resizePng(whiteStencil, GLYPH);

	const composite = await sharp(bgPng)
		.composite([{ input: glyph, top: Math.round((H - GLYPH) / 2), left: 110 }])
		.png({ compressionLevel: 9 })
		.toBuffer();

	await writePng("docs-site/public/og.png", composite);
	await writePng("src/app/opengraph-image.png", composite);
	await writePng("src/app/twitter-image.png", composite);
}

async function main() {
	const srcBuffer = await sharp(SOURCE).png().toBuffer();
	const meta = await sharp(srcBuffer).metadata();
	console.log(
		`Source: ${SOURCE} (${meta.width}×${meta.height}, alpha=${meta.hasAlpha})\n`,
	);

	await buildLogoVariants(srcBuffer);
	await buildFavicons(srcBuffer);
	await buildOgImage(srcBuffer);

	console.log("\nDone.");
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
