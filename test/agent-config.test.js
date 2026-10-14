const assert = require("node:assert/strict");
const test = require("node:test");

const { getAgentIdentity } = require("../src/lib/agent-config.ts");

test("getAgentIdentity preserves the GHEC identity", () => {
  assert.deepEqual(
    getAgentIdentity(
      "ghec",
      "MyOrg/my-repo",
      "MyOrg",
      "my-repo",
      "",
      "MyOrg",
    ),
    {
      customer: "MyOrg",
      repo: "MyOrg/my-repo",
    },
  );
});

test("getAgentIdentity marks GHDR and GHES as GHES", () => {
  for (const githubEnv of ["ghdr", "ghes"]) {
    assert.deepEqual(
      getAgentIdentity(
        githubEnv,
        "MyOrg/my-repo",
        "MyOrg",
        "my-repo",
        " Customer ",
        "Customer::ServerOne::MyOrg",
      ),
      {
        customer: "Customer",
        repo: "Customer::ServerOne::MyOrg/my-repo",
        is_ghes: true,
      },
    );
  }
});
