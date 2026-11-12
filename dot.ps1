$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$installLockPath = Join-Path $scriptDir "node_modules/.package-lock.json"
$runFromSource = (Test-Path -LiteralPath $installLockPath -PathType Leaf) -and [bool](Get-Command node -ErrorAction SilentlyContinue)
$noEnv = $false
$forwardArgs = New-Object System.Collections.Generic.List[string]

foreach ($arg in $args) {
	if ($arg -eq "--no-env") {
		$noEnv = $true
	} else {
		$forwardArgs.Add($arg)
	}
}

if ($noEnv) {
	$envVarsToUnset = @(
		"ANTHROPIC_API_KEY",
		"ANTHROPIC_OAUTH_TOKEN",
		"OPENAI_API_KEY",
		"GEMINI_API_KEY",
		"GROQ_API_KEY",
		"CEREBRAS_API_KEY",
		"XAI_API_KEY",
		"OPENROUTER_API_KEY",
		"ZAI_API_KEY",
		"MISTRAL_API_KEY",
		"MINIMAX_API_KEY",
		"MINIMAX_CN_API_KEY",
		"AI_GATEWAY_API_KEY",
		"OPENCODE_API_KEY",
		"COPILOT_GITHUB_TOKEN",
		"GH_TOKEN",
		"GITHUB_TOKEN",
		"HF_TOKEN",
		"GOOGLE_APPLICATION_CREDENTIALS",
		"GOOGLE_CLOUD_PROJECT",
		"GCLOUD_PROJECT",
		"GOOGLE_CLOUD_LOCATION",
		"AWS_PROFILE",
		"AWS_ACCESS_KEY_ID",
		"AWS_SECRET_ACCESS_KEY",
		"AWS_SESSION_TOKEN",
		"AWS_REGION",
		"AWS_DEFAULT_REGION",
		"AWS_BEARER_TOKEN_BEDROCK",
		"AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
		"AWS_CONTAINER_CREDENTIALS_FULL_URI",
		"AWS_WEB_IDENTITY_TOKEN_FILE",
		"AZURE_OPENAI_API_KEY",
		"AZURE_OPENAI_BASE_URL",
		"AZURE_OPENAI_RESOURCE_NAME"
	)

	foreach ($name in $envVarsToUnset) {
		Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue
	}

	Write-Host "Running without API keys..."
}

if ($runFromSource) {
	$tsxBin = Join-Path $scriptDir "node_modules/.bin/tsx.cmd"
	if (-not (Test-Path -LiteralPath $tsxBin -PathType Leaf)) {
		throw "tsx not found at $tsxBin. Run npm ci --ignore-scripts from the repo root."
	}

	$cliPath = Join-Path $scriptDir "packages/coding-agent/src/cli.ts"
	& $tsxBin $cliPath @forwardArgs
} else {
	$bootstrapPath = Join-Path $scriptDir "scripts/bootstrap-runtime.ps1"
	if (-not (Test-Path -LiteralPath $bootstrapPath -PathType Leaf)) {
		throw "dot: runtime bootstrap not found: $bootstrapPath"
	}
	$runtimePath = & $bootstrapPath
	& $runtimePath @forwardArgs
}

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
	exit $exitCode
}
