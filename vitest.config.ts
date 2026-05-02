import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
	plugins: [react()],
	test: {
		environment: "jsdom",
		globals: true,
		setupFiles: ["./src/__tests__/setup.ts"],
		exclude: ["**/node_modules/**", "**/dist/**", "**/.next/**", "**/.claude/**"],
		coverage: {
			provider: "v8",
			include: ["src/lib/**/*.ts"],
			exclude: [
				"src/lib/**/*.test.ts",
				"src/lib/**/__tests__/**",
				"src/lib/**/*.generated.ts",
			],
			reporter: ["text", "text-summary"],
			// Coverage floor on src/lib/ — pure functions are the highest-leverage
			// place to enforce tests. Floor set at the post-#255 baseline (32.8%
			// lines, 2026-05-01) minus 2pp for "no regression" headroom. Future
			// work (e.g. #246) ratchets this up.
			thresholds: {
				lines: 30,
			},
		},
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src"),
			"prisma/generated/client": path.resolve(__dirname, "./prisma/generated/client.ts"),
		},
	},
});
