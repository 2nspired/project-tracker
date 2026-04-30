export type ServerBrand = "pigeon" | "project-tracker";

export const LEGACY_BRAND_DEPRECATION =
	"MCP entrypoint 'scripts/mcp-start.sh' (mcpServers key 'project-tracker') is the legacy alias. Switch your config to 'scripts/pigeon-start.sh' under key 'pigeon', and run `npm run migrate-rebrand` for the rest of the rename. Alias removed in v6.0.";

export function resolveServerBrand(
	env: Record<string, string | undefined> = process.env as Record<string, string | undefined>
): ServerBrand {
	return env.MCP_SERVER_BRAND === "project-tracker" ? "project-tracker" : "pigeon";
}
