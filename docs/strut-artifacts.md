# Strut artifacts: the shapes

What a strut job sends in `run.end`'s `artifacts` list, what Hive maps it to (`mapStrutArtifacts`, `src/services/strut-runs/job-turn.ts`), and where it shows. Every entry is `{ id, kind, title, label?, summary?, url?, content?, error? }`. In mock mode, `src/app/api/mock/graph/strut-artifacts.ts` puts one of each on the mock initiatives' cards.

**Where things show:**
- **On the canvas:** a job's artifacts appear in the strip under the card the job is on (initiative, milestone or feature). A feature's pull requests are the exception: they appear in its Build panel and set its work state.
- **In chat:** under the job's message. Its kind decides whether it is a row, a thumbnail, a preview or the folded line.
- **Opening one:** both places open it on the artifact panel.

**Files:** a `url` of the form `/jobs/<job>/files/<path>` (or `/artifacts/<run>/<path>`) is a file on the swarm. The browser reads it through `GET /api/orgs/<org>/strut/artifacts?swarmId=…&key=…`.

## Strut sends the file as a `/jobs/<job>/files/…` link

| kind | Strut sends | Hive ref | How it shows |
|---|---|---|---|
| `image` | `{"id":"shot-step-2","kind":"image","title":"Repo step after sign-in","label":"Screenshot","url":"/jobs/<job>/files/onboarding-step-2.png"}` | `image`, `graph` source (swarm + key) | Thumbnail; opens full size |
| `walkthrough` | `{"id":"walkthrough-signup","kind":"walkthrough","title":"Sign-up, end to end","url":"/jobs/<job>/files/walkthrough.json"}`, with the manifest `{"title","status","frames":[{"file":"onboarding-step-1.png","caption","pageUrl"}]}` | `walkthrough`, `graph` source; frames are siblings of the manifest | Thumbnail; a player that can be scrubbed |
| `video` | `{"kind":"video","title":"…","url":"/jobs/<job>/files/run.webm"}` | `video`, `graph` source | Thumbnail; player |
| `html` | `{"id":"repo-picker-page","kind":"html","title":"Repo picker, as built","url":"/jobs/<job>/files/repo-picker.html"}` | `html`, `graph` source | Row; rendered in a sandboxed frame, scripts on |
| `pdf` | `{"id":"security-review","kind":"pdf","title":"Security review…","url":"/jobs/<job>/files/security-review.pdf"}` | `pdf`, `graph` source | Folded line; viewer |
| `diff`, `pull_request` | `{"kind":"diff","url":"/jobs/<job>/files/change.patch"}` | `code`, `graph` source | Folded line; code view |

## Strut sends the content inline

| kind | Strut sends | Hive ref | How it shows |
|---|---|---|---|
| `pull_request` | `{"id":"pr-hive-5622","kind":"pull_request","title":"List installation repos, newest first","content":{"url":"https://github.com/stakwork/hive/pull/5622","repo":"stakwork/hive","number":5622,"state":"open","headBranch":"repo-list","baseBranch":"master","checks":[{"name":"build","status":"success"},{"name":"unit-tests","status":"pending"}]}}` | `pull_request`, inline. `state` is `open`, `draft`, `merged` or `closed`; check `status` is `success`, `failure`, `pending` or `skipped` | Row with state and CI; the feature's Build panel and work state |
| `pull_request` (url only) | `{"kind":"pull_request","title":"…","url":"https://github.com/o/r/pull/12"}` | `pull_request`, inline `{url, repo, number, state:"open"}` | Row |
| `markdown` | `{"id":"onboarding-stories","kind":"markdown","title":"User stories","content":"- As a new PM, …"}` | `markdown`, inline `{text}` | First lines; rendered markdown (mermaid fences draw) |
| `log` | `{"id":"stories-log","kind":"log","title":"Job log","content":"12:01:04 reading the brief\n…"}` | `log`, inline `{text}` | Folded line; log view |
| `json` | `{"id":"gh-scopes","kind":"json","title":"Scopes the app asks for","content":"{\"metadata\":\"read\"}"}` (JSON text, or any non-object value) | `json`, inline `{value}` | Folded line; tree view |
| `code` | `{"id":"repo-picker-code","kind":"code","title":"RepoPicker.tsx","content":{"filename":"RepoPicker.tsx","language":"tsx","code":"export function …"}}` (or a string) | `code`, inline | Folded line; highlighted code |
| `diff` | `{"id":"repo-picker-diff","kind":"diff","title":"Sort repos newest first","content":"--- a/src/repos.ts\n+++ b/src/repos.ts\n@@ …"}` | `code`, inline `{code, language:"diff"}` | Folded line; diff-highlighted code |
| `url` | `{"id":"signup-preview","kind":"url","title":"Preview deploy","url":"https://hive-git-signup-stakwork.vercel.app"}` | `url`, inline `{url}` | Row; opens in a new tab |
| `html` (inline) | `{"kind":"html","content":"<!doctype html>…"}` | `code`, inline: markup is shown, never run | Folded line; code view |

## Not an artifact entry

| What | Where it lives | How it shows |
|---|---|---|
| Architecture diagram | Mermaid text in the feature's `Architecture.diagram` in the graph (Jarvis 135) | Drawn in the feature's Architecture panel |
| Dropped entry | `{"id":"mute-shot","kind":"image","title":"Settings page","error":"screenshot failed: page did not load"}` | Not a ref: the job's message names it and the reason |

Other reasons an entry is dropped: a `url` that is neither a strut file link nor absolute (`bad url`), `content` the kind can't show (`unsupported content`), or neither `url` nor `content` (`nothing to show`).
