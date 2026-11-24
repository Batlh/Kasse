**Wichtig beim Umstieg von einer älteren Version (1.4 oder früher):**
Ab Version 1.5 hat die App einen neuen internen Namen (`io.github.batlh.kasse`) und einen neuen Signierschlüssel.
Android installiert sie deshalb als **neue App neben der alten**, deine Daten werden nicht automatisch übernommen.

1. In der alten App: **Bericht → Sicherung speichern**.
2. Diese Version installieren und öffnen.
3. Im ersten Bildschirm (oder unter **Bericht**) **Sicherung laden** und die gespeicherte Datei wählen.
4. Prüfen, ob „In der Kasse“ stimmt, dann die alte App deinstallieren.

**Neu in 1.5**
- Code liegt jetzt auf GitHub, Downloads unter Releases.
- Versionsnummer steht im Bericht unter „Daten“.

**Seit 1.4 enthalten**
- Kosten der Veranstaltung mit Kategorien, nur für die Bilanz
- Buchungen korrigieren statt stornieren
- An der Theke eingelöste Marken buchen
- Trinkgeld beim Bezahlen und bei der Rückgabe von Marken, getrennt vom Ergebnis
- Bericht mit Ergebnis (Plus/Minus) und Kassensturz

**Dateien**
- `Kasse.apk`: Android 7 oder neuer
- `Kasse.exe`: Windows 10/11, nutzt Edge oder Chrome als Fenster. Die Daten liegen in `Kasse-Daten.json` neben dem Programm.
