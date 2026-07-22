# StepSecurity Job Hooks

GitHub Actions self-hosted runner job hooks for running StepSecurity pre-job and post-job logic around every workflow job. The hooks use the native GitHub Actions runner hook environment variables to run a pre-job script when a job starts and a post-job script when a job completes.

The hook scripts are published as GitHub release assets and can be mirrored internally for runner teams to consume through small wrapper scripts.

## Prerequisites

Before configuring the hooks, ensure the runner has:

- A GitHub Actions self-hosted runner installed and running.
- Node.js available on `PATH` as `node`.
- Network access to the configured hook asset URL and the StepSecurity API endpoint.
- Permission to create a directory for the hook wrapper scripts, for example `/opt/step-security` on Linux.
- Permission to set the GitHub Actions runner hook variables: `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.

Platform-specific requirements:

- Linux: `bash`, `curl`, and `sudo` if writing hook variables to `/etc/environment`.
- Windows: PowerShell and permission to set machine-level environment variables for the runner service.

## Usage

The recommended hosting model is for a central platform or security team to publish approved hook assets to stable internal URLs, and for the DevOps team to configure each runner to use those URLs.

### Central team hosts hook assets internally

If your organization does not want runners downloading hook assets from GitHub directly, split the setup into two distinct steps:

1. The central platform or security team mirrors `pre.js` and `post.js` to an internal artifact repository such as Artifactory and exposes stable internal URLs.
2. The DevOps team configures each runner with local wrapper scripts that download those internally hosted assets.

In this model, use stable internal URLs so the central team can roll out hook updates without requiring runner teams to edit wrapper scripts. The central team can still keep versioned artifacts internally and repoint the stable URLs during rollout.

#### Step 1: Central team publishes internal hook assets

The central team publishes approved `pre.js` and `post.js` assets and exposes stable internal URLs such as:

- `https://artifactory.example.com/stepsecurity/jobhooks/pre.js`
- `https://artifactory.example.com/stepsecurity/jobhooks/post.js`

#### Step 2: DevOps team configures each runner

After the internal assets are available, the DevOps team creates local wrapper scripts on each runner that point to those internal URLs.

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

Configure the GitHub Actions runner hook environment variables:

```sh
echo "ACTIONS_RUNNER_HOOK_JOB_STARTED=/opt/step-security/step-prejob-hook.sh" | sudo tee -a /etc/environment
echo "ACTIONS_RUNNER_HOOK_JOB_COMPLETED=/opt/step-security/step-postjob-hook.sh" | sudo tee -a /etc/environment
```

Restart the GitHub Actions runner service after updating `/etc/environment`.

### Authentication option: Load the StepSecurity API key from AWS Secrets Manager

Use this pattern when the runner should not store `STEP_API_KEY` directly in the wrapper scripts. The hook reads the API key from AWS Secrets Manager at runtime after assuming the role configured in `STEP_API_KEY_ROLE_ARN`.

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
curl -fsSL "https://artifactory.example.com/stepsecurity/jobhooks/pre.js" | node
EOF

