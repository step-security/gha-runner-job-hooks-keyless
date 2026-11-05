const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.GITHUB_REPOSITORY = "MyOrg/my-repo";
process.env.GITHUB_WORKFLOW = "ci.yml";
process.env.GITHUB_RUN_ID = "42";
process.env.GITHUB_WORKSPACE = "/opt/actions-runner/_work/my-repo/my-repo";
process.env.STEP_EXPLICIT_PROXY_ENDPOINTS = "aws-proxy.mhf.mhc:8080, 192.88.99.88:8080 aws-proxy.mhf.mhc:8080";

const {
  buildSharedAgentJsonForCurrentJob,
  parseExplicitProxyEndpoints,
} = require("../src/lib/agent-config.ts");

test("parseExplicitProxyEndpoints splits on commas and whitespace and dedupes", () => {
  assert.deepEqual(parseExplicitProxyEndpoints(""), []);
  assert.deepEqual(parseExplicitProxyEndpoints("  "), []);
  assert.deepEqual(parseExplicitProxyEndpoints("a:1"), ["a:1"]);
  assert.deepEqual(parseExplicitProxyEndpoints("a:1,b:2 c:3,,  a:1"), ["a:1", "b:2", "c:3"]);
});

test("agent.json carries the explicit proxy keys when STEP_EXPLICIT_PROXY_ENDPOINTS is set", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-proxy-"));
  const agentJsonPath = path.join(dir, "agent.json");

  await buildSharedAgentJsonForCurrentJob(
    { agentJsonPath, isPersistent: true },
    { apiKey: "key", correlationId: "corr", config: null },
  );

  const written = JSON.parse(fs.readFileSync(agentJsonPath, "utf8"));
  assert.equal(written.is_explicit_proxy, true);
  assert.deepEqual(written.explicit_proxy_endpoints, ["aws-proxy.mhf.mhc:8080", "192.88.99.88:8080"]);
  assert.equal(written.egress_policy, "audit");
  assert.equal(written.is_persistent, true);
  assert.equal(written.customer, "MyOrg");
});
