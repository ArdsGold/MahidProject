"""One Windows desktop notification with sound per operator input prompt; no dependencies."""
import argparse
import json
import os
import subprocess
import uuid
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent
STOP_REQUESTED = threading.Event()


def check_cancelled():
    if STOP_REQUESTED.is_set():
        raise KeyboardInterrupt


def notify(message):
    if os.name != 'nt' or os.environ.get('BACKLINK_NOTIFICATIONS') == '0':
        return None
    folder = ROOT / '.local' / 'notifications'
    path = folder / (uuid.uuid4().hex + '.json')
    try:
        folder.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps({'title': 'Backlink tool: action required',
                                    'message': message[:240]}, ensure_ascii=False), encoding='utf-8-sig')
        return subprocess.Popen(
            ['powershell.exe', '-NoProfile', '-NonInteractive', '-STA', '-ExecutionPolicy', 'Bypass',
             '-File', str(ROOT / 'operator_notification.ps1'), '-MessageFile', str(path)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    except OSError:
        try:
            path.unlink(missing_ok=True)
        except OSError:
            pass
        return None  # Desktop notifications must never lose or answer an operator prompt.


def operator_input(message=''):
    notify(message or 'The tool is waiting for your input in the terminal.')
    return input(message)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--test', action='store_true', required=True)
    parser.parse_args()
    process = notify('Test notification. You should see this Windows desktop alert and hear a sound. No browser action is required.')
    if process is None:
        print('Desktop notifications unavailable; terminal prompts remain active.')
    else:
        print('Test notification requested.', flush=True)
        process.wait(timeout=30)
        print('Notification helper exit code:', process.returncode)


if __name__ == '__main__':
    main()
