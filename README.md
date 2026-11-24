# Kasse

Kassenprogramm für private Veranstaltungen, für Android und Windows. Es läuft komplett offline.

- Artikel selbst anlegen: Marken/Jetons mit Rückgabewert, Abendkasse-Tickets, Getränke, mit Bestand und Pack-Knöpfen (5er, 10er)
- Startgeld nach Scheinen und Münzen; beim Bezahlen nennt die App das Rückgeld samt Stückelung
- Rückgabe von Marken mit Auszahlbetrag, eingelöste Marken von der Theke, Trinkgeld
- Ausgaben, Einlagen, Entnahmen, Geld wechseln, Kasse zählen
- Buchungen korrigieren oder stornieren, mit sichtbarer alter Fassung
- Bericht mit Ergebnis der Veranstaltung (Einnahmen minus Kosten) und Kassensturz
- Sicherung als Datei zum Übertragen zwischen Handy und PC, Abrechnung als CSV für Excel
- Passt sich auf Android dem hellen oder dunklen Design und der Bildschirmgröße an

## Herunterladen

Die fertigen Dateien liegen unter [Releases](https://github.com/Batlh/kasse/releases):

- **Kasse.apk** für Android 7 oder neuer. Beim Installieren muss „Apps aus unbekannten Quellen“ erlaubt sein.
- **Kasse.exe** für Windows 10/11. Braucht Microsoft Edge oder Google Chrome als Fenster. Die Daten liegen in `Kasse-Daten.json` neben dem Programm, lege die EXE deshalb in einen eigenen Ordner.

Auf Android speichert die App nach jedem Schritt im App-Speicher. Die Daten gehen nur verloren, wenn die App deinstalliert oder ihr Speicher gelöscht wird. Zwischendurch eine Sicherung zu speichern schadet trotzdem nicht.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `src/` | Oberfläche (`ui.js`, `style.css`, `index.tpl.html`) und Rechenkern (`core.js`), gemeinsam für beide Plattformen |
| `android/` | Kleine Android-Hülle um eine WebView: Speichern, Dateien, Theme, Notch, Zurück-Taste |
| `windows/` | Go-Programm ohne fremde Bibliotheken: lokaler Server nur für diesen PC, öffnet Edge/Chrome im App-Modus |
| `tools/` | `bundle.py` fügt alles zu einer `index.html` zusammen, `build_apk.sh` baut die APK ohne Gradle |
| `tests/` | `node tests/core.test.js` prüft die Rechnungen |

Alle Beträge werden in ganzen Cent gerechnet. Bargeld und Bestände werden nie direkt überschrieben, sondern immer aus Startgeld und Buchungen berechnet.

## Selbst bauen

GitHub Actions baut bei jedem Push auf `main` die APK und die EXE. Steht in `VERSION` eine neue Versionsnummer, entsteht automatisch ein Release mit dem Text aus `RELEASE_NOTES.md`.

Für signierte Releases braucht das Repository zwei Secrets:

- `SIGNING_STORE_B64`: der Keystore (`.jks`, PKCS12, Alias `kasse`) als Base64
- `ANDROID_KEY_PASSWORD`: Passwort für Keystore und Schlüssel

Ohne diese Secrets signiert der Build nur mit einem Testschlüssel und veröffentlicht kein Release.

Lokal:

```bash
node tests/core.test.js
python3 tools/bundle.py
KASSE_KEYSTORE=pfad/zu/kasse.jks KASSE_KEY_PASSWORD=… tools/build_apk.sh   # braucht ANDROID_HOME
cd windows && cp ../build/index.html . && GOOS=windows go build -ldflags "-s -w -H=windowsgui" -o ../build/Kasse.exe .
```

## Lizenz

Der Code steht unter der [MIT-Lizenz](LICENSE).
Die eingebettete Schrift [Barlow](https://github.com/jpt/barlow) steht unter der SIL Open Font License 1.1, siehe [`src/fonts/OFL.txt`](src/fonts/OFL.txt).
