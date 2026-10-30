"""Offline notification delivery, input preservation and command-argument isolation."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import operator_notifications as notifications


class NotificationChecks(unittest.TestCase):
    def test_one_notification_per_wait_preserves_operator_answer(self):
        with patch.object(notifications, 'notify') as alert, patch('builtins.input', return_value='skip') as answer:
            self.assertEqual(notifications.operator_input('Complete CAPTCHA on example.test'), 'skip')
            alert.assert_called_once_with('Complete CAPTCHA on example.test')
            answer.assert_called_once()

    def test_message_is_data_not_a_shell_command_and_helper_is_hidden(self):
        with tempfile.TemporaryDirectory() as d, patch.object(notifications, 'ROOT', Path(d)), \
             patch.dict(os.environ, {'BACKLINK_NOTIFICATIONS': '1'}), patch('operator_notifications.subprocess.Popen') as launch:
            with patch.object(notifications.os, 'name', 'nt'):
                notifications.notify('CAPTCHA on example.test $(do-not-execute) "quoted"')
            args, options = launch.call_args
            self.assertNotIn('$(do-not-execute)', str(args))
            self.assertFalse(options.get('shell', False))
            self.assertEqual(options['creationflags'], getattr(notifications.subprocess, 'CREATE_NO_WINDOW', 0))
            message_file = Path(args[0][-1])
            self.assertIn('$(do-not-execute)', json.loads(message_file.read_text(encoding='utf-8-sig'))['message'])

    def test_notification_failure_never_dismisses_or_answers_the_prompt(self):
        with tempfile.TemporaryDirectory() as d, patch.object(notifications, 'ROOT', Path(d)), \
             patch.dict(os.environ, {'BACKLINK_NOTIFICATIONS': '1'}), patch('operator_notifications.subprocess.Popen', side_effect=OSError), \
             patch('builtins.input', return_value='done'):
            with patch.object(notifications.os, 'name', 'nt'):
                self.assertEqual(notifications.operator_input('Verification required'), 'done')
            self.assertEqual(list((Path(d) / '.local/notifications').glob('*.json')), [])

    def test_disabled_notifications_start_no_process(self):
        with patch.dict(os.environ, {'BACKLINK_NOTIFICATIONS': '0'}), patch('operator_notifications.subprocess.Popen') as launch:
            self.assertIsNone(notifications.notify('Testing'))
            launch.assert_not_called()


if __name__ == '__main__':
    unittest.main()
