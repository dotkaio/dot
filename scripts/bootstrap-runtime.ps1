$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$cacheRoot = if ($env:DOT_BOOTSTRAP_CACHE_DIR) { $env:DOT_BOOTSTRAP_CACHE_DIR } else { Join-Path $repoRoot ".artifacts/runtime" }
$repository = if ($env:DOT_BOOTSTRAP_REPOSITORY) { $env:DOT_BOOTSTRAP_REPOSITORY } else { "dotkaio/dot" }
$githubBaseUrl = if ($env:DOT_BOOTSTRAP_GITHUB_URL) { $env:DOT_BOOTSTRAP_GITHUB_URL.TrimEnd("/") } else { "https://github.com" }
$githubApiUrl = if ($env:DOT_BOOTSTRAP_GITHUB_API_URL) { $env:DOT_BOOTSTRAP_GITHUB_API_URL.TrimEnd("/") } else { "https://api.github.com" }
$currentFile = Join-Path $cacheRoot "current"

function Get-CachedTag {
	if (Test-Path -LiteralPath $currentFile -PathType Leaf) {
		return (Get-Content -LiteralPath $currentFile -Raw).Trim()
	}
	return $null
}

function Get-ReleaseTag {
	if ($env:DOT_BOOTSTRAP_RELEASE_TAG) {
		return $env:DOT_BOOTSTRAP_RELEASE_TAG
	}

	if ($env:DOT_OFFLINE -eq "1") {
		$cachedTag = Get-CachedTag
		if (-not $cachedTag) {
			throw "dot: offline mode is enabled and no cached runtime is available."
		}
		return $cachedTag
	}

	try {
		$headers = @{ "User-Agent" = "dot-bootstrap" }
		$release = Invoke-RestMethod -UseBasicParsing -Headers $headers -Uri "$githubApiUrl/repos/$repository/releases/latest"
		if ($release.tag_name) {
			return [string]$release.tag_name
		}
	} catch {
		$cachedTag = Get-CachedTag
		if ($cachedTag) {
			[Console]::Error.WriteLine("dot: could not check for updates; using cached runtime $cachedTag.")
			return $cachedTag
		}
		throw "dot: no published release was found for $repository. Publish a GitHub release with Dot binary assets first."
	}

	throw "dot: no published release was found for $repository. Publish a GitHub release with Dot binary assets first."
}

$architecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString().ToLowerInvariant()
switch ($architecture) {
	"arm64" { $arch = "arm64" }
	"x64" { $arch = "x64" }
	default { throw "dot: unsupported Windows architecture: $architecture" }
}

$platform = "windows-$arch"
$asset = "dot-$platform.zip"
$tag = Get-ReleaseTag
$runtimeDir = Join-Path $cacheRoot "$tag/$platform"
$binary = Join-Path $runtimeDir "dot.exe"

if (Test-Path -LiteralPath $binary -PathType Leaf) {
	New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
	Set-Content -LiteralPath $currentFile -Value $tag -NoNewline
	Write-Output $binary
	exit 0
}

if ($env:DOT_OFFLINE -eq "1") {
	throw "dot: runtime $tag for $platform is not cached and offline mode is enabled."
}

New-Item -ItemType Directory -Force -Path $cacheRoot | Out-Null
$workDir = Join-Path $cacheRoot ".download-$PID-$([guid]::NewGuid().ToString("N"))"
New-Item -ItemType Directory -Force -Path $workDir | Out-Null

try {
	$archive = Join-Path $workDir $asset
	$checksums = Join-Path $workDir "SHA256SUMS"
	$releaseBase = "$githubBaseUrl/$repository/releases/download/$tag"
	[Console]::Error.WriteLine("dot: downloading $tag for $platform...")
	Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/$asset" -OutFile $archive
	Invoke-WebRequest -UseBasicParsing -Uri "$releaseBase/SHA256SUMS" -OutFile $checksums

	$escapedAsset = [regex]::Escape($asset)
	$checksumLine = Get-Content -LiteralPath $checksums | Where-Object { $_ -match "^[0-9A-Fa-f]{64}\s+\*?$escapedAsset$" } | Select-Object -First 1
	if (-not $checksumLine) {
		throw "dot: $asset is missing from the release checksum manifest."
	}
	$expectedChecksum = ($checksumLine -split "\s+")[0].ToLowerInvariant()
	$actualChecksum = (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant()
	if ($actualChecksum -ne $expectedChecksum) {
		throw "dot: checksum verification failed for $asset."
	}

	$extractedDir = Join-Path $workDir "extracted"
	Expand-Archive -LiteralPath $archive -DestinationPath $extractedDir
	$extractedBinary = Join-Path $extractedDir "dot.exe"
	if (-not (Test-Path -LiteralPath $extractedBinary -PathType Leaf)) {
		throw "dot: $asset does not contain the expected dot executable."
	}

	$runtimeParent = Split-Path -Parent $runtimeDir
	New-Item -ItemType Directory -Force -Path $runtimeParent | Out-Null
	if (Test-Path -LiteralPath $runtimeDir) {
		Remove-Item -LiteralPath $runtimeDir -Recurse -Force
	}
	Move-Item -LiteralPath $extractedDir -Destination $runtimeDir
	Set-Content -LiteralPath $currentFile -Value $tag -NoNewline
	Write-Output $binary
} finally {
	if (Test-Path -LiteralPath $workDir) {
		Remove-Item -LiteralPath $workDir -Recurse -Force
	}
}
