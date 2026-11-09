#!/usr/bin/env python3
import json
import os
import signal
import subprocess
import sys
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path.cwd()
COMPOSE = 'compose.experiment-1a.yml'
GENERATOR = 'scripts/load/experiment-1a-final.mjs'
TIMEOUT = 600
ORDER = ['1-A', '1-B', '1-C', '2-C', '2-B', '2-A']
OUT = ROOT / 'experiments/1a/results' / ('final5000-' + datetime.now().strftime('%Y%m%d-%H%M%S-%f'))
ACTIVE = None
STOP = threading.Event()
THREAD = None
ENV = os.environ.copy()

def run(args, timeout=60, check=True):
    result = subprocess.run(args, env=ENV, text=True, stdout=subprocess.PIPE,
                            stderr=subprocess.STDOUT, timeout=timeout)
    if check and result.returncode:
        raise RuntimeError(f'Befehl fehlgeschlagen ({result.returncode}): {args[0]}\n{result.stdout}')
    return result.stdout

def dc(*args, **kw):
    return run(['docker', 'compose', '-p', 'arsnova-exp1a', '-f', COMPOSE, *args], **kw)

def save(path, value):
    path.write_text(value, encoding='utf-8')

def host_snapshot(folder, suffix):
    for label, args in [('vm', ['vm_stat']), ('swap', ['sysctl', 'vm.swapusage'])]:
        try:
            save(folder / f'host-{label}-{suffix}.txt', run(args, check=False, timeout=10))
        except Exception as exc:
            save(folder / f'host-{label}-{suffix}.txt', str(exc))

def cgroup(folder, suffix):
    script = "from pathlib import Path\nfor n in ('cpu.stat','cpu.max','memory.current','memory.peak'):\n p=Path('/sys/fs/cgroup')/n\n print(n+':\\n'+(p.read_text() if p.exists() else 'unavailable'))"
    save(folder / f'cgroup-{suffix}.txt', dc('exec', '-T', 'spacy', 'python', '-c', script))

def monitor(folder, ids):
    with (folder / 'docker-stats.jsonl').open('w', encoding='utf-8') as output:
        while not STOP.is_set():
            try:
                output.write(run(['docker', 'stats', '--no-stream', '--format', '{{json .}}', *ids],
                                 timeout=15, check=False))
                output.flush()
            except Exception as exc:
                save(folder / 'stats-warning.txt', str(exc))
            STOP.wait(1)

def terminate():
    global ACTIVE
    if ACTIVE is not None and ACTIVE.poll() is None:
        try:
            os.killpg(ACTIVE.pid, signal.SIGTERM)
            ACTIVE.wait(timeout=5)
        except subprocess.TimeoutExpired:
            os.killpg(ACTIVE.pid, signal.SIGKILL)
            ACTIVE.wait()
        except ProcessLookupError:
            pass

def load(folder):
    global ACTIVE
    env = ENV.copy()
    env.update(PARTICIPANTS='5000', JOIN_CONCURRENCY='25', VOTE_CONCURRENCY='100',
               ITERATIONS='10', ANALYSIS_P95_LIMIT_MS='30000',
               REPORT_FILE=str(folder / 'report.json'), TRPC_URL='http://127.0.0.1:3000/trpc')
    started = time.monotonic()
    with (folder / 'console.log').open('w', encoding='utf-8') as logfile:
        ACTIVE = subprocess.Popen(['/usr/bin/time', '-l', 'node', GENERATOR], env=env,
                                  stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                  text=True, bufsize=1, start_new_session=True)
        def stream():
            for line in ACTIVE.stdout:
                logfile.write(line)
                logfile.flush()
                print(line, end='', flush=True)
        reader = threading.Thread(target=stream, daemon=True)
        reader.start()
        try:
            result = ACTIVE.wait(timeout=TIMEOUT)
        except subprocess.TimeoutExpired:
            print(f'Zeitlimit nach {TIMEOUT} Sekunden; Lastgenerator wird beendet.', flush=True)
            save(folder / 'timeout.txt', f'Lastlauf nach {TIMEOUT} Sekunden beendet.\n')
            terminate()
            result = 124
        finally:
            if ACTIVE.poll() is None:
                terminate()
            reader.join(timeout=5)
    save(folder / 'elapsed-seconds.txt', f'{time.monotonic()-started:.3f}\n')
    save(folder / 'exit-code.txt', f'{result}\n')
    return result

