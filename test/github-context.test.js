const assert = require("node:assert/strict");
const test = require("node:test");

const {
  getGitHubEnv,
  getScopedOwner,
} = require("../src/lib/github-context.ts");

test("getGitHubEnv detects GitHub Enterprise Cloud", () => {
  assert.equal(getGitHubEnv("https://github.com"), "ghec");
  assert.equal(getGitHubEnv("  https://github.com/  "), "ghec");
  assert.equal(getGitHubEnv("http://runner.localhost:3000"), "ghec");
});

test("getGitHubEnv detects GitHub data residency", () => {
  assert.equal(getGitHubEnv("https://octocorp.ghe.com"), "ghdr");
  assert.equal(getGitHubEnv("https://EU.OCTOCORP.GHE.COM/path"), "ghdr");
});

test("getGitHubEnv treats other hosts as GitHub Enterprise Server", () => {
  assert.equal(getGitHubEnv("https://github.example.com"), "ghes");
  assert.equal(getGitHubEnv("https://github.internal"), "ghes");
});

test("getGitHubEnv defaults to github.com", () => {
  const originalServerUrl = process.env.GITHUB_SERVER_URL;
  delete process.env.GITHUB_SERVER_URL;

  try {
    assert.equal(getGitHubEnv(), "ghec");
  } finally {
    if (originalServerUrl === undefined) {
      delete process.env.GITHUB_SERVER_URL;
    } else {
      process.env.GITHUB_SERVER_URL = originalServerUrl;
    }
  }
});

test("getScopedOwner leaves GHEC owners unchanged", () => {
  assert.equal(getScopedOwner("ghec", "MyOrg", "", ""), "MyOrg");
});

test("getScopedOwner scopes GHDR and GHES owners", () => {
  assert.equal(
    getScopedOwner("ghdr", "MyOrg", "Customer", "EU"),
    "Customer::EU::MyOrg",
  );
  assert.equal(
    getScopedOwner("ghes", "MyOrg", "Customer", "ServerOne"),
    "Customer::ServerOne::MyOrg",
  );
});

test("getScopedOwner requires customer and server name outside GHEC", () => {
  assert.throws(
    () => getScopedOwner("ghdr", "MyOrg", "", "EU"),
    /missing-customer/,
  );
  assert.throws(
    () => getScopedOwner("ghes", "MyOrg", "Customer", ""),
    /missing-server-name/,
  );
});
