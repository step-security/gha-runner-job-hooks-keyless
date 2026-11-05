const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

process.env.GITHUB_REPOSITORY = "MyOrg/my-repo";
process.env.GITHUB_WORKFLOW = "ci.yml";
process.env.GITHUB_RUN_ID = "42";
process.env.GITHUB_WORKSPACE = "/opt/actions-runner/_work/my-repo/my-repo";
// the runner's own proxy settings, as the customer configures them
process.env.HTTPS_PROXY = "http://aws-proxy.mhf.mhc:8080";
process.env.https_proxy = "http://aws-proxy.mhf.mhc:8080";
process.env.HTTP_PROXY = "http://aws-proxy.mhf.mhc:8080";
process.env.http_proxy = "http://aws-proxy.mhf.mhc:8080";
delete process.env.STEP_EXPLICIT_PROXY_ENDPOINTS;

const {
  buildSharedAgentJsonForCurrentJob,
  parseExplicitProxyEndpoints,
  proxyEndpointFromUrl,
  resolveExplicitProxyEndpoints,
} = require("../src/lib/agent-config.ts");

test("parseExplicitProxyEndpoints splits on commas and whitespace and dedupes", () => {
  assert.deepEqual(parseExplicitProxyEndpoints(""), []);
  assert.deepEqual(parseExplicitProxyEndpoints("  "), []);
  assert.deepEqual(parseExplicitProxyEndpoints("a:1"), ["a:1"]);
  assert.deepEqual(parseExplicitProxyEndpoints("a:1,b:2 c:3,,  a:1"), ["a:1", "b:2", "c:3"]);
});

test("proxyEndpointFromUrl reduces a proxy URL to host:port", () => {
  assert.equal(proxyEndpointFromUrl("http://aws-proxy.mhf.mhc:8080"), "aws-proxy.mhf.mhc:8080");
  assert.equal(proxyEndpointFromUrl("http://user:secret@proxy.corp:3128/"), "proxy.corp:3128");
  assert.equal(proxyEndpointFromUrl("proxy.corp:3128"), "proxy.corp:3128");
  assert.equal(proxyEndpointFromUrl("http://proxy.corp"), "proxy.corp:80");
  assert.equal(proxyEndpointFromUrl("https://proxy.corp"), "proxy.corp:443");
  assert.equal(proxyEndpointFromUrl("http://192.88.99.88:8080"), "192.88.99.88:8080");
  assert.equal(proxyEndpointFromUrl(""), "");
  assert.equal(proxyEndpointFromUrl(undefined), "");
  assert.equal(proxyEndpointFromUrl("http://"), "");
});

test("resolveExplicitProxyEndpoints prefers the override, else dedupes the proxy variables", () => {
  assert.deepEqual(
    resolveExplicitProxyEndpoints({
      endpoints: "",
      proxyUrls: ["http://a:8080", "http://a:8080", "http://b:3128", undefined, ""],
    }),
    ["a:8080", "b:3128"],
  );
  assert.deepEqual(
    resolveExplicitProxyEndpoints({ endpoints: "x:1 y:2", proxyUrls: ["http://a:8080"] }),
    ["x:1", "y:2"],
  );
  assert.deepEqual(resolveExplicitProxyEndpoints({ endpoints: "", proxyUrls: [] }), []);
});

test("agent.json carries the proxy keys derived from the runner's proxy variables", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "hooks-proxy-"));
  const agentJsonPath = path.join(dir, "agent.json");

  await buildSharedAgentJsonForCurrentJob(
    { agentJsonPath, isPersistent: true },
    { apiKey: "key", correlationId: "corr", config: null },
  );

  const written = JSON.parse(fs.readFileSync(agentJsonPath, "utf8"));
  assert.equal(written.is_explicit_proxy, true);
  assert.deepEqual(written.explicit_proxy_endpoints, ["aws-proxy.mhf.mhc:8080"]);
  assert.equal(written.egress_policy, "audit");
  assert.equal(written.is_persistent, true);
  assert.equal(written.customer, "MyOrg");
});
