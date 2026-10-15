export type GithubRunContext = {
  githubRepository: string;
  owner: string;
  repo: string;
  workflow: string;
  runId: string;
  stepSummaryPath: string;
  job: string;
  eventPath: string;
};

export type GitHubEnv = "ghec" | "ghdr" | "ghes";

export function getGithubRunContext(): GithubRunContext {
  const githubRepository = process.env.GITHUB_REPOSITORY || "";

  return {
    githubRepository,
    owner: githubRepository.split("/")[0] || "",
    repo: githubRepository.split("/")[1] || "",
    workflow: parseWorkflowName(process.env.GITHUB_WORKFLOW_REF || ""),
    runId: process.env.GITHUB_RUN_ID || "",
    stepSummaryPath: process.env.GITHUB_STEP_SUMMARY || "",
    job: process.env.GITHUB_JOB || "",
    eventPath: process.env.GITHUB_EVENT_PATH || "",
  };
}

export function getGitHubEnv(url?: string): GitHubEnv {
  const ghUrl = new URL(
    url?.trim() || process.env.GITHUB_SERVER_URL || "https://github.com",
  );
  const hostname = ghUrl.hostname.trimEnd().toUpperCase();

  if (hostname === "GITHUB.COM") return "ghec";
  if (hostname.endsWith(".GHE.COM")) return "ghdr";
  if (hostname.endsWith(".LOCALHOST")) return "ghec";
  return "ghes";
}

export function getScopedOwner(
  githubEnv: GitHubEnv,
  owner: string,
  customer: string,
  serverName: string,
): string {
  if (githubEnv === "ghec") {
    return owner;
  }

  const normalizedCustomer = customer.trim();
  if (!normalizedCustomer) {
    throw new Error(`ScopedOwner status=config-invalid reason=missing-customer`);
  }

  const normalizedServerName = serverName.trim();
  if (!normalizedServerName) {
    throw new Error(`ScopedOwner status=config-invalid reason=missing-server-name`);
  }

  return `${normalizedCustomer}::${normalizedServerName}::${owner}`;
}

function parseWorkflowName(workflowRef: string): string {
  return workflowRef
    .replace(/.*\.github\/workflows\//, "")
    .replace(/@.*/, "");
}
