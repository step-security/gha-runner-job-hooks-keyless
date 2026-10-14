const assert = require("node:assert/strict");
const test = require("node:test");

const { parsePolicyStoreConfig } = require("../src/lib/policy.ts");

test("parsePolicyStoreConfig parses allowed and denied endpoints", () => {
  assert.deepEqual(
    parsePolicyStoreConfig(
      JSON.stringify({
        policy_name: "policy",
        allowed_endpoints: ["github.com:443", 123, "api.github.com:443"],
        denied_endpoints: ["example.com:443", false, "example.org:443"],
        egress_policy: "block",
      }),
    ),
    {
      policyName: "policy",
      allowedEndpoints: "github.com:443 api.github.com:443",
      deniedEndpoints: "example.com:443 example.org:443",
      disableSudo: false,
      disableSudoAndContainers: false,
      disableFileMonitoring: false,
      disableTelemetry: false,
      egressPolicy: "block",
    },
  );
});

test("parsePolicyStoreConfig defaults invalid endpoint fields to empty", () => {
  const missing = parsePolicyStoreConfig(
    JSON.stringify({ policy_name: "policy" }),
  );
  assert.equal(missing?.allowedEndpoints, "");
  assert.equal(missing?.deniedEndpoints, "");

  const invalid = parsePolicyStoreConfig(
    JSON.stringify({
      policy_name: "policy",
      allowed_endpoints: "github.com:443",
      denied_endpoints: "example.com:443",
    }),
  );
  assert.equal(invalid?.allowedEndpoints, "");
  assert.equal(invalid?.deniedEndpoints, "");
});
