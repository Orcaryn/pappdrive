#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
SERVER_DIR="$PROJECT_DIR/packages/server"
WWW_DIR="$PROJECT_DIR/packages/www"
NPM_DIR="$PROJECT_DIR/packages/pappdrive"

VERSION_BUMP=""
VERSION=""
DEPLOY_SERVER=false
DEPLOY_WWW=false
PUBLISH_NPM=false

main() {
  case "$*" in
    "") ;;
    --major|--minor|--patch) VERSION_BUMP="${1#--}" ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage >&2
      exit 1
      ;;
  esac

  check_preconditions

  changed server "$(deployed_commit "$SERVER_DIR")" packages/server packages/protocol && DEPLOY_SERVER=true
  changed www "$(deployed_commit "$WWW_DIR")" packages/www && DEPLOY_WWW=true
  changed npm "v$(npm view pappdrive version)" packages/pappdrive packages/protocol docs/api.md docs/hosts.md docs/llms.txt docs/skill/SKILL.md LICENSE && PUBLISH_NPM=true

  if [[ "$DEPLOY_SERVER" == false && "$DEPLOY_WWW" == false && "$PUBLISH_NPM" == false ]]; then
    echo "==> Nothing to deploy."
    exit 0
  fi

  if [[ "$PUBLISH_NPM" == true ]]; then
    choose_version
  fi

  echo "==> Verifying..."
  pnpm --dir "$PROJECT_DIR" verify

  if [[ "$DEPLOY_SERVER" == true ]]; then
    deploy_server
  fi

  if [[ "$DEPLOY_WWW" == true ]]; then
    deploy_www
  fi

  if [[ "$PUBLISH_NPM" == true ]]; then
    publish_npm
  fi

  echo "==> Done."
}

usage() {
  cat <<EOF
Usage: ./deploy.sh [--major | --minor | --patch]

Deploys what changed since the last deploy of each target:
  server   packages/server and packages/protocol; the live Worker version is tagged with its commit
  www      packages/www; the same
  npm      packages/pappdrive, packages/protocol, the bundled docs and LICENSE, since the tag of the
           published version. Publishes, commits and tags the new version (the Swift package's too), pushes.

Requires main, a clean working tree up to date with its remote, and an npm login.

  --major, --minor, --patch   The version to publish; asked when omitted
  --help                      Show this help
EOF
}

check_preconditions() {
  local -a missing=()

  [[ "$(git -C "$PROJECT_DIR" rev-parse --abbrev-ref HEAD)" == main ]] || missing+=("Not on main.")
  [[ -z "$(git -C "$PROJECT_DIR" status --porcelain)" ]] || missing+=("The working tree is not clean.")
  git -C "$PROJECT_DIR" fetch --quiet --tags || missing+=("Cannot fetch from the remote.")
  [[ -z "$(git -C "$PROJECT_DIR" rev-list "HEAD..@{u}")" ]] || missing+=("main is behind its remote. Pull first.")
  npm whoami >/dev/null 2>&1 || missing+=("Not logged in to npm. Run: npm login")

  if ((${#missing[@]} > 0)); then
    echo "Cannot deploy:" >&2
    printf '  - %s\n' "${missing[@]}" >&2
    exit 1
  fi
}

# wrangler prints "Tag: -" for a version deployed without one.
deployed_commit() {
  pnpm --dir "$1" exec wrangler deployments status | sed -nE '/^ *Tag: +/{s///p;q;}'
}

changed() {
  local target="$1" since="$2"
  shift 2

  if git -C "$PROJECT_DIR" diff --quiet "$since" HEAD -- "$@" 2>/dev/null; then
    echo "==> $target: unchanged since $since"
    return 1
  fi

  echo "==> $target: changed since $since"
}

choose_version() {
  local current major minor patch
  current="$(sed -nE 's/^  "version": "(.*)",$/\1/p' "$NPM_DIR/package.json")"
  IFS=. read -r major minor patch <<< "$current"

  local patch_version="$major.$minor.$((patch + 1))"
  local minor_version="$major.$((minor + 1)).0"
  local major_version="$((major + 1)).0.0"

  if [[ -z "$VERSION_BUMP" ]]; then
    echo "==> pappdrive $current. Publish:"
    echo "  1) patch  $patch_version"
    echo "  2) minor  $minor_version"
    echo "  3) major  $major_version"

    local choice
    read -r -p "Choose [1-3]: " choice

    case "$choice" in
      1) VERSION_BUMP=patch ;;
      2) VERSION_BUMP=minor ;;
      3) VERSION_BUMP=major ;;
      *)
        echo "Not a choice: $choice" >&2
        exit 1
        ;;
    esac
  fi

  case "$VERSION_BUMP" in
    patch) VERSION="$patch_version" ;;
    minor) VERSION="$minor_version" ;;
    major) VERSION="$major_version" ;;
  esac

  if [[ -n "$(git -C "$PROJECT_DIR" tag --list "v$VERSION")" ]]; then
    echo "Tag v$VERSION already exists." >&2
    exit 1
  fi

  echo "==> Version: $current -> $VERSION"
}

deploy_server() {
  echo "==> Deploying the server..."
  pnpm --dir "$SERVER_DIR" exec wrangler d1 migrations apply pappdrive --remote
  pnpm --dir "$SERVER_DIR" exec wrangler deploy --tag "$(git -C "$PROJECT_DIR" rev-parse HEAD)"
}

deploy_www() {
  echo "==> Deploying the site..."
  pnpm --dir "$WWW_DIR" build
  pnpm --dir "$WWW_DIR" exec wrangler deploy --tag "$(git -C "$PROJECT_DIR" rev-parse HEAD)"
}

publish_npm() {
  echo "==> Publishing pappdrive $VERSION..."
  (cd "$NPM_DIR" && npm version "$VERSION" --no-git-tag-version)
  pnpm --dir "$NPM_DIR" build

  echo "==> Committing and tagging v$VERSION..."
  git -C "$PROJECT_DIR" commit -m "Release $VERSION" -- \
    packages/pappdrive/package.json \
    packages/swift/Sources/Pappdrive/Resources/pappdrive.js \
    packages/android/pappdrive/src/main/assets/pappdrive.js

  pnpm --dir "$NPM_DIR" publish
  git -C "$PROJECT_DIR" tag -a "v$VERSION" -m "pappdrive $VERSION"
  git -C "$PROJECT_DIR" push --follow-tags

  echo "==> Published: https://www.npmjs.com/package/pappdrive/v/$VERSION"
}

main "$@"
