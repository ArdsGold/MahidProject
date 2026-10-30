"""Ui.Vision pilot macro commands; data files stay in each campaign helper folder."""


def macro_commands():
    read_job = [('store', '1', '!csvReadLineNumber'), ('csvRead', 'pastelink_job.csv', '')]
    fill = read_job + [
        ('echo', 'Check your earlier Pastelink submission first. If it already exists, stop and use Capture_URL. Resume only to fill a new form.', '#shownotification'),
        ('pause', '0', ''),
        ('open', 'https://pastelink.net/submit', ''),
        ('echo', 'Complete browser verification. Click Resume when the form is visible.', '#shownotification'),
        ('pause', '0', ''),
        ('executeScript', 'return document.querySelector("#textbody").maxLength;', 'body_limit'),
        ('if_v2', '${body_limit} >= 0 && ${body_limit} < ${!COL5}', ''),
        ('throwError', 'Combined content exceeds the form limit. Use the batch publisher to fit essentials and report omissions.', ''),
        ('end', '', ''),
        ('echo', 'Source fields omitted: ${!COL6}', '#shownotification'),
        ('type', 'id=input-title', '${!COL3}'),
        ('type', 'id=textbody', '${!COL4}'),
        ('echo', 'Details filled. Complete options and CAPTCHA, retain any edit code privately, and submit manually. Open the public result and run Pastelink_Capture_URL.', '#shownotification'),
    ]
    capture = read_job + [
        ('store', '${!COL1}', '!csvLine'),
        ('store', '${!COL2}', '!csvLine'),
        ('store', 'candidate', '!csvLine'),
        ('store', '${!URL}', '!csvLine'),
        ('csvSave', 'helper_results.csv', ''),
        ('echo', 'Export helper_results.csv from the CSV tab, then import it using browser_helper.py. The URL is not counted until verified.', '#shownotification'),
    ]
    return fill, capture
