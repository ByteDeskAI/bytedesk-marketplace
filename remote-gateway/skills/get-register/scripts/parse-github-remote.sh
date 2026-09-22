#!/usr/bin/env bash
# Same rules as register.ParseGitHubRemote. Prints owner/repo.
set -euo pipefail
remote="${1:?git remote url}"
s="${remote%"${remote##*[![:space:]]}"}"
s="${s#"${s%%[![:space:]]*}"}"
s="${s%.git}"
s="${s%/}"
case "$s" in
  git@github.com:*)
    printf '%s\n' "${s#git@github.com:}"
    ;;
  https://github.com/*)
    printf '%s\n' "${s#https://github.com/}"
    ;;
  http://github.com/*)
    printf '%s\n' "${s#http://github.com/}"
    ;;
  ssh://git@github.com/*)
    printf '%s\n' "${s#ssh://git@github.com/}"
    ;;
  */*)
    rest="${s#*/}"
    if [[ "$rest" == */* ]]; then
      echo "not a GitHub remote: $remote" >&2
      exit 1
    fi
    printf '%s\n' "$s"
    ;;
  *)
    echo "not a GitHub remote: $remote" >&2
    exit 1
    ;;
esac