sudo chmod +x /opt/step-security/step-prejob-hook.sh
```

Do not set `STEP_API_KEY` in the wrapper scripts when using this model. The runner must be able to assume the configured IAM role, and the secret must contain the API key in JSON format. The AWS Secrets Manager settings are only required in the pre-job wrapper.

## Configuration

### GitHub Actions runner hook variables

These variables are used by the GitHub Actions runner to locate the hook wrapper scripts:

| Variable                            | Value                                                                                                           |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `ACTIONS_RUNNER_HOOK_JOB_STARTED`   | Path to the executable pre-job wrapper script, for example `/opt/step-security/step-prejob-hook.sh` on Linux.   |
| `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` | Path to the executable post-job wrapper script, for example `/opt/step-security/step-postjob-hook.sh` on Linux. |

On Windows, these variables should point to the wrapper scripts the runner can execute, for example:

- `ACTIONS_RUNNER_HOOK_JOB_STARTED=C:\step-security\step-prejob-hook.ps1`
- `ACTIONS_RUNNER_HOOK_JOB_COMPLETED=C:\step-security\step-postjob-hook.ps1`

### StepSecurity hook options

The following environment variables can be used to configure the hook behavior:

| Variable                     | Default                                   | Description                                                                                                                                                                                                        |
| ---------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `STEP_AGENT_ROOT`            | `/home/agent`                             | Linux directory used for agent files, status files, logs, and hook state. This is separate from the wrapper script path configured in `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.   |
| `STEP_AGENT_ROOT_WINDOWS`    | `C:\agent`                                | Windows directory used for agent files, status files, logs, and hook state. This is separate from the wrapper script path configured in `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`. |
| `STEP_DISABLE_AGENT_UPDATE`  | `false`                                   | Set to `true` to disable automatic Linux agent download/update.                                                                                                                                                    |
| `STEP_AGENT_VERSION_LINUX`   | `latest`                                  | Linux agent release to install. Use `latest` or a specific release tag.                                                                                                                                            |
| `STEP_AGENT_VERSION_WINDOWS` | `latest`                                  | Windows agent release to install. Use `latest` or a specific release tag.                                                                                                                                          |
| `STEP_ARTIFACTORY_BASE`      | ``                                        | Optional Artifactory base URL for property-based serving resolution, for example `https://stepsecurity.jfrog.io/artifactory`. When set together with `STEP_ARTIFACTORY_REPO`, the hook resolves the current serving artifact by Artifactory item properties. |
| `STEP_ARTIFACTORY_REPO`      | ``                                        | Optional Artifactory repository name used with `STEP_ARTIFACTORY_BASE`, for example `jatin-repo1`. Required when using property-based serving resolution.                                                        |
| `STEP_AGENT_ARTIFACTORY_URL` | ``                                        | Optional direct-download Artifactory base URL for agent assets. When set without `STEP_ARTIFACTORY_BASE` and `STEP_ARTIFACTORY_REPO`, the hook downloads from `<STEP_AGENT_ARTIFACTORY_URL>/<asset_name>` instead of the API-provided URLs.            |
| `STEP_API_KEY`               | ``                                        | StepSecurity API key. If set, the hook uses this value directly.                                                                                                                                                   |
| `STEP_API_KEY_ROLE_ARN`      | ``                                        | IAM role to assume before reading the API key from AWS Secrets Manager.                                                                                                                                            |
| `STEP_API_KEY_SECRET_NAME`   | `stepsecurity/orgs/<owner>/vm-api-key`    | Secrets Manager secret name. Supports `<owner>` placeholder substitution with the GitHub owner before reading the secret.                                                                                          |
| `STEP_API_KEY_SECRET_REGION` | `us-west-2`                               | AWS region for the Secrets Manager secret.                                                                                                                                                                         |
| `STEP_API_KEY_SECRET_FIELD`  | `api_key`                                 | JSON field inside the Secrets Manager secret that contains the API key.                                                                                                                                            |
| `STEP_API`                   | `https://agent.api.stepsecurity.io/v1`    | StepSecurity API endpoint.                                                                                                                                                                                         |
| `STEP_TELEMETRY_URL`         | `https://prod.app-api.stepsecurity.io/v1` | StepSecurity telemetry endpoint.                                                                                                                                                                                   |

Set these values in the wrapper scripts or inject them through your runner configuration before running the hook. On Linux wrapper scripts, use `export STEP_NAME=value`. On Windows wrapper scripts, set them with PowerShell environment assignments such as `$env:STEP_AGENT_ROOT_WINDOWS='C:\agent'`.

Each hook validates configured network endpoints at startup and logs warnings for failures. Checked endpoints include `STEP_API`, `STEP_TELEMETRY_URL`, `STEP_AGENT_ARTIFACTORY_URL` when set, `STEP_ARTIFACTORY_BASE` or `ARTIFACTORY_BASE` when set, and AWS STS and Secrets Manager regional endpoints when `STEP_API_KEY_ROLE_ARN` is set. API-discovered agent asset URLs are not preflighted. The pre-job hook also requires either `STEP_API_KEY` or `STEP_API_KEY_ROLE_ARN`; if neither is set, the hook logs the configuration problem and exits successfully after printing detailed diagnostics.

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

For more on managing the API key, see:

- [StepSecurity API Key Rotation](docs/key-rotation-flow-generic.md) — how to rotate StepSecurity API keys on a regular schedule with zero downtime, for both VM runners and Kubernetes runners (ARC).
- [Kubernetes ARC Harden-Runner: Keyless API Key Setup](docs/k8s-keyless-mode-customer-setup.md) — one-time AWS and Helm setup to enable keyless mode for Kubernetes runners (ARC).

### Artifactory

Two Artifactory modes are supported:

- Property-based serving resolution: set `STEP_ARTIFACTORY_BASE` and `STEP_ARTIFACTORY_REPO`. The hook queries Artifactory for the single artifact marked as serving for the current platform and architecture, downloads `downloadUri`, verifies `checksums.sha256`, and refreshes only when the serving SHA changes.
- Direct-download mode: set `STEP_AGENT_ARTIFACTORY_URL`. The hook downloads from `<STEP_AGENT_ARTIFACTORY_URL>/<asset_name>` and does not query Artifactory properties.

