const assert = require("node:assert/strict");
const test = require("node:test");

const {
  downloadHookConfig,
  getApiKeyName,
  resolveHookConfigUris,
} = require("../src/lib/api-key.ts");

test("getApiKeyName resolves the default template", () => {
  assert.equal(
    getApiKeyName(
      "ghdr",
      "my-org",
      "stepsecurity/orgs/<github_env>/<owner>/vm-api-key",
    ),
    "stepsecurity/orgs/ghdr/my-org/vm-api-key",
  );
});

test("getApiKeyName replaces every placeholder occurrence", () => {
  assert.equal(
    getApiKeyName(
      "ghec",
      "MyOrg",
      "<github_env>/<owner>/<github_env>/<owner>",
    ),
    "ghec/MyOrg/ghec/MyOrg",
  );
});

test("getApiKeyName supports partial and fixed templates", () => {
  assert.equal(
    getApiKeyName("ghes", "MyOrg", "secrets/<owner>"),
    "secrets/MyOrg",
  );
  assert.equal(
    getApiKeyName("ghes", "MyOrg", "shared/vm-api-key"),
    "shared/vm-api-key",
  );
});

test("resolveHookConfigUris searches and returns every download URI", async () => {
  const artifactoryConfig = {
    base: "https://artifactory.example.com/artifactory",
    repo: "stepsecurity",
  };
  let searchedConfig;
  let searchedSelectors;

  const result = await resolveHookConfigUris(
    artifactoryConfig,
    async (config, selectors) => {
      searchedConfig = config;
      searchedSelectors = selectors;
      return [
        { downloadUri: "https://artifactory.example.com/primary.json" },
        {},
        { downloadUri: " https://artifactory.example.com/secondary.json " },
      ];
    },
  );

  assert.deepEqual(searchedConfig, artifactoryConfig);
  assert.deepEqual(searchedSelectors, {
    "ss.serving": "true",
    "ss.gha-hook-config": "true",
  });
  assert.deepEqual(result, [
    "https://artifactory.example.com/primary.json",
    "https://artifactory.example.com/secondary.json",
  ]);
});

test("resolveHookConfigUris requires a result with a download URI", async () => {
  const artifactoryConfig = {
    base: "https://artifactory.example.com/artifactory",
    repo: "stepsecurity",
  };

  await assert.rejects(
    resolveHookConfigUris(artifactoryConfig, async () => []),
    /unexpected-result-count count=0/,
  );
  await assert.rejects(
    resolveHookConfigUris(artifactoryConfig, async () => [{}, {}]),
    /missing-download-uri/,
  );
});

test("downloadHookConfig downloads and parses the configuration", async () => {
  let requestedUrl;
  let requestedHeaders;
  const result = await downloadHookConfig(
    "https://artifactory.example.com/config.json",
    async (url, headers) => {
      requestedUrl = url;
      requestedHeaders = headers;
      return {
        statusCode: 200,
        body: JSON.stringify({
          region: " us-west-2 ",
          roleArn: " arn:aws:iam::123:role/reader ",
        }),
      };
    },
  );

  assert.equal(requestedUrl.href, "https://artifactory.example.com/config.json");
  assert.deepEqual(requestedHeaders, { "User-Agent": "stepsecurity-jobhooks" });
  assert.deepEqual(result, {
    region: "us-west-2",
    roleArn: "arn:aws:iam::123:role/reader",
  });
});

test("downloadHookConfig rejects download and JSON errors", async () => {
  await assert.rejects(
    downloadHookConfig("https://artifactory.example.com/config.json", async () => ({
      statusCode: 503,
      body: "",
    })),
    /config-download-failed http_status=503/,
  );
  await assert.rejects(
    downloadHookConfig("https://artifactory.example.com/config.json", async () => ({
      statusCode: 200,
      body: "not-json",
    })),
    /invalid-config-json/,
  );
});

test("downloadHookConfig requires region and roleArn strings", async () => {
  for (const config of [
    { roleArn: "arn:aws:iam::123:role/reader" },
    { region: "", roleArn: "arn:aws:iam::123:role/reader" },
    { region: "us-west-2" },
    { region: "us-west-2", roleArn: 123 },
  ]) {
    await assert.rejects(
      downloadHookConfig(
        "https://artifactory.example.com/config.json",
        async () => ({ statusCode: 200, body: JSON.stringify(config) }),
      ),
      /ApiKey status=config-invalid field=/,
    );
  }
});
