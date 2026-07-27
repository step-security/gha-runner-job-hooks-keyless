#!/usr/bin/env pwsh
# ==============================================================================
# wrapper.ps1 -- manually-maintained canonical copy, staged into the vendor
# tree by release/fetch-upstream.ps1 (no network fetch, no upstream checksum to
# verify against -- see runner/hooks/vendor/README.md). Windows-native
# equivalent of wrapper.sh: same CLI shape (dispatch on script basename), same
# log format ("[StepSecurity] ..."), same exit codes (always 0 -- soft-fail on
# any error so a hook problem never fails the job).
#
# Env var: STEP_AGENT_ROOT_WINDOWS, NOT STEP_AGENT_ROOT -- vendor's own
# AgentRuntimeConfig (gha-runner-job-hooks-keyless/src/lib/config.ts) uses a
# Windows-specific root (default C:\agent) distinct from the Linux STEP_AGENT_ROOT
# (default /home/agent); this wrapper's hook-staging dir (gha-hooks\) is the
# Windows analog of wrapper.sh's "${STEP_AGENT_ROOT}/gha-hooks" and must live
# under that same Windows root, per README.md's "STEP_AGENT_ROOT_WINDOWS ...
# Windows directory used for agent files, status files, logs, and hook state."
# STEP_ARTIFACTORY_BASE/REPO are unchanged (platform-agnostic). Update this
# file by hand when vendor's upstream scripts/wrapper.sh changes, then re-run
# release/fetch-upstream.ps1 to re-stage + re-publish.
# ==============================================================================

$CurlConnectTimeoutSeconds = 10
$CurlMaxTimeSeconds = 60

