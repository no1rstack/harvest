$ErrorActionPreference = 'Stop'

$rootDir = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$artifactDir = Join-Path $rootDir 'artifacts/review'
$openApiFile = Join-Path $rootDir 'openapi/harvest-v1.openapi.yaml'
$schemathesisBaseUrl = $env:SCHEMATHESIS_BASE_URL
$zapTargetUrl = if ($env:ZAP_TARGET_URL) { $env:ZAP_TARGET_URL } else { $schemathesisBaseUrl }

New-Item -ItemType Directory -Force -Path $artifactDir | Out-Null

function Write-Step($label, $message) {
  "`n[$label] $message"
}

function Invoke-Stage($binary, $scriptBlock, $missingMessage) {
  if (Get-Command $binary -ErrorAction SilentlyContinue) {
    & $scriptBlock
  } else {
    Write-Step 'SKIP' $missingMessage
  }
}

Write-Step 'STEP' '1/6 npm test'
& npm test | Tee-Object -FilePath (Join-Path $artifactDir 'npm-test.txt')

Write-Step 'STEP' '2/6 npm build'
& npm run build | Tee-Object -FilePath (Join-Path $artifactDir 'npm-build.txt')

Write-Step 'STEP' '3/6 semgrep'
Invoke-Stage 'semgrep' {
  & semgrep scan --config (Join-Path $rootDir '.semgrep/harvest.yml') --json --output (Join-Path $artifactDir 'semgrep.json') $rootDir
} 'semgrep not installed'

Write-Step 'STEP' '4/6 gitleaks'
Invoke-Stage 'gitleaks' {
  & gitleaks detect --source $rootDir --config (Join-Path $rootDir '.gitleaks.toml') --report-format json --report-path (Join-Path $artifactDir 'gitleaks.json')
} 'gitleaks not installed'

Write-Step 'STEP' '5/6 trivy'
Invoke-Stage 'trivy' {
  & trivy fs --config (Join-Path $rootDir 'trivy.yaml') --output (Join-Path $artifactDir 'trivy.txt') $rootDir
} 'trivy not installed'

if ($schemathesisBaseUrl) {
  Write-Step 'STEP' '6/6 schemathesis'
  Invoke-Stage 'schemathesis' {
    & schemathesis run --url $schemathesisBaseUrl --report-junit-path (Join-Path $artifactDir 'schemathesis-junit.xml') $openApiFile
  } 'schemathesis not installed'
} else {
  Write-Step 'SKIP' 'schemathesis skipped; set SCHEMATHESIS_BASE_URL'
}

if ($zapTargetUrl) {
  Write-Step 'STEP' 'zap baseline'
  Invoke-Stage 'zap-baseline.py' {
    & zap-baseline.py -t $zapTargetUrl -r (Join-Path $artifactDir 'zap-report.html') -w (Join-Path $artifactDir 'zap-report.md') -c (Join-Path $rootDir '.zap/rules.tsv')
  } 'ZAP baseline script not installed'
} else {
  Write-Step 'SKIP' 'ZAP skipped; set ZAP_TARGET_URL or SCHEMATHESIS_BASE_URL'
}

Write-Step 'DONE' "Artifacts written to $artifactDir"
