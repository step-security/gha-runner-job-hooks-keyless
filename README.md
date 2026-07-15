# StepSecurity Job Hooks

GitHub Actions self-hosted runner job hooks for running StepSecurity pre-job and post-job logic around every workflow job. The hooks use the native GitHub Actions runner hook environment variables to run a pre-job script when a job starts and a post-job script when a job completes.

The hook scripts are published as GitHub release assets and can be configured on the runner through small wrapper scripts.

## Prerequisites

Before configuring the hooks, ensure the runner has:

- A GitHub Actions self-hosted runner installed and running.
- Node.js available on `PATH` as `node`.
- Network access to the configured hook asset URL and the StepSecurity API endpoint.
- Permission to create a directory for the hook wrapper scripts, for example `/opt/step-security` on Linux.
- Permission to set the GitHub Actions runner hook variables: `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

Platform-specific requirements:

- Linux: `bash`, `curl`, and `sudo` if writing hook variables to `/etc/environment`.

Restart the GitHub Actions runner service after configuring hook variables so the runner picks them up.

## Usage

The job hooks can be adopted in two common hosting models:

- A DevOps team manages the runner configuration directly and points wrapper scripts at the StepSecurity GitHub release assets.
- A central platform or security team hosts approved hook assets internally, while DevOps teams only configure runners to use those internal URLs.

In both models, the GitHub Actions runner executes local wrapper scripts through `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`. The hosting model determines where those wrapper scripts download `pre.js` and `post.js`.

### Option 1: DevOps team installs hooks on each runner

This is the minimal setup for a team that manages its own self-hosted runners. The wrapper scripts export the hook configuration, download the published hook script for the configured release, and pipe it to `node`.

Replace `vX.Y.Z` with the jobhooks release tag you want to use.

The examples below place the wrapper scripts in `/opt/step-security`. This path is only for the wrapper scripts and does not need to match `STEP_AGENT_ROOT`. You can use any absolute path that the runner can execute; if you choose a different path, update the hook environment variables to point to that location.

```sh
sudo mkdir -p /opt/step-security

cat <<EOF | sudo tee /opt/step-security/step-prejob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/pre.js" | node
EOF

cat <<EOF | sudo tee /opt/step-security/step-postjob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/post.js" | node
EOF

sudo chmod +x /opt/step-security/step-prejob-hook.sh /opt/step-security/step-postjob-hook.sh
```

Configure the GitHub Actions runner hook environment variables. These values must match the wrapper script paths you created:

```sh
echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/step-security/step-prejob-hook.sh" | sudo tee -a /etc/environment
echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/step-security/step-postjob-hook.sh" | sudo tee -a /etc/environment
```

Restart the GitHub Actions runner service after updating `/etc/environment`.

### Option 2: Central team hosts hook assets internally

If your organization does not want runners downloading hook assets from GitHub directly, a central platform or security team can mirror `pre.js` and `post.js` to an internal artifact repository such as Artifactory. DevOps teams still create local wrapper scripts on each runner, but the wrapper scripts download the hook assets from internal URLs instead of GitHub release URLs.

In this model, use stable internal URLs so the central team can roll out hook updates without requiring runner teams to edit wrapper scripts. The central team can still keep versioned artifacts internally and repoint the stable URLs during rollout.

For example:

```sh
sudo mkdir -p /opt/step-security

cat <<EOF | sudo tee /opt/step-security/step-prejob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
curl -fsSL "https://artifactory.example.com/stepsecurity/jobhooks/pre.js" | node
EOF

cat <<EOF | sudo tee /opt/step-security/step-postjob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
curl -fsSL "https://artifactory.example.com/stepsecurity/jobhooks/post.js" | node
EOF

sudo chmod +x /opt/step-security/step-prejob-hook.sh /opt/step-security/step-postjob-hook.sh
```

The runner hook environment variables are configured the same way as in Option 1, because the runner must still execute local wrapper scripts:

```sh
echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/step-security/step-prejob-hook.sh" | sudo tee -a /etc/environment
echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/step-security/step-postjob-hook.sh" | sudo tee -a /etc/environment
```

### Responsibilities by team

- DevOps team: create the wrapper scripts on each runner, set `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`, and restart the runner service after changes.
- Central platform or security team: publish approved `pre.js` and `post.js` assets, expose stable internal URLs, and define the rollout process for upgrading hook versions.

### Authentication option: Load the StepSecurity API key from AWS Secrets Manager

Use this pattern when the runner should not store `STEP_API_KEY` directly in the wrapper scripts. The hook reads the API key from AWS Secrets Manager at runtime after assuming the role configured in `STEP_API_KEY_ROLE_ARN`.

For example:

```sh
sudo mkdir -p /opt/step-security

