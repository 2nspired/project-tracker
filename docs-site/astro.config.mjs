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
			logo: { src: "./src/assets/logo.svg", replacesTitle: false },
			favicon: "/favicon.svg",
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
