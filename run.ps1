$ErrorActionPreference = 'Stop'

$docker = @(
    "$env:ProgramFiles\Docker\Docker\resources\bin\docker.exe"
    "$env:LOCALAPPDATA\Programs\DockerDesktop\resources\bin\docker.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if (-not $docker) { throw 'Docker Desktop is not installed.' }

$startedDockerDesktop = $false
$dockerReady = $false

try {
    & $docker info *> $null
    $dockerReady = $LASTEXITCODE -eq 0

    if (-not $dockerReady) {
        Write-Host 'Starting Docker Desktop...'
        & $docker desktop start --timeout 120
        if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop failed to start.' }
        $startedDockerDesktop = $true
        $dockerReady = $true
    }

    & $docker compose up --build
    if ($LASTEXITCODE -ne 0) { throw "Docker Compose exited with code $LASTEXITCODE." }
}
finally {
    if ($dockerReady) { & $docker compose down }
    if ($startedDockerDesktop) {
        Write-Host 'Stopping Docker Desktop...'
        & $docker desktop stop --timeout 120
    }
}
