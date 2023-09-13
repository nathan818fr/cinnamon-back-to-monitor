#!/bin/bash
set -Eeuo pipefail
shopt -s inherit_errexit

EXT_UUID='back-to-monitor@nathan818fr'
EXT_URL='https://github.com/nathan818fr/cinnamon-back-to-monitor'

function main() {
    local local_repo; local_repo="$(realpath -m -- "$(dirname "$(realpath -m -- "$0")")/..")"
    local spices_repo; spices_repo="$(realpath -m -- "${SPICES_EXTENSIONS_DIR:-${local_repo}/../cinnamon-spices-extensions}")"

    if ! git -C "$spices_repo" rev-parse --is-inside-work-tree >/dev/null; then
        echo "warn: '${spices_repo}' is not a git repository" >&2
        exit 1
        # eg:
        # $ git clone git@github.com:nathan818fr/cinnamon-spices-extensions.git
        # $ git remote add linuxmint https://github.com/linuxmint/cinnamon-spices-extensions
    fi

    pushd "$spices_repo" >/dev/null

    git checkout master
    git pull linuxmint master
    git branch -D "$EXT_UUID" 2>/dev/null || true
    git checkout -b "$EXT_UUID"

    rm -rf -- "$EXT_UUID"
    rsync -a --inplace --include={'/LICENSE','/README.md','/screenshot.png','/info.json','/files/','/files/**'} --exclude='*' -- "${local_repo}/" "${EXT_UUID}/"
    git add -- "$EXT_UUID"
    git status

    if [[ -n "$(git status --porcelain)" ]]; then
        git commit -m "Update ${EXT_UUID}

Changelog at: ${EXT_URL}/commits/main"
    fi
    git push -f --set-upstream -- origin "$EXT_UUID"

    popd >/dev/null
}

main "$@"
exit 0
