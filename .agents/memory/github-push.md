---
name: Pushing to GitHub
description: How to publish this project to the user's GitHub repo when git has no authenticated remote.
---
The workspace git has no GitHub remote with credentials. Push via the GitHub connector (`github-source-control`) and the Git Data API: build trees with inline `content` (about 50 files per request, chained with base_tree on the remote head), create one commit with the remote head as parent, then fast-forward `refs/heads/main` (force false).
**Why:** git push cannot authenticate here, and one blob request per file wastes the content-creation rate limit.
**How to apply:** when the user asks to publish or push to https://github.com/bucala/Cut-Render. The remote also has LICENSE and README.md, which are not in the workspace. Using base_tree keeps them, but files deleted locally stay on the remote and must be removed explicitly (tree entry with sha null).
