import type { z } from "zod";
import { logToolCall } from "./instrumentation.js";
import { requireIntentIfPolicyRequires, resolvePolicyForCall } from "./policy-enforcement.js";
import type { ToolResult } from "./utils.js";

// ─── Types ──────────────────────────────────────────────────────────

export type ToolCategory =
	| "discovery"
	| "cards"
	| "checklist"
	| "comments"
	| "milestones"
	| "tags"
	| "notes"
	| "activity"
	| "setup"
	| "relations"
	| "session"
	| "decisions"
	| "git"
	| "context"
	| "diagnostics";

export type ToolAnnotations = {
	readOnlyHint?: boolean;
	destructiveHint?: boolean;
	idempotentHint?: boolean;
};

export type ExtendedToolDef = {
	category: ToolCategory;
	description: string;
	parameters: z.ZodObject<z.ZodRawShape>;
	annotations?: ToolAnnotations;
	handler: (params: Record<string, unknown>) => Promise<ToolResult>;
};

// ─── Registry ───────────────────────────────────────────────────────

const registry = new Map<string, ExtendedToolDef>();

export function registerExtendedTool(name: string, def: ExtendedToolDef) {
	registry.set(name, def);
}

export function getRegistrySize(): number {
	return registry.size;
}

/**
 * Snapshot of all extended tools — used by the server manifest resource.
 * Returns tools sorted by category, then name.
 */
export function getAllExtendedTools(): Array<{
	name: string;
	category: string;
	description: string;
	readOnly: boolean;
	destructive: boolean;
}> {
	return Array.from(registry.entries())
		.map(([name, def]) => ({
			name,
			category: def.category,
			description: def.description,
			readOnly: def.annotations?.readOnlyHint ?? false,
			destructive: def.annotations?.destructiveHint ?? false,
		}))
		.sort((a, b) => {
			if (a.category !== b.category) return a.category.localeCompare(b.category);
			return a.name.localeCompare(b.name);
		});
}

// ─── getTools: Catalog Discovery ────────────────────────────────────

type ToolSummary = {
	name: string;
	category: string;
	description: string;
	readOnly?: boolean;
	destructive?: boolean;
};

type ParamInfo = {
	type: string;
	required: boolean;
	description: string;
	default?: unknown;
	enum?: string[];
	items?: Record<string, { type: string; required: boolean; description: string }>;
};

type ToolDetail = ToolSummary & {
	parameters: Record<string, ParamInfo>;
};

// biome-ignore-start lint/suspicious/noExplicitAny: Zod internals expose `_def` as Record<string, any> for runtime schema introspection; narrowing requires duplicating Zod's internal type machinery
function getDef(schema: z.ZodTypeAny): Record<string, any> {
	return schema._def as unknown as Record<string, any>;
}
// biome-ignore-end lint/suspicious/noExplicitAny: end Zod _def access scope

function unwrapZod(schema: z.ZodTypeAny): z.ZodTypeAny {
	const def = getDef(schema);
	if (
		def.typeName === "ZodOptional" ||
		def.typeName === "ZodDefault" ||
		def.typeName === "ZodNullable"
	) {
		return unwrapZod(def.innerType as z.ZodTypeAny);
	}
	return schema;
}

function zodTypeToString(schema: z.ZodTypeAny): string {
	let inner = schema;
	const def = getDef(inner);
	if (def.typeName === "ZodOptional" || def.typeName === "ZodDefault") {
		inner = def.innerType as z.ZodTypeAny;
	}
	const innerDef = getDef(inner);
	if (innerDef.typeName === "ZodNullable") {
		inner = innerDef.innerType as z.ZodTypeAny;
		return `${zodTypeToString(inner)} | null`;
	}
	if (innerDef.typeName === "ZodArray") {
		const elementType = zodTypeToString(innerDef.type as z.ZodTypeAny);
		return `array<${elementType}>`;
	}
	if (innerDef.typeName === "ZodEnum") return "enum";
	if (innerDef.typeName === "ZodString") return "string";
	if (innerDef.typeName === "ZodNumber") return "number";
	if (innerDef.typeName === "ZodBoolean") return "boolean";
	if (innerDef.typeName === "ZodObject") return "object";
	if (innerDef.typeName === "ZodRecord") return "record";
	if (innerDef.typeName === "ZodLiteral") return String(innerDef.value);
	if (innerDef.typeName === "ZodUnion") {
		const options = (innerDef.options as z.ZodTypeAny[]).map(zodTypeToString);
		return options.join(" | ");
	}
	if (innerDef.typeName === "ZodAny" || innerDef.typeName === "ZodUnknown") return "any";
	return schema.description ?? "unknown";
}

