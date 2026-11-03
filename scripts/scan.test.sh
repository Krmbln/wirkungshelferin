#!/usr/bin/env bash
# Tests scan.sh in a throwaway git repo: clean passes, each planted leak fails.
set -euo pipefail

scan="$(cd "$(dirname "$0")" && pwd)/scan.sh"
work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
pass=0; fail=0

setup() {
  rm -rf "$work/repo"; mkdir -p "$work/repo/scripts"; cd "$work/repo"
  git init -q; cp "$scan" scripts/scan.sh
  printf 'Fixture Verein\n' > .real-names.txt
  printf '.real-names.txt\n' > .gitignore
  printf 'Auth/authorization: is every route protected?\n' > notes.md
}

expect() { # expect <pass|fail> <description> [env...]
  local want=$1 desc=$2; shift 2
  if env -u CI -u REAL_NAMES "$@" bash scripts/scan.sh > "$work/out" 2>&1; then got=pass; else got=fail; fi
  if [[ $got == "$want" ]]; then pass=$((pass + 1)); echo "  ok   $desc"
  else fail=$((fail + 1)); echo "  FAIL $desc (expected $want)"; sed 's/^/       /' "$work/out"; fi
}

# Split so this file doesn't trip the real scan.
key="sk-ant-api03-""abcdefghijklmnop"
auth='"author''ization": "Bearer xyz"'
apikey='"x-api''-key": "abc123"'

setup; expect pass "clean repo, prose mentioning authorization"
setup; echo "const k = '$key'" > leak.ts; expect fail "API key in a new file"
setup; echo "{$auth}" > rec.json; expect fail "authorization header with a value"
setup; echo "{$apikey}" > rec.json; expect fail "x-api-key header with a value"
setup; mkdir -p app/dist; echo "$key" > app/dist/a.js; expect fail "API key in app/dist (ignored by git)"
setup; echo 'Der fixture verein spielt.' > case.md; expect fail "real name, other case"
setup; mkdir -p docs; echo x > "docs/Fixture Verein Antrag.md"; expect fail "real name in a file path"
setup; echo 'Fixture Verein' > hidden.md; echo hidden.md >> .gitignore; expect pass "real name in an ignored file"
setup; rm .real-names.txt; expect fail "CI without a name list" CI=true
setup; rm .real-names.txt; echo 'Andere Gruppe' > x.md; expect fail "list from REAL_NAMES" REAL_NAMES=$'\nAndere Gruppe\n'
setup; printf '# comment\n\n' > .real-names.txt; echo 'anything' > x.md; expect pass "blank lines and comments match nothing"

# The name must not appear in the scan output (public CI logs).
setup; echo 'Fixture Verein' > case.md; env -u CI bash scripts/scan.sh > "$work/out" 2>&1 || true
if grep -q -i 'fixture verein' "$work/out"; then fail=$((fail + 1)); echo "  FAIL name printed in output"
else pass=$((pass + 1)); echo "  ok   name not printed in output"; fi

echo "$pass passed, $fail failed"
[[ $fail -eq 0 ]]
