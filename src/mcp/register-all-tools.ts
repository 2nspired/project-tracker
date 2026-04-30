// Side-effect imports that populate the MCP tool registry. Single source
// of truth for which tool modules exist — both src/mcp/server.ts (the
// live MCP server) and the catalog/docs sync scripts pull from this list,
// so adding a new tool module is a one-line change in one place.
//
// Order matches src/mcp/server.ts.

import "./extended-tools.js";
import "./tools/discovery-tools.js";
import "./tools/relation-tools.js";
import "./tools/session-tools.js";
import "./tools/decision-tools.js";
import "./tools/context-tools.js";
import "./tools/plan-card.js";
import "./tools/query-tools.js";
import "./tools/git-tools.js";
import "./tools/summary-tools.js";
import "./tools/onboarding-tools.js";
import "./tools/status-tools.js";
import "./tools/fact-tools.js";
import "./tools/claim-tools.js";
import "./tools/knowledge-tools.js";
import "./tools/instrumentation-tools.js";
import "./tools/tag-tools.js";
import "./tools/token-tools.js";
import "./tools/doctor-tools.js";
