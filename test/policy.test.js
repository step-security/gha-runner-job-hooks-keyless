const assert = require("node:assert/strict");
const test = require("node:test");

const {
  parsePolicyStoreConfig,
  parseRunPolicyEvaluation,
} = require("../src/lib/policy.ts");

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

test("parseRunPolicyEvaluation parses supported conclusions and summaries", () => {
  assert.deepEqual(
    parseRunPolicyEvaluation({
      conclusion: "block",
      summary_markdown: "## Blocked",
      summary_log: "Run policy blocked this job",
    }),
    {
      conclusion: "block",
      summaryMarkdown: "## Blocked",
      summaryLog: "Run policy blocked this job",
    },
  );
  assert.deepEqual(parseRunPolicyEvaluation({ conclusion: "proceed" }), {
    conclusion: "proceed",
    summaryMarkdown: undefined,
    summaryLog: undefined,
  });
});

test("parseRunPolicyEvaluation rejects malformed evaluations", () => {
  for (const value of [null, "block", {}, { conclusion: "unknown" }]) {
    assert.equal(parseRunPolicyEvaluation(value), null);
  }
});
