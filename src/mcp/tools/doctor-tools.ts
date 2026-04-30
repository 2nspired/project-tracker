import { z } from "zod";
import { runDoctor } from "@/lib/doctor/index.js";
import { registerExtendedTool } from "../tool-registry.js";
import { ok, safeExecute } from "../utils.js";

registerExtendedTool("doctor", {
	category: "diagnostics",
	description:
		"Install health check — runs 8 checks for legacy config drift, version skew, and FTS state. Returns structured { checks, summary } with copy-pasteable fix commands per failed check.",
	parameters: z.object({}),
	annotations: { readOnlyHint: true },
	handler: () =>
		safeExecute(async () => {
			const report = await runDoctor();
			return ok(report);
		}),
});