function extractObjectShape(
	schema: z.ZodObject<z.ZodRawShape>
): Record<string, { type: string; required: boolean; description: string }> {
	const result: Record<string, { type: string; required: boolean; description: string }> = {};
	for (const [key, value] of Object.entries(schema.shape)) {
		const field = value as z.ZodTypeAny;
		result[key] = {
			type: zodTypeToString(field),
			required: !field.isOptional(),
			description: field.description ?? "",
		};
	}
	return result;
}

function extractParamInfo(schema: z.ZodObject<z.ZodRawShape>): ToolDetail["parameters"] {
	const shape = schema.shape;
	const result: ToolDetail["parameters"] = {};

	for (const [key, value] of Object.entries(shape)) {
		const zodField = value as z.ZodTypeAny;
		const isOptional = zodField.isOptional();
		const def = getDef(zodField);

		let enumValues: string[] | undefined;
		let defaultValue: unknown;
		let items: ParamInfo["items"];

		// Extract enum values
		let inner = zodField;
		if (def.typeName === "ZodDefault") {
			defaultValue = def.defaultValue?.();
			inner = def.innerType as z.ZodTypeAny;
		}
		const innerDef = getDef(inner);
		if (innerDef.typeName === "ZodOptional") {
			inner = innerDef.innerType as z.ZodTypeAny;
		}
		const unwrappedDef = getDef(inner);
		if (unwrappedDef.typeName === "ZodEnum") {
			enumValues = unwrappedDef.values as string[];
		}

		// Extract array item shape when element is an object
		const unwrapped = unwrapZod(zodField);
		const unwrappedFieldDef = getDef(unwrapped);
		if (unwrappedFieldDef.typeName === "ZodArray") {
			const elementSchema = unwrapZod(unwrappedFieldDef.type as z.ZodTypeAny);
			const elementDef = getDef(elementSchema);
			if (elementDef.typeName === "ZodObject") {
				items = extractObjectShape(elementSchema as z.ZodObject<z.ZodRawShape>);
			}
		}

		result[key] = {
			type: zodTypeToString(zodField),
			required: !isOptional && defaultValue === undefined,
			description: zodField.description ?? "",
			...(defaultValue !== undefined && { default: defaultValue }),
			...(enumValues && { enum: enumValues }),
			...(items && { items }),
		};
	}

	return result;
}

/**
 * Get the tool catalog. Supports three modes:
 * - No args: returns all categories with tool counts
 * - category: returns tool summaries for that category
 * - tool: returns full detail for a specific tool including parameter schema
 */
