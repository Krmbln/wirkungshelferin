#!/usr/bin/env bash
# Fails if credentials or real names would go public (implementation plan, standing rule 4).
#  1. Credentials in every tracked (or new, not ignored) file.
#  2. An API key in the built app (app/dist), if it exists.
#  3. Real names in file contents and paths. The list is never tracked: it comes from
#     $REAL_NAMES (GitHub Actions secret) or the git-ignored .real-names.txt, one name per line.
# Matches are reported as file:line only, so the names never show up in public CI logs.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"
failed=0

files=()
while IFS= read -r -d '' f; do
  [[ -f "$f" && "$f" != scripts/scan.sh ]] && files+=("$f")
done < <(git ls-files -z --cached --others --exclude-standard)

hits() { cut -d: -f1,2 | sed 's/^/  /'; }

credentials='sk-ant-[A-Za-z0-9_-]{8,}|x-api-key["'\'']?[[:space:]]*[:=][[:space:]]*["'\'']?[A-Za-z0-9]|authorization["'\'']?[[:space:]]*[:=][[:space:]]*["'\'']?(bearer|basic|sk-)'

echo "1/3 Credentials in ${#files[@]} files"
if out=$(grep -I -n -i -E "$credentials" -- "${files[@]}"); then
  echo "FAIL: possible credentials:"; echo "$out" | hits; failed=1
fi

echo "2/3 API key in app/dist"
if [[ -d app/dist ]]; then
  if out=$(grep -r -I -n -E 'sk-ant-[A-Za-z0-9_-]{8,}' app/dist); then
    echo "FAIL: API key in the build:"; echo "$out" | hits; failed=1
  fi
else
  echo "  (no build, skipped)"
fi

echo "3/3 Real names"
names=$(mktemp); trap 'rm -f "$names"' EXIT
if [[ -n "${REAL_NAMES:-}" ]]; then
  printf '%s\n' "$REAL_NAMES" > "$names"
elif [[ -f .real-names.txt ]]; then
  cp .real-names.txt "$names"
fi
# Blank lines would match everything; # starts a comment.
grep -v -E '^[[:space:]]*(#|$)' "$names" | sed 's/[[:space:]]*$//' > "$names.clean" || true
mv "$names.clean" "$names"

if [[ ! -s "$names" ]]; then
  if [[ -n "${CI:-}" ]]; then
    echo "FAIL: name list missing (GitHub secret REAL_NAMES)"; failed=1
  else
    echo "  WARNING: no .real-names.txt, name scan skipped"
  fi
else
  echo "  $(wc -l < "$names" | tr -d ' ') names"
  if out=$(grep -I -n -i -F -f "$names" -- "${files[@]}"); then
    echo "FAIL: real names in file contents:"; echo "$out" | hits; failed=1
  fi
  if out=$(printf '%s\n' "${files[@]}" | grep -n -i -F -f "$names"); then
    echo "FAIL: real names in file paths (line numbers of the file list):"; echo "$out" | cut -d: -f1 | sed 's/^/  entry /'; failed=1
  fi
fi

if [[ $failed -ne 0 ]]; then exit 1; fi
echo "OK: nothing found"
