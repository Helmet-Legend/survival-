#!/usr/bin/env bash
# Après une fusion dans `main` : si la pull request fusionnée a déjà été
# compilée avec succès sur exactement le même code, publie ses APK et IPA
# au lieu de tout recompiler (≈ 15 minutes de gagnées). Sinon, sortie
# « reprise=false » et la compilation complète a lieu comme avant.
set -euo pipefail

decide() {
  echo "reprise=$1" >> "$GITHUB_OUTPUT"
  [ "$1" = true ] || echo "Compilation complète : $2"
  exit 0
}

pr=$(gh api "repos/$GITHUB_REPOSITORY/commits/$GITHUB_SHA/pulls" --jq '.[0].number // empty')
[ -n "$pr" ] || decide false "aucune pull request pour $GITHUB_SHA"
head=$(gh api "repos/$GITHUB_REPOSITORY/pulls/$pr" --jq .head.sha)

run=$(gh run list --repo "$GITHUB_REPOSITORY" --workflow android-apk.yml \
  --event pull_request --commit "$head" --limit 20 \
  --json databaseId,conclusion \
  --jq '[.[] | select(.conclusion == "success")][0].databaseId // empty')
[ -n "$run" ] || decide false "pas de compilation réussie pour la PR #$pr ($head)"

mkdir -p reprise
gh run download "$run" --repo "$GITHUB_REPOSITORY" --dir reprise \
  --name fenrir-build-info --name fenrir-build-info-signed \
  --name fenrir-apk --name fenrir-ipa \
  || decide false "artefacts de la compilation $run introuvables"

# La PR a été compilée sur sa fusion avec `main` : même arbre de fichiers
# que le commit fusionné, sauf si `main` a bougé entre-temps.
tree=$(git rev-parse "HEAD^{tree}")
built=$(cat reprise/fenrir-build-info/tree.txt)
[ "$tree" = "$built" ] || decide false "code différent de celui compilé ($built ≠ $tree)"
[ "$(cat reprise/fenrir-build-info-signed/build-info-signed.txt)" = 1 ] \
  || decide false "APK de la PR signé en débogage"

apk=$(ls reprise/fenrir-apk/Fenrir-*.apk)
ipa=$(ls reprise/fenrir-ipa/Fenrir-*.ipa)
version=$(basename "$apk" .apk)
version=${version#Fenrir-}
gh release create "v$version" "$apk" "$ipa" \
  --repo "$GITHUB_REPOSITORY" --target "$GITHUB_SHA" \
  --title "Fenrir $version" \
  --notes "$(git log -1 --pretty=%B | head -1)"
echo "Version $version publiée depuis la compilation $run de la PR #$pr."
decide true ""
