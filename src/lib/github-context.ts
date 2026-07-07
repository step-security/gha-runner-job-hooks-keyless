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

function parseWorkflowName(workflowRef: string): string {
  const workflowMatch = workflowRef.match(/.*\/([^@]*)@.*/);
  return workflowMatch ? workflowMatch[1] : workflowRef;
}

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
