# Semantic split

`runSemanticSplit` groups a PR's changes by **intention**: edits that serve one purpose belong together even across files, while unrelated purposes stay separate. A group names that intention, explains it, and lists the change units it contains (one unit per text hunk, or one metadata unit for a change without text hunks).

1. Pack the exact diff into pages within the request limits. Check that their unit IDs match the original Git change inventory.
2. If there is one page, ask the model to group its raw diff. If there are several, make a separate model call for each page to record concise notes with its unit IDs, then ask the model to group from all those notes. This resembles [map–reduce summarization of long documents](https://developers.openai.com/cookbook/examples/summarizing_long_documents): analyze each chunk, then combine the results. Here the final step produces groups, not another summary.
3. Validate that the proposal assigns every expected unit exactly once. For an invalid reply, replay the grouping conversation with the validation errors and request a complete replacement. Missing or duplicated known IDs also bring in their original pages, because notes may omit details. Allow at most three corrections after the first grouping reply.

Page notes are kept as `pages[].analysis.text`; the CLI saves them, the raw pages, and completed grouping attempts in `run.json`. A single-page run has no page notes. Input limits can stop corrections early, and valid ID coverage does not prove that the groups are semantically right or independently applicable.
