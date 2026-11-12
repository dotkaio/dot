#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -P "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(dirname "$SCRIPT_DIR")"
CACHE_ROOT="${DOT_BOOTSTRAP_CACHE_DIR:-$REPO_ROOT/.artifacts/runtime}"
REPOSITORY="${DOT_BOOTSTRAP_REPOSITORY:-dotkaio/dot}"
GITHUB_BASE_URL="${DOT_BOOTSTRAP_GITHUB_URL:-https://github.com}"
GITHUB_API_URL="${DOT_BOOTSTRAP_GITHUB_API_URL:-https://api.github.com}"
CURRENT_FILE="$CACHE_ROOT/current"

fail() {
  printf 'dot: %s\n' "$*" >&2
  exit 1
}

download_file() {
  local url="$1"
  local destination="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --silent --show-error --location --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --quiet --output-document="$destination" "$url"
  else
    fail "curl or wget is required for the initial runtime download."
  fi
}

cached_tag() {
  if [[ -f "$CURRENT_FILE" ]]; then
    tr -d '\r\n' < "$CURRENT_FILE"
  fi
}

resolve_latest_tag() {
  if [[ -n "${DOT_BOOTSTRAP_RELEASE_TAG:-}" ]]; then
    printf '%s\n' "$DOT_BOOTSTRAP_RELEASE_TAG"
    return
  fi

  if [[ "${DOT_OFFLINE:-}" == "1" ]]; then
    local current
    current="$(cached_tag)"
    [[ -n "$current" ]] || fail "offline mode is enabled and no cached runtime is available."
    printf '%s\n' "$current"
    return
  fi

  local tag=""
  if command -v curl >/dev/null 2>&1; then
    local effective_url
    effective_url="$(curl --fail --silent --show-error --location --output /dev/null --write-out '%{url_effective}' \
      "$GITHUB_BASE_URL/$REPOSITORY/releases/latest" 2>/dev/null || true)"
    effective_url="${effective_url%%\?*}"
    effective_url="${effective_url%/}"
    tag="${effective_url##*/}"
    if [[ "$tag" == "latest" || "$tag" == "releases" ]]; then
      tag=""
    fi
  elif command -v wget >/dev/null 2>&1; then
    local metadata
    metadata="$(wget --quiet --output-document=- "$GITHUB_API_URL/repos/$REPOSITORY/releases/latest" 2>/dev/null || true)"
    tag="$(printf '%s\n' "$metadata" | sed -n 's/.*"tag_name"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' | head -n 1)"
  fi

  if [[ -z "$tag" ]]; then
    tag="$(cached_tag)"
    if [[ -n "$tag" ]]; then
      printf 'dot: could not check for updates; using cached runtime %s.\n' "$tag" >&2
    else
      fail "no published release was found for $REPOSITORY. Publish a GitHub release with Dot binary assets first."
    fi
  fi
  printf '%s\n' "$tag"
}

case "$(uname -s)" in
  Darwin) os="darwin" ;;
  Linux) os="linux" ;;
  *) fail "unsupported operating system: $(uname -s)" ;;
esac

case "$(uname -m)" in
  arm64|aarch64) arch="arm64" ;;
  x86_64|amd64) arch="x64" ;;
  *) fail "unsupported architecture: $(uname -m)" ;;
esac

platform="$os-$arch"
asset="dot-$platform.tar.gz"
tag="$(resolve_latest_tag)"
runtime_dir="$CACHE_ROOT/$tag/$platform/dot"
binary="$runtime_dir/dot"

if [[ -x "$binary" ]]; then
  mkdir -p "$CACHE_ROOT"
  printf '%s\n' "$tag" > "$CURRENT_FILE"
  printf '%s\n' "$binary"
  exit 0
fi

[[ "${DOT_OFFLINE:-}" != "1" ]] || fail "runtime $tag for $platform is not cached and offline mode is enabled."
mkdir -p "$CACHE_ROOT"
work_dir="$(mktemp -d "$CACHE_ROOT/.download.XXXXXX")"
trap 'rm -rf "$work_dir"' EXIT
archive="$work_dir/$asset"
checksums="$work_dir/SHA256SUMS"
release_base="$GITHUB_BASE_URL/$REPOSITORY/releases/download/$tag"

printf 'dot: downloading %s for %s...\n' "$tag" "$platform" >&2
download_file "$release_base/$asset" "$archive"
download_file "$release_base/SHA256SUMS" "$checksums"

expected_checksum="$(awk -v asset="$asset" '$2 == asset || $2 == "*" asset { print $1; exit }' "$checksums")"
[[ -n "$expected_checksum" ]] || fail "$asset is missing from the release checksum manifest."

if command -v shasum >/dev/null 2>&1; then
  actual_checksum="$(shasum -a 256 "$archive" | awk '{print $1}')"
elif command -v sha256sum >/dev/null 2>&1; then
  actual_checksum="$(sha256sum "$archive" | awk '{print $1}')"
elif command -v openssl >/dev/null 2>&1; then
  actual_checksum="$(openssl dgst -sha256 "$archive" | awk '{print $NF}')"
else
  fail "shasum, sha256sum, or openssl is required to verify the runtime download."
fi

[[ "$actual_checksum" == "$expected_checksum" ]] || fail "checksum verification failed for $asset."
mkdir -p "$work_dir/extracted"
tar -xzf "$archive" -C "$work_dir/extracted"
[[ -f "$work_dir/extracted/dot/dot" ]] || fail "$asset does not contain the expected dot executable."
chmod +x "$work_dir/extracted/dot/dot"
mkdir -p "$(dirname "$runtime_dir")"
rm -rf "$runtime_dir"
mv "$work_dir/extracted/dot" "$runtime_dir"
printf '%s\n' "$tag" > "$CURRENT_FILE"
printf '%s\n' "$binary"
