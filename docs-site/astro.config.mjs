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
			title: "Project Tracker",
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
					label: "Get started",
					items: [
						{ label: "What is Project Tracker?", slug: "index" },
						{ label: "Quickstart", slug: "quickstart" },
					],
				},
				{
					label: "How it works",
					items: [
						{ label: "The session loop", slug: "workflow" },
						{ label: "Design rationale", slug: "why" },
						{ label: "Anti-patterns", slug: "anti-patterns" },
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