def export():
    allowed = {'report.json', 'console.log', 'exit-code.txt', 'flags.json',
               'docker-stats.jsonl', 'cgroup-before.txt', 'cgroup-after.txt',
               'host-vm-before.txt', 'host-vm-after.txt', 'host-swap-before.txt',
               'host-swap-after.txt', 'measurement-commit.txt', 'script-sha256.txt',
               'image-manifest.txt', 'docker-resources.txt', 'method.txt', 'failure.txt',
               'timeout.txt', 'elapsed-seconds.txt', 'stats-warning.txt', 'series-status.txt'}
    target = OUT.parent / (OUT.name + '-export.txt')
    with target.open('w', encoding='utf-8') as output:
        output.write(f'arsnova.eu – 5000er-Isolationsserie\nSerie: {OUT.name}\n')
        for path in sorted(OUT.rglob('*')):
            if path.is_file() and path.name in allowed:
                name = path.relative_to(OUT)
                output.write(f'\n===== BEGIN FILE: {name} =====\n')
                output.write(path.read_text(encoding='utf-8', errors='replace'))
                output.write(f'\n===== END FILE: {name} =====\n')
    print(f'\nExport: {target}\nGröße: {target.stat().st_size/1024:.1f} KiB', flush=True)

def main():
    global THREAD
    if sys.platform != 'darwin':
        raise SystemExit('Dieser Runner ist für das bestehende macOS-/Colima-Labor vorgesehen.')
    for name in [COMPOSE, GENERATOR, 'experiments/1a/.env.runtime']:
        if not Path(name).is_file():
            raise SystemExit(f'Fehlt: {name}. Bitte im Repository-Hauptverzeichnis starten.')
    source = Path(GENERATOR).read_text()
    if 'responses.slice(0, 100)' not in source:
        raise SystemExit('Analyseinput-Begrenzung im Generator nicht gefunden; nicht starten.')
    run(['node', '--check', GENERATOR])
    old = run(['pgrep', '-fl', 'node scripts/load/experiment-1a-'], check=False)
    if old.strip():
        raise SystemExit('Noch laufenden Lastgenerator prüfen:\n' + old)
    confirmation = input(
        'Nur lokales Labor arsnova-exp1a: App/Sidecar werden neu erstellt, '
        'Redis wird vor jedem Lauf geleert. Zum Start LABOR eingeben: '
    )
    if confirmation != 'LABOR':
        raise SystemExit('Abgebrochen; keine Messserie gestartet.')
    OUT.mkdir(parents=True, exist_ok=False)
    status = 'unvollständig'
    folder = OUT
    try:
        save(OUT / 'measurement-commit.txt', run(['git', 'rev-parse', 'HEAD']))
        save(OUT / 'script-sha256.txt', run(['shasum', '-a', '256', GENERATOR, __file__, COMPOSE]))
        save(OUT / 'docker-resources.txt', run(['docker', 'info', '--format', 'CPUs={{.NCPU}} RAM_BYTES={{.MemTotal}}']))
        save(OUT / 'image-manifest.txt', run(['docker', 'image', 'inspect', 'arsnova-exp1a-app:baseline',
             'arsnova-exp1a-spacy:baseline', '--format', '{{.Id}} {{json .RepoTags}}']))
        save(OUT / 'method.txt',
             '5000 Teilnehmende, HTTP-Einzelsession, 10 Runden, Join-Parallelität 25, Vote-Parallelität 100.\n'
             '1000 Analysen je Lauf: 100 je Runde, maximal 2 gleichzeitig; mindestens 200 ms je Workerzyklus.\n'
             'Input: 100 Eintraege mit Index- und Auftragszusatz auf Basis von 12 Textvorlagen.\n'
             'Alle Varianten verwenden dieselbe geplante Analysearbeit; keine reine CPU-Stresslast.\n'
             'A: spaCy aus; B: 1 CPU/1 GiB; C: 0,25 CPU/1 GiB.\n'
             'Reihenfolge: '+', '.join(ORDER)+'\n'
             'Kein separater Warm-up, kein Browser-/WebSocket-Test; keine LLM-/Encoder-Last.\n'
             'App-Neustart und Redis-Leerung je Lauf; PostgreSQL bleibt erhalten.\n'
             '600 s Zeitlimit je Lastlauf; Setup-Befehle separat zeitbegrenzt.\n')
        print(f'Ergebnisordner: {OUT}', flush=True)
        for entry in ORDER:
            folder = OUT / entry
            folder.mkdir()
            scenario = entry[-1]
            ENV['EXP_NLP_ENABLED'] = 'false' if scenario == 'A' else 'true'
            ENV['EXP_SPACY_CPUS'] = '0.25' if scenario == 'C' else '1.0'
            print(f'\n=== {entry}: Vorbereitung ===', flush=True)
            dc('stop', 'app')
            if scenario == 'A':
                dc('--profile', 'nlp', 'stop', 'spacy')
            else:
                dc('--profile', 'nlp', 'up', '-d', '--no-build', '--no-deps', '--force-recreate',
                   '--wait', '--wait-timeout', '240', 'spacy', timeout=270)
            dc('exec', '-T', 'redis', 'redis-cli', 'FLUSHDB')
            dc('up', '-d', '--no-build', '--no-deps', '--force-recreate', '--wait', '--wait-timeout',
               '240', 'app', timeout=270)
            flags = dc('exec', '-T', 'app', 'node', '-e',
                "console.log(JSON.stringify(Object.fromEntries(['NLP_ENABLED','WORD_CLOUD_SEMANTIC_ENABLED','QA_NLP_ENABLED','QA_SUMMARY_ENABLED','OPEN_WEIGHT_LLM_ENABLED'].map(k=>[k,process.env[k]]))))")
            save(folder / 'flags.json', flags)
            parsed = json.loads(flags)
            for key, value in parsed.items():
                expected = ENV['EXP_NLP_ENABLED'] if key == 'NLP_ENABLED' else 'false'
                if value != expected:
                    raise RuntimeError(f'Feature-Flag stimmt nicht: {key}={value}')
            host_snapshot(folder, 'before')
            if scenario != 'A':
                cgroup(folder, 'before')
            ids = dc('ps', '-q').split()
            STOP.clear()
            THREAD = threading.Thread(target=monitor, args=(folder, ids), daemon=True)
            THREAD.start()
            print(f'=== {entry}: Lastlauf, Zeitlimit {TIMEOUT} s ===', flush=True)
            try:
                result = load(folder)
            finally:
                STOP.set()
                THREAD.join(timeout=20)
                THREAD = None
                host_snapshot(folder, 'after')
                if scenario != 'A':
                    cgroup(folder, 'after')
            if result != 0:
                raise RuntimeError(f'{entry}: Exitcode {result}; Serie angehalten, Daten bleiben erhalten.')
            report = json.loads((folder / 'report.json').read_text())
            assertions = report.get('assertions', [])
            if not assertions or not all(a.get('passed') for a in assertions):
                raise RuntimeError(f'{entry}: Report nicht vollständig bestanden.')
            print(f'=== {entry}: bestanden ===', flush=True)
        status = 'vollständig: 6/6 Läufe bestanden'
    except KeyboardInterrupt:
        terminate()
        status = 'manuell unterbrochen'
        save(folder / 'failure.txt', status+'\n')
    except Exception as exc:
        terminate()
        status = 'abgebrochen: ' + str(exc)
        save(folder / 'failure.txt', status+'\n')
        print(status, flush=True)
    finally:
        STOP.set()
        if THREAD:
            THREAD.join(timeout=20)
        save(OUT / 'series-status.txt', status+'\n')
        export()
    return 0 if status.startswith('vollständig:') else 1

if __name__ == '__main__':
    sys.exit(main())