#### How it works

- When `STEP_ARTIFACTORY_BASE` and `STEP_ARTIFACTORY_REPO` are set, the hook queries `GET /api/search/prop` with selectors derived from runtime:
  - common: `ss.serving=true`, `ss.approved=true`
  - Linux: `ss.os=linux`, `ss.arch=amd64|arm64`
  - Windows: `ss.os=windows`, `ss.arch=amd64`
- The property search must return exactly one result. The hook uses `downloadUri` to download the tarball and `checksums.sha256` to validate it.
- The hook stores the currently staged tarball SHA under `.current_sha256` in `STEP_AGENT_ROOT` or `STEP_AGENT_ROOT_WINDOWS`, and re-installs only when the serving SHA changes or the agent binary is missing.
- When only `STEP_AGENT_ARTIFACTORY_URL` is set, the hook downloads assets only from `<STEP_AGENT_ARTIFACTORY_URL>/<asset_name>`.
- When neither Artifactory mode is configured, the hook uses the StepSecurity release API as before.

#### How to populate Artifactory

For property-based serving resolution:

1. Upload the agent tarballs to your Artifactory repository.
2. Set item properties on each artifact:
   - `ss.approved=true`
   - `ss.os=linux` or `ss.os=windows`
   - `ss.arch=amd64` or `ss.arch=arm64`
   - `ss.sha256=<64-character sha256 hex>`
   - `ss.serving=true` only on the single version currently served for a given `ss.os` and `ss.arch`
3. Set `STEP_ARTIFACTORY_BASE` and `STEP_ARTIFACTORY_REPO` on the runner.

Example repository paths:

- Linux amd64: `stepsecurity/harden-runner-bravo/1.8.12/harden-runner-bravo_1.8.12_linux_amd64.tar.gz`
- Linux arm64: `stepsecurity/harden-runner-bravo/1.8.12/harden-runner-bravo_1.8.12_linux_arm64.tar.gz`
- Windows amd64: `stepsecurity/harden-runner-agent-windows/1.0.7/harden-runner-agent-windows_1.0.7_windows_amd64.tar.gz`

For direct-download mode:

1. Call the StepSecurity release API for the required platform and version:
   - Linux latest: `https://agent.api.stepsecurity.io/v1/harden-runner-agent/github/linux/single/releases/latest`
   - Linux specific version: `https://agent.api.stepsecurity.io/v1/harden-runner-agent/github/linux/single/releases/<tag>`
   - Windows latest: `https://agent.api.stepsecurity.io/v1/harden-runner-agent/github/win/single/releases/latest`
   - Windows specific version: `https://agent.api.stepsecurity.io/v1/harden-runner-agent/github/win/single/releases/<tag>`
2. Inspect the returned `assets` list and identify the files you need.
3. Open either `primary_download_url` or `fallback_download_url` for each asset and download the archive.
4. Upload each downloaded archive into your internal Artifactory using the exact filename from `asset_name`.
5. Set `STEP_AGENT_ARTIFACTORY_URL` on the runner to the Artifactory base URL that serves those uploaded files.

#### Example

Property-based serving resolution:

- `STEP_ARTIFACTORY_BASE=https://stepsecurity.jfrog.io/artifactory`
- `STEP_ARTIFACTORY_REPO=jatin-repo1`
- Query example:
  - `https://stepsecurity.jfrog.io/artifactory/api/search/prop?ss.serving=true&ss.approved=true&ss.os=windows&ss.arch=amd64&repos=jatin-repo1`

Direct-download mode:

- Linux fallback URL: `https://packages.stepsecurity.io/self-hosted/harden-runner-bravo_1.8.12_linux_arm64.tar.gz`
- Windows fallback URL: `https://packages.stepsecurity.io/self-hosted/harden-runner-agent-windows_1.0.7_windows_amd64.tar.gz`
- `STEP_AGENT_ARTIFACTORY_URL=https://artifactory.example.com/self-hosted`

## Notes and troubleshooting

- `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED` must point to wrapper scripts, not directly to `pre.js` or `post.js`.
- Hook failures can block the workflow job.
- When using centrally hosted hook assets, prefer stable internal URLs and let the central team manage the rollout behind those URLs.
- The wrapper scripts download and execute the hook release asset each time the hook runs.
- Check wrapper scripts at the paths configured in `ACTIONS_RUNNER_HOOK_JOB_STARTED` and `ACTIONS_RUNNER_HOOK_JOB_COMPLETED`.
- Check agent files, logs, and hook state under `STEP_AGENT_ROOT` on Linux or `STEP_AGENT_ROOT_WINDOWS` on Windows.
