"""Local Ui.Vision connection. Uses the official bridge; no Codex settings changes."""
import argparse
import json
import queue
import re
import subprocess
import sys
import threading
import time
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BRIDGE = ROOT / '.local/uivision-bridge/node_modules/uivision-mcp-bridge/uivision-mcp-bridge.js'


class BridgeError(Exception):
    pass


def tool_text(result):
    return '\n'.join(item.get('text', '') for item in result.get('content', []) if item.get('type') == 'text')


def bridge_connected(status):
    """Use current connection evidence, not the historical 'host not connected at hello' note."""
    return bool(re.search(r'\b[1-9]\d* browser connections?\s*:|\bconnected\s+(?:chrome|edge|firefox)(?:#|\b)', status, re.I))


def redact_token(value):
    return re.sub(r'(token (?:field|value)[^:\n]*:\s*)\S+', r'\1[REDACTED]', value, flags=re.I)


class UiVision:
    def __init__(self, command=None):
        if command is None:
            if not BRIDGE.exists():
                raise BridgeError('Install the local bridge: npm install --prefix .local/uivision-bridge --no-audit --no-fund --ignore-scripts uivision-mcp-bridge@1.7.20')
            command = ['node', str(BRIDGE)]
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        stderr=subprocess.DEVNULL, text=True, encoding='utf-8',
                                        creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
        self.messages = queue.Queue()
        self.sequence = 0
        threading.Thread(target=self._read, daemon=True).start()
        try:
            self.request('initialize', {'protocolVersion': '2024-11-05', 'capabilities': {},
                                       'clientInfo': {'name': 'Backlink App', 'version': '1.0'}})
            self._send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
            # A second bridge process connects to the existing one asynchronously.
            # Wait using status checks, never by retrying a browser action.
            for attempt in range(25):
                ready = self.request('tools/call', {'name': 'bridge_status', 'arguments': {}})
                if not ready.get('isError') or 'relay is not connected yet' not in tool_text(ready):
                    break
                time.sleep(0.2)
        except BaseException:
            self.close()
            raise

    def _read(self):
        try:
            for line in self.process.stdout:
                try:
                    self.messages.put(json.loads(line))
                except ValueError:
                    continue
        finally:
            self.messages.put(None)

    def _send(self, message):
        self.process.stdin.write(json.dumps(message, ensure_ascii=False) + '\n')
        self.process.stdin.flush()

    def request(self, method, params=None, timeout=30):
        self.sequence += 1
        request_id = self.sequence
        self._send({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params or {}})
        deadline = time.monotonic() + timeout
        while True:
            try:
                message = self.messages.get(timeout=max(0, deadline - time.monotonic()))
            except queue.Empty:
                self._send({'jsonrpc': '2.0', 'method': 'notifications/cancelled', 'params': {'requestId': request_id}})
                raise BridgeError('Ui.Vision request timed out; inspect the browser before repeating an action.') from None
            if message is None:
                raise BridgeError('Ui.Vision bridge exited.')
            if message.get('id') != request_id:
                continue
            if 'error' in message:
                raise BridgeError(redact_token(message['error'].get('message', 'Bridge error')))
            return message.get('result', {})

    def call(self, name, arguments=None, timeout=180):
        result = self.request('tools/call', {'name': name, 'arguments': arguments or {}}, timeout)
        if result.get('isError'):
            raise BridgeError(redact_token(tool_text(result)))
        return result

    def close(self):
        if self.process.poll() is None:
            self.process.stdin.close()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                self.process.terminate()
                self.process.wait(timeout=3)
        self.process.stdout.close()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()


def main():
    sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument('--connect', action='store_true', help='Keep the local bridge available; never navigates or publishes')
    action.add_argument('--tool', help='Call an official Ui.Vision tool')
    parser.add_argument('--args-file', type=Path, help='JSON arguments for --tool; use .local for private data')
    parser.add_argument('--output', type=Path, help='Save complete tool response locally (may contain private page data)')
    args = parser.parse_args()
    with UiVision() as client:
        if args.connect:
            print('Local Ui.Vision bridge is running on port 50888. No publishing started.', flush=True)
            print('In Ui.Vision: Settings (gear) > AI > enable MCP bridge > Test. Keep its panel open.', flush=True)
            previous = None
            while True:
                report = tool_text(client.call('bridge_status'))
                # The upstream unpaired status contains a fallback token. Do not print it.
                status = 'Waiting for Ui.Vision connection' if 'NOT connected' in report else report
                status = redact_token(status)
                if status != previous:
                    print(status, flush=True)
                    previous = status
                time.sleep(3)
        else:
            arguments = json.loads(args.args_file.read_text(encoding='utf-8-sig')) if args.args_file else {}
            result = client.call(args.tool, arguments, timeout=900 if args.tool == 'run_macro' else 180)
            if args.output:
                args.output.parent.mkdir(parents=True, exist_ok=True)
                args.output.write_text(json.dumps(result, ensure_ascii=False), encoding='utf-8')
            print(redact_token(tool_text(result)), flush=True)


if __name__ == '__main__':
    try:
        main()
    except (BridgeError, ValueError, FileNotFoundError) as exc:
        sys.exit(str(exc))
    except KeyboardInterrupt:
        sys.exit('Ui.Vision connection stopped.')
