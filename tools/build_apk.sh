#!/bin/bash
# Baut build/Kasse.apk ohne Gradle: aapt2, javac/ecj, d8, apksigner.
#
# Werkzeuge: aus $ANDROID_HOME (KASSE_BUILD_TOOLS/KASSE_PLATFORM oder jeweils die neueste Version)
# oder, falls $TC gesetzt ist, aus einem lokalen Werkzeugordner.
#
# Signieren: KASSE_KEYSTORE (Pfad zur .jks), KASSE_KEY_PASSWORD, optional KASSE_KEY_ALIAS (Standard: kasse).
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
VERSION=$(tr -d '[:space:]' < "$ROOT/VERSION")
IFS=. read -r MA MI PA <<< "$VERSION"
CODE=$(( ${MA:-0} * 10000 + ${MI:-0} * 100 + ${PA:-0} ))
: "${KASSE_KEYSTORE:?KASSE_KEYSTORE fehlt}" "${KASSE_KEY_PASSWORD:?KASSE_KEY_PASSWORD fehlt}"
ALIAS=${KASSE_KEY_ALIAS:-kasse}

if [ -n "${TC:-}" ]; then
  AAPT2=$TC/x-aapt/aapt2/bin/Linux/aapt2; T=$TC/x-min/package/tools; JAR=$T/android.jar
  D8=(java -cp "$T/d8.jar" com.android.tools.r8.D8); APKSIGNER=(java -jar "$T/apksigner.jar")
  JAVAC=(java -jar "$T/ecj-3.45.0.jar" -nowarn)
else
  : "${ANDROID_HOME:?ANDROID_HOME fehlt}"
  BT=${KASSE_BUILD_TOOLS:-$(ls -d "$ANDROID_HOME"/build-tools/*/ | sort -V | tail -1)}
  PLAT=${KASSE_PLATFORM:-$(ls -d "$ANDROID_HOME"/platforms/android-*/ | sort -V | tail -1)}
  AAPT2=$BT/aapt2; JAR=$PLAT/android.jar; D8=("$BT/d8"); APKSIGNER=("$BT/apksigner")
  JAVAC=(javac -nowarn -Xlint:-options)
fi

O=$ROOT/build/apk; rm -rf "$O"; mkdir -p "$O"/{gen,cls,assets,dex}
cp "$ROOT/build/index.html" "$O/assets/index.html"
"$AAPT2" compile --dir "$ROOT/android/res" -o "$O/res.zip"
"$AAPT2" link -I "$JAR" --manifest "$ROOT/android/AndroidManifest.xml" -A "$O/assets" --java "$O/gen" \
  --version-code "$CODE" --version-name "$VERSION" \
  -o "$O/base.apk" "$O/res.zip"
"${JAVAC[@]}" -source 8 -target 8 -bootclasspath "$JAR" -d "$O/cls" $(find "$ROOT/android/java" "$O/gen" -name '*.java')
"${D8[@]}" --release --lib "$JAR" --min-api 24 --output "$O/dex" $(find "$O/cls" -name '*.class')
python3 -I "$ROOT/tools/align.py" "$O/base.apk" "$O/dex/classes.dex" "$O/aligned.apk"
"${APKSIGNER[@]}" sign --ks "$KASSE_KEYSTORE" --ks-pass env:KASSE_KEY_PASSWORD --key-pass env:KASSE_KEY_PASSWORD \
  --ks-key-alias "$ALIAS" --min-sdk-version 24 --out "$ROOT/build/Kasse.apk" "$O/aligned.apk"
rm -f "$ROOT/build/Kasse.apk.idsig"
"${APKSIGNER[@]}" verify --min-sdk-version 24 --print-certs "$ROOT/build/Kasse.apk" | grep -i 'SHA-256'
echo "build/Kasse.apk: Version $VERSION ($CODE), $(stat -c %s "$ROOT/build/Kasse.apk") Bytes"
