# GitHub Actions A–Z — a complete course, taught from a real pipeline

This is the teaching guide for the **github_actions** CI/CD lab: a real
application (four microservices), a real CI pipeline running on GitHub's cloud
runners, and a real CD pipeline deploying to a Kubernetes (kind) cluster on a
Mac through a self-hosted runner. Everything you will read about GitHub Actions
here is *demonstrated by files in this repository* — the code is the source of
truth.

The best part: the lab *serves this guide itself*. The frontend container is
a nginx that ships this file (`GUIDE.md`) plus a tiny vendored markdown
renderer — so once the pipeline has run, the guide you are reading is the
homepage of the deployed application, and its API examples hit live services.

The teaching style follows the *express_developers_guide* philosophy:

1. **Concept** — each topic explained in plain words, from zero.
2. **In the GitHub UI:** — exactly where to see or configure the thing, click
   by click, because half of GitHub Actions lives in the web UI, not in YAML.
3. **Code** — a snippet quoted *from this repo* (or, for topics this project
   deliberately does not use, a clearly-marked concept example).

How to read the snippets:

- A comment line `<!-- source: path -->` above a code block means: *these lines
  are copied verbatim from that file in this repository* (sometimes shortened
  with a `…` line). Open the file side-by-side; it is the source of truth.
- A comment line `<!-- concept -->` means: *illustrative example only — this
  project does not use this feature* (usually because a simpler design chose
  otherwise). The guide never blurs the two.

The guide has two parts:

- **Part I — Fundamentals A–Z**: every GitHub Actions concept, ordered
  pedagogically, each grounded in this repo (or honestly marked as
  concept-only).
- **Part II — The Project**: this repository's architecture, every workflow
  explained section by section, the Kubernetes side, the runner, and how a
  commit travels from `git push` to a running pod.

---

## How to run this project

The whole lab runs on one Mac. After a reboot (or on a fresh clone), one
command rebuilds the world:

<!-- concept -->
```console
$ task up
```

Its own description says it best:

<!-- source: Taskfile.yml -->
```yaml
  up:
    desc: Full bootstrap — the "resume after reboot (or 2 years later)" one-shot. Docker check, kind cluster (start stopped nodes, or create+ingress), runner check, overlays only if namespaces missing, then smoke.
```

In order: it checks Docker Desktop is up (and tells you to start it if not),
starts the stopped kind node containers (or creates the cluster + ingress
from scratch if the cluster is gone), *checks* the self-hosted runner — if
it is not running it prints exactly how to start it (`task runner-start`) —
re-applies any missing environment overlays, and finishes with a smoke test
of all three environments. Run it after every reboot and you are back in
business. Run `task runner-start` too if `task up` reported the runner down.

For browser access, run once (adds the three hostnames to `/etc/hosts`):

<!-- concept -->
```console
$ task hosts
```

(curl-based smoke tests do not need this — they use `--resolve`.)

Then the lab is reachable at:

| Environment | URL |
|---|---|
| development | http://development.github-actions.test:8080 |
| staging | http://staging.github-actions.test:8080 |
| production | http://production.github-actions.test:8080 |

Each URL serves this guide (rendered client-side by the frontend container)
and proxies the three live APIs:

- `GET /api/facts?topic=<anything>` — Wikipedia facts for a topic, word-counted
  by the counter service.
- `POST /api/count` with `{"text": "..."}` — word / character / unique-word
  counts.
- `GET /api/image?topic=<anything>` — a Wikimedia Commons image for a topic.

The `/demo.html` page ("Try the app →" in the top bar) drives all three as
the *app*, not as a debug tool: one topic → one combined card (image +
description + counts). Your browser only makes two requests (facts, image,
in parallel) — the counts arrive ready inside the facts response because the
facts service called counter for you.

The other tasks you will see in this guide (`task cluster-create`,
`task ingress`, `task build`, `task deploy`, `task smoke`, `task pull-secret`,
`task guide-check`, …) are the building blocks `task up` orchestrates — they
are documented in [Part II](#part-ii--the-project) with their real
definitions.

---

# Part I — Fundamentals A–Z

## 1. A short history of CI/CD — and why GitHub Actions won

*Concept only — not used in this project (but knowing where a tool came from
tells you why its abstractions look the way they do).*

Continuous Integration means: every push is built and tested automatically, so
integration bugs surface in hours instead of weeks. The lineage of CI servers:

- **Make / cron scripts (1980s–2000s)** — the original "CI": a cron job on a
  server that checked out the repo and ran `make test`. Everything since has
  been about making that safer, faster, and better reported.
- **CruiseControl (2001), Jenkins (2011, fork of Hudson)** — the dominant
  self-hosted CI server. Infinitely flexible, but *you* maintain the server,
  the plugins (1,800+), the plugin security updates, and the auth.
- **Travis CI (2011)** — CI as a service: a `.travis.yml` in your repo, zero
  infrastructure. It proved the "config lives in the repo" model; pricing
  changes in 2019 pushed the community to look elsewhere.
- **CircleCI (2013–), GitLab CI (2015 in GitLab 8)** — YAML pipelines with a
  DAG model. GitLab CI in particular popularized *pipelines as first-class
  graph objects* (stages, `needs`, artifacts passed between jobs).
- **GitHub Actions (2018, GA November 2019)** — GitHub's answer: workflows
  live next to the code, and anyone can publish reusable steps to a
  **marketplace**. Its differentiators: event sources beyond CI (issues,
  releases, stars, schedules), actions as composable building blocks, and
  (later) free minutes for public repos plus built-in package/artifact
  storage.

**GitHub Actions vs the field, in one paragraph each:**

- vs **Jenkins**: no server to babysit and no plugin ecosystem to audit — but
  your builds run on someone else's infrastructure (or, self-hosted, on yours
  — this project does both; see §10).
