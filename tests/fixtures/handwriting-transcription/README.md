# Handwriting fixture

One pair of files, used by unit tests that need a **real** captured writing file:

| File | Purpose |
|---|---|
| `short - single paragraph.svg` | Real 笔墨/Ink writing file (contains `<metadata>` and stroke markup) |
| `short - single paragraph.expected.txt` | The markdown the author actually wrote by hand |

Tests that use it:

- `tests/logic/utils/writing-svg-to-png-base64.test.ts` — rasterises it and asserts the PNG signature
- `tests/logic/utils/strip-writing-svg-to-visual-only.test.ts` — asserts metadata is stripped while stroke markup survives

Both care about **structure**, not transcription accuracy, so one capture is sufficient.

Manifest: `fixtures.ts` (`HANDWRITING_TRANSCRIPTION_FIXTURE_IDS`).

> Larger multi-paragraph and long captures were removed: they existed only for a
> live transcription eval that is no longer part of this project.
