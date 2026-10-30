"""Private local worker for the desktop app. JSON events carry no browser logs or credentials."""
import argparse
import contextlib
import json
import os
import queue
import sys
import threading
import uuid
from pathlib import Path

import operator_notifications as notifications

ROOT = Path(__file__).resolve().parent


class DesktopChannel:
    def __init__(self, incoming=None, outgoing=None):
        self.incoming = incoming or sys.stdin
        self.outgoing = outgoing or sys.stdout
        self.answers = queue.Queue()
        self.lock = threading.Lock()

    def emit(self, event, **values):
        with self.lock:
            self.outgoing.write(json.dumps({'event': event, **values}) + '\n')
            self.outgoing.flush()

    def read_commands(self):
        for line in self.incoming:
            try:
                command = json.loads(line)
            except ValueError:
                continue
            if command.get('command') == 'stop':
                notifications.STOP_REQUESTED.set()
            elif command.get('command') == 'respond':
                self.answers.put(command)
        notifications.STOP_REQUESTED.set()  # Closing the app must not leave an unattended publisher.

    def ask(self, message='', kind='verification', alert=True):
        notifications.check_cancelled()
        request_id = uuid.uuid4().hex
        if alert:
            notifications.notify(message)
        self.emit('action', id=request_id, message=message, kind=kind)
        while True:
            notifications.check_cancelled()
            try:
                response = self.answers.get(timeout=0.2)
            except queue.Empty:
                continue
            if response.get('id') == request_id:
                value = str(response.get('value', ''))
                if value.strip().lower() == 'stop':
                    notifications.STOP_REQUESTED.set()
                    raise KeyboardInterrupt
                return value


def connect_chrome():
    from uivision import UiVision, tool_text, BridgeError, bridge_connected
    with UiVision() as client:
        status = tool_text(client.call('bridge_status'))
        if not bridge_connected(status) and 'wake channel' in status.lower():
            client.call('open_panel', {'target': 'chrome', 'why': 'Connect the local desktop publisher.'})
            status = tool_text(client.call('bridge_status'))
        if not bridge_connected(status):
            raise BridgeError('Open Chrome and Ui.Vision, enable its MCP bridge, then try Connect Chrome again.')


def resolve_review(workbook, pool, host, value):
    """An operator can defer a protected result or supply a URL for independent verification."""
    import backlinks
    from mappings.common import publication_domain
    from website_pool import merge_pool
    business, entries = backlinks.load_workbook(workbook)
    entries = merge_pool(entries, pool, workbook)
    folder = backlinks.campaign_folder(business)
    with backlinks.campaign_lock(folder / '.lock'):
        state = json.loads((folder / 'state.json').read_text(encoding='utf-8'))
        record = state[host]
        if record.get('status') == 'published':
            return True
        if record.get('status') not in ('submitting', 'uncertain', 'unverified'):
            raise ValueError('This record is not an unresolved submission')
        if value == 'skip':
            record['review_disposition'] = 'operator_deferred'
            backlinks.save(state, folder, entries)
            return True
        if not value.strip():
            return False
        public_host = publication_domain(host, record)
        backlinks.check_public_url(value.strip(), public_host)
        record.update(candidate_url=value.strip(), status='unverified')
        backlinks.save(state, folder, entries)
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            browser = p.chromium.launch()
            try:
                state[host] = {**record, **backlinks.verify(browser, value.strip(), business, public_host)}
            finally:
                browser.close()
        backlinks.save(state, folder, entries)
        return state[host].get('status') == 'published'


