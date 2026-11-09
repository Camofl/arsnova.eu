# Thema 1A: ergaenzender Belastungsversuch

Stand: 2026-11-09. Deskriptive Laborergebnisse, keine Produktionsfreigabe.

## Methode
5000 logische Teilnehmende, HTTP-Einzelsession, zehn Runden mit je 5000 Votes, 1000 Analyseauftraege je Lauf, maximal zwei Worker und mindestens 200 ms Workerzyklus. Synthetische Texte mit Index-/Auftragszusatz auf Basis von zwoelf Vorlagen. App-/Sidecar-Neustart und Redis-Leerung je Lauf; PostgreSQL blieb erhalten. Kein separater Warm-up. Docker: vier CPUs, 6198624256 Byte RAM; Lastgenerator auf demselben physischen Host.

## Vollstaendige Laeufe
| Variante | Laufzeit s | Vote-p95 laut Report ms | Analyse-p95 laut Report ms | Stimmen | LEMMA |
|---|---:|---:|---:|---:|---:|
| A: NLP aus | 156.190 | 209.61 | 103.67 | 50000/50000 | 0/1000, NLP_DISABLED |
| B: 1 CPU / 1 GiB | 162.846 | 274.64 | 267.47 | 50000/50000 | 1000/1000 |
| C-Ergaenzung: 0.25 CPU / 1 GiB | 802.279 | 236.68 | 2706.64 | 50000/50000 | 1000/1000 |

B und C-Ergaenzung: keine Normalisierungs-Fallbacks. Alle drei Sessions sauber beendet; Antworten laut Report vollstaendig und unveraendert. p95 sind Reportkennzahlen, keine Mittelwerte der Runden-p95.

## Ressourcen
Sidecar-Zaehlerdifferenzen: B 86.303529 CPU-s und 0.125104 s throttled_usec, 10/1134 gedrosselte Perioden; C-Ergaenzung 186.983708 CPU-s und 626.941340 s throttled_usec, 7472/7517 gedrosselte Perioden. memory.peak am Ende: B 500.64 MiB, C-Ergaenzung 514.02 MiB, jeweils seit Containerstart. Drosselungszeit ist keine identische zusaetzliche Gesamtlaufzeit.
Anteil der Vote-Wellenzeit mit mindestens einer offenen Analyseanfrage, als vereinigte HTTP-Zeitintervalle: A 43.55 %, B 99.30 %, C-Ergaenzung 100 %. Keine Messung durchgehender Sidecar-CPU-Aktivitaet.

## Abbruch bleibt dokumentiert
Die geplante Folge A/B/C/C/B/A endete beim ersten C nach 600.027 s mit Exitcode 124. Sieben protokollierte Runden bestaetigen 35000 angenommene Votes; ein Abschlussreport fehlt. Ausschliesslich C wurde danach von Anfang an mit Gesamtzeitlimit 1200 statt 600 s wiederholt. Lastprofil und Analyse-Einzelschwelle blieben unveraendert. Keine Fortsetzung, kein Ersatz des Timeout-Befunds; die zweite Wiederholungsfolge entfiel aus Zeitgruenden.

## Schluss
1 CPU/1 GiB ist ein Kandidat fuer diese Laborlast, nicht eine Produktionsfreigabe. Alle Analysen lemmatisiert und alle Stimmen angenommen; B-Vote-p95 dennoch etwa 31 % ueber A. C konnte mit mehr Gesamtzeit abschliessen, nicht innerhalb des urspruenglichen 600-s-Budgets. C-Analyse-p95 etwa 10.12-fach und Gesamtlaufzeit etwa 4.93-fach gegenueber B. Starke Drosselung nachgewiesen, aber keine alleinige kausale Erklaerung aller Unterschiede. Die Beobachtungen sind mit begrenztem Analysedurchsatz bei erhaltenem Vote-Pfad vereinbar, beweisen keine vollstaendige Ressourcenisolation.

## Grenzen und Nachweise
Ein vollstaendiger Lauf je Variante; keine abgesicherte Streuung oder kausale Effektgroesse. Kein Browser-/WebSocket-/Kompass-E2E, kein konstanter Q&A-Testbestand, keine LLM-/Encoder-Last; synthetische Texte, gemeinsamer Host und erhaltene Datenbank. Identitaet mit Release 1.3 nicht verifiziert. Fruehere wiederholte 5000er-Serie mit 50 Analysen je Lauf getrennt auswerten.

Quellexporte: final5000-20261109-220824-060209-export.txt und final5000-retry-c-20261109-224357-830331-export.txt. Rohdaten und ausgefuehrte Generator-/Runnerdateien sind fuer vollstaendige Reproduktion zusaetzlich zu archivieren. Dieser erste Publikationsschritt umfasst nur den Bericht, nicht das vollstaendige Reproduktionspaket.
