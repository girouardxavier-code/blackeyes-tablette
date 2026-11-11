#!/usr/bin/env bash
# Construit dist/CielDirect.apk avec les outils Android d'Ubuntu :
#   apt-get install android-sdk-build-tools android-sdk-platform-23 apksigner zipalign
# (les classes sont compilées contre android-23 ; l'application cible Android 14, minimum Android 7.)
set -euo pipefail
cd "$(dirname "$0")"
SDK=${ANDROID_HOME:-/usr/lib/android-sdk}
JAR=$SDK/platforms/android-23/android.jar
BT=$(ls -d "$SDK"/build-tools/*/ | head -1)
OUT=build; rm -rf "$OUT"; mkdir -p "$OUT"/{res,gen,classes,apk/assets}
KS=${CD_KEYSTORE:-ciel-direct.keystore}; PASS=${CD_KEYPASS:-cieldirect}
[ -f "$KS" ] || keytool -genkeypair -keystore "$KS" -storepass "$PASS" -keypass "$PASS" -alias cieldirect \
  -keyalg RSA -keysize 2048 -validity 10000 -dname "CN=Ciel Direct, O=Ciel Direct, C=FR" >/dev/null 2>&1

aapt2 compile --dir res -o "$OUT/res.zip"
aapt2 link -o "$OUT/base.apk" -I "$JAR" --manifest AndroidManifest.xml --java "$OUT/gen" "$OUT/res.zip" --auto-add-overlay
javac -nowarn -Xlint:-options --release 8 -classpath "$JAR" -d "$OUT/classes" $(find src "$OUT/gen" -name '*.java')
"$BT"/dx --dex --min-sdk-version=24 --output="$OUT/apk/classes.dex" "$OUT/classes"
cp -r ../www "$OUT/apk/assets/www"
cp "$OUT/base.apk" "$OUT/unaligned.apk"
(cd "$OUT/apk" && zip -qr -9 ../unaligned.apk classes.dex assets)
zipalign -f -p 4 "$OUT/unaligned.apk" "$OUT/aligned.apk"
mkdir -p ../dist
apksigner sign --v4-signing-enabled false --ks "$KS" --ks-pass "pass:$PASS" --key-pass "pass:$PASS" --out ../dist/CielDirect.apk "$OUT/aligned.apk"
apksigner verify --print-certs ../dist/CielDirect.apk | head -1
ls -l ../dist/CielDirect.apk
