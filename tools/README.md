# Supervised maintenance helpers

Run these scripts from the project root, with the approved campaign workbook and website pool available. They select the current supervised browser connection `chrome#1`. Check that it is the intended regular-Chrome profile before use. They currently use the private Cheer Athletics workbook path; they are not general new-client launchers.

- `continue_website.py HOST`: inspect a pool website and its account flow, with operator prompts. Does not publish listings.
- `continue_blog_account.py HOST`: continue inspected account registration after an explicit login rejection; preserves account checkpoints.
- `inspect_classic_blog.py HOST`: validate a signed-in classic blog editor without publishing.
- `publish_classic_blog.py HOST`: publish approved content once through a validated classic editor; saves checkpoints and independently verifies the public URL.
- `verify_public_candidate.py HOST URL`: independently verify a saved public candidate without posting.
- `publish_selected.py HOST ...`: run registered workflows for the selected pool hostnames, preserving campaign state.

Publishing helpers require an authorized active publishing run. Do not use live submissions as tests, clear protected checkpoints, or re-run an uncertain final action to recover a receipt. Private diagnostics and account files stay under `.local/`.