def publish_from_app(args, channel):
    import backlinks
    import uivision_publish
    from mappings.common import InspectionRequired
    from website_pool import merge_pool
    business, entries = backlinks.load_workbook(args.workbook)
    entries = merge_pool(entries, args.pool, args.workbook)
    hosts = list(dict.fromkeys(e['domain'] for e in entries))
    visited = set()
    original_begin = backlinks.begin_attempt
    def begin(folder, host):
        notifications.check_cancelled()
        visited.add(host)
        channel.emit('site', host=host)
        original_begin(folder, host)
    backlinks.begin_attempt = uivision_publish.begin_attempt = begin
    remaining = None
    while True:
        notifications.check_cancelled()
        sys.argv = ['uivision_publish.py', str(args.workbook.resolve()), '--pool',
                    str(args.pool.resolve()), '--campaign', 'default', '--publish', '--all-sites']
        if remaining is not None:
            if not remaining:
                break
            sys.argv += ['--only', *remaining]
        try:
            uivision_publish.main()
            break
        except InspectionRequired as error:
            alert = True
            while True:
                value = channel.ask(error.host + ': No clear public result was found. Inspect Chrome. '
                    'Done rechecks without reposting; Skip defers this site; or provide its public listing URL to verify.',
                    kind='review', alert=alert)
                try:
                    resolved = resolve_review(args.workbook, args.pool, error.host, value)
                    break
                except Exception:
                    channel.emit('review', message='That URL could not be independently verified. Check the public page or skip this site; nothing was reposted.')
                    alert = False
            if resolved:
                visited.add(error.host)
            remaining = [host for host in hosts if host not in visited or (not resolved and host == error.host)]
    channel.emit('finished', message='Run finished. Verified links and every outcome are saved.')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--workbook', type=Path)
    parser.add_argument('--pool', type=Path)
    parser.add_argument('--connect', action='store_true')
    args = parser.parse_args()
    if not args.connect and (not args.workbook or not args.pool):
        parser.error('--workbook and --pool are required for publishing')
    channel = DesktopChannel()
    threading.Thread(target=channel.read_commands, daemon=True).start()
    # Install before importing publishers so all imported input wrappers use this channel.
    notifications.operator_input = channel.ask
    os.environ['BACKLINK_DESKTOP'] = '1'
    private = ROOT / '.local' / 'desktop'
    private.mkdir(parents=True, exist_ok=True)
    log_path = private / ('session-' + uuid.uuid4().hex + '.log')
    with log_path.open('w', encoding='utf-8') as log, contextlib.redirect_stdout(log), contextlib.redirect_stderr(log):
        try:
            if args.connect:
                connect_chrome()
                channel.emit('connected', message='Chrome is connected. Keep Ui.Vision open.')
            else:
                publish_from_app(args, channel)
        except KeyboardInterrupt:
            channel.emit('stopped', message='Paused safely. Saved submissions will not be repeated.')
        except Exception as error:
            import traceback
            traceback.print_exc(file=log)
            from mappings.common import NeedsAttention
            from uivision import BridgeError
            if isinstance(error, NeedsAttention):
                notifications.notify('A publishing result needs your review. Open Backlink Publisher.')
                channel.emit('review', message='An unresolved result needs your review. Open the results and browser; Pause/Resume will not repeat its submission.')
            elif isinstance(error, BridgeError):
                message = 'The local bridge is not installed. Follow the setup instructions in DESKTOP_APP.md.' if 'install the local bridge' in str(error).lower() else 'Chrome could not be controlled. Open Chrome and Ui.Vision, enable MCP bridge, then click Connect Chrome.'
                channel.emit('error', message=message)
            elif isinstance(error, ValueError) and 'campaign is locked' in str(error).lower():
                channel.emit('error', message='This campaign is locked by another publisher. Stop that publisher first; keep the saved journal intact.')
            elif isinstance(error, FileNotFoundError) and getattr(error, 'filename', '') == 'node':
                channel.emit('error', message='Node.js is missing. Install the local prerequisites listed in DESKTOP_APP.md.')
            elif 'playwright install' in str(error).lower():
                channel.emit('error', message='The verification browser is missing. Run python -m playwright install chromium once, then resume.')
            else:
                channel.emit('error', message='The run could not finish. Check the workbook and website pool; technical details were saved privately.')
            channel.emit('diagnostic', path=str(log_path))


if __name__ == '__main__':
    main()
