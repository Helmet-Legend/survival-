#!/usr/bin/env bash
# Sur le téléphone virtuel (image google_apis, accès root possible) :
# 1. crée un coffre par l'interface, comme un utilisateur ;
# 2. vérifie que les bases du coffre sont réellement chiffrées par
#    SQLCipher (un fichier SQLite en clair commence par « SQLite format 3 ») ;
# 3. agrandit le texte du système à 200 % et vérifie qu'on peut encore
#    déverrouiller et voir l'accueil.
set -euo pipefail

PKG=app.fenrir
ACTIVITY=com.resilios.MainActivity
PIN=482915

# Élément de l'écran par son texte ou sa description d'accessibilité
# (insensible à la casse) ; renvoie « x y » de son centre, ou rien.
find_node() {
  adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1 || true
  adb pull /sdcard/ui.xml ui.xml >/dev/null 2>&1 || return 0
  python3 - "$1" <<'EOF'
import re, sys, xml.etree.ElementTree as ET
want = sys.argv[1].lower()
for node in ET.parse('ui.xml').iter('node'):
    label = (node.get('content-desc') or '') + '|' + (node.get('text') or '')
    if want in [part.strip().lower() for part in label.split('|')]:
        x1, y1, x2, y2 = map(int, re.findall(r'\d+', node.get('bounds')))
        print((x1 + x2) // 2, (y1 + y2) // 2)
        break
EOF
}

# Attend l'élément (jusqu'à 60 s) puis le touche.
tap() {
  local pos=""
  for _ in $(seq 1 30); do
    pos=$(find_node "$1")
    [ -n "$pos" ] && break
    sleep 2
  done
  if [ -z "$pos" ]; then
    echo "::error::Élément introuvable à l'écran : « $1 »"
    exit 1
  fi
  # shellcheck disable=SC2086
  adb shell input tap $pos
  sleep 0.5
}

wait_for() {
  for _ in $(seq 1 30); do
    [ -n "$(find_node "$1")" ] && return 0
    sleep 2
  done
  echo "::error::« $1 » n'apparaît pas"
  exit 1
}

type_pin() {
  for digit in $(echo "$PIN" | grep -o .); do
    tap "Chiffre $digit"
  done
  tap "Valider"
}

echo "— Création du coffre par l'interface"
# Fenêtre système éventuelle (autorisation de notifications) : refusée.
for label in "Don’t allow" "Don't allow" "Ne pas autoriser"; do
  pos=$(find_node "$label")
  if [ -n "$pos" ]; then
    # shellcheck disable=SC2086
    adb shell input tap $pos
    sleep 1
  fi
done
tap "Choisir mon code"
type_pin
type_pin
tap "Plus tard"
wait_for "Autonomie du foyer"
echo "Coffre créé, accueil affiché."

echo "— Chiffrement des bases sur le disque"
adb root >/dev/null
sleep 3
files=$(adb shell "find /data/data/$PKG /data/user/0/$PKG -name 'rs_store_*.db' 2>/dev/null" | tr -d '\r' | sort -u)
if [ -z "$files" ]; then
  echo "::error::Bases du coffre introuvables sur le téléphone"
  exit 1
fi
for f in $files; do
  size=$(adb shell "stat -c %s '$f'" | tr -d '\r')
  header=$(adb shell "head -c 15 '$f'" | tr -d '\r')
  echo "$f : $size octets"
  if [ "$size" -lt 4096 ]; then
    echo "::error::$f est vide ou presque"
    exit 1
  fi
  if [ "$header" = "SQLite format 3" ]; then
    echo "::error::$f est une base SQLite EN CLAIR : SQLCipher n'est pas actif"
    exit 1
  fi
  if adb shell "grep -c -a 'CREATE TABLE' '$f'" | tr -d '\r' | grep -qv '^0$'; then
    echo "::error::$f contient du texte de schéma lisible"
    exit 1
  fi
done
echo "Les deux bases sont chiffrées (aucun en-tête ni schéma lisible)."

echo "— Texte du système agrandi à 200 %"
adb shell settings put system font_scale 2.0
adb shell am force-stop "$PKG"
adb shell am start -W -n "$PKG/$ACTIVITY" >/dev/null
type_pin
wait_for "Autonomie du foyer"
adb shell settings put system font_scale 1.0
echo "Déverrouillage et accueil utilisables avec le texte à 200 %."