$AgentRootWindows = if ($env:STEP_AGENT_ROOT_WINDOWS) { $env:STEP_AGENT_ROOT_WINDOWS } else { 'C:\agent' }
$AgentBaseDir = Join-Path ($AgentRootWindows.TrimEnd('\', '/')) 'gha-hooks'
$ScriptName = Split-Path -Leaf $PSCommandPath
$HookMode = 'post'
if ($ScriptName -eq 'pre.ps1') { $HookMode = 'pre' }

$CurrentHook = Join-Path $AgentBaseDir "$HookMode.js"

function Write-SsWrapperLog { param([string]$Message) Write-Host "[StepSecurity] $Message" }
function Write-SsWrapperWarn { param([string]$Message) Write-SsWrapperLog "WARN: $Message" }

New-Item -ItemType Directory -Force -Path $AgentBaseDir | Out-Null

function Update-SsHooksFromArtifactory {
    foreach ($cmd in @('node')) {
        if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
            Write-SsWrapperWarn "missing required command: $cmd; skipping hook refresh"
            return
        }
    }

    $tmpDir = Join-Path ([System.IO.Path]::GetTempPath()) ([guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
    } catch {
        Write-SsWrapperWarn "failed to create temporary directory; skipping hook refresh"
        return
    }

    try {
        $searchResponse = Join-Path $tmpDir 'artifactory-search.json'

        Write-SsWrapperLog "refreshing hooks from Artifactory repo $($env:STEP_ARTIFACTORY_REPO)"

        $url = "$($env:STEP_ARTIFACTORY_BASE.TrimEnd('/'))/api/search/prop?ss.serving=true&ss.gha-hook=true&repos=$($env:STEP_ARTIFACTORY_REPO)"
        try {
            Invoke-WebRequest -Uri $url -Headers @{ 'X-Result-Detail' = 'properties,info' } -OutFile $searchResponse -TimeoutSec $CurlMaxTimeSeconds -UseBasicParsing -ErrorAction Stop
        } catch {
            Write-SsWrapperWarn "failed to query Artifactory; keeping current staged hooks"
            return
        }

        $hookRows = $null
        try {
            $json = Get-Content $searchResponse -Raw | ConvertFrom-Json
            $latestByName = @{}
            foreach ($item in $json.results) {
                if ($item.path -notmatch '/(pre|post)\.js$') { continue }
                $name = Split-Path -Leaf $item.path
                if (-not $latestByName.ContainsKey($name) -or $latestByName[$name].created -lt $item.created) {
                    $latestByName[$name] = $item
                }
            }
            $hookRows = foreach ($name in $latestByName.Keys) {
                $item = $latestByName[$name]
                $version = ($item.path -split '/')[-2]
                [pscustomobject]@{ HookName = $name; DownloadUri = $item.downloadUri; ExpectedSha256 = $item.checksums.sha256; HookVersion = $version }
            }
        } catch {
            Write-SsWrapperWarn "failed to parse Artifactory response; keeping current staged hooks"
            return
        }

        if (-not $hookRows -or @($hookRows).Count -eq 0) {
            Write-SsWrapperWarn "Artifactory returned no staged hook assets; keeping current staged hooks"
            return
        }

        foreach ($row in @($hookRows)) {
            $hookName = $row.HookName
            $downloadUri = $row.DownloadUri
            $expectedSha256 = $row.ExpectedSha256
            $hookVersion = $row.HookVersion

            if (-not $hookName) { continue }
            if (-not $downloadUri -or -not $expectedSha256) {
                Write-SsWrapperWarn "skipping $(if ($hookName) { $hookName } else { 'unknown hook' }); missing download URI or checksum"
                continue
            }

            $downloadedHook = Join-Path $tmpDir $hookName
            $stagedHook = Join-Path $AgentBaseDir $hookName

            Write-SsWrapperLog "downloading $hookName (version $hookVersion) from Artifactory"
            try {
                Invoke-WebRequest -Uri $downloadUri -OutFile $downloadedHook -TimeoutSec $CurlMaxTimeSeconds -UseBasicParsing -ErrorAction Stop
            } catch {
                Write-SsWrapperWarn "failed to download $hookName; keeping current staged copy"
                continue
            }

            try {
                $downloadedSha256 = (Get-FileHash -Path $downloadedHook -Algorithm SHA256).Hash.ToLowerInvariant()
            } catch {
                Write-SsWrapperWarn "failed to calculate checksum for $hookName; keeping current staged copy"
                continue
            }
            if ($downloadedSha256 -ne $expectedSha256) {
                Write-SsWrapperWarn "checksum mismatch for $hookName; expected $expectedSha256, got $downloadedSha256; keeping current staged copy"
                continue
            }

            if (-not (Test-Path $stagedHook -PathType Leaf)) {
                try {
                    Copy-Item -Path $downloadedHook -Destination $stagedHook -Force -ErrorAction Stop
                } catch {
                    Write-SsWrapperWarn "failed to stage new $hookName; keeping current staged copy"
                    continue
                }
                Write-SsWrapperLog "staged new $hookName (version $hookVersion)"
                continue
            }

            try {
                $stagedSha256 = (Get-FileHash -Path $stagedHook -Algorithm SHA256).Hash.ToLowerInvariant()
            } catch {
                Write-SsWrapperWarn "failed to calculate staged checksum for $hookName; keeping current staged copy"
                continue
            }
            if ($stagedSha256 -ne $downloadedSha256) {
                try {
                    Copy-Item -Path $downloadedHook -Destination $stagedHook -Force -ErrorAction Stop
                } catch {
                    Write-SsWrapperWarn "failed to update staged $hookName; keeping current staged copy"
                    continue
                }
                Write-SsWrapperLog "updated staged $hookName (version $hookVersion)"
                continue
            }

            Write-SsWrapperLog "$hookName unchanged (version $hookVersion)"
        }
    } finally {
        Remove-Item -Recurse -Force $tmpDir -ErrorAction SilentlyContinue
    }
}

if ($HookMode -eq 'pre') {
    Update-SsHooksFromArtifactory
}

if (-not (Test-Path $CurrentHook -PathType Leaf)) {
    Write-SsWrapperWarn "missing staged hook: $CurrentHook; skipping execution"
    exit 0
}

Write-SsWrapperLog "executing $CurrentHook"
& node $CurrentHook
if ($LASTEXITCODE -ne 0) {
    Write-SsWrapperWarn "hook execution failed for $CurrentHook; exiting 0"
}
exit 0
