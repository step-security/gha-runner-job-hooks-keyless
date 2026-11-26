const assert = require("node:assert/strict");
const test = require("node:test");

function loadScope(env) {
  const keys = ["GITHUB_SERVER_URL", "STEP_CUSTOMER", "STEP_SERVER_NAME"];
  const original = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  for (const k of keys) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  // config.ts reads the environment at import time.
  for (const id of Object.keys(require.cache)) {
    if (id.includes("/src/")) delete require.cache[id];
  }
  const scope = require("../src/linux/k8s/scope.ts");
  return {
    scope,
    restore() {
      for (const k of keys) {
        if (original[k] === undefined) delete process.env[k];
        else process.env[k] = original[k];
      }
    },
  };
}

function silenced(fn) {
  const original = console.log;
  const lines = [];
  console.log = (line) => lines.push(String(line));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = original;
  }
}

test("resolveK8sScopedOwner keeps the GitHub owner on github.com", () => {
  const { scope, restore } = loadScope({
    GITHUB_SERVER_URL: "https://github.com",
  });
  try {
    assert.equal(scope.resolveK8sScopedOwner("test-org"), "test-org");
  } finally {
    restore();
  }
});

test("resolveK8sScopedOwner scopes GHES and GHDR owners", () => {
  for (const serverUrl of [
    "https://github.example.com",
    "https://octocorp.ghe.com",
  ]) {
    const { scope, restore } = loadScope({
      GITHUB_SERVER_URL: serverUrl,
      STEP_CUSTOMER: "test-customer",
      STEP_SERVER_NAME: "server-one",
    });
    try {
      assert.equal(
        scope.resolveK8sScopedOwner("test-org"),
        "test-customer::server-one::test-org",
      );
    } finally {
      restore();
    }
  }
});

test("resolveK8sScopedOwner reports missing GHES configuration and returns null", () => {
  for (const env of [
    { GITHUB_SERVER_URL: "https://github.example.com" },
    {
      GITHUB_SERVER_URL: "https://github.example.com",
      STEP_CUSTOMER: "test-customer",
    },
    {
      GITHUB_SERVER_URL: "https://octocorp.ghe.com",
      STEP_SERVER_NAME: "server-one",
    },
  ]) {
    const { scope, restore } = loadScope(env);
    try {
      const { result, lines } = silenced(() =>
        scope.resolveK8sScopedOwner("test-org"),
      );
      assert.equal(result, null);
      assert.ok(lines.some((line) => line.startsWith("::error title=")));
    } finally {
      restore();
    }
  }
});

test("buildPrejobPolicyPayload keeps the daemon's five slash-separated parts", () => {
  const { scope, restore } = loadScope({});
  try {
    const payload = scope.buildPrejobPolicyPayload({
      scopedOwner: "test-customer::server-one::test-org",
      repo: "widgets",
      workflow: "build.yml",
      runId: "123",
      job: "build",
    });
    assert.equal(
      payload,
      "test-customer::server-one::test-org/widgets/build.yml/123/build",
    );
    assert.equal(payload.split("/").length, 5);
    assert.equal(payload.split("/")[0], "test-customer::server-one::test-org");

    assert.equal(
      scope.buildPrejobPolicyPayload({
        scopedOwner: "test-org",
        repo: "widgets",
        workflow: "build.yml",
        runId: "123",
        job: "build",
      }),
      "test-org/widgets/build.yml/123/build",
    );
  } finally {
    restore();
  }
});
