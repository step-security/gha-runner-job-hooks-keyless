const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.GITHUB_REPOSITORY = "MyOrg/my-repo";
process.env.GITHUB_WORKFLOW = "ci.yml";
process.env.GITHUB_RUN_ID = "42";
delete process.env.STEP_EXPLICIT_PROXY_ENDPOINTS;

const { buildSharedAgentJsonForCurrentJob } = require("../src/lib/agent-config.ts");

test("agent.json has no proxy keys when STEP_EXPLICIT_PROXY_ENDPOINTS is unset", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-noproxy-"));
  const agentJsonPath = path.join(dir, "agent.json");

  await buildSharedAgentJsonForCurrentJob(
    { agentJsonPath, isPersistent: false },
    { apiKey: "key", correlationId: "corr", config: null },
  );

  const written = JSON.parse(fs.readFileSync(agentJsonPath, "utf8"));
  assert.equal("is_explicit_proxy" in written, false);
  assert.equal("explicit_proxy_endpoints" in written, false);
});