export function getToolCatalog(opts?: { category?: string; tool?: string }):
	| {
			type: "categories";
			categories: Array<{ name: string; tools: number; description: string }>;
	  }
	| {
			type: "tools";
			category: string;
			tools: ToolSummary[];
	  }
	| {
			type: "detail";
			tool: ToolDetail;
	  }
	| null {
	// Specific tool detail
	if (opts?.tool) {
		const def = registry.get(opts.tool);
		if (!def) return null;
		return {
			type: "detail",
			tool: {
				name: opts.tool,
				category: def.category,
				description: def.description,
				readOnly: def.annotations?.readOnlyHint,
				destructive: def.annotations?.destructiveHint,
				parameters: extractParamInfo(def.parameters),
			},
		};
	}

	// Category listing
	if (opts?.category) {
		const tools: ToolSummary[] = [];
		for (const [name, def] of registry) {
			if (def.category === opts.category) {
				tools.push({
					name,
					category: def.category,
					description: def.description,
					readOnly: def.annotations?.readOnlyHint,
					destructive: def.annotations?.destructiveHint,
				});
			}
		}
		return { type: "tools", category: opts.category, tools };
	}

	// All categories overview
	const categoryMap = new Map<string, number>();
	for (const [, def] of registry) {
		categoryMap.set(def.category, (categoryMap.get(def.category) ?? 0) + 1);
	}

	const CATEGORY_DESCRIPTIONS: Record<string, string> = {
		discovery: "Find projects, boards, cards, stats, board audit, and smart queries",
		cards: "Bulk operations, templates, and card deletion",
		checklist: "Add, toggle, and bulk-add checklist sub-tasks",
		comments: "List comments on cards",
		milestones: "Create, update, and manage roadmap milestones",
		notes: "Create and manage project notes",
		activity: "View recent changes and activity history",
		setup: "Create projects, columns, and configure boards",
		relations: "Card dependencies — blocks, related, parent/child",
		session: "Session handoff and board diff between conversations",
		decisions: "Structured architectural decision records",
		git: "Git commit linking and code mapping",
		context: "Context bundles, persistent knowledge entries, and code facts",
		diagnostics: "Install health check — config drift, version skew, FTS state",
	};

	return {
		type: "categories",
		categories: Array.from(categoryMap.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([name, count]) => ({
				name,
				tools: count,
				description: CATEGORY_DESCRIPTIONS[name] ?? "",
			})),
	};
}

// ─── runTool: Execute Extended Tools ────────────────────────────────

/**
 * Execute an extended tool by name with parameter validation.
 */
export async function executeTool(
	name: string,
	params: Record<string, unknown>
): Promise<ToolResult> {
	const start = Date.now();

	const def = registry.get(name);
	if (!def) {
		// Suggest similar tool names
		const allNames = Array.from(registry.keys());
		const suggestions = allNames
			.filter(
				(n) =>
					n.toLowerCase().includes(name.toLowerCase()) ||
					name.toLowerCase().includes(n.toLowerCase())
			)
			.slice(0, 3);

		const hint =
			suggestions.length > 0
				? `Did you mean: ${suggestions.join(", ")}? Use getTools to see all available tools.`
				: "Use getTools to see all available tools.";

		const result: ToolResult = {
			content: [{ type: "text" as const, text: `Tool "${name}" not found. ${hint}` }],
			isError: true,
		};
		logToolCall(name, Date.now() - start, result);
		return result;
	}

	// Validate parameters
	const parsed = def.parameters.safeParse(params);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.map((i) => `  - ${i.path.join(".")}: ${i.message}`)
			.join("\n");
		const result: ToolResult = {
			content: [
				{
					type: "text" as const,
					text: `Invalid parameters for "${name}":\n${issues}\n\nUse getTools({ tool: "${name}" }) to see the full parameter schema.`,
				},
			],
			isError: true,
		};
		logToolCall(name, Date.now() - start, result);
		return result;
	}

	// Per-project tracker.md policy enforcement (RFC #111, card 3/7). Runs
	// after schema validation but before the handler — so a malformed call
	// still gets the precise schema-level error, and a well-typed call
	// gets the policy-level intent gate before any state mutation.
	//
	// Read-only short-circuit (card #232): tools annotated with
	// `readOnlyHint: true` can't trigger an `intent_required_on` violation,
	// so we skip the resolver entirely. This avoids a per-call `git rev-parse`
	// subprocess (3s timeout) + DB lookup on read-heavy sessions.
	const validatedParams = parsed.data as Record<string, unknown>;
	if (def.annotations?.readOnlyHint !== true) {
		const policy = await resolvePolicyForCall(validatedParams);
		const check = requireIntentIfPolicyRequires(policy, name, validatedParams);
		if (!check.ok) {
			const result: ToolResult = {
				content: [{ type: "text" as const, text: check.message }],
				isError: true,
			};
			logToolCall(name, Date.now() - start, result);
			return result;
		}
	}

	const result = await def.handler(validatedParams);
	logToolCall(name, Date.now() - start, result);
	return result;
}