cat <<EOF | sudo tee /opt/step-security/step-prejob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
export STEP_AGENT_VERSION_LINUX="latest"
export STEP_API_KEY_ROLE_ARN="arn:aws:iam::123456789012:role/stepsecurity-api-key-reader"
export STEP_API_KEY_SECRET_NAME="stepsecurity/orgs/<owner>/vm-api-key"
export STEP_API_KEY_SECRET_REGION="us-west-2"
export STEP_API_KEY_SECRET_FIELD="api_key"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/pre.js" | node
EOF

cat <<EOF | sudo tee /opt/step-security/step-postjob-hook.sh >/dev/null
#!/bin/bash
export STEP_AGENT_ROOT="/home/agent"
curl -fsSL "https://github.com/step-security/gha-runner-job-hooks-keyless/releases/download/vX.Y.Z/post.js" | node
EOF

sudo chmod +x /opt/step-security/step-prejob-hook.sh /opt/step-security/step-postjob-hook.sh
```

In this model, do not set `STEP_API_KEY` in the wrapper scripts. The runner must be able to assume the configured IAM role, and the secret must contain the API key in JSON format. If you use `<owner>` in `STEP_API_KEY_SECRET_NAME`, the GitHub owner must also match the secret's `OrgName` tag. The AWS Secrets Manager settings are only required in the pre-job wrapper.

After any wrapper script or hook environment variable change, restart the GitHub Actions runner service.

## Configuration

### GitHub Actions runner hook variables

These variables are used by the GitHub Actions runner to locate the hook wrapper scripts:

| Variable                            | Value                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the executable pre-job wrapper script, for example `/opt/step-security/step-prejob-hook.sh` on Linux.   |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the executable post-job wrapper script, for example `/opt/step-security/step-postjob-hook.sh` on Linux. |

### StepSecurity hook options

The following environment variables can be used to configure the hook behavior:

| Variable                     | Default                                   | Description                                                                                                                                                                                                      |
| ---------------------------- | ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `STEP_AGENT_ROOT`            | `/home/agent`                             | Linux directory used for agent files, status files, logs, and hook state. This is separate from the wrapper script path configured in `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`. |
| `STEP_DISABLE_AGENT_UPDATE`  | `false`                                   | Set to `true` to disable automatic Linux agent download/update.                                                                                                                                                  |
| `STEP_AGENT_VERSION_LINUX`   | `latest`                                  | Linux agent release to install. Use `latest` or a specific release tag.                                                                                                                                          |
| `STEP_API_KEY`               | ``                                        | StepSecurity API key. If set, the hook uses this value directly.                                                                                                                                                 |
| `STEP_API_KEY_ROLE_ARN`      | ``                                        | IAM role to assume before reading the API key from AWS Secrets Manager.                                                                                                                                          |
| `STEP_API_KEY_SECRET_NAME`   | `stepsecurity/orgs/<owner>/vm-api-key`    | Secrets Manager secret name. Supports `<owner>` placeholder substitution with the GitHub owner before reading the secret.                                                                                        |
| `STEP_API_KEY_SECRET_REGION` | `us-west-2`                               | AWS region for the Secrets Manager secret.                                                                                                                                                                       |
| `STEP_API_KEY_SECRET_FIELD`  | `api_key`                                 | JSON field inside the Secrets Manager secret that contains the API key.                                                                                                                                          |
| `STEP_API`                   | `https://agent.api.stepsecurity.io/v1`    | StepSecurity API endpoint.                                                                                                                                                                                       |
| `STEP_TELEMETRY_URL`         | `https://prod.app-api.stepsecurity.io/v1` | StepSecurity telemetry endpoint.                                                                                                                                                                                 |

Set these values in the wrapper scripts or inject them through your runner configuration before running the hook. On Linux wrapper scripts, use `export STEP_NAME=value`. Restart the runner service after changing wrapper scripts or hook variables.

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
- When downloading hook assets directly from GitHub, pin the hook URL to a specific release tag for reproducible runner behavior.
- When using centrally hosted hook assets, prefer stable internal URLs and let the central team manage the rollout behind those URLs.
- The wrapper scripts download and execute the hook release asset each time the hook runs.
- Check wrapper scripts at the paths configured in `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.
- Check agent files, logs, and hook state under `STEP_AGENT_ROOT`, which defaults to `/home/agent`.