- vs **GitLab CI**: GitLab's pipeline model is arguably more uniform (one
  `.gitlab-ci.yml`, stages as first-class), while GitHub Actions is more
  *composable* (any step can be an independently-versioned action from the
  marketplace) and more *event-driven* (a workflow can react to anything in
  the repo's event stream). GitLab CI is only for repos hosted on GitLab;
  Actions is only for GitHub — your forge usually picks for you.
- vs **CircleCI**: CircleCI is CI/CD-only and very fast; Actions is welded
  into the GitHub ecosystem — checks on PRs, the Actions tab, environments,
  packages (GHCR), branch protection, all in one place. That integration is
  why "the most industry-standard way" on GitHub means Actions.

This project uses GitHub Actions for exactly that reason: the repository, the
CI, the registry (GHCR), the environments, and the approvals are all one
system — visible in one web UI, authenticated by one identity.

**In the GitHub UI:** Actions is the tab with the play/pause icon between
"Pull requests" and "Projects" on your repo's main navigation. Every workflow
run in this guide's snippets has a page there.

## 2. The five words: event → workflow → job → step → runner

Everything in GitHub Actions hangs off five nouns:

- **event** — something that happened in or to the repository: a push, an
  opened pull request, a published release, a schedule firing, a manual
  button-press, or *another workflow finishing*.
- **workflow** — one YAML file in `.github/workflows/`, describing what to do
  in response to events. A repo can have many (this repo has four: CI plus
  three deploys).
- **job** — a group of steps that all run on the **same runner**, in parallel
  with other jobs by default. Jobs are the unit of the dependency graph
  (`needs`), of the runner choice, of permissions, of environments, and of the
  concurrency group.
- **step** — one item inside a job: either a shell script you wrote (`run:`)
  or a pre-packaged unit someone else wrote (`uses:`). Steps in a job run in
  order and share the runner's filesystem and environment.
- **runner** — the machine (or container) a job executes on. Either
  GitHub-hosted (ephemeral VM GitHub gives you, e.g. `ubuntu-latest`) or
  self-hosted (a machine *you* register, which polls GitHub over an
  outbound HTTPS connection).

This project demonstrates all five words in eight lines:

<!-- source: .github/workflows/ci.yaml -->
```yaml
name: CI

on:
  workflow_dispatch:
    inputs:
      skip-build:
        description: 'Run tests/render only, skip image build+push'
        required: false
        type: boolean
        default: false
```

The `name:` is what the Actions tab shows; `on:` declares which **events**
start this **workflow**; and further down (§9) each **job** picks its
**runner** while its **steps** test, build, and push.

**In the GitHub UI:** open the repo → **Actions** tab → left sidebar lists
workflows by `name:` ("CI", "Deploy development", …). Click any run → the left
column lists its **jobs**; click a job → the log lists its **steps** with
timing. The grey "Set up job" / "Complete job" entries are runner lifecycle,
not your steps.

## 3. Reading a workflow file: the anatomy

A workflow file has four zones, top to bottom:

1. `name:` — display name (optional; the file name is used otherwise).
2. `on:` — triggers: event types plus their filters.
3. Workflow-wide keys — `concurrency:`, `permissions:`, `env:`, `defaults:`.
4. `jobs:` — one or more jobs, each with its runner, steps, and conditions.

Here is zone 3 of this repo's CI workflow — workflow-level keys that apply to
every job in the file:

<!-- source: .github/workflows/ci.yaml -->
```yaml
# Latest run per ref wins; obsolete pushes/PR updates are cancelled.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

# Least privilege by default; build-push widens only packages: write.
permissions:
  contents: read
```

(Both keys get their own sections: §19 and §20.)

YAML details that bite newcomers: the `on:` key is parsed by YAML 1.1 as
boolean `True` — quote it as `"on":` only if your linter complains; indentation
is two spaces per level; a `|` block (literal) preserves newlines for
multi-line scripts, `>` (folded) joins lines.

**In the GitHub UI:** the workflow file path (`.github/workflows/ci.yaml`) is
shown under each workflow's name in the Actions tab's left sidebar ("Workflow
file" link when you click the "…" menu) — click through to view/edit it.

## 4. Events: what starts a workflow

About thirty event types can start a workflow. The four this repo uses across
its workflows:

- `push` — commits pushed to a branch (or tag).
- `pull_request` — activity on a PR (opened, synchronize, reopened…).
- `workflow_dispatch` — a human pressed "Run workflow" (§6).
- `workflow_run` — *another workflow* completed (used here to chain CD after
  CI; §Part II).

Others you will commonly meet: `schedule` (cron, §7), `release`, `issues`,
`issue_comment`, `create`/`delete` (branches/tags), `fork`, `star`, `check_run`.

The full `on:` block of the CI workflow shows three events at once:

<!-- source: .github/workflows/ci.yaml -->
```yaml
on:
  workflow_dispatch:
    inputs:
      skip-build:
        description: 'Run tests/render only, skip image build+push'
        required: false
        type: boolean
        default: false
  pull_request:
    branches: [development, staging, production]
    paths:
      - 'app/**'
      - '.docker/**'
      - '.k8s/**'
      - 'GUIDE.md'
      - 'scripts/**'
      - '.github/workflows/ci.yaml'
  push:
    branches: [development]
    paths:
      - 'app/**'
      - '.docker/**'
      - '.k8s/**'
      - 'GUIDE.md'
      - 'scripts/**'
      - '.github/workflows/ci.yaml'
```

Read it as: CI runs on a manual dispatch with a `skip-build` toggle; on PRs
targeting any of the three long-lived branches; and on pushes to
`development`. The path list includes `GUIDE.md` and `scripts/**` because a
dedicated CI job validates this guide's snippets (Part II).

**In the GitHub UI:** each run's page shows the triggering event ("This
workflow was triggered by push to development" etc.) next to the commit SHA at
the top; on a PR's Conversation tab, the Checks section shows every workflow
run the `pull_request` event spawned.

## 5. Event filters: branches and paths

An event type alone is rarely what you want — you want *which* pushes, *which*
PRs. Filters narrow it:

- `branches:` / `tags:` — ref name patterns (`refs/heads/` and `refs/tags/`
  respectively). Glob patterns (`release/**`) allowed; `!` negations are
  allowed but tricky (a ref must match at least one positive pattern).
- `paths:` / `paths-ignore:` — run only if the diff touches these paths.
  `paths-ignore` is the inverse and simpler when the ignore-list is short.
- For `pull_request`, `types:` narrows the *activity* (`opened`, `synchronize`
  for new pushes, `reopened`, `closed`, …).

The CI workflow filters pushes to one branch AND to six path prefixes:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  push:
    branches: [development]
    paths:
      - 'app/**'
      - '.docker/**'
      - '.k8s/**'
      - 'GUIDE.md'
      - 'scripts/**'
      - '.github/workflows/ci.yaml'
```

Meaning: a README-only push to `development` does not start CI. The deploy
workflows use branch filters alone:

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
on:
  push:
    branches: [staging]
  workflow_dispatch:
    inputs:
      image_tag:
        description: 'Deploy this tag instead of the merge commit (e.g. sha-abcd123 or abcd123)'
        required: false
        type: string
        default: ''
```

One quirk worth memorizing (it bit this project): on a
repository's *very first push*, path-filtered workflows may not trigger at all,
because GitHub has no diff base to compare against. The next matching push
behaves normally.

**In the GitHub UI:** there is no direct "why did/didn't this run" page — you
infer it from the run page's event + ref line. For `paths:` debugging, the
commit's "Files changed" view is your ground truth.

## 6. workflow_dispatch: the manual Run button and typed inputs

`workflow_dispatch` makes a workflow runnable by hand, with a form. Inputs
have types (`string`, `boolean`, `choice`, `environment`, `number`) that render
as text fields, checkboxes, and dropdowns in the UI.

CI defines one boolean input used as an escape hatch:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  workflow_dispatch:
    inputs:
      skip-build:
        description: 'Run tests/render only, skip image build+push'
        required: false
        type: boolean
        default: false
```

A job then reads it through the `inputs` context (§16) to skip the expensive
build:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    if: github.event_name == 'push' && github.ref == 'refs/heads/development' && inputs.skip-build != true
```

The deploy-staging/production workflows take a string input to override the
deployed image tag — a manual rollback/redeploy lever:

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
  workflow_dispatch:
    inputs:
      image_tag:
        description: 'Deploy this tag instead of the merge commit (e.g. sha-abcd123 or abcd123)'
        required: false
        type: string
        default: ''
```

And deploy-development carries a bare `workflow_dispatch` (no inputs) purely
as a debug re-run button:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [development]
  workflow_dispatch:
```

**In the GitHub UI:** Actions tab → choose the workflow in the left sidebar →
if it has a `workflow_dispatch` trigger, a **"Run workflow"** dropdown appears
top-right: pick the branch/ref, fill the input form (our `skip-build`
checkbox), and press Run. The run's page then shows the input values in the
"Review required" / summary sidebar.

## 7. schedule: cron workflows

*Concept only — not used in this project.* Nightly dependency scans, weekly
report jobs, periodic refresh jobs use `schedule` with POSIX cron syntax
(5 fields: minute hour day-of-month month day-of-week) in UTC:

<!-- concept -->
```yaml
on:
  schedule:
    - cron: '17 3 * * 1'  # 03:17 UTC every Monday
```

Gotchas: times are UTC (a "9am job" must subtract your timezone); GitHub
queues scheduled workflows during busy windows with up to ~30 min jitter and
drops schedules on repos inactive for 60 days; and a workflow file's cron
takes effect only once the file is on the default branch.

**In the GitHub UI:** scheduled runs appear in the Actions tab with an event
label "Scheduled by GitHub"; the "…" menu next to a workflow → "View workflow
file" is where you confirm the cron. Disable a schedule via the UI's disable-
workflow toggle, not by guessing timezone math.

## 8. The job graph: needs and the DAG

By default, all jobs in a workflow run **in parallel**. `needs:` names the
jobs that must succeed first, turning the workflow into a directed acyclic
graph (DAG). If a `needs` job fails, dependent jobs are *skipped* (not
failed).

CI's build job waits on two jobs — the three-way language test matrix and the
kustomize render matrix (both are fan-outs: one job name, several parallel
instances; §18):

<!-- source: .github/workflows/ci.yaml -->
```yaml
  build-push:
    name: build+push (${{ matrix.service }})
    needs: [test-matrix, render]
```

Which produces this graph in every CI run (a standalone `guide` job —
Part II — runs alongside, validating this guide's snippets):

<!-- concept -->
```text
test-matrix (facts)  ─┐
test-matrix (counter)─┼─► build-push (facts)     ─┐
test-matrix (image)  ─┘   build-push (counter)   ─┤
                         build-push (image)      ─┼─► (workflow completes)
render (development) ─┐   build-push (frontend)  ─┘
render (staging)     ─┼──►   guide (snippets)
render (production)  ─┘
```

`needs` also unlocks reading upstream results (§15) and makes failure
propagate: a red test-matrix instance skips all four build-push instances.

**In the GitHub UI:** every run page renders this DAG live — the graph view
with colored nodes (green/yellow/red/grey) beside the job list. Watch it
animate during a real CI run: test-matrix and render nodes fill first, then
the build-push column lights up.

## 9. Runners: GitHub-hosted

A runner is where a job actually executes. GitHub-hosted runners are ephemeral
virtual machines GitHub provisions per job, thrown away afterward — the
default and the right choice for anything that runs untrusted or
general-purpose code.

Specify one with `runs-on:`:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  test-matrix:
    name: test (${{ matrix.service }})
    runs-on: ubuntu-latest
```

Properties that matter: they are **isolated** (fresh VM per job — you must
check out your own code, §24), **pre-tooled** (Docker, node, python, go, and
more preinstalled — `setup-*` actions in §30 still pin exact versions), **on a
public IP** (fine for outbound calls like `docker push` to GHCR), and
**metered** (free quotas on private repos, generous on public ones; this repo
is private, so every CI minute counts — one reason tests are matrixed rather
than duplicated per-job).

**In the GitHub UI:** in a job's log, the very first lines ("Runner name",
"Runner image", installed software manifest) identify the GitHub-hosted VM;
"Runner group" / "Runner labels" in the job sidebar show the label set that
matched your `runs-on`.

## 10. Runners: self-hosted (and fork-PR hardening)

A self-hosted runner is a machine *you* register with GitHub (or your org).
It polls GitHub over an **outbound** HTTPS connection — no inbound ports need
openening — picks up jobs whose `runs-on` labels it matches, executes them,
and streams logs back. It persists between jobs (unlike GitHub-hosted), can
reach your LAN/localhost, and costs no Actions minutes.

That persistence and reach are exactly why this project needs one: deploys
must run `kubectl` against the kind cluster, which only exists on the Mac
itself. The deploy jobs therefore target the Mac:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    runs-on: [self-hosted, deploy-local]
```

Two labels: the built-in `self-hosted` plus the custom `deploy-local` (the
runner's own label, allowlisted for the actionlint linter in
`.github/actionlint.yaml` — see Part II).

**Security — read this before ever adding a self-hosted runner.** A job is
arbitrary code execution on the machine. The safe rules this project follows:

- **Private repo only.** On a public repo, anyone can open a PR; whether fork
  PRs may run on your self-hosted runners is a single settings toggle away
  from disaster. This repo is private, so only collaborators trigger runs.
- **Untrusted code never reaches the runner.** Pull-request CI (the untrusted
  path — proposed code from contributors) runs on GitHub-hosted
  `ubuntu-latest` only. The self-hosted runner executes only deploy workflows
  triggered by `push`/`workflow_run`/`workflow_dispatch` on protected
  long-lived branches — code that a maintainer already merged.
- **Least-privilege token on the runner** (§20) and **no secrets on the
  runner machine** — the pull token arrives per-job via env and is rotated
  into the cluster on every deploy (Part II).

**In the GitHub UI:** repo → **Settings → Actions → Runners** (org-level:
Settings → Actions → Runner groups): lists runners with status
(Idle/Active/Offline), labels, and last-seen time. When the Mac reboots and
the runner process is not restarted, it shows **Offline** here — that is your
first stop when deploys queue forever (see Part II, resume-after-reboot).
Registration (Settings → Actions → Runners → "New self-hosted runner") is
what produced the runner directory in Part II.

## 11. jobs.container: every step in a container

*Concept only — not used in this project.* A job can declare that all its
steps run *inside* a container on the runner — the "works on my machine"
guarantee without a Dockerfile per step:

<!-- concept -->
```yaml
jobs:
  lint-in-env:
    runs-on: ubuntu-latest
    container:
      image: node:20-alpine
      env:
        NODE_ENV: test
    steps:
      - run: node --version   # runs INSIDE the container
```

Use it to pin an exact toolchain OS-wide for a job (e.g. shellcheck, terraform
validate). Differences from `docker run` in a step: the job's `env` and
workspace are mapped in for you, and steps still see `$GITHUB_*` variables.
Note `container:` is a *job* key — a per-step container equivalent is an
action published as a Docker/container action (§27).

This project pins toolchains with `setup-*` actions (§30) and ships
application images instead, so it has no jobs.container use.

**In the GitHub UI:** a containerized job's log opens with "Container
information" (image digest) before "Set up job".

## 12. Steps: run vs uses, shell, working-directory

A step is either your script or someone else's action:

- `run:` — a shell command/script (default `bash -e`; `shell:` overrides).
- `uses:` — run an action (from the marketplace, or local like ours: §25).

Two step-level keys this repo leans on: `working-directory` (run in a sub-dir
of the checkout) and `shell` (force a specific interpreter):

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Install counter dependencies
        if: matrix.service == 'counter'
        working-directory: app/counter
        run: npm ci
      - name: Run counter tests
        if: matrix.service == 'counter'
        # GLOB form is mandatory: a bare directory argument hangs Node 22.
        run: node --test "app/counter/*.test.js"
```

Note how the second step *doesn't* use working-directory — the glob is
resolved by the shell from the repo root, and `node --test` then runs every
matching file. (The comment encodes a real bug: Node 22 hangs if you pass it
the bare directory here.)

And the deploy workflows pin the interpreter explicitly because their scripts
run on macOS's ancient bash (see §13):

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
      - name: Resolve image coordinates
        id: img
        shell: bash
        env:
          INPUT_TAG: ${{ inputs.image_tag }}
```

`name:` is display-only but shows up in the UI log outline and in annotations,
so this repo names every step.

**In the GitHub UI:** in a job's log, each step is a collapsible header with
duration; failed steps show inline error annotations, and the job page's
"Annotations" panel collects them.

## 13. Environment variables and their scoping

Environment variables in a workflow exist at four scopes, inner shadowing
outer:

1. **Workflow** (`env:` at top level) — all jobs.
2. **Job** (`env:` under the job) — all steps of that job.
3. **Step** (`env:` under the step) — that step only.
4. **The runner's default environment** — the documented `GITHUB_*` variables
   (`GITHUB_SHA`, `GITHUB_REPOSITORY_OWNER`, `GITHUB_REF`, …) plus `PATH`
   etc., always present.

The deploy workflows pass workflow-context values into scripts at *step*
scope, keeping the script re-readable and testable:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
        env:
          HEAD_SHA: ${{ github.event.workflow_run.head_sha || github.sha }}
        run: |
          set -euo pipefail
          owner="$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')"
          echo "prefix=ghcr.io/$owner" >> "$GITHUB_OUTPUT"
          # …
          if [ "$GITHUB_EVENT_NAME" = "workflow_dispatch" ]; then
            echo "tag=development" >> "$GITHUB_OUTPUT"
          else
            echo "tag=sha-${HEAD_SHA:0:7}" >> "$GITHUB_OUTPUT"
          fi
```

`HEAD_SHA` is step-scope; `GITHUB_REPOSITORY_OWNER` is the runner's built-in.
Note the style rule this repo adopted: **workflow shell must
be POSIX-safe** — `tr` instead of bash-4's `${VAR,,}`, because the
self-hosted runner's `/bin/bash` is 3.2. Expressions like `${HEAD_SHA:0:7}`
(substring, not lowercase expansion) are fine in bash 3.2.

**In the GitHub UI:** step-level `env` values are visible (masked if secret-
derived) in the job log's "Run &lt;script&gt;" preamble: GitHub prints the exact
`env:` block the step received.

## 14. GITHUB_ENV and GITHUB_OUTPUT: passing values between steps

Steps are separate processes — a variable `export`ed in one is invisible to
the next. GitHub provides two magic files as the bridge:

- **`$GITHUB_OUTPUT`** — append `key=value` lines; later steps read them as
  `${{ steps.<id>.outputs.key }}`. This is how CI computes the image name and
  short sha once and reuses them in the build step:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Derive image name and tags
        id: img
        shell: bash
        run: |
          set -euo pipefail
          owner="$(printf '%s' "$GITHUB_REPOSITORY_OWNER" | tr '[:upper:]' '[:lower:]')"
          echo "name=ghcr.io/$owner/github-actions-${{ matrix.service }}" >> "$GITHUB_OUTPUT"
          echo "short=${GITHUB_SHA:0:7}" >> "$GITHUB_OUTPUT"
```

…consumed three steps later:

<!-- source: .github/workflows/ci.yaml -->
```yaml
          tags: |
            ${{ steps.img.outputs.name }}:sha-${{ steps.img.outputs.short }}
            ${{ steps.img.outputs.name }}:development
```

The `id: img` on the producing step is the handle.

- **`$GITHUB_ENV`** — *Concept for this repo*: same append pattern, but the
  pairs become real environment variables for **every subsequent step** in
  the job:

<!-- concept -->
```yaml
      - name: Export image coordinates
        run: |
          echo "IMAGE_TAG=sha-${GITHUB_SHA:0:7}" >> "$GITHUB_ENV"
      - name: Use it
        run: docker build -t app:"$IMAGE_TAG" .   # IMAGE_TAG is now a plain env var
```

This project always chooses `GITHUB_OUTPUT` + explicit step ids over
`GITHUB_ENV`: outputs are visible in the UI (step summaries show them), are
scoped to exactly the consumers that name them, and cannot leak into scripts
that don't expect them.

**In the GitHub UI:** the run's job page shows each step's declared outputs in
the step header area; `GITHUB_ENV`-exported values are less visible (they only
appear inside later steps' logs), which is precisely the observability
argument for outputs.

## 15. Job outputs: passing values between jobs via needs

A job can declare `outputs:` that downstream jobs read through the `needs`
context — the inter-job counterpart of step outputs:

<!-- concept -->
```yaml
jobs:
  compute:
    runs-on: ubuntu-latest
    outputs:
      image_tag: ${{ steps.img.outputs.short }}
    steps:
      - id: img
        run: echo "short=sha-${GITHUB_SHA:0:7}" >> "$GITHUB_OUTPUT"
  deploy:
    needs: compute
    runs-on: ubuntu-latest
    steps:
      - run: echo "deploying ${{ needs.compute.outputs.image_tag }}"
```

Note the indirection: a job output can only *forward* a step output (or an
expression) — jobs, unlike steps, do not run a shell whose exports could be
harvested automatically.

This project doesn't need job outputs, by design: its multi-job workflow (CI)
ends at build+push, and the value that crosses the CI/CD boundary (the sha
tag) travels through the *git commit itself* — deploy-development re-derives
it from `github.event.workflow_run.head_sha`, deploy-staging/production from
the merge commit's `HEAD^2`. When the artifact of a job is a pushed image
tagged by commit sha, the commit *is* the message. (A reusable-workflow
refactor of the three deploy workflows would use job outputs or secrets-passing;
see §26.)

**In the GitHub UI:** a job's outputs render in the job page sidebar under
"Outputs" once it completes.

## 16. Contexts: the ${{ }} expression dictionary

Contexts are the named dictionaries available inside `${{ }}` expressions.
The ones you will actually use, in this project's own words:

| Context | Reads | Example from this repo |
|---|---|---|
| `github` | the event payload + repo/run identity | `${{ github.event_name }}`, `${{ github.ref }}`, `${{ github.sha }}`, `${{ github.actor }}` |
| `inputs` | workflow_dispatch inputs (`inputs.x`) / action inputs (`inputs.x` in composite) | `${{ inputs.skip-build }}` |
| `matrix` | current matrix cell | `${{ matrix.service }}`, `${{ matrix.env }}` |
| `env` | workflow/job/step env you declared | `${{ env.HEAD_SHA }}` pattern (not needed here — values passed via env: directly) |
| `secrets` | encrypted secrets | `${{ secrets.GHCR_PULL_TOKEN }}` |
| `vars` | unencrypted configuration variables | *not used here* (§21) |
| `steps` | a step's outputs/status by id | `${{ steps.img.outputs.tag }}` |
| `needs` | upstream jobs' outputs/results | `needs: [test-matrix, render]` (§8); outputs in §15 |
| `runner` | the runner machine's identity/labels | *not needed here* |
| `job` | this job's status (in `if:`/outputs) | *not needed here* |
| `vars`/`secrets` fallbacks | `${{ vars.x || 'default' }}` patterns | *not used here* |

One real expression mixing three contexts at once:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    if: github.event_name == 'push' && github.ref == 'refs/heads/development' && inputs.skip-build != true
```

`github` (event + ref), `inputs` (the dispatch form), and — in composite
actions — `inputs` doubles for the action's own `with:` block:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
      env:
        DEPLOY_ENV: ${{ inputs.env }}
        IMAGE_PREFIX: ${{ inputs.image_prefix }}
```

Rules to keep straight: `${{ }}` is substituted **before** the step runs (it
is templating, not shell — you cannot use it inside single-quoted shell
strings... actually you can, but always pass results through `env:` like
above when the value might contain quotes); in `if:` expressions the `{{ }}`
wrapper is implicit (`if: ${{ ... }}` equals `if: ...`); and secret contexts
are unavailable in certain places (composite actions can't read `secrets` at
all — §25).

**In the GitHub UI:** the workflow editor and the Actions tab's log viewer
linkify `${{ }}`-heavy lines poorly, but the run page's "Summary" shows
annotations where expressions produced empty values (a classic `if:` bug is
quoting: `if: "false"` is truthy).

## 17. if: conditionals

Every job and step accepts `if:` with an expression. Truthiness: empty
strings are false; the strings `'false'` and `'0'` are false; everything else
is true. On jobs, `if:` is evaluated after `needs` (skipped vs failed
upstream distinguishes via `needs.<job>.result`), and a special function
`success()/failure()/always()/cancelled()` (default context: `success()`)
controls whether steps run despite earlier failures.

The project's flagship conditional — build only on real development pushes,
and respect the dispatch toggle:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    # Pushes to development only — skipped (not failed) on pull requests and
    # on manual dispatch runs that set the skip-build input.
    if: github.event_name == 'push' && github.ref == 'refs/heads/development' && inputs.skip-build != true
```

Per-matrix-cell steps run only for the matching service:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Set up Python
        if: matrix.service == 'facts'
        uses: actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97 # v7.0.0
```

(Three setup steps + three run groups all carry `if: matrix.service == ...` —
a deliberate single-matrix design instead of three separate jobs; trade-offs
in §18.)

And a two-state guard that treats manual runs as first-class:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    # workflow_run 'completed' fires on EVERY conclusion; deploy only on green
    # CI. Manual dispatch runs have no workflow_run payload — always deploy.
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
```

Without the `workflow_dispatch` arm, the bare-dispatch fallback (§6) could
never pass the `workflow_run.conclusion` check — a bug class this project hit
head-on during its environment-rename refactor (the guard was written for the
trigger-only workflow, then dispatch was added).

**In the GitHub UI:** skipped jobs/steps appear greyed-out with a
circumvented-circle icon, and hovering shows the evaluated `if:` expression —
the first place to look when "my job didn't run".

## 18. Matrix strategies and fail-fast

A matrix runs one copy of the job per combination of `matrix:` values —
fan-out without copy-paste. The CI workflow uses it twice: three languages…

<!-- source: .github/workflows/ci.yaml -->
```yaml
    strategy:
      fail-fast: false
      matrix:
        service: [facts, counter, image]
```

…and three kustomize environments, and four build-push services:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    strategy:
      fail-fast: false
      matrix:
        env: [development, staging, production]
```

**`fail-fast: false`** disables GitHub's default behavior of cancelling all
in-flight siblings the moment one matrix leg fails. This repo always sets it:
if the Python leg breaks, you want the Node and Go results from the same
commit anyway — one broken service should not blind you to the state of the
other two. (Trade-off: a repo-wide failure burns more minutes.)

Matrices also support `include:` (add cells / extra keys to cells) and
`exclude:`, and multi-axis products (`os: [ubuntu, macos] × node: [20, 22]`).
Max 256 jobs per workflow run.

Note what the test matrix *doesn't* do here: there is no `os` axis (all Linux)
and the per-service steps are gated by `if: matrix.service == '...'` instead
of splitting into three jobs — a conscious single-job choice (one runner
boot, shared checkout cache... in exchange for slightly noisier logs).

**In the GitHub UI:** each matrix leg is its own entry in the run's job list,
titled by the `name:` template — `test (facts)`, `test (counter)`,
`render (staging)`, `build+push (frontend)`. On PRs, each leg is a separate
entry in the Checks panel, and with `fail-fast: false` a single red leg is
visible next to green siblings instead of cancelled greys.

## 19. Concurrency: latest-wins and serialized deploys

Two runs of the same workflow can race — two pushes in quick succession, or a
deploy overlapping the rollout it triggered. `concurrency:` assigns runs to
named groups and decides what happens when a group is busy.

CI wants **latest-wins**: a newer push to the same ref makes the older run
obsolete, so cancel it:

<!-- source: .github/workflows/ci.yaml -->
```yaml
# Latest run per ref wins; obsolete pushes/PR updates are cancelled.
concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true
```

The group name embeds `github.ref`, so development pushes and each PR form
*separate* groups — you never cancel someone else's PR check.

Deploys want the opposite — **serialized, never cancelled** (killing a
kubectl apply mid-rollout is how you get half-updated clusters):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    # Serialize development deploys; never cancel a rollout already in flight.
    concurrency:
      group: deploy-development
      cancel-in-progress: false
```

With `cancel-in-progress: false` (and no timeout override), a second run
*queues* behind the first. Combined with the environment approval gate
(§22), this is what makes production deploys safe: one at a time, approved,
never interrupted.

`concurrency:` at workflow level applies to every job; at job level to that
job. `group` is an arbitrary string — but a constant group name (like
`deploy-production`) also serializes *across* whatever else uses that exact
name.

**In the GitHub UI:** a queued run shows a "Waiting" status in the run list
with the concurrency group name; cancelled ones show "Cancelled" with
"This run was cancelled because another run in the same concurrency group
..." in its header.

## 20. GITHUB_TOKEN and least-privilege permissions

Every job gets an automatically-generated installation token, `github.token`
(a.k.a. `secrets.GITHUB_TOKEN`): pre-authenticated as the GitHub App that
runs Actions, valid for the job's duration, revoked after. It can clone the
repo, post PR comments, and — with the right `permissions` — push packages.
No PATs, no rotation, no storage: this is why CI needs zero stored
credentials.

**Least privilege** means: declare the minimum scopes the job needs. The
workflow-level floor for CI:

<!-- source: .github/workflows/ci.yaml -->
```yaml
# Least privilege by default; build-push widens only packages: write.
permissions:
  contents: read
```

…and exactly one job widens itself, because pushing images needs it:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  build-push:
    name: build+push (${{ matrix.service }})
    needs: [test-matrix, render]
```

with, further down in the same job:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    runs-on: ubuntu-latest
    permissions:
      contents: read
      packages: write
```

The token in action — GHCR login uses it as the password, no secret stored
anywhere:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Log in to GHCR
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}
```

Scope names: `contents`, `packages`, `actions`, `checks`, `deployments`,
`discussions`, `id-token` (see OIDC, §23), `issues`, `pages`, `pull-requests`,
`repository-projects`, `security-events`, `statuses` — each with `none|read|write`.

If a workflow declares nothing, the repo default applies (Settings → Actions →
General → Workflow permissions — read-only or read-write; GitHub has pushed
read-only defaults). Explicit beats inherited: declare `permissions:` even when
it just restates the floor, so a future settings change can't silently widen
your token.

One more property that matters for CD: fork PRs get a **read-only,
no-secrets** token by default — the foundation of the hardening story in §10.

**In the GitHub UI:** repo **Settings → Actions → General → "Workflow
permissions"** — the repo-wide default (leave it "Read repository contents
and packages permissions"); each run's job log prints "GITHUB_TOKEN
Permissions" in the "Set up job" section — audit there what a job actually
received.

## 21. Secrets, Variables, and masking

Two repo-level stores, one encrypted, one not:

- **Secrets** (`secrets.X`) — encrypted at rest, write-only via UI/CLI, never
  readable back. Values are **masked** in logs (`***`) and unavailable to fork
  PRs.
- **Variables** (`vars.X`) — plaintext, freely readable in `env:` blocks or
  the Configuration tab. For non-sensitive knobs: image names, feature flags,
  regions. *This project defines none yet — its only knob (environment name)
  is structural, not configurable.*

This project has exactly one secret: `GHCR_PULL_TOKEN`, a classic PAT with
`read:packages`. Why a PAT at all when `github.token` can push? Because the
*cluster* (the Mac's kubelet) needs to pull images long after the CI job —
and its token — died. The job hands the secret to the composite action via
step env (composite actions can't read the `secrets` context — §25):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
      - name: Deploy development overlay
        # Composite actions cannot read the `secrets` context — the token is
        # injected via env (stays masked in logs).
        uses: ./.github/actions/deploy-env
        env:
          GHCR_PULL_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}
        with:
          env: development # kustomize overlay / namespace (github-actions-development); matches the GitHub environment above
          image_prefix: ${{ steps.img.outputs.prefix }}
          image_tag: ${{ steps.img.outputs.tag }}
```

Masking notes: the mask covers the value anywhere it would print (even
accidentally echoed inside scripts); values of ~short length and common words
mask poorly; and masking never happens for values written to files (the
kubernetes secret the deploy creates holds the token in base64 — which is
encoding, not encryption; that's normal for k8s Secrets and fine here since
the cluster is local).

Scopes for both secrets and variables: **repository**, **environment**
(scoped to runs targeting that environment — this project's pattern for
per-env values), and **organization**. `GITHUB_TOKEN` itself lives in the
implicit `secrets` namespace alongside yours.

**In the GitHub UI:** repo → **Settings → Secrets and variables → Actions**:
two tabs ("Secrets", "Variables"), each split Repository / Environment (pick
the environment to add an env-scoped one). Secrets show name + last-updated
only, never the value. Updates take effect on the *next* run — no
re-registration needed.

## 22. Environments and protection rules

A GitHub **environment** (not to be confused with env *variables*) is a named
deployment target — `development`, `staging`, `production` — that a job
declares, gaining: deployment history in the UI, scoped secrets/variables,
and **protection rules**: required reviewers (a manual approval gate),
deployment-branch policy (which branches may deploy here), and wait timers.

This project defines all three environments and attaches one to every deploy
job:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    runs-on: [self-hosted, deploy-local]
    environment: development
```

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
    runs-on: [self-hosted, deploy-local]
    environment: production
```

The design: `development` and `staging` deploy automatically; `production`
carries a **required-reviewer** rule — when a production deploy job starts,
it pauses in "Waiting" until a designated reviewer approves (or rejects) in
the UI. No YAML change can bypass it: the gate is server-side. Combined with
§19's serialized concurrency, production changes are one-at-a-time,
human-approved, and branch-filtered (`push` to `production` only).

Environment names are free-form strings — but the convention here binds four
things under one name: the GitHub environment, the kustomize overlay
directory, the Kubernetes namespace, and the ingress hostname (all
`development`/`staging`/`production` — see Part II). That string is the
thread you can pull from a URL all the way back to a workflow file.

**In the GitHub UI:** repo → **Settings → Environments** — create/inspect
each environment, add protection rules ("Required reviewers" with a list of
users/teams, "Deployment branches and tags"), and environment-scoped secrets.
The *runtime* view is the repo homepage right sidebar → **Environments** (or
a run's summary): every deployment with workflow, commit, and status —
production's entries will show who approved what. During a gated run, the
workflow page shows an "Approve or reject" prompt on the job and reviewers
get email/PR pings.

## 23. OIDC: keyless cloud credentials

*Concept only — not used in this project (its only remote is GHCR, which the
built-in token already covers).*

The classic CI/CD secret leak is the cloud credential JSON sitting in your
CI's secret store. **OpenID Connect** replaces it: GitHub Actions runs an
identity provider; your cloud (AWS, GCP, Azure, ...) trusts it. A job
requests a short-lived signed token describing *which repo, environment, ref*
is running, exchanges it via `actions/github-script` or the cloud's official
login action for temporary cloud credentials, and there is no long-lived key
to rotate or steal.

The two moving parts:

<!-- concept -->
```yaml
permissions:
  id-token: write   # request OIDC tokens
  contents: read
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: aws-actions/configure-aws-credentials@<sha>
        with:
          role-to-assume: arn:aws:iam::123456789012:role/gha-deploy
          aws-region: eu-west-1
```

…and on the cloud side a trust policy that maps token claims (`repository:
Mayank-UK/github_actions`, `environment: production`, `ref: refs/heads/production`)
to the role — so only the right branch, in the right environment, can assume
it. This is the cloud-native successor to "put the kubeconfig in secrets".

**In the GitHub UI:** nothing to configure on the GitHub side beyond the
`id-token: write` permission — the IdP is automatic. Your audit lives in the
cloud provider's console (trust policies, assumed-role history).

## 24. Using third-party actions: marketplace vetting and SHA pinning

Actions are reusable steps anyone can publish; the **GitHub Marketplace** is
their directory. Using one means executing someone else's code with your
token and your secrets — so two rules:

1. **Vet before use.** Prefer `actions/*` (GitHub-official) and the vendor's
   own action; check the repo's stars/issues/maintenance, what permissions it
   requests, whether it logs excessively, and that the *marketplace listing
   links the source repo you inspected*. A slick listing page is not an
   audit.
2. **Pin to the full 40-character commit SHA.** Tags are mutable — `v4` can
   be force-pushed to point at malicious code, and deleted/renamed tags break
   builds. A commit SHA is immutable. Keep the human-readable version in a
   trailing comment so upgrades stay reviewable.

This repo pins **every** `uses:` this way — it's stated as policy at the top
of the CI file:

<!-- source: .github/workflows/ci.yaml -->
```yaml
# Every `uses:` is pinned to a full 40-char commit SHA with the release tag in a
# trailing comment (supply-chain hygiene; updates via Dependabot/renovate).
name: CI
```

Examples of the pattern across the workflows:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Set up QEMU (arm64 emulation)
        uses: docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
```

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
```

Even the Go/Node/Python toolchains follow it:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Set up Node
        if: matrix.service == 'counter'
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
```

The one exception to "someone else's code" is a local action —
`uses: ./.github/actions/deploy-env` — which is our *own* composite action
(§25); the leading `./` makes it repo-relative (also the safest `uses:` there
is). Updates to pinned SHAs are exactly what Dependabot automates; the
trailing `# vX.Y.Z` comments are what its PRs rewrite.

**In the GitHub UI:** the marketplace is at github.com/marketplace (filter
"Actions", verify "Verified creator" badges — but still read the source).
Each workflow run's job log prints the *resolved* commit for every `uses:`
("Resolving repository refs" / the action's header line) — after an upgrade,
confirm the SHA you intended actually ran. Repo Insights → Dependency graph →
Actions lists every referenced action for a quick audit.

## 25. Authoring your own: composite actions

Three ways to package reusable logic: composite actions, JavaScript actions,
container actions (§27), plus reusable *workflows* (§26). The **composite
action** is the simplest: a directory with an `action.yaml` whose steps are
plain `run:` scripts (each choosing its own `shell:`), plus declared `inputs:`
and `outputs:`. It runs *inline* in the calling job — same runner, same
filesystem, same env — so it can use anything on the runner (here: kubectl,
kustomize, git).

This repo ships one — `.github/actions/deploy-env` — and all three deploy
workflows call it. Its interface is deliberately **secret-free**: three plain
inputs, no `secrets` access (composite actions cannot read that context),
with the token injected by the caller via step env (§21). The header:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
name: deploy-env
description: >-
  Deploy all four services to one environment namespace: rotate the ghcr-pull
  imagePullSecret, point the overlay at the CI-built images (kustomize edit
  set image), apply the overlay, then gate on all four rollouts.
```

Inputs are typed by description + `required`:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
inputs:
  env:
    description: 'Target environment: development | staging | production (namespace github-actions-<env>, overlay .k8s/overlays/<env>)'
    required: true
  image_prefix:
    description: 'Registry path prefix of the CI-built images, e.g. ghcr.io/mayank-uk (the prefix also supplies the GHCR pull username)'
    required: true
  image_tag:
    description: 'Image tag to deploy for all four services, e.g. sha-abcd123'
    required: true
```

The composite marker and step structure:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
runs:
  using: composite
  steps:
    - name: Rotate ghcr-pull imagePullSecret
```

Inside, every step reads inputs through the `inputs` context (§16) and fails
loudly on the missing token with a POSIX `:?` guard:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
      shell: bash
      env:
        DEPLOY_ENV: ${{ inputs.env }}
        IMAGE_PREFIX: ${{ inputs.image_prefix }}
      run: |
        set -euo pipefail
        : "${GHCR_PULL_TOKEN:?GHCR_PULL_TOKEN is not set — the caller must pass it via env from secrets.GHCR_PULL_TOKEN}"
        owner="${IMAGE_PREFIX##*/}"
        kubectl create secret docker-registry ghcr-pull \
          --docker-server=ghcr.io \
          --docker-username="$owner" \
          --docker-password="$GHCR_PULL_TOKEN" \
          -n "github-actions-$DEPLOY_ENV" \
          --dry-run=client -o yaml | kubectl apply -f -
```

Why the env-injection dance instead of just using `secrets.`? (a) composite
actions genuinely cannot — the context is unavailable to them; (b) it keeps
the action usable from *any* caller (each supplies its own token); (c) env-
passed secrets stay masked in logs, and the `:?` guard turns a forgotten
injection into an instant, self-documenting failure instead of an empty
docker-username deployed to the cluster.

A composite action's steps get their own log sections in the caller's job —
indistinguishable from native steps.

**In the GitHub UI:** nothing special — a local action's steps render inside
the calling job's log. Authoring docs: the `action.yaml` schema is validated
at run time; failures show as "The workflow is not valid" on the run page and
in the Actions tab's error banner before any runner boots.

## 26. Authoring your own: reusable workflows

*Concept with respect to shipping one — this repo deliberately runs three
sibling deploy workflows instead; the design discussion below is the honest
trade-off, in the style of this guide.*

A **reusable workflow** is a workflow that other workflows `call:`. It can
take `inputs:` and `secrets:`, contain its own jobs graph, and get called
many times with different arguments — the right tool when whole *pipelines*
repeat, not just steps:

<!-- concept -->
```yaml
# .github/workflows/deploy-reusable.yaml
on:
  workflow_call:
    inputs:
      env_name:
        required: true
        type: string
    secrets:
      ghcr_pull_token:
        required: true

jobs:
  deploy:
    runs-on: [self-hosted, deploy-local]
    environment: ${{ inputs.env_name }}
    concurrency:
      group: deploy-${{ inputs.env_name }}
      cancel-in-progress: false
    steps:
      # ... one copy of the deploy logic ...
```

<!-- concept -->
```yaml
# .github/workflows/deploy-staging.yaml — collapses to this
on:
  push:
    branches: [staging]
jobs:
  call-deploy:
    uses: ./.github/workflows/deploy-reusable.yaml
    with:
      env_name: staging
    secrets:
      ghcr_pull_token: GHCR_PULL_TOKEN
```

Unlike composite actions, reusable workflows (a) can read `secrets` when the
caller forwards them, (b) get their own `needs` graph and runner, (c) appear
as a nested job in the caller's run. Max one level of nesting (a called
workflow cannot call another).

This repo chose three explicit sibling workflows over one reusable one: each
deploy differs in *trigger semantics* (workflow_run vs push vs push+approval)
more than in *body*, triggers cannot be parameterized into a `workflow_call`,
and having each environment's full logic in its own file means each can drift
deliberately (production's approval notes, staging's warning text) without a
`if: inputs.env == ...` lattice. The shared body was instead factored into
the composite action (§25) — the same DRY, one level down. The rule of thumb
that fell out: **factor steps into composite actions first; graduate to
reusable workflows only when whole job graphs repeat.**

**In the GitHub UI:** a called workflow's jobs appear in the caller's run
with a "Reusable workflow" label linking to the called file.

## 27. Authoring your own: JavaScript and container actions

*Concept only — this project's action is composite (§25); these two are the
other authoring formats.*

- **JavaScript action** — a Node bundle (`action.yml` with
  `runs: using: 'node20'`, `main: dist/index.js`) executed by the runner's
  bundled Node. Runs *on the host* (fast, cross-platform, no Docker daemon
  needed) with full access to the Actions toolkit (`@actions/core`,
  `@actions/exec`, `@actions/github`), including first-class inputs, outputs,
  and secret masking from code:

<!-- concept -->
```yaml
# action.yml of a JS action
name: 'my-action'
description: 'Does a thing'
inputs:
  verbosity:
    default: 'info'
runs:
  using: 'node20'
  main: 'dist/index.js'
```

- **Container action** — `runs: using: 'docker'` with an adjacent Dockerfile;
  the runner builds and runs it. Perfect hermetic tooling (custom binaries,
  compiled tools) at the cost of build time and Linux-only execution:

<!-- concept -->
```yaml
runs:
  using: 'docker'
  image: 'Dockerfile'
  args:
    - --strict
```

The marketplace's most popular actions (checkout, setup-*) are JS; the
ecosystem's heavier tools ship as containers. Note container actions cannot
run on macOS/Windows runners, and composite steps cannot use `uses: docker://`
— which is another reason this repo's deploy action is plain-shell composite.

**In the GitHub UI:** indistinguishable at run time from any other action —
authoring format is a packaging detail.

## 28. Artifacts vs actions/cache vs buildx gha cache

Three different "store files between jobs" mechanisms — different lifetimes,
different purposes:

- **Artifacts** (`actions/upload-artifact` / `download-artifact`) — zipped
  files attached to a *run*, downloadable from the UI, auto-expiring (default
  90 days), shareable between jobs of the same run. For build reports,
  binaries, coverage HTML, screenshots. *This project uploads none*: its only
  cross-job product is container images, which belong in a *registry*
  (GHCR), not run artifacts — the industry-standard distinction.
- **The cache** (`actions/cache`, or the built-in `cache:` input of the
  `setup-*` actions) — content-addressed directories keyed by your choice
  (`cache-dependency-path` lockfiles typically), shared across the whole
  repo, 10 GB per-repo LRU. For *dependency* downloads. All three language
  setups here use the built-in form — one line each:

<!-- source: .github/workflows/ci.yaml -->
```yaml
        with:
          python-version: '3.12'
          cache: pip
          cache-dependency-path: app/facts/requirements.txt
```

<!-- source: .github/workflows/ci.yaml -->
```yaml
        with:
          node-version: 22
          cache: npm
          cache-dependency-path: app/counter/package-lock.json
```

…and the honest counter-example — caching is *disabled* where it cannot work
(zero module deps → no go.sum to key on):

<!-- source: .github/workflows/ci.yaml -->
```yaml
        with:
          go-version-file: app/image/go.mod
          cache: false # no go.sum (zero module deps) — setup-go caching requires one
```

- **Buildx `gha` cache** — Docker *layer* cache (not directories) exported to
  the same storage via BuildKit's `cache-from`/`cache-to`. This is what makes
  the multi-arch builds tolerable — unchanged Dockerfile layers are skipped:

<!-- source: .github/workflows/ci.yaml -->
```yaml
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Rule of thumb: artifacts = outputs of this run (per-run, short life);
cache = inputs you'd otherwise re-download (repo-wide, long life); gha cache
= image layers (per-Dockerfile). They are not interchangeable.

**In the GitHub UI:** artifacts appear at the bottom of a run's summary page
(downloadable zip); caches are repo-level — **Actions → management via
"Actions" sidebar → Caches** (view/evict by key); gha cache entries surface
in the same Caches list prefixed `buildkit`.

## 29. Workflow commands: ::group, ::error, ::warning

Workflow commands are magic `echo` strings your scripts emit that the runner
parses into UI affordances. The four that matter:

- `::group::<title>` … `::endgroup::` — a collapsible log section.
- `::error::…`, `::warning::…`, `::notice::…` — annotations: red/yellow/blue
  chips on the run summary and job page, attached to the step (or with
  `file=`/`line=` properties, to a source location).

The composite action wraps its deploy summary in a group:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
        echo "::group::Deployed to github-actions-$DEPLOY_ENV ($IMAGE_TAG)"
        for svc in facts counter image frontend; do
          echo "github-actions-$svc -> $IMAGE_PREFIX/github-actions-$svc:$IMAGE_TAG"
        done
        echo "::endgroup::"
```

The render job turns an empty kustomize output into a hard, annotated error:

<!-- source: .github/workflows/ci.yaml -->
```yaml
          out="$(kubectl kustomize .k8s/overlays/${{ matrix.env }})"
          if [ -z "$out" ]; then
            echo "::error::.k8s/overlays/${{ matrix.env }} rendered to EMPTY output"
            exit 1
          fi
```

And the staging/production workflows surface a degraded-but-continuing path
as a warning (squash/rebase merge or direct push — the resolved commit never
went through `development`, so CI may never have built it; see Part II):

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
              echo "::warning::resolved commit $sha is NOT on development — CI only builds development pushes; images may not exist"
```

(Other commands exist — `::debug::` behind the debug flag, `::add-mask::` to
mask values your script generates, `::set-output` (deprecated in favor of
`$GITHUB_OUTPUT`, §14) — but group/error/warning cover 95% of real use.)

**In the GitHub UI:** groups render as collapsible triangles in the job log;
error/warning/notice lines collect in the job page's "Annotations" panel and
on the run summary — searchable, linkable, and exactly where a reviewer
lands first. That is why "make failure states annotate" is worth it: the
`::error` above puts "rendered to EMPTY output" in front of you without
opening the log.

## 30. Pattern: language-runtime test jobs

The most common CI workflow in the world: for each language in the repo, set
up the exact runtime, install dependencies, run tests. The pattern's three
mechanical decisions: (a) a `setup-<language>` action pinning the *version*,
(b) dependency install keyed off the *lockfile*, (c) the test invocation —
each visible in this repo's matrix (§18 covers the fan-out; here is the
shape):

Python leg — version pinned by setup action, pip cache keyed to
requirements, test-only deps installed alongside (kept out of the runtime
image deliberately):

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Install facts dependencies
        if: matrix.service == 'facts'
        # pytest (runner) and httpx (fastapi.testclient backend) are test-only
        # deps and deliberately not in the runtime requirements.txt.
        run: pip install -r app/facts/requirements.txt pytest httpx
      - name: Run facts tests
        if: matrix.service == 'facts'
        run: python -m pytest app/facts
```

Node leg — `npm ci` (lockfile-exact, never `npm install` in CI) inside the
service directory:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Install counter dependencies
        if: matrix.service == 'counter'
        working-directory: app/counter
        run: npm ci
```

Go leg — version derived from the repo's own `go.mod`, no cache (§28):

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Run image tests
        if: matrix.service == 'image'
        working-directory: app/image
        run: go test ./...
```

The tests themselves are offline by design (mocked HTTP), so CI never flakes
on Wikipedia's uptime — the app tests quote in Part II show the technique.

**In the GitHub UI:** each leg is a separate check ("test (facts)" etc.) on
PRs — set all three as *required* status checks under Settings → Branches →
Branch protection rules, so a PR cannot merge with a red leg.

## 31. Pattern: multi-arch build + push (QEMU + buildx)

One codebase must run on both amd64 servers and arm64 laptops/Graviton/RPi —
so CI builds one multi-arch *manifest list* under a single tag. The standard
three-step dance: QEMU (emulates foreign architectures), Buildx (builds
multiple platforms in one invocation, exports layer cache), login (push
rights):

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Set up QEMU (arm64 emulation)
        uses: docker/setup-qemu-action@99012661954931238ded8c8b007157a8430204e1 # v4.4.0
      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@f87e5991a6d7451dcb8d9637bfbc97413f497069 # v4.4.1
      - name: Log in to GHCR
        uses: docker/login-action@dbcb813823bdd20940b903addbd779551569679f # v4.6.0
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ github.token }}
```

Then the build itself — note the per-service `context:` expression (the
frontend image bakes this guide in, so it builds from the repo root while
the API services build from their `app/` subdirectories), `platforms:`,
`push: true` (build and push are one atomic step), the two tags (immutable
`sha-` tag + moving `development` tag), and the gha cache lines from §28:

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Build and push multi-arch image
        uses: docker/build-push-action@c3c9e263c25d99ce0380d002d59b67737d91b0dc # v7.4.0
        with:
          # frontend builds from repo root (its Dockerfile COPYs GUIDE.md);
          # other services build from their app/ subdirectory.
          context: ${{ matrix.service == 'frontend' && '.' || format('app/{0}', matrix.service) }}
          file: .docker/${{ matrix.service }}/Dockerfile
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ${{ steps.img.outputs.name }}:sha-${{ steps.img.outputs.short }}
            ${{ steps.img.outputs.name }}:development
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

Why arm64 is *required* here, not a nice-to-have: the deploy target is a
kind cluster on an Apple-silicon Mac — its nodes are arm64; an amd64-only
image would crashloop on the cluster with the classic `exec format error`.
(QEMU's emulation is also a known flake source.)

The tags encode the deployment model: `sha-<7>` is immutable and is what CD
deploys; `development` is a moving pointer for humans to `docker pull`. GHCR
naming requires lowercase, hence the `tr` lowercasing in §14's snippet.

**In the GitHub UI:** pushed images land under the repo's **Packages**
(rocket icon in the repo header / your profile Packages tab): each package
shows tags, the manifest's OS/ARCH list (confirm both `linux/amd64` and
`linux/arm64` rows!), and pull commands. Package visibility for a private
repo is private by default, inherited via the token that pushed it.

## 32. Pattern: changed-files / paths-filter

*Concept only — this project uses native `paths:` filters (§5) instead.*
When jobs need to know *which files changed* (not merely whether the workflow
should run), the marketplace provides detectors (`tj-actions/changed-files`,
`dorny/paths-filter`) that output per-path boolean filters for conditional
jobs:

<!-- concept -->
```yaml
      - uses: dorny/paths-filter@<sha>
        id: changes
        with:
          filters: |
            backend:
              - 'app/**'
            docs:
              - '**/*.md'
  deploy-backend:
    needs: [detect]
    if: needs.changes.outputs.backend == 'true'
```

The advantage over workflow-level `paths:`: per-*job* granularity inside one
workflow, and filters reusable across jobs. The costs: a third-party action
in the trust base (§24) and — the reason this repo declined — GitHub's
native `paths:` already covers the workflow-level question, and the CI
author chose an honest simplification, recorded in the file:

<!-- source: .github/workflows/ci.yaml -->
```yaml
    # Union of paths needed by ALL jobs (GitHub workflows do not support YAML
    # anchors, so the list is duplicated below). test-matrix also runs on
    # .k8s-only changes — accepted for simplicity instead of per-job path gating.
    paths:
      - 'app/**'
      - '.docker/**'
      - '.k8s/**'
      - '.github/workflows/ci.yaml'
```

**In the GitHub UI:** none — this pattern is invisible except as skipped/
not-skipped jobs in the run.

## 33. Pattern: GitOps vs push-deploy

Two philosophies for "how code reaches the cluster":

- **Push-deploy (this project)** — the CI/CD pipeline *pushes* to the
  cluster: here a deploy job runs `kustomize edit set image` + `kubectl
  apply -k` on a runner that sits next to the cluster. Simple, explicit,
  everything in one place (the workflow file is the whole truth), and a
  perfect fit for a lab. The push's own words:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
        for svc in facts counter image frontend; do
          (
            cd ".k8s/overlays/$DEPLOY_ENV"
            kustomize edit set image "github-actions/$svc=$IMAGE_PREFIX/github-actions-$svc:$IMAGE_TAG"
          )
        done
```

- **GitOps (concept)** — the cluster *pulls*: a controller inside the
  cluster (Argo CD, Flux) watches a git repo (or registry) declared to be
  the desired state and reconciles the cluster toward it. Deploy = git
  commit; rollback = git revert; audit = git log; and nothing outside the
  cluster needs credentials to change it. The cost: another system running
  in-cluster, and drift-by-hand becomes a fought-over anti-pattern.

The middle ground this project occupies — kustomize overlays in git, edited
ephemerally by the pipeline — is sometimes called *GitOps-lite*: desired
state is versioned in git, but reconciliation is one-shot per deploy instead
of continuous. Part II shows exactly where the line is drawn and why (a
local lab cluster + a teaching goal beat a 24/7 controller).

**In the GitHub UI:** for push-deploy, the deploy run's log *is* the audit
trail (each apply/rollout with timestamps and the sha tag). For GitOps the
UI moves to the Argo/Flux dashboard; the Actions tab only shows the commit
that changed desired state.

## 34. Pattern: release-please and semver releases

*Concept only — this project's releases are commit-sha tags, not semver.*
When a product (not a lab) needs versioned releases, changelogs, and semver
bumps, **release-please** (Google's) automates the ceremony: it reads
Conventional Commit messages (`feat:`, `fix:`, …), maintains a Release PR
that bumps versions + generates the changelog, and tags a release when you
merge it:

<!-- concept -->
```yaml
on:
  push:
    branches: [main]
permissions:
  contents: write
  pull-requests: write
jobs:
  release-please:
    runs-on: ubuntu-latest
    steps:
      - uses: googleapis/release-please-action@<sha>
        with:
          release-type: node
```

The mental model: *humans write conventional commits; the robot assembles
releases.* Compare this repo's scheme — every push to `development` produces
an immutable `sha-<7>` image tag, and environments pin exact shas — which
trades public version numbers for perfect traceability (the deployed tag
*is* the git commit). Semver + release-please is the right tool when
consumers outside your pipeline choose what to upgrade to; sha-tagging is
right when the pipeline is the only consumer.

**In the GitHub UI:** releases live under the repo's **Releases** page
(_tags + changelog + assets_); release-please's open Release PR sits in the
PR list, growing with each conventional commit.

## 35. Pattern: housekeeping — stale bot, OTel timing export

*Named for course coverage; deliberately out of scope for this project.*

- **stale-bot** — a scheduled workflow (§7) that marks untouched issues/PRs
  stale after N days and closes them after M more, usually via the
  `actions/stale` action. Repository hygiene on autopilot.
- **OTel timing export** — exporting job timings (step durations) as
  OpenTelemetry metrics to a backend, so "CI got slower this month" is a
  dashboard query instead of a vibe. Hooks exist via marketplace actions
  that wrap the workflow/job timing context.

Neither is worth its third-party surface for a single-maintainer lab; both
become relevant the moment a team's queue times and PR staleness start
costing real money.

**In the GitHub UI:** stale-bot's activity appears as the bot's comments on
issues/PRs; OTel timing lives entirely in your observability tool.

## 36. DevEx: the Taskfile local-first loop

Workflow-driven projects drift into "git push to test" — a 5-minute round
trip for a 5-second mistake. The antidote is a *local-first loop*: the same
operations the pipeline does, runnable on the laptop in seconds, with CI as
the verification of last resort. This repo's loop is a `Taskfile.yml`
(go-task), and every task it defines mirrors a pipeline stage one-to-one:

<!-- source: Taskfile.yml -->
```yaml
  cluster-create:
    desc: Create the kind cluster (1 ingress-ready control-plane + 2 workers, host 8080 -> node 80)
    cmds:
      - kind create cluster --config .k8s/kind-cluster.yaml --name {{.CLUSTER}}
```

<!-- source: Taskfile.yml -->
```yaml
  deploy:
    desc: Apply one overlay (ENV=development|staging|production, default development) and wait for all rollouts
    cmds:
      - kubectl apply -k .k8s/overlays/{{.ENV}}
```

The local deploy even mirrors CD's rollout gate (§25's composite action):

<!-- source: Taskfile.yml -->
```yaml
      - |
        for d in facts counter image frontend; do
          kubectl rollout status deployment/$d -n github-actions-{{.ENV}} --timeout=180s
        done
```

And the smoke test is the same one the bootstrap runs:

<!-- source: Taskfile.yml -->
```yaml
            code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$env.github-actions.test:8080:127.0.0.1" "http://$env.github-actions.test:8080/")
```

Why this matters for learning Actions specifically: when a *deploy* fails,
the same kustomize overlay and the same rollout gate can be exercised locally
(`task deploy ENV=staging`) in seconds — the workflow is just a remote
executor of commands you can run by hand. Every workflow in this repo was
first run as Taskfile commands.

Two meta-tasks complete the loop: `task up` (the reboot bootstrap, see
[How to run this project](#how-to-run-this-project)) and `task guide-check`
— the exact snippet check CI's `guide` job runs, so this guide can be
verified before you push:

<!-- source: Taskfile.yml -->
```yaml
  guide-check:
    desc: Verify GUIDE.md snippets against their source files (the same check the CI guide job runs)
    cmds:
      - python3 scripts/check_snippets.py
```

**In the GitHub UI:** nothing — this is the point. The fastest debugging loop
never leaves the terminal.

## 37. DevEx: act — run workflows locally

*Concept only — not part of this project's loop (its deploys target a
local cluster; act's emulation adds little over the Taskfile, and self-hosted
labels/macOS quirks would mislead more than help).*

[`act`](https://github.com/nektos/act) runs workflows locally in Docker by
emulating the GitHub runner: it parses `on:`, spins containers for jobs,
provides the contexts (`github`, `env`, …) from a fake event payload, and
mounts secrets from a `.secrets` file:

<!-- concept -->
```console
$ act push                    # which workflows would a push start?
$ act -j test-matrix          # just this job
$ act --secret-file .secrets  # with secrets
```

Honest limits: runners are approximated (ubuntu-latest is a Docker image, not
the real VM), marketplace JS actions mostly work but runner-internal
features vary, self-hosted labels and `environment:` gates don't apply, and
anything needing real GitHub state (workflow_run, approvals) can't be
emulated. It shines for iterating on `run:` scripts and matrix logic — i.e.,
exactly the parts this repo already keeps POSIX-simple.

**In the GitHub UI:** n/a — act is a CLI (`brew install act`).

## 38. DevEx: debugging — SSH breakpoints and debug variables

*Concept only — this project debugs via local-first tasks (§36) and the
runners' logs; the interactive tools below are the ecosystem's escalation
ladder.*

- **SSH breakpoint** — `mxschmitt/action-ssh` / `appleboy/ssh-action` family,
  but the canonical one is hosting a tmate session *from inside a step*
  (`mxschmitt/action-tmate@v3`): the step pauses, prints an SSH/web address,
  and you land in the *actual runner mid-job* — inspect mounted files, env,
  the works. Must never be left enabled on untrusted triggers (it is a
  remote shell on your runner).

<!-- concept -->
```yaml
      - name: Debug via tmate
        uses: mxschmitt/action-tmate@<sha>
        # job pauses here; an ssh command appears in the log
```

- **Debug variables** — two magic repositity-level *secrets* flip on verbose
  runner internals for every subsequent run: `ACTIONS_STEP_DEBUG: true`
  (per-step debug logging, incl. `::debug::` lines) and
  `ACTIONS_RUNNER_DEBUG: true` (runner-internal diagnostic logs — how
  contexts got injected, what the runner executed).

**In the GitHub UI:** the two debug flags are set as repo **secrets**
(Settings → Secrets and variables → Actions) named exactly
`ACTIONS_STEP_DEBUG` / `ACTIONS_RUNNER_DEBUG` with value `true`; toggling
them changes what subsequent run logs show. tmate's address appears in the
job log — click through to the web terminal.

## 39. DevEx: monorepo vs multi-repo

*Concept only — this project is a single repo by design (the lab's whole
point is one repo containing app + k8s + workflows); here is the decision
space.*

- **Multi-repo** — one repo per service; each owns its pipeline. Clear
  ownership and access boundaries; CI stays small and fast. Cross-service
  changes become N PRs and version coordination; shared workflow logic must
  be published (reusable workflows, §26) or duplicated.
- **Monorepo** — everything in one repo; one `paths:`-filtered CI (§5, §32)
  runs only affected services; atomic cross-service commits. Pipelines grow
  (hence path filters, matrix, changed-file detection); access control needs
  CODEOWNERS discipline; repo size needs hygiene.

This repo is a monorepo of four services *plus infrastructure* — and it
shows the standard monorepo CI shape: `paths:` gates the workflow, a matrix
fans out per service, and each service's slice runs only when its own code
changed... with the documented simplification that the path union (§32) runs
all test legs on any app change. The deploy side is per-environment
workflows rather than per-service, because the deployment unit is "the
release" (all four images together), not individual services.

**In the GitHub UI:** nothing directly; the observable monorepo mechanics
are the path-filtered runs ("This workflow was triggered by…" only on
matching diffs) and CODEOWNERS-driven reviews.

---

# Part II — The Project

## The lab at a glance

One diagram, the whole system:

<!-- concept -->
```text
                         G I T H U B   (cloud)
   ┌──────────────────────────────────────────────────────────────────┐
   │  repo Mayank-UK/github_actions (PRIVATE)                         │
   │                                                                  │
   │  push to development                                             │
   │        │                                                         │
   │        ▼                                                         │
   │  ┌─────────────────────── CI workflow ────────────────────────┐  │
   │  │ test-matrix ×3   render ×3   guide ×1 (this file!)         │  │
   │  │        └────────┬────────┘     (ubuntu-latest, cloud)      │  │
   │  │                 ▼  needs                                    │  │
   │  │        build-push ×4  (QEMU+buildx → multi-arch images)     │  │
   │  │                 │  push via GITHUB_TOKEN                    │  │
   │  └─────────────────┼───────────────────────────────────────────┘  │
   │                    ▼                                             │
   │             GHCR  ghcr.io/<owner>/github-actions-{facts,         │
   │                   counter,image,frontend}:{sha-xxxxxxx,          │
   │                   development}  (private)                        │
   │                                                                  │
   │  workflow_run "CI" completed ──▶ Deploy development               │
   │  push to staging           ──▶ Deploy staging                    │
   │  push to production        ──▶ Deploy production (+approval)     │
   │        │ environment: development|staging|production             │
   └────────┼─────────────────────────────────────────────────────────┘
            │  job picked up via OUTBOUND HTTPS polling (no inbound ports)
            ▼
   ┌── Y O U R   M A C ──────────────────────────────────────────────┐
   │  actions-runner (native process, label deploy-local)             │
   │        │ runs the composite action: rotate ghcr-pull secret,     │
   │        │ kustomize edit set image, kubectl apply -k,             │
   │        │ kubectl rollout status ×4                               │
   │        ▼                                                         │
   │  Docker Desktop → kind cluster "github-actions"                  │
   │   ├─ control-plane (ingress-ready, host 8080 → node 80)          │
   │   ├─ worker ×2                                                   │
   │   └─ namespaces: github-actions-development                      │
   │                  github-actions-staging                          │
   │                  github-actions-production                       │
   │        └─ ingress-nginx → frontend svc → GUIDE.md rendered +     │
   │                            /api → facts|counter|image            │
   │  http://{development,staging,production}.github-actions.test:8080│
   └──────────────────────────────────────────────────────────────────┘
```

Three design decisions worth internalizing before reading any file:

1. **Split-brain runners on purpose.** Untrusted-ish work (PR tests) runs on
   GitHub's ephemeral cloud VMs; only deploys run on the self-hosted Mac
   runner — the minimum trust surface (§10).
2. **Outbound-only connection.** The runner *dials out* to GitHub. Nothing
   needs to be exposed to the internet — "deploy from GitHub to my laptop"
   works with zero open ports (the plan explicitly rejected tunnels).
3. **The commit is the contract.** CI tags every image `sha-<first-7>`; every
   deploy re-derives that tag from git (head_sha or HEAD^2). Any running pod
   can be traced to exactly one CI run and one commit.

## Repository layout

<!-- concept -->
```text
github_actions/
├── GUIDE.md                     ← this guide (the single docs file)
├── Taskfile.yml                 ← local-first loop + task up bootstrap (§36)
├── scripts/
│   └── check_snippets.py        ← verifies this guide's source: quotes
├── agentic_development.md       ← project state journal (the other allowed .md)
├── .github/
│   ├── actionlint.yaml          ← linter config (allowlist deploy-local label)
│   ├── actions/
│   │   └── deploy-env/
│   │       └── action.yaml      ← THE composite action (§25)
│   └── workflows/
│       ├── ci.yaml              ← tests ×3 + render ×3 + guide + build-push ×4
│       ├── deploy-development.yaml   ← workflow_run-triggered
│       ├── deploy-staging.yaml       ← push-triggered
│       └── deploy-production.yaml    ← push-triggered + approval gate
├── .docker/                     ← one Dockerfile per service
│   ├── facts/Dockerfile   counter/Dockerfile
│   ├── image/Dockerfile   frontend/Dockerfile  ← bakes GUIDE.md + renderer in
├── .k8s/
│   ├── kind-cluster.yaml        ← 1 control-plane (ingress-ready) + 2 workers
│   ├── base/                    ← namespace-agnostic manifests + kustomization
│   └── overlays/
│       ├── development/         ← ns github-actions-development, host dev…test
│       ├── staging/
│       └── production/          ← + 2 replicas per service
└── app/
    ├── facts/    (FastAPI + pytest)      ← GET /facts?topic=
    ├── counter/  (Express + node:test)   ← POST /count
    ├── image/    (Go stdlib + go test)   ← GET /image?topic=
    └── frontend/ (nginx: guide renderer page + /api proxy)
```

The repo follows a strict two-file documentation rule (`GUIDE.md` +
`agentic_development.md`); everything else teaches from code.

## The application: four services, one ingress

Three language backends + an nginx gateway — chosen so one CI workflow
demonstrates three real language toolchains on identical skeleton code:

- **facts** (Python/FastAPI, :8000) — fetches a Wikipedia summary for a
  topic, POSTs the text to counter, returns facts + counts:

<!-- source: app/facts/main.py -->
```python
@app.get("/facts")
def facts(topic: str = Query(default=None)):
    topic = (topic or "").strip()
    if not topic:
        logger.info("rejected request: empty topic")
        return JSONResponse(status_code=400, content={"error": "topic is required"})

    logger.info("facts request for topic %r", topic)
    facts_text, source_url = _get_facts(topic)
    counts = _get_counts(facts_text)
    return {
        "topic": topic,
        "facts": facts_text,
        "sourceUrl": source_url,
        "counts": counts,
    }
```

- **counter** (Node/Express, :3000) — word/character/unique-word counts:

<!-- source: app/counter/server.js -->
```js
app.post('/count', (req, res) => {
  const text = (req.body || {}).text;
  if (typeof text !== 'string') {
    return res.status(400).json({ error: 'text is required' });
  }

  // Whitespace-tokenized words: split(' ') alone leaves empty strings for
  // leading/trailing/repeated whitespace, so filter them out.
  const words = text.split(' ').filter((w) => w.length > 0);
  const characters = text.length;
  const uniqueWords = new Set(
    words.map((w) =>
      w
        .toLowerCase()
        .replace(new RegExp(`^[${EDGE_PUNCT}]+|[${EDGE_PUNCT}]+$`, 'g'), '')
    )
  ).size;

  res.json({ words: words.length, characters, uniqueWords });
});
```

- **image** (Go, :8080) — Wikimedia Commons search with deliberate nulls on
  misses:

<!-- source: app/image/main.go -->
```go
// imageResponse is the service's JSON contract. Pointers marshal as null
// when there is no result, and the key is always present.
type imageResponse struct {
	Topic     string  `json:"topic"`
	ImageURL  *string `json:"imageUrl"`
	PageTitle *string `json:"pageTitle"`
}
```

- **frontend** (nginx :80) — the guide's renderer page + API proxy. The
  container ships this file: the Dockerfile vendors a pinned markdown
  renderer (marked + highlight.js, sha256-verified at build, no runtime CDN)
  and copies `GUIDE.md` into the image, so the *deployed application serves
  the guide you are reading*:

<!-- source: .docker/frontend/Dockerfile -->
```dockerfile
# *.html: the guide shell (index.html) + the interactive demo page (demo.html).
COPY app/frontend/*.html /usr/share/nginx/html/
COPY app/frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY GUIDE.md /usr/share/nginx/html/GUIDE.md
```

nginx serves the markdown with an explicit content type (its stock
mime.types would offer a download instead)… Alongside the guide page, the
image also ships `demo.html` — a one-action page ("Try the app →" in the
guide's top bar): enter a topic, get a single combined result card (Commons
image + Wikipedia description + word counts). The counts are the
service-to-service proof — the facts pod calls the counter pod itself, so
the page's two parallel requests (`/api/facts`, `/api/image`) return a
result the counter service already computed; the page never calls counter.

<!-- source: app/frontend/nginx.conf -->
```nginx
    location = /GUIDE.md {
        default_type text/markdown;
        charset utf-8;
    }
```

…and proxies the three APIs, one location each:

<!-- source: app/frontend/nginx.conf -->
```nginx
    location /api/facts {
        proxy_pass http://facts:8000/facts;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/count {
        proxy_pass http://counter:3000/count;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }

    location /api/image {
        proxy_pass http://image:8080/image;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
```

All three test suites are offline (mocked HTTP) — see
`app/facts/test_main.py`, `app/counter/server.test.js`,
`app/image/main_test.go` — which is what lets CI's test matrix be
deterministic.

## The CI workflow, section by section

`.github/workflows/ci.yaml` — the DAG (§8's graph view is its UI rendering):

**Header** — name plus the supply-chain policy comment (§24).

**Triggers** (`on:`) — three events with filters (§4–§6): manual dispatch
with `skip-build`, PRs to the three long-lived branches, pushes to
`development` only. Both git events carry the same path filter.

**Workflow-wide keys** — `concurrency` latest-wins per ref (§19);
`permissions: contents: read` as the floor (§20).

**Job `test-matrix`** — one job, three legs (`facts|counter|image`), each leg
gated step-by-step with `if: matrix.service == '...'` (§17, §30). Why one job
instead of three? One runner boot per leg is unavoidable either way, but one
*workflow file section* keeps the three toolchains diff-readable side by
side — and `fail-fast: false` (§18) keeps all legs reporting.

**Job `render`** — the k8s-side test: renders each kustomize overlay and
fails on empty output with an annotated error (§29). This is what guarantees
"kustomize overlays are valid" on every PR — before any image is built
(quoted in §29).

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Render kustomize overlay
        run: |
          set -euo pipefail
          out="$(kubectl kustomize .k8s/overlays/${{ matrix.env }})"
          if [ -z "$out" ]; then
            echo "::error::.k8s/overlays/${{ matrix.env }} rendered to EMPTY output"
            exit 1
          fi
          echo "overlay ${{ matrix.env }}: $(printf '%s\n' "$out" | wc -l | tr -d ' ') lines rendered"
```

**Job `guide`** — the pipeline validates its own documentation: a stdlib
Python script re-parses this very file and proves every `<!-- source: … -->`
block is still an ordered subsequence of the file it quotes (and every other
block is honestly marked `<!-- concept -->`). Documentation drift becomes a
red X on the PR, not a reader's confusion later. The same check runs locally
with `task guide-check`:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  guide:
    name: guide snippets
    runs-on: ubuntu-latest
    steps:
…
      - name: Check GUIDE.md snippets against sources
        # stdlib-only script — verifies every <!-- source: PATH --> fenced
        # block is an ordered subsequence of PATH, and that every other
        # block carries <!-- concept -->. Absent GUIDE.md passes (ratchet).
        run: python scripts/check_snippets.py
```

**Job `build-push`** — gated by `needs: [test-matrix, render]` AND the
push-only `if:` (§8, §17). Widens `permissions` to `packages: write` (§20).
Per service (matrix of four): checkout → QEMU/buildx/login (§31) → derive
image coordinates via `GITHUB_OUTPUT` (§14) → build+push multi-arch with the
double tag and gha cache (§28, §31).

CI ends here — deliberately. It builds and publishes, never deploys; CD is
a separate workflow per environment, keeping triggers, permissions, and
environments independently auditable.

## Deploy development: workflow_run and the head_sha gotcha

`.github/workflows/deploy-development.yaml` chains CD after CI without any
polling: it *is* triggered by CI finishing.

**Trigger** — `workflow_run` fires when the workflow *named* `CI` (the filter
matches the workflow's `name:`, not its file name) completes on branch
`development` (§6's quote shows the block).

**The gotcha that owns this file.** Under `workflow_run`, `github.sha` is the
*default branch's* commit — not the commit CI just built. If the deploy used
`github.sha` it would happily deploy yesterday's image after a merge to the
default branch. Every reference to the built commit therefore flows from
`github.event.workflow_run.head_sha`:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
      - name: Check out repository
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          # The CI run's commit — NOT github.sha (default branch under
          # workflow_run). Under workflow_dispatch (no payload) fall back to
          # the dispatched ref's own commit.
          ref: ${{ github.event.workflow_run.head_sha || github.sha }}
```

**Job guard** — `workflow_run` fires on *every* conclusion; only green CI may
deploy (and dispatch runs, which carry no payload, always pass):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    if: github.event_name == 'workflow_dispatch' || github.event.workflow_run.conclusion == 'success'
```

**Job configuration** — the whole pattern in one block: self-hosted runner
(§10), environment binding (§22), serialized concurrency (§19), floor
permissions (§20):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    runs-on: [self-hosted, deploy-local]
    environment: development
    # Serialize development deploys; never cancel a rollout already in flight.
    concurrency:
      group: deploy-development
      cancel-in-progress: false
    permissions:
      contents: read
```

**Steps** — checkout at `head_sha`; derive the image prefix/tag (POSIX-safe,
§13) from `HEAD_SHA`; call the composite action with the env-injected pull
secret (§21, §25). A documented interaction: a manual CI run with
`skip-build=true` still completes `success`, still triggers this workflow,
and then fails loudly at the rollout gate on the never-pushed tag
(ImagePullBackOff after 180s) — accepted as the *right* failure mode: a
visible, explainable error beats silent no-ops.

## Deploy staging and production: merge commits, HEAD^2, and the approval gate

`.github/workflows/deploy-staging.yaml` and `deploy-production.yaml` are
twins (same body, different branch/environment/concurrency group); the
production file adds nothing structurally — the approval gate is *server
side* (§22).

**Trigger** — `push` to the branch, plus a dispatch override input (§5–§6).

**The image-resolution problem.** CI only builds on pushes to
`development`. When a PR merges development → staging, the *merge commit* is
new — CI never built it. A promotion merge's **second parent** (`HEAD^2`)
is the development side — and chained promotions (staging → production) put
*further* merge commits in between, so the deploy resolves the tag by
*walking second parents* back to a commit CI did build (checkout needs
`fetch-depth: 0` so parents exist):

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
      - name: Check out repository (full history)
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          fetch-depth: 0
```

Then the resolution — dispatch override wins, else the second-parent
descent:

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
          if [ -n "$INPUT_TAG" ]; then
            # Manual override (workflow_dispatch): accept sha-abc1234 or bare abc1234.
            case "$INPUT_TAG" in
              sha-*) tag="$INPUT_TAG" ;;
              *)     tag="sha-$INPUT_TAG" ;;
            esac
            echo "deploy tag from dispatch input: $tag"
          else
            # Second-parent descent: a promotion merge's SECOND parent is the
            # branch merged in, so walking second parents from HEAD unwinds
            # staging<-development and lands on the commit CI actually built.
            # Stops early at any commit already on origin/development (covers
            # fast-forward promotions AND development tips that are themselves
            # PR merge commits — built by CI, but a blind descent would
            # overshoot them). Fetch-depth 0 (above) makes origin/development
            # available.
            sha="$(git rev-parse HEAD)"
            while ! git merge-base --is-ancestor "$sha" origin/development 2>/dev/null; do
              # rev-list prints "sha parent1 parent2": field 3 is the second
              # parent; empty when the commit is a non-merge (or a root).
              second="$(git rev-list --parents -n1 "$sha" | awk '{ print $3 }')"
              if [ -z "$second" ]; then
                break
              fi
              sha="$second"
            done
            # Cut exactly 7 chars (--short=N may emit more on ambiguous
            # prefixes, and CI tags are always 7).
            tag="sha-$(printf '%s' "$sha" | cut -c1-7)"
…
            echo "resolved deploy commit via second-parent descent: $sha"
          fi
```

…with a post-walk guard emitting the §29 `::warning` when the walk lands on
a commit that never went through `development` (squash/rebase merge or
direct push) — it deploys anyway; the rollout gate fails loudly if the
images were never built.

**Why this constrains merge style:** "Create a merge commit" (or
fast-forward) preserves the second-parent chain; **squash** and **rebase**
merges leave no second parent — the walk stops early, warns, and probably
fails the rollout gate (tag never built). The repo's branch flow (below) therefore
*requires* merge commits for promotion PRs. A cleaner-sounding alternative —
rebuild images for every branch push — was rejected because staging/production
should deploy *tested, already-built* artifacts, not fresh ones.

**The approval gate (production only).** The job declares
`environment: production`; GitHub's required-reviewers rule on that
environment holds the job in "Waiting for review" before any step runs.
`concurrency: deploy-production` with `cancel-in-progress: false` serializes
approvals so two queued production deploys can't interleave.

## The composite action: deploy-env

`.github/actions/deploy-env/action.yaml` (§25 covered its interface) — the
deploy body all three environments share, as four steps:

1. **Rotate the imagePullSecret** — `kubectl create secret … | kubectl apply`
   is the idempotent create-or-update (§21's snippet): re-runnable every
   deploy, and the mechanism by which a rotated GitHub PAT reaches the
   cluster without any workflow edit.
2. **Point the overlay at the built images** — the runner's checkout is
   ephemeral, so `kustomize edit set image` mutates the working tree only;
   the *overlay in git* stays environment-shape-only (§33's snippet).
3. **Apply**:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
    - name: Apply overlay
      shell: bash
      env:
        DEPLOY_ENV: ${{ inputs.env }}
      run: |
        set -euo pipefail
        kubectl apply -k ".k8s/overlays/$DEPLOY_ENV"
```

4. **Gate on rollouts** — the deploy is not "done" when apply returns; it is
   done when all four deployments roll out. A tag that was never pushed
   surfaces here as ImagePullBackOff within 180s:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
        for svc in facts counter image frontend; do
          kubectl rollout status "deployment/$svc" -n "github-actions-$DEPLOY_ENV" --timeout=180s
        done
```

…then the §29 `::group` summary prints the four deployed image coordinates.

The rollout gate is the workflow's lie detector: it converts every upstream
mistake (skip-build dispatches, squash merges, deleted packages) into a fast,
visible, *pipeline-side* failure instead of a half-dead cluster discovered
later.

## Kubernetes: kind cluster, kustomize base and overlays

**kind cluster** (`.k8s/kind-cluster.yaml`) — one ingress-ready control-plane
(host port 8080 → node 80) plus two workers, so pods genuinely spread over
nodes:

<!-- source: .k8s/kind-cluster.yaml -->
```yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
nodes:
- role: control-plane
  kubeadmConfigPatches:
  - |
    kind: InitConfiguration
    nodeRegistration:
      kubeletExtraArgs:
        node-labels: "ingress-ready=true"
  extraPortMappings:
  - containerPort: 80
    hostPort: 8080
    protocol: TCP
- role: worker
- role: worker
```

**Base + overlays.** The base carries the four Deployments+Services and the
Ingress, deliberately *namespace-agnostic* (each overlay stamps one in):

<!-- source: .k8s/base/kustomization.yaml -->
```yaml
# Namespace-agnostic base: no resource carries a `namespace:` — each overlay's
# `namespace:` field stamps every resource into its environment namespace.
# Service NAMES stay short (facts, counter, ...) so the frontend nginx upstreams
# (http://facts:8000 etc.) resolve inside whichever namespace this deploys to.

resources:
- facts.yaml
- counter.yaml
- image.yaml
- frontend.yaml
- ingress.yaml
```

Base image tags are the *local* `p0` tags (loaded into kind by `task
build`/`task load`); CD overrides them per deploy:

<!-- source: .k8s/base/kustomization.yaml -->
```yaml
images:
- name: github-actions/facts
  newTag: p0
- name: github-actions/counter
  newTag: p0
- name: github-actions/image
  newTag: p0
- name: github-actions/frontend
  newTag: p0
```

An overlay = namespace + host patch (+ replicas for production):

<!-- source: .k8s/overlays/development/kustomization.yaml -->
```yaml
resources:
- namespace.yaml
- ../../base

namespace: github-actions-development

patches:
- patch: |-
    - op: replace
      path: /spec/rules/0/host
      value: development.github-actions.test
  target:
    kind: Ingress
    name: github-actions
```

<!-- source: .k8s/overlays/production/kustomization.yaml -->
```yaml
namespace: github-actions-production

replicas:
- name: facts
  count: 2
- name: counter
  count: 2
- name: image
  count: 2
- name: frontend
  count: 2
```

Every Deployment carries `imagePullSecrets: ghcr-pull` — harmless for local
dev (images preloaded, `IfNotPresent` means no pull) and *required* for CD
(pulled from private GHCR):

<!-- source: .k8s/base/facts.yaml -->
```yaml
      # CD-deployed images live in private GHCR; the ghcr-pull secret is
      # created by the deploy action / `task pull-secret`. Harmless for local
      # dev: IfNotPresent + preloaded images means the kubelet never pulls.
      imagePullSecrets:
      - name: ghcr-pull
      containers:
      - name: facts
        image: github-actions/facts:p0
        imagePullPolicy: IfNotPresent
```

The counter Deployment's probe budgets encode a hard-won lesson (slow
npm cold starts under memory pressure must not be killed):

<!-- source: .k8s/base/counter.yaml -->
```yaml
        # npm+node cold start can take ~40s under memory pressure on the 8GB
        # kind host: readiness gates traffic while warming; liveness kills only
        # after ~80s so slow starts survive.
        readinessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 10
          periodSeconds: 5
          failureThreshold: 12
        livenessProbe:
          httpGet:
            path: /health
            port: http
          initialDelaySeconds: 20
          periodSeconds: 10
          failureThreshold: 6
```

Why the `github-actions.test` domain: `.test` is RFC-2606-reserved for
exactly this (never resolvable publicly, no collision), and `.local` is
reserved by macOS for mDNS.

## imagePullSecrets: how private images reach the cluster

The full credential flow, end to end:

1. A human creates a classic PAT with `read:packages` and stores it as the
   GitHub Actions secret `GHCR_PULL_TOKEN` (Settings → Secrets and variables
   → Actions). Why a PAT and not `GITHUB_TOKEN`: the cluster pulls images
   *between* pipelines — it needs credentials that outlive any job (a
   fine-grained PAT or robot account would be the org-scale equivalent).
2. On every deploy, the workflow hands the secret to the composite action
   via step env — masked in logs, unreadable to the action's own `inputs`
   (§21).
3. The action rotates it into the target namespace as the `ghcr-pull`
   imagePullSecret (§25's `create --dry-run | apply` snippet) — so a token
   revocation + secret update is picked up by the *next deploy*, cluster-side,
   with zero manual kubectl.
4. Pods reference it via `imagePullSecrets` (the facts.yaml quote above);
   the kubelet presents it when pulling from private GHCR.

Locally, `task pull-secret` performs step 3 by hand for all three namespaces
(refusing politely when the env var is unset):

<!-- source: Taskfile.yml -->
```yaml
  pull-secret:
    desc: Apply the ghcr-pull imagePullSecret to all three namespaces (requires GHCR_PULL_TOKEN env var — a classic PAT with read:packages)
```

## Branch and promotion flow

Three long-lived branches, PRs always in one direction:

<!-- concept -->
```text
feature branch ──PR──▶ development ──PR(merge commit)──▶ staging ──PR(merge commit)──▶ production
                        │ CI: test+render            │ deploy staging             │ deploy production
                        │ + build-push (sha-<7>)     │ (tag from HEAD^2)          │ (tag from HEAD^2,
                        │ + deploy development       │                            │  approval gate)
                        ▼                            ▼                            ▼
                     ns github-actions-         ns github-actions-          ns github-actions-
                        development                 staging                      production
```

**The life of a commit:**

1. Push/PR to `development` → CI: three language test legs + three render
   legs; on *push* (not PR) also four multi-arch builds tagged
   `sha-<7>` + `development`, pushed to GHCR.
2. CI completes green on `development` → `workflow_run` fires → Deploy
   development checks out `head_sha`, resolves the same `sha-<7>`, deploys to
   the development namespace. Fully automatic.
3. Promotion = a PR from `development` → `staging`, merged with **"Create a
   merge commit"** (the HEAD^2 contract, above). The push event triggers
   Deploy staging: tag resolved from the merge commit's second parent —
   the exact images CI built for the development head.
4. `staging` → `production` PR likewise; the production deploy job
   additionally parks in the environment's required-reviewer approval until
   a human clicks Approve.

**Promotion, precisely stated:** environments never rebuild; they *redeploy
already-tested image tags*, and each promotion's PR merge commit encodes
which build that is. That is what makes staging and production
bit-for-bit-what-development-was — and rollback is "dispatch the workflow
with an older `image_tag` input" (§6's override).

The one manual rule for the human: always merge promotion PRs with merge
commits (or fast-forward), never squash/rebase — the workflows' warnings and
the rollout gate will catch you otherwise, loudly.

## The self-hosted runner

**What it is:** a native macOS process at `~/Development/temp/actions-runner`
(kept outside any git repo), named `mac-local`, labeled `deploy-local`,
started with `nohup` (`task runner-start` wraps this idempotently) — it
survives terminal closes but **dies on reboot** (no auto-restart; `task up`
checks and reminds you).

**Why native and not a container** (a deliberate plan amendment): the deploy
jobs must reach the kind cluster's API server, which listens on the *Mac's*
localhost. A runner inside Docker Desktop would be in the VM network and
could not reach the host loopback — every `kubectl` would fail. The native
process sees the Mac exactly as a developer does.

**What it runs:** only jobs whose labels match `runs-on: [self-hosted,
deploy-local]` — i.e., only the three deploy workflows' single jobs. Its
working directory is a fresh checkout per job (the composite action's
"kustomize edit is safe because the checkout is ephemeral" reasoning rides on
this).

**Security posture** (recapping §10): private repo; PR-triggered CI is
cloud-only; the runner sees exactly one secret (the pull token, per-job env);
cluster RBAC is untouched (the runner uses the Mac user's kubeconfig for a
local lab cluster — acceptable here, and why it must never be pointed at a
real cluster without narrowing).

**In the GitHub UI:** Settings → Actions → Runners shows it Idle (running),
Active (executing), or Offline (process down — the post-reboot state until
you restart it; Part II's resume section covers the fix).

## Resume after a reboot (and after two years)

State that survives: the kind cluster and its namespaces (Docker Desktop
volumes), the runner's registration/credentials on disk (no re-registration
or token re-entry — just start it), `/etc/hosts` entries, the GitHub side
entirely.

State that dies: the runner *process* (nohup, not a service) and Docker
Desktop itself. So after any reboot:

<!-- concept -->
```console
$ task up            # docker check → kind nodes started (or cluster created)
                     #   → runner CHECKED → missing overlays applied → smoke ×3
$ task runner-start  # only if task up reported the runner down (idempotent)
```

`task hosts` once more only if `/etc/hosts` was reset (rare).

**Returning after two years:** start with this file and
`agentic_development.md` (the project journal — current pipeline state,
pending tasks); then `git log --oneline` for the human history. The
bootstrap is still one command (`task up`). If the runner shows Offline in
GitHub's UI despite `task runner-start`, check Settings → Actions → Runners
for its last-seen time; if the registration was removed in the interim,
re-register (Settings → Actions → Runners → New self-hosted runner — the
download/configure/run script sequence; registration tokens expire after
~1h). If deploys queue but never start, the labels changed. If images 404,
the PAT (secret `GHCR_PULL_TOKEN`) expired — classic PATs do; refresh and
push once (the next deploy rotates it into the cluster automatically). And
if you edit this guide, `task guide-check` (or a PR) will verify every
snippet you quote still exists.

---

*This guide is the project's single documentation file (two-file rule:
`GUIDE.md` + `agentic_development.md`). Snippet integrity is machine-checked
in CI: every `<!-- source: path -->` block in this file is verified to be an
ordered subsequence of that file's lines. The code is the source of truth —
if this guide and the repo ever disagree, fix the guide.*
