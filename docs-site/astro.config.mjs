import starlight from "@astrojs/starlight";
import { defineConfig } from "astro/config";
import mermaid from "astro-mermaid";

// GitHub Pages deploys under /pigeon/ (workflow sets DOCS_BASE).
// Local dev serves at root so `localhost:4321/` just works.
const SITE = process.env.DOCS_SITE ?? "https://2nspired.github.io";
const BASE = process.env.DOCS_BASE ?? "/";

export default defineConfig({
	site: SITE,
	base: BASE,
	trailingSlash: "ignore",
	integrations: [
		mermaid({
			theme: "neutral",
			autoTheme: true,
		}),
		starlight({
			title: "Pigeon",
			description:
				"Local-first kanban board with MCP integration for AI-assisted development.",
			logo: {
				light: "./src/assets/logo-dark.png",
				dark: "./src/assets/logo-light.png",
				replacesTitle: false,
				alt: "Pigeon — local-first MCP kanban",
			},
			favicon: "/favicon.png",
			head: [
				{
					tag: "link",
					attrs: { rel: "icon", type: "image/png", sizes: "32x32", href: "/favicon-32.png" },
				},
				{
					tag: "link",
					attrs: { rel: "icon", type: "image/png", sizes: "192x192", href: "/favicon-192.png" },
				},
				{
					tag: "link",
					attrs: {
						rel: "apple-touch-icon",
						sizes: "180x180",
						href: "/apple-touch-icon.png",
					},
				},
				{ tag: "meta", attrs: { property: "og:image", content: `${SITE}${BASE}og.png` } },
				{ tag: "meta", attrs: { property: "og:image:width", content: "1200" } },
				{ tag: "meta", attrs: { property: "og:image:height", content: "630" } },
				{ tag: "meta", attrs: { name: "twitter:card", content: "summary_large_image" } },
				{ tag: "meta", attrs: { name: "twitter:image", content: `${SITE}${BASE}og.png` } },
			],
			social: [
				{
					icon: "github",
					label: "GitHub",
					href: "https://github.com/2nspired/pigeon",
				},
			],
			customCss: ["./src/styles/custom.css"],
			sidebar: [
				{
					label: "Start here",
					items: [
						{ label: "What is Pigeon?", slug: "index" },
						{ label: "Quickstart", slug: "quickstart" },
					],
				},
				{
					label: "Concepts",
					items: [
						{ label: "Mental model", slug: "concepts" },
						{ label: "Design rationale", slug: "why" },
					],
				},
				{
					label: "How-to",
					items: [
						{ label: "The session loop", slug: "workflow" },
						{ label: "Plan a card", slug: "plan-card" },
						{ label: "Write a tracker.md", slug: "tracker-md" },
						{ label: "Avoid anti-patterns", slug: "anti-patterns" },
					],
				},
				{
					label: "Reference",
					items: [
						{ label: "MCP tools", slug: "tools" },
						{ label: "Slash commands", slug: "slash-commands" },
						{ label: "Integration — /api/state", slug: "integration" },
					],
				},
			],
			editLink: {
				baseUrl:
					"https://github.com/2nspired/pigeon/edit/main/docs-site/",
			},
			lastUpdated: true,
		}),
	],
});
