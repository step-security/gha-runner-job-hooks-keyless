# StepSecurity Job Hooks

GitHub Actions self-hosted runner job hooks for running StepSecurity pre-job and post-job logic around every workflow job. The hooks use the native GitHub Actions runner hook environment variables to run a pre-job script when a job starts and a post-job script when a job completes.

The hook scripts are published as GitHub release assets and can be configured on the runner through small wrapper scripts.

## Prerequisites

Before configuring the hooks, ensure the runner has:

- A GitHub Actions self-hosted runner installed and running.
- Node.js available on `PATH` as `node`.
- Network access to GitHub release assets and the StepSecurity API endpoint.
- Permission to create the hook/agent directory, for example `/home/agent` on Linux.
- Permission to set the GitHub Actions runner hook variables: `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

Platform-specific requirements:

- Linux: `bash`, `curl`, and `sudo` if writing hook variables to `/etc/environment`.

Restart the GitHub Actions runner service after configuring hook variables so the runner picks them up.

## Configure Linux runner job hooks

Create wrapper scripts for the GitHub Actions runner job hooks. The wrappers export the hook configuration, download the published hook script for the configured release, and pipe it to `node`.

Create the pre-job and post-job wrapper scripts. Replace `vX.Y.Z` with the jobhooks release tag you want to use.

The examples below place the wrapper scripts in `/home/agent`, but this path is not required. You can use any absolute path that the runner can execute; if you choose a different path, update the hook environment variables to point to that location.

```sh
sudo mkdir -p /home/agent

cat <<EOF | sudo tee /home/agent/step-prejob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/pre.js" | node
EOF

cat <<EOF | sudo tee /home/agent/step-postjob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/post.js" | node
EOF

sudo chmod +x /home/agent/step-prejob-hook.sh /home/agent/step-postjob-hook.sh
```

Configure the GitHub Actions runner hook environment variables. These values must match the wrapper script paths you created:

```sh
echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/home/agent/step-prejob-hook.sh" | sudo tee -a /etc/environment
echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/home/agent/step-postjob-hook.sh" | sudo tee -a /etc/environment
```

Restart the GitHub Actions runner service after updating `/etc/environment`.

## Configuration

### GitHub Actions runner hook variables

These variables are used by the GitHub Actions runner to locate the hook wrapper scripts:

| Variable                            | Value                                                     |
| ----------------------------------- | --------------------------------------------------------- |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the executable pre-job wrapper script, for example `/home/agent/step-prejob-hook.sh` on Linux. |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the executable post-job wrapper script, for example `/home/agent/step-postjob-hook.sh` on Linux. |

### StepSecurity hook options

The following environment variables can be used to configure the hook behavior:

| Variable                    | Default                              | Description                                                               |
| --------------------------- | ------------------------------------ | ------------------------------------------------------------------------- |
| `STEP_AGENT_ROOT`           | `/home/agent`                        | Linux directory used for agent files, status files, logs, and hook state. |
| `STEP_DISABLE_AGENT_UPDATE` | `false`                              | Set to `true` to disable automatic Linux agent download/update.           |
| `STEP_AGENT_VERSION_LINUX`  | `latest`                             | Linux agent release to install. Use `latest` or a specific release tag.   |
| `STEP_API_KEY`              | ``                                   | StepSecurity API key. If set, the hook uses this value directly.          |
| `STEP_API_KEY_ROLE_ARN`     | ``                                   | IAM role to assume before reading the API key from AWS Secrets Manager.   |
| `STEP_API_KEY_SECRET_NAME`  | `stepsecurity/orgs/<owner>/vm-api-key` | Secrets Manager secret name. Supports `<owner>` placeholder substitution with the GitHub owner before reading the secret. |
| `STEP_API_KEY_SECRET_REGION`| `us-west-2`                          | AWS region for the Secrets Manager secret.                                |
| `STEP_API_KEY_SECRET_FIELD` | `api_key`                            | JSON field inside the Secrets Manager secret that contains the API key.   |
| `STEP_API`                  | `https://agent.api.stepsecurity.io/v1` | StepSecurity API endpoint.                                                |
| `STEP_TELEMETRY_URL`        | `https://prod.app-api.stepsecurity.io/v1` | StepSecurity telemetry endpoint.                                      |

Set these values in the pre-job and post-job wrapper scripts before running the hook. On Linux, use `export STEP_NAME=value`. Update the wrapper scripts and restart the runner service if you change these values.

### Resolving the StepSecurity API key

The hook resolves the API key in this order:

1. `STEP_API_KEY`
2. AWS Secrets Manager, using `STEP_API_KEY_ROLE_ARN`

To resolve the API key from AWS Secrets Manager, set:

- `STEP_API_KEY_ROLE_ARN` to a role the runner can assume
- `STEP_API_KEY_SECRET_NAME` to the secret name; use `<owner>` in the value if the name is org-specific, for example `stepsecurity/orgs/github-orgs/<owner>/vm-api-key`
- `STEP_API_KEY_SECRET_REGION` if the secret is not in `us-west-2`
- the GitHub owner to match the secret's `OrgName` tag, which is passed to STS as a session tag during `AssumeRole`
- `STEP_API_KEY_SECRET_FIELD` if the JSON field is not `api_key`

The secret value must be a JSON object containing the API key field, for example:

```json
{
  "api_key": "your-stepsecurity-api-key"
}
```

## Notes and troubleshooting

- `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` must point to wrapper scripts, not directly to `pre.js` or `post.js`.
- Hook failures can block the workflow job.
- Pin the hook URL to a specific release tag for reproducible runner behavior.
- The wrapper scripts download and execute the hook release asset each time the hook runs.
- Check Linux hook and agent files under `STEP_AGENT_ROOT`, which defaults to `/home/agent`.
