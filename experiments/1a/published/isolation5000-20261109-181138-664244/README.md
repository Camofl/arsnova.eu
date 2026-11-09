# 1A: spaCy-Ressourcenisolation

## Herkunft und Version

Autor: Alfred Weickert.
Messserie: isolation5000-20261109-181138-664244, 9. November 2026.
Messcommit: 5f9c9d895fc9016a94ab381f13c6aebad640fc8c.

Die Originaldaten liegen unverändert im lokalen results-Verzeichnis.
Dieses Verzeichnis enthält eine ausgewählte Veröffentlichungskopie.
In script-sha256.txt wurde ausschließlich der absolute lokale Pfad
des Runners durch seinen Repositorypfad ersetzt. Hashwerte und
Messwerte wurden nicht verändert. Vollständige Anwendungslogs,
Konsolenausgaben und Host-Speicherdiagnosen sind nicht enthalten.

Der spätere Veröffentlichungscommit ist nicht der Messcommit.
Die Release-1.3-Konformität ist bislang nicht nachgewiesen.

## Versuch

A: spaCy deaktiviert.
B: spaCy mit 1 CPU und 1 GiB RAM.
C: spaCy mit 0,25 CPU und 1 GiB RAM.

Drei Wiederholungen je Variante.
Ausführungsreihenfolge:
1-A, 1-B, 1-C, 2-B, 2-C, 2-A, 3-C, 3-A, 3-B.

Je Lauf: 5000 logische Teilnehmende, zehn Vote-Runden,
Join-Parallelität 25 und Vote-Parallelität 100.
50 Analyseanfragen je Lauf; jeweils die ersten 100 synthetischen
Antworten aus zwölf Basistextvorlagen.
Kein eigenständiger Q&A-Lasttest, kein Browser-/WebSocket-Test.

App-Neustart und Redis-Leerung vor jedem Lauf.
PostgreSQL bleibt erhalten. Kein separater Warm-up.
Encoder, Q&A-NLP, Summary und LLM sind deaktiviert.
Docker-VM: 4 CPUs; RAM siehe docker-resources.txt.

## Auswertung

Vom Repository-Hauptverzeichnis aus:

```bash
python3 experiments/1a/analyze-isolation5000.py experiments/1a/published/isolation5000-20261109-181138-664244
```

summary-runs.csv enthält Kennzahlen je Lauf.
summary-variants.csv enthält Median, Minimum und Maximum der
laufbezogenen Kennzahlen. Insbesondere ist der Median mehrerer
p95-Werte KEIN gemeinsam berechnetes p95 aller Requests.

LEMMA-Verfügbarkeit wird anhand normalizationApplied ausgewertet.
API-Erfolg und angewendete Lemmatisierung sind getrennte Kriterien.
Die Baseline A soll keine Lemmatisierung durchführen.

CPU- und Drosselungswerte sind Differenzen der cgroup-Zähler
vor und nach dem jeweiligen Lauf. Das Messfenster schließt
ergänzende Überwachungs- und Diagnoseaktivität ein.
memory.peak ist ein Lebenszeitmaximum der cgroup seit deren Anlage,
kein isoliert gemessener Peak ausschließlich während der Live-Last.
summary-resources.csv enthält pro Lauf und Dienst CPU- und
RAM-Stichprobenkennzahlen aus docker-stats.jsonl. Der RAM-Wert
entspricht der Docker-CLI-Anzeige und ist nicht mit memory.peak
oder einem gesamten Host-RAM-Verbrauch gleichzusetzen.
CPU-Prozentwerte werden unverändert aus Docker übernommen;
sie sind nicht auf die gesamte Vier-CPU-VM normiert.
Die Stichproben besitzen keine individuellen Zeitstempel.
Daher werden keine zeitgewichteten Mittelwerte berechnet.
Stichprobenmaxima können kurze tatsächliche Spitzen verfehlen.

Zusätzliche Auswertung vom Repository-Hauptverzeichnis:

```bash
python3 experiments/1a/analyze-container-resources.py experiments/1a/published/isolation5000-20261109-181138-664244
```

Nach jeder Änderung an veröffentlichten Dateien ist der erste
Auswerter erneut auszuführen, um checksums.sha256 zu aktualisieren.

## Originalrunner und Voraussetzungen

Originalrunner: experiments/1a/run-isolation5000.py.
Benötigt macOS, Python 3, Node.js, Docker Compose, vorbereitete
Images und eine lokale experiments/1a/.env.runtime.
Die Laufzeitkonfiguration wird nicht veröffentlicht.

ACHTUNG: Der Runner startet Dienste neu und führt Redis FLUSHDB aus.
Er darf ausschließlich im isolierten Experimentprojekt laufen.
Er wird für die Auswertung vorhandener Daten NICHT benötigt.

Der Runner nutzt vorhandene Images mit --no-build.
image-manifest.txt dokumentiert lokale Image-IDs, nicht automatisch
reproduzierbare Registry-Digests oder einen belegten Source-Build.
Die Zuordnung von Image-Inhalt und Messcommit ist separat zu prüfen.

## Aussagegrenzen

5000 logische Teilnehmende entsprechen nicht 5000 gleichzeitigen
Browsern. Lastgenerator und Docker-VM teilen sich denselben Mac.
Die Analyse arbeitet mit einem kleinen, wiederholungsreichen Korpus.
Analyseanfragen überlappen nur einen Teil der Vote-Wellen.
Ein bestandener Lauf garantiert keine lückenlose Lemmatisierung.
SIDECAR_UNAVAILABLE allein bestimmt nicht die interne Fehlerursache.
Die Abfrageverfügbarkeit ist kein Nachweis visueller Kompassaktualität.
Die Ergebnisse rechtfertigen keine Freigabe zusätzlichen LLM-Betriebs.

## Integrität und KI-Unterstützung

checksums.sha256 erfasst die Dateien dieser Veröffentlichungskopie,
ausgenommen die Prüfsummenliste selbst.
Skripte und Konfiguration werden zusätzlich durch Git versioniert.
Prüfsummen belegen Dateiidentität, nicht inhaltliche Richtigkeit.

Das nachträgliche Auswertungsskript und diese README wurden mit
Perplexity-Unterstützung erstellt. Sie gehören nicht zum ursprünglichen
Messlauf. Prüfung und Verantwortung liegen beim Verfasser.
