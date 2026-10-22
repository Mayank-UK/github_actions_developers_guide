# GitHub Actions A–Z — a complete course, taught from a real pipeline

This is the teaching guide for the **github_actions** CI/CD lab: a real
application (four microservices), a real CI pipeline running on GitHub's cloud
runners, and a real CD pipeline that deploys docker compose stacks — the two
lab environments on a Mac through a self-hosted runner, and production on a
cloud VM over SSH. Everything you will read about GitHub Actions
here is *demonstrated by files in this repository* — the code is the source of
truth.

The best part: the lab *serves this guide itself*. The frontend container is
a nginx that ships this file (`GUIDE.md`) plus a tiny vendored markdown
renderer — so once the pipeline has run, the guide you are reading is the
homepage of the deployed application, and its API examples hit live services.
Four workflows make it all happen: one **CI** (validation + image publishing
for both tracks) and one **deploy workflow per environment**.

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
  explained section by section, the deployment side, the runner, and how a
  commit travels from `git push` to a running container.

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
    desc: Full bootstrap — the "resume after reboot (or 2 years later)" one-shot. Docker check, bring each environment stack up (no-op when already running; starts stopped containers), runner check, then smoke.
```

In order: it checks Docker Desktop is up (and tells you to start it if not),
brings each of the three environment stacks up (`docker compose up -d --wait`
— a no-op for stacks that never stopped, a restarter for those that did, and
health-gated either way), *checks* the self-hosted runner — if it is not
running it prints exactly how to start it (`task runner-start`) — and finishes
with a smoke test of all three environments. Run it after every reboot and you
are back in business. Run `task runner-start` too if `task up` reported the
runner down.

(On a fresh clone the stacks have no local images yet — `task deploy-all`
builds them first, then brings up all three environments.)

Each environment is one docker compose project publishing the frontend on its
own loopback port — no hostnames, no `/etc/hosts` edits:

| Environment | URL | Compose project |
|---|---|---|
| development | http://localhost:8080 | github-actions-development |
| staging | http://localhost:8081 | github-actions-staging |
| production (local lab copy) | http://localhost:8082 | github-actions-production |

The *actual* production of this repo is not the Mac at all: the same four
services — serving this very guide — are deployed by the production pipeline
to a cloud VM at
`https://githubactionsdevelopersguide.makbuilds.duckdns.org/` (blue/green
over SSH; Part II covers it). The local `production` stack above is the
teaching artifact that mirrors it on your loopback.

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

The other tasks you will see in this guide (`task build`, `task deploy`,
`task deploy-all`, `task down`, `task smoke`, `task guide-check`, …) are the
building blocks `task up` orchestrates — they
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

About thirty event types can start a workflow. The events this repo's
workflows use:

- `push` — commits pushed to a branch (or tag).
- `pull_request` — activity on a PR (opened, synchronize, reopened…).
- `workflow_dispatch` — a human pressed "Run workflow" (§6).
- `workflow_run` — *another workflow* completed. This lab retired it once
  (the offline-runner lesson, §6's note) and brought it back with a guard:
  all three deploy workflows carry it — Deploy development fires when CI
  completes on `development`, Deploy production when CI completes on
  `production` (both only act on green runs; Part II shows the gate).

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
  # PR checks exist for PRs INTO development (feature -> dev); release PRs
  # (-> production) are validated by the merge push itself, so every change
  # produces exactly one CI run.
  pull_request:
    branches: [development]
  push:
    branches: [development, production]
```

Read it as: CI runs on a manual dispatch with a `skip-build` toggle; on PRs
into `development`; and on pushes to the two release branches — `development`
(builds the lab images) and `production` (validates and publishes the site
images). There is deliberately no `paths:` filter: almost every file in this
small repo feeds some job — app code, Dockerfiles, this guide (its snippet
check is itself a CI job), the e2e suite, the workflows themselves. §32
records the trade.

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

The CI workflow filters pushes to the two release branches — and to nothing
else:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  push:
    branches: [development, production]
```

Meaning: a push to any other branch starts nothing on its own (open a PR and
the `pull_request` event takes over); a push to either release branch runs
the *whole* pipeline — no path filtering, deliberately (§32 records why).

Branch filters also apply to `workflow_run`, where they match the branch the
completed run was on — that is how Deploy development chains after CI on one
branch only (Deploy staging declares the same shape; Part II explains why its
arm is dormant):

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [staging]
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

The deploy workflows also take string inputs to override the deployed image
tag — manual rollback/redeploy levers. Deploy staging's is optional:

<!-- source: .github/workflows/deploy-staging.yaml -->
```yaml
  workflow_dispatch:
    inputs:
      image_tag:
        description: 'Deploy this tag instead of the merge commit (e.g. sha-abcd123 or abcd123)'
        required: false
        type: string
        default: ''
```

…while Deploy production (the site deploy) demands one — a rollback there is
always an explicit choice of commit:

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
  workflow_dispatch:
    inputs:
      image_tag:
        description: 'Commit image tag, e.g. sha-abcd1234 or abcd1234'
        required: true
        type: string
```

And deploy-development carries both an automatic and a manual trigger, with
no inputs at all:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
on:
  workflow_run:
    workflows: [CI]
    types: [completed]
    branches: [development]
  workflow_dispatch:
```

**Why the lab deploys check their target first.** All three deploys once
fired automatically — deploy-development via `workflow_run` after CI,
staging and production on `push`. But the lab deploy jobs require the
self-hosted runner on the author's Mac, which is usually offline, so every
push left a deploy job queued *forever* waiting for a runner that was not
there. The triggers were removed (a dispatch-only era), and then re-added
with the missing piece: a cheap cloud job — `check-target` — that queries
GitHub's runners API *before* the deploy job runs. Runner offline? The
deploy is skipped and the check job's log says exactly why (start the
runner: `task runner-start`). The operational lesson generalizes — an
automatic trigger is only as reliable as the machine its jobs require, so
make checking for that machine part of the workflow itself. Production
needs no such gate: its target (the VM) is always on, reached over SSH from
a cloud job.

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

CI's lab build job waits on two jobs — the three-way language test matrix and
the compose render matrix (both are fan-outs: one job name, several parallel
instances; §18):

<!-- source: .github/workflows/ci.yaml -->
```yaml
  build-push:
    name: build+push (${{ matrix.service }})
    needs: [test-matrix, render]
```

…while the site side of the same workflow chains its own spine — the browser
gate, then (on production pushes only) the publish chain:

<!-- source: .github/workflows/ci.yaml -->
```yaml
  publish:
    name: publish (${{ matrix.service }})
    needs: [e2e, vm-arch]
```

Which produces this graph in every CI run (a standalone `guide` job —
Part II — runs alongside, validating this guide's snippets):

<!-- concept -->
```text
  guide (snippets)                       vm-arch (VM SSH recon)
        [standalone]                     [standalone, prod pushes only]

  test-matrix (facts)    ─┬──► build-push x4      (lab images; pushes to
  test-matrix (counter)  ─┤                         development only)
  test-matrix (image)    ─┤
  render (development)   ─┤
  render (staging)       ─┤
  render (production)    ─┘
  secrets-scan ───────────┬──► e2e (image smoke + browser gate)
  test-matrix (again) ────┘         │
                                    ▼
                          publish x4 (site images; prod pushes only)
                                    │
                                    ▼
                                ghcr-prune
```

`needs` also unlocks reading upstream results (§15) and makes failure
propagate: a red test-matrix instance skips all four build-push instances
*and* the e2e gate — and with it the whole publish chain (which additionally
carries its own branch gate, §17).

**In the GitHub UI:** every run page renders this DAG live — the graph view
with colored nodes (green/yellow/red/grey) beside the job list. Watch it
animate during a real CI run: test-matrix and render nodes fill first, then
the build-push column lights up; on a production push, e2e leads into
vm-arch, publish, and ghcr-prune.

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
must run `docker compose` against the Mac's Docker daemon, which only the Mac
itself can reach. The deploy jobs therefore target the Mac:

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
  `ubuntu-latest` only. The self-hosted runner executes only the two lab
  deploy jobs, on code a maintainer already merged — the automatic
  (`workflow_run`) path requires green CI, the manual path a human pressing
  Run workflow. The production deploy never touches the runner at all: it
  runs on a cloud VM and SSHes to the server.
- **Least-privilege token on the runner** (§20) and **no secrets on the
  runner machine** — the pull token arrives per-job via env, is used for one
  `docker login`, and is logged out again before the job ends (Part II).

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

This project's one job output is load-bearing. Deploy development's first
job (`check-target`, a cheap cloud job) asks GitHub's API whether the lab
runner is online and exports the verdict; the deploy job below it runs only
when the verdict is `true`:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
  check-target:
    name: check lab runner (mac-local)
    runs-on: ubuntu-latest
    permissions:
      contents: read
      # Reading the repo's registered self-hosted runners via the REST API
      # needs the actions scope — granted here, on this cheap cloud job
      # only, not on the deploy job that touches the lab itself.
      actions: read
    outputs:
      runner_online: ${{ steps.check.outputs.runner_online }}
```

The deploy job consumes it as
`needs.check-target.outputs.runner_online == 'true'` (§17 quotes the full
`if:`) — a cloud job's API probe deciding whether the lab job under it may
run at all. The other value that crosses the CI/CD boundary (the sha tag)
still travels through the *git commit itself* — deploy-development re-derives
it from `github.event.workflow_run.head_sha` (dispatch runs deploy the moving
`development` tag instead), deploy-staging from the merge commit's `HEAD^2`,
and the site deploy from `head_sha` again. When the artifact of a job is a
pushed image tagged by commit sha, the commit *is* the message. (A
reusable-workflow refactor of the deploy workflows would use job outputs or
secrets-passing; see §26.)

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

And a guard that treats manual runs as first-class — the lab deploy runs
only when the cloud check job saw the runner online, except on dispatch:

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    # Automatic runs deploy only when check-target saw the runner ONLINE;
    # manual dispatch always attempts — the human is expected to have
    # started the runner (check-target's log explains the queue if not).
    if: needs.check-target.outputs.runner_online == 'true' || github.event_name == 'workflow_dispatch'
```

This `if:` used to carry the green-CI check itself
(`github.event.workflow_run.conclusion == 'success'`) — that arm moved
*inside* check-target, because expressions reading
`github.event.workflow_run.*` evaluate empty under dispatch (the payload
does not exist there — a bug class this project hit head-on during an
environment-rename refactor: a guard written for one trigger silently broke
the other). The split keeps each check where its context actually exists:
the conclusion check in a bash `if` guarded by `GITHUB_EVENT_NAME`, the
runner verdict in the `needs` output, the dispatch arm in the `if:` above.

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

…and three compose environments, and four build-push services:

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
deploy mid-recreate is how you get half-updated stacks):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    # Serialize development deploys; never cancel a deploy already in flight.
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

The `actions` scope in real use — checking the lab runner before deploying
to it (§15's job reads this API):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
          status="$(curl -sS --max-time 30 \
            -H "Authorization: Bearer $GITHUB_TOKEN" \
            -H 'Accept: application/vnd.github+json' \
            "https://api.github.com/repos/$GITHUB_REPOSITORY/actions/runners" \
            | jq -r '.runners[] | select(.name == "mac-local") | .status' 2>/dev/null | head -n 1 || true)"
```

A subtlety this block teaches by living it: the runners API sometimes
refuses the workflow's own `GITHUB_TOKEN` with a 403 — so the query can
NEVER be allowed to fail the check (`-sS` not `-fsS`, jq errors swallowed,
`|| true`): a status lookup problem must read as "offline", not as a red
build. The check job is deliberately un-failable.

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

This project has one *repository* secret — `GHCR_PULL_TOKEN`, a classic PAT
with `read:packages` — plus a set of *environment* secrets on `production`
for the site deploy (below). Why a PAT at all when `github.token` can push?
Because the *deploy* (the Mac's Docker daemon, hours or days after the CI
job — and its token — died) needs to pull the private images from GHCR. The
job hands the secret to the composite action via step env (composite actions
can't read the `secrets` context — §25):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
      - name: Deploy development stack
        # Composite actions cannot read the `secrets` context — the token is
        # injected via env (stays masked in logs).
        uses: ./.github/actions/deploy-env
        env:
          GHCR_PULL_TOKEN: ${{ secrets.GHCR_PULL_TOKEN }}
        with:
          env: development # compose stack (file .docker/docker-compose.development.yml, project github-actions-development); matches the GitHub environment above
          image_prefix: ${{ steps.img.outputs.prefix }}
          image_tag: ${{ steps.img.outputs.tag }}
```

Masking notes: the mask covers the value anywhere it would print (even
accidentally echoed inside scripts); values of ~short length and common words
mask poorly; and masking never happens for values written to files — which is
why the deploy's `docker login` reads the token from stdin (never argv, never
a file) and logs out again before the job ends (Part II).

The production environment carries its own secret set — the SSH coordinates
of the deployment VM, readable only by jobs that declare
`environment: production` (Part II's site deploy):

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
        with:
          host: ${{ secrets.VM_HOST }}
          username: ${{ secrets.VM_USER }}
          key: ${{ secrets.VM_PRIVATE_KEY }}
          fingerprint: ${{ secrets.VM_HOST_FINGERPRINT }}
```

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
    name: deploy (production)
    runs-on: ubuntu-latest
```

The design: the two lab environments deploy whenever green CI meets an
online runner (or a human dispatches — §6's note), while `production`
carries a **required-reviewer** rule — when a production deploy job starts
(automatically after green CI on the production branch, or by dispatch for a
rollback), it pauses in "Waiting" until a designated reviewer approves (or
rejects) in the UI. No YAML change can bypass it: the gate is server-side.
Combined with §19's serialized concurrency, production changes are
one-at-a-time and human-approved.

Environment names are free-form strings — but the convention here binds four
things under one name: the GitHub environment, the compose file
(`.docker/docker-compose.<env>.yml`), the compose project
(`github-actions-<env>`), and the published frontend port (8080/8081/8082 —
see Part II). That string is the thread you can pull from a URL all the way
back to a workflow file.

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
filesystem, same env — so it can use anything on the runner (here: docker,
git).

This repo ships one — `.github/actions/deploy-env` — and both lab deploy
workflows call it. Its interface is deliberately **secret-free**: three plain
inputs, no `secrets` access (composite actions cannot read that context),
with the token injected by the caller via step env (§21). The header:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
name: deploy-env
description: >-
  Deploy all four services to one environment stack: docker login to GHCR
  with the pull token, pull the CI-built images, docker compose up -d --wait
  (health-gated), smoke-test the published port, then log out again.
```

Inputs are typed by description + `required`:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
inputs:
  env:
    description: 'Target environment: development | staging | production (compose file .docker/docker-compose.<env>.yml, project github-actions-<env>)'
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
    - name: Log in to GHCR (pull token)
```

Inside, every step reads inputs through the `inputs` context (§16) and fails
loudly on the missing token with a POSIX `:?` guard:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
      shell: bash
      env:
        IMAGE_PREFIX: ${{ inputs.image_prefix }}
      run: |
        set -euo pipefail
        : "${GHCR_PULL_TOKEN:?GHCR_PULL_TOKEN is not set — the caller must pass it via env from secrets.GHCR_PULL_TOKEN}"
        owner="${IMAGE_PREFIX##*/}"
        printf '%s' "$GHCR_PULL_TOKEN" | docker login ghcr.io --username "$owner" --password-stdin
```

Why the env-injection dance instead of just using `secrets.`? (a) composite
actions genuinely cannot — the context is unavailable to them; (b) it keeps
the action usable from *any* caller (each supplies its own token); (c) env-
passed secrets stay masked in logs, `--password-stdin` keeps the value out of
process listings, and the `:?` guard turns a forgotten injection into an
instant, self-documenting failure instead of an anonymous `docker login`
that never happened.

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

This repo chose three explicit deploy workflows over one reusable one: each
deploy differs in *trigger semantics* (the two lab deploys are
runner-gated `workflow_run` + dispatch; the production site deploy is
`workflow_run` + dispatch over SSH — no runner at all) more than in *body*,
triggers cannot be parameterized into a `workflow_call`,
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

The render job turns an empty compose render into a hard, annotated error:

<!-- source: .github/workflows/ci.yaml -->
```yaml
          out="$(docker compose -f .docker/docker-compose.${{ matrix.env }}.yml config)"
          if [ -z "$out" ]; then
            echo "::error::docker-compose.${{ matrix.env }}.yml rendered to EMPTY output"
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

Why arm64 is *required* here, not a nice-to-have: the deploy target is the
Apple-silicon Mac's own Docker daemon — its containers are arm64; an amd64-only
image would crashloop on the stack with the classic `exec format error`.
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

*Concept only — this project runs CI on every push to its two release
branches and every PR, with no file-path filtering at all.*
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
in the trust base (§24) — and, for the workflow-level variant, "why didn't
CI run?" mysteries (§5's first-push quirk shows how those feel). This repo
weighed the options twice. It first used workflow-level `paths:` filters
(saving minutes on out-of-scope pushes, at the cost of a duplicated path
union); when the site pipeline folded into the same CI, the filter went
away entirely: almost every file in this small repo feeds some job — app
code, both compose families, this guide (the snippet check), the scripts,
the e2e suite, the workflows themselves. The honest simplification is:
everything runs, every time.

**In the GitHub UI:** none — this pattern is invisible except as skipped/
not-skipped jobs in the run.

## 33. Pattern: GitOps vs push-deploy

Two philosophies for "how code reaches the deployment target":

- **Push-deploy (this project)** — the CI/CD pipeline *pushes* to the
  target: here a deploy job runs `docker compose pull` + `docker compose up
  -d --wait` on a runner that sits next to the Docker host. Simple, explicit,
  everything in one place (the workflow file is the whole truth), and a
  perfect fit for a lab. The push's own words:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
        export IMG_PREFIX="$IMAGE_PREFIX" IMG_TAG="$IMAGE_TAG"
        docker compose --file ".docker/docker-compose.$DEPLOY_ENV.yml" pull
```

- **GitOps (concept)** — the target *pulls*: a controller (Argo CD, Flux —
  or a compose watcher like Komodo) watches a git repo (or registry) declared
  to be the desired state and reconciles the deployment toward it. Deploy =
  git commit; rollback = git revert; audit = git log; and nothing outside the
  target needs credentials to change it. The cost: another system running
  around the clock, and drift-by-hand becomes a fought-over anti-pattern.

The middle ground this project occupies — compose files in git, their image
knobs overridden per deploy by the pipeline — is sometimes called
*GitOps-lite*: desired state is versioned in git, but reconciliation is
one-shot per deploy instead of continuous. Part II shows exactly where the
line is drawn and why (a local lab + a teaching goal beat a 24/7 controller).

**In the GitHub UI:** for push-deploy, the deploy run's log *is* the audit
trail (each pull/up with timestamps and the sha tag). For GitOps the
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
  build:
    desc: Build the 4 service images with the local p0 tags (the compose files' IMG_PREFIX/IMG_TAG defaults). frontend builds from the repo-root context so GUIDE.md gets baked into the image.
```

<!-- source: Taskfile.yml -->
```yaml
  deploy:
    desc: Bring up one environment stack (ENV=development|staging|production, default development) and wait for health. Local p0 images by default; CD-style GHCR images via IMG_PREFIX/IMG_TAG (requires a prior `docker login ghcr.io`).
    cmds:
      - docker compose --file .docker/docker-compose.{{.ENV}}.yml up -d --wait
```

The local deploy *is* CD's deploy — the same compose file, the same
`--wait` health gate (§25's composite action just adds the GHCR login and
image knobs around it).

And the smoke test is the same one the bootstrap runs:

<!-- source: Taskfile.yml -->
```yaml
            code=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$port/")
```

Why this matters for learning Actions specifically: when a *deploy* fails,
the same compose file and the same health gate can be exercised locally
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
local Docker daemon; act's emulation adds little over the Taskfile, and self-hosted
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
point is one repo containing app + compose + workflows); here is the decision
space.*

- **Multi-repo** — one repo per service; each owns its pipeline. Clear
  ownership and access boundaries; CI stays small and fast. Cross-service
  changes become N PRs and version coordination; shared workflow logic must
  be published (reusable workflows, §26) or duplicated.
- **Monorepo** — everything in one repo; a `paths:`-filtered CI (§5, §32)
  can run only affected services; atomic cross-service commits. Pipelines
  grow (hence path filters, matrix, changed-file detection); access control
  needs CODEOWNERS discipline; repo size needs hygiene.

This repo is a monorepo of four services *plus infrastructure* — and it
shows the monorepo mechanics at small scale: a matrix fans out per service,
and per-service steps gate on `if: matrix.service == ...` instead of
changed-file detection. At this size the CI deliberately skips path
filtering entirely (§32 records the trade) — every push to a release branch
runs everything. The deploy side is per-environment
workflows rather than per-service, because the deployment unit is "the
release" (all four images together), not individual services.

**In the GitHub UI:** nothing directly; the observable monorepo mechanics
are the per-service matrix legs in each run and CODEOWNERS-driven reviews.

---

# Part II — The Project

## The lab at a glance

One diagram, the whole system:

<!-- concept -->
```text
                        G I T H U B   (cloud)
  ┌────────────────────────────────────────────────────────────────────┐
  │  repo Mayank-UK/github_actions (PRIVATE)                           │
  │                                                                    │
  │  push to development               push to production              │
  │        │                                 │                         │
  │        ▼                                 ▼                         │
  │  ┌────────────────── CI workflow ──────────────────────┐           │
  │  │ test-matrix ×3   render ×3   guide ×1 (this file!)  │           │
  │  │ secrets-scan ───► e2e (site images + Playwright)    │           │
  │  │   lab arm:  build-push ×4 → GHCR github-actions-*   │           │
  │  │             (multi-arch, dev pushes only)           │           │
  │  │   site arm: vm-arch ─► publish ×4 ─► ghcr-prune     │           │
  │  │             (github-actions-guide-*, prod pushes)   │           │
  │  └───────────┬──────────────────────────┬──────────────┘           │
  │              │ workflow_run (green CI)   │ workflow_run (green CI) │
  │              ▼                           ▼                         │
  │   Deploy development            Deploy production (+approval)      │
  │     check-target: runner?         SSH deploy (VM secrets)          │
  │       offline → SKIP + reason          │                           │
  │       online  → deploy job             │                           │
  │   Run workflow → Deploy staging        │                           │
  │     (same check-target gate)           │                           │
  │        │ environment: dev|staging      │                           │
  └────────┼───────────────────────────────┼───────────────────────────┘
           │ outbound HTTPS polling         │ SSH + pull from GHCR
           ▼                                ▼
  ┌── Y O U R   M A C ────────────┐  ┌── O R A C L E   V M ────────────┐
  │  actions-runner (mac-local)   │  │  shared caddy :443 (TLS edge)   │
  │    composite action: login,   │  │    └ flip file: which color     │
  │    pull, up --wait, smoke,    │  │  gadg_blue / gadg_green         │
  │    logout                     │  │    four service containers      │
  │         ▼                     │  │  https://githubactions-         │
  │  Docker Desktop               │  │  developersguide.makbuilds.     │
  │   ├─ github-actions-          │  │  duckdns.org/                   │
  │   │  development  :8080       │  └─────────────────────────────────┘
  │   └─ github-actions-          │
  │      staging     :8081        │
  └───────────────────────────────┘
```

Four design decisions worth internalizing before reading any file:

1. **Split-brain runners on purpose.** Untrusted-ish work (PR tests, the
   browser gate) runs on GitHub's ephemeral cloud VMs; only the two *lab*
   deploys run on the self-hosted Mac runner — the minimum trust surface
   (§10). The production deploy needs no runner at all: a cloud job SSHes
   to the always-on VM.
2. **Outbound-only connections.** The runner *dials out* to GitHub, and the
   production deploy SSHes out from a cloud job — nothing on the Mac or the
   VM needs an inbound port open to the internet.
3. **The commit is the contract.** CI tags every image `sha-<first-7>`; every
   deploy re-derives that tag from git (head_sha or HEAD^2). Any running
   container can be traced to exactly one CI run and one commit.
4. **Check the target before deploying to it.** A lab whose deployment
   target is a laptop that reboots cannot promise "always on" — so the lab
   deploy workflows ask GitHub's API whether the runner is up before the
   deploy job runs, and skip with a loud explanation when it is not
   (§15/§17 quote the gate). Production, whose target is always on, deploys
   straight after green CI plus an approval click.

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
│   └── workflows/               ← exactly FOUR workflows
│       ├── ci.yaml              ← ONE CI, two tracks: test ×3 + render ×3 +
│       │                          guide + secrets-scan + e2e; build-push ×4
│       │                          (lab, dev-gated); vm-arch/publish ×4/
│       │                          ghcr-prune (site, prod-gated)
│       ├── deploy-development.yaml   ← workflow_run+dispatch; runner-gated lab
│       ├── deploy-staging.yaml       ← dispatch (workflow_run declared, dormant)
│       └── deploy-production.yaml    ← THE site deploy: SSH blue/green on the VM
├── .docker/
│   ├── facts/Dockerfile   counter/Dockerfile
│   ├── image/Dockerfile   frontend/Dockerfile  ← bakes GUIDE.md + renderer in
│   ├── docker-compose.development.yml  ← env stack, project …-development, :8080
│   ├── docker-compose.staging.yml      ← env stack, project …-staging,     :8081
│   ├── docker-compose.production.yml   ← env stack, project …-production,  :8082
│   └── (docker-compose-prod.yml / .ci.yml / .env — the SITE stack pair:
│        CI's e2e job boots it, deploy-production.yaml ships it to the VM)
└── app/
    ├── facts/    (FastAPI + pytest)      ← GET /facts?topic=
    ├── counter/  (Express + node:test)   ← POST /count
    ├── image/    (Go stdlib + go test)   ← GET /image?topic=
    └── frontend/ (nginx: guide renderer page + /api proxy)
```

The repo follows a strict two-file documentation rule (`GUIDE.md` +
`agentic_development.md`); everything else teaches from code.

## The application: four services, one gateway

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
service-to-service proof — the facts container calls the counter container
itself, so the page's two parallel requests (`/api/facts`, `/api/image`)
return a result the counter service already computed; the page never calls
counter.

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

**Triggers** (`on:`) — three events (§4–§6): manual dispatch with
`skip-build`, every pull request, and pushes to the two release branches —
`development` and `production`, no paths filter (§32 records the trade).

**Workflow-wide keys** — `concurrency` latest-wins per ref (§19);
`permissions: contents: read` as the floor (§20).

**Job `test-matrix`** — one job, three legs (`facts|counter|image`), each leg
gated step-by-step with `if: matrix.service == '...'` (§17, §30). Why one job
instead of three? One runner boot per leg is unavoidable either way, but one
*workflow file section* keeps the three toolchains diff-readable side by
side — and `fail-fast: false` (§18) keeps all legs reporting.

**Job `render`** — the deployment-side test: `docker compose config`
interpolates and merges each environment's compose file into the final stack
definition (a cheap "is the deploy config valid" render) and fails on
empty output with an annotated error (§29). This is what guarantees
"the compose stacks are valid" on every PR — before any image is built
(quoted in §29).

<!-- source: .github/workflows/ci.yaml -->
```yaml
      - name: Render compose stack
        # docker compose config interpolates and merges the file into the
        # final stack definition — a cheap "is the deploy config valid"
        # check, on the preinstalled docker CLI of ubuntu-latest.
        run: |
          set -euo pipefail
          out="$(docker compose -f .docker/docker-compose.${{ matrix.env }}.yml config)"
          if [ -z "$out" ]; then
            echo "::error::docker-compose.${{ matrix.env }}.yml rendered to EMPTY output"
            exit 1
          fi
          echo "stack ${{ matrix.env }}: $(printf '%s\n' "$out" | wc -l | tr -d ' ') lines rendered"
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
double tag and gha cache (§28, §31). These are the **lab images**
(`github-actions-*`) the two lab deploys consume.

**Jobs `secrets-scan` and `e2e` — the site track begins.** A gitleaks scan
over the full history, then the browser gate: `e2e` builds all four *site*
production images locally, boots them with the site compose pair
(`docker-compose-prod.yml` + the CI override that publishes the frontend on
the loopback), probes the homepage and a live proxied API, then drives the
rendered guide with Playwright (`e2e/`). It `needs: [test-matrix,
secrets-scan]` — the site pipeline's old standalone test job folded into
`test-matrix` (identical suites), so nothing runs twice. A dispatch with
`skip-build` skips it (it builds all four images).

**Jobs `vm-arch`, `publish`, `ghcr-prune` — the production-gated arm.** All
three carry `if: push && refs/heads/production`. One SSH recon (`uname -m`)
asks the deployment VM its architecture; `publish` then builds each site
image for exactly that platform with provenance + SBOM attestations, double
tags it (`sha-<7>` immutable + `production` moving), and `ghcr-prune`
deletes sha-tagged GHCR versions beyond the newest 10 (untagged versions are
never touched — the incident note in the file explains why). These are the
images Deploy production ships to the VM.

CI ends here — deliberately. It validates and publishes both image families;
it never deploys. CD is a separate workflow per environment, keeping
triggers, permissions, and environments independently auditable.

## Deploy development: the runner-gated lab deploy

`.github/workflows/deploy-development.yaml` chains CD after CI without any
polling: it is *triggered by CI finishing* — and, before touching the lab,
it checks that the lab is even there.

**Trigger — automatic, with a gate.** The `workflow_run` filter matches the
workflow *named* `CI` (its `name:`, not its file name) completing on branch
`development` (§6 quotes the block). Deploying automatically to a Mac that
reboots is exactly what once left jobs queued forever (§6's note); the fix
was not to give up on automation but to **check the target first** — the
`check-target` job:

- *Non-green CI is a no-op.* `workflow_run` fires on *every* conclusion, so
  the check treats anything but `success` as "nothing to deploy" (this guard
  used to live in the deploy job's `if:`; §17 explains the move).
- *The runner is asked, not assumed.* One REST call (§20's snippet) reads
  the registered runners and looks for `mac-local` being `online`.
- *Offline ⇒ skip with a reason.* The deploy job is skipped and
  check-target's log prints the point of this whole design — the loud box:

<!-- source: .github/workflows/deploy-development.yaml -->
```text
              DEPLOY SKIPPED — the lab runner (mac-local) is OFFLINE
```

  …followed by the full explanation: this environment deploys to the local
  docker-compose lab on the developer's Mac via the self-hosted runner;
  start it with `task runner-start`, then Run workflow. The check job
  *succeeds on purpose* — a skipped deploy with a reason in the log beats a
  red X that means "nothing is actually wrong", and beats even more the job
  that queues forever on an offline runner.

**The gotcha that owns this file (and why the expressions remain).** Under
`workflow_run`, `github.sha` is the *default branch's* commit — not the
commit CI just built. If the deploy used `github.sha` it would happily
deploy yesterday's image after a merge to the default branch. Every
reference to the built commit therefore flows from
`github.event.workflow_run.head_sha` (empty under dispatch, so the
`|| github.sha` fallback resolves to the dispatched ref's own commit):

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

**Job guard** — the deploy job itself is gated on the check's verdict
(`needs` outputs, §15; the full `if:` in §17): automatic runs deploy only
when the runner was seen online; a manual dispatch always attempts — the
human pressing Run workflow is expected to have started the runner
(check-target's log explains the queue if they forgot).

**Job configuration** — the whole pattern in one block: self-hosted runner
(§10), environment binding (§22), serialized concurrency (§19), floor
permissions (§20):

<!-- source: .github/workflows/deploy-development.yaml -->
```yaml
    runs-on: [self-hosted, deploy-local]
    environment: development
    # Serialize development deploys; never cancel a deploy already in flight.
    concurrency:
      group: deploy-development
      cancel-in-progress: false
    permissions:
      contents: read
```

**Steps** — checkout at `head_sha`; derive the image prefix/tag (POSIX-safe,
§13) from `HEAD_SHA`; call the composite action with the env-injected pull
secret (§21, §25). A documented interaction from the workflow_run era, back
in play now that the auto-trigger is: a manual CI run with
`skip-build=true` completes `success` without pushing images; if the runner
is online, this workflow then auto-deploys and fails loudly at the pull step
on the never-pushed tag — accepted as the *right* failure mode: a visible,
explainable error beats silent no-ops. (Dispatch runs deploy the moving
`development` tag instead — always built.)

## Deploy staging: merge commits and the HEAD^2 walk

`.github/workflows/deploy-staging.yaml` shares its shape with Deploy
development (the same check-target gate, the same self-hosted deploy job)
but not its resolution logic — and it is the workflow that teaches how a
promotion finds images CI actually built.

**Trigger** — `workflow_dispatch` with the `image_tag` override input (§6)
is the live path: dispatch on the branch you mean to promote; the walk below
starts from that branch's HEAD. The file also declares a `workflow_run`
trigger on CI completing on `staging` (§5) — dormant by construction, since
CI only runs on pushes to `development`/`production` and PRs; nothing today
completes a CI run on a staging ref. It is declared so the day CI grows a
staging trigger, this deploy gates on it exactly like Deploy development
does.

**The image-resolution problem.** CI only builds on pushes to
`development`. When a PR merges development → staging, the *merge commit* is
new — CI never built it. A promotion merge's **second parent** (`HEAD^2`)
is the development side — and chained promotions put
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
direct push) — it deploys anyway; the pull step fails loudly if the
images were never built.

**Why this constrains merge style:** "Create a merge commit" (or
fast-forward) preserves the second-parent chain; **squash** and **rebase**
merges leave no second parent — the walk stops early, warns, and probably
fails at the pull step (tag never built). The repo's branch flow (below)
therefore *requires* merge commits for promotion PRs. A cleaner-sounding
alternative — rebuild images for every branch push — was rejected because
staging should deploy *tested, already-built* artifacts, not fresh ones.

## Deploy production: the site deploy (SSH, blue/green, caddy)

`.github/workflows/deploy-production.yaml` is **the** production deployment
of this repo — not the local compose lab, but the real, public site: this
very guide, served at
`https://githubactionsdevelopersguide.makbuilds.duckdns.org/` from a cloud
VM, fronted by a shared caddy that terminates TLS. It runs entirely on
GitHub-hosted runners — no self-hosted lab runner involved — and drives the
VM over SSH.

**Trigger** — green CI completing on the production branch deploys the
exact commit CI just published (e2e gate → publish chain, above); manual
dispatch with a required `image_tag` input is the rollback lever, gated to
the production ref:

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
on:
  workflow_run:
    workflows: ['CI']
    types: [completed]
    branches: [production]
  workflow_dispatch:
```

The job's `if:` is the strictest gate in the repo — dispatch must come from
the production ref itself, and a workflow_run must be a green, same-repo,
push-triggered run on the production branch:

<!-- source: .github/workflows/deploy-production.yaml -->
```yaml
    if: >-
      (
        github.event_name == 'workflow_dispatch' &&
        github.ref == 'refs/heads/production'
      ) ||
      (
        github.event_name == 'workflow_run' &&
        github.event.workflow_run.conclusion == 'success' &&
        github.event.workflow_run.event == 'push' &&
        github.event.workflow_run.head_branch == 'production' &&
        github.event.workflow_run.head_repository.full_name == github.repository
      )
```

**Resolution** — no HEAD^2 walk here: CI publishes images on every
production push, so the workflow_run deploys `workflow_run.head_sha` (the
dispatch input names the rollback commit instead), both verified to exist
and to be reachable from `origin/production` before anything happens.

**The deploy** — validate the compose pair, prepare release directories on
the VM, `scp` the compose file, then one SSH script that does blue/green
properly: boot the *inactive* color (`gadg_blue`/`gadg_green` compose
projects) with the freshly published images, probe it privately on its own
network, and only then flip the shared caddy's upstream file and reload:

<!-- source: .github/workflows/deploy-production.yaml -->
```bash
            printf 'reverse_proxy gadg_frontend_%s:80\n' "$COLOR" \
              > "$ROOT/platform/upstream.caddy"
            docker exec caddy caddy reload --config /etc/caddy/Caddyfile
```

A public health gate follows the flip; on failure it flips back to the
still-running old color (instant rollback) — the live color is never touched
until the new one is healthy. Old release directories are pruned, newest 5
kept.

**Credentials & gate** — the VM's SSH coordinates and the GHCR pull login
ride in `production`-environment secrets (§21); the job declares
`environment: production`, so GitHub's required-reviewers rule holds it in
"Waiting for review" before any step runs — one approval click per
production deploy — and `concurrency: deploy-production` with
`cancel-in-progress: false` serializes approvals so two queued production
deploys can't interleave.

**What stays local** — the per-environment compose files (including
`docker-compose.production.yml`) remain teaching artifacts: the local lab's
production stack still runs on `:8082` via `task deploy ENV=production`;
the workflow deploys the site's `docker-compose-prod.yml` pair to the VM.

## The composite action: deploy-env

`.github/actions/deploy-env/action.yaml` (§25 covered its interface) — the
deploy body both lab environments share, as six steps:

1. **Log in to GHCR** — the pull token (env-injected by the caller, §21)
   goes to `docker login --password-stdin`: never argv, never a file, and
   gone again before the job ends. The Docker daemon can now pull the
   private images this deploy needs.
2. **Pull the stack's images** — `docker compose pull` with the
   `IMG_PREFIX`/`IMG_TAG` knobs exported. Pulling *before* `up` makes a
   never-pushed tag fail HERE, loudly and within seconds, while the running
   stack keeps serving untouched.
3. **Deploy (recreate + wait healthy)**:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
    - name: Deploy (recreate + wait healthy)
      shell: bash
      env:
        DEPLOY_ENV: ${{ inputs.env }}
      run: |
        set -euo pipefail
        docker compose --file ".docker/docker-compose.$DEPLOY_ENV.yml" up -d --wait
```

4. **Smoke-test the stack** — the deploy is not "done" when `up` returns; it
   is done when the published frontend port answers. The compose file maps
   each environment to its own port, so the smoke curls it:

<!-- source: .github/actions/deploy-env/action.yaml -->
```yaml
        case "$DEPLOY_ENV" in
          development) port=8080 ;;
          staging)     port=8081 ;;
          production)  port=8082 ;;
          *) echo "unknown environment: $DEPLOY_ENV" >&2; exit 1 ;;
        esac
```

5. **Deploy summary** — the §29 `::group` prints the four deployed image
   coordinates.
6. **Log out of GHCR** — `if: always()` hygiene: the self-hosted runner
   persists between jobs, so a registry login must not outlive the job that
   created it (the only `always()` step in this repo — §17's concept, made
   real).

The `up -d --wait` + smoke pair is the workflow's lie detector: it converts
every upstream mistake (skip-build dispatches, squash merges, deleted
packages) into a fast, visible, *pipeline-side* failure instead of a
half-dead stack discovered later.

## Docker compose: one stack per environment

**The convention:** one compose file per environment
(`.docker/docker-compose.<env>.yml`), each declaring its own project name
and its own published frontend port. Three projects = three isolated stacks
(own network, own containers) coexisting on one Docker host — the
compose-era equivalent of three namespaces behind one ingress:

<!-- source: .docker/docker-compose.development.yml -->
```yaml
name: github-actions-development
```

Only the frontend publishes a port, loopback-only, distinct per environment
(staging 8081, production 8082 — the environment URL *is* the port):

<!-- source: .docker/docker-compose.development.yml -->
```yaml
    ports:
      # Loopback only: the lab is local; no reason to expose it past the Mac.
      # Distinct port per environment = distinct "environment URL".
      - "127.0.0.1:8080:80"
```

**Images interpolate two knobs.** Both default to the local-dev flow
(`task build` tags `github-actions/github-actions-<svc>:p0`); the lab CD
exports both before `docker compose up` — so the *same file* serves the
local loop and the pipeline (§33's GitOps-lite line):

<!-- source: .docker/docker-compose.development.yml -->
```yaml
  facts:
    image: ${IMG_PREFIX:-github-actions}/github-actions-facts:${IMG_TAG:-p0}
```

(The vars are named `IMG_*`, not `IMAGE_*`, on purpose: the sibling
`.docker/.env` belongs to the site stack's compose pair — the
`docker-compose-prod.yml` that CI's e2e job boots and Deploy production
ships to the VM — and auto-loads for every compose invocation in that
directory; its `IMAGE_TAG=ci` must not leak into these stacks' defaults.)

**Healthchecks are the probes.** Each service declares its own healthcheck —
the compose counterpart of the readiness/liveness probes the k8s layer used
to carry, tuned per runtime (slim Python has no wget; alpine's busybox
resolves `localhost` to ::1 first):

<!-- source: .docker/docker-compose.development.yml -->
```yaml
    healthcheck:
      # python:3.12-slim ships no wget/curl — urllib it is.
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
```

The counter service's generous budget encodes a hard-won lesson from the
cluster era (slow npm cold starts under memory pressure must not fail the
deploy):

<!-- source: .docker/docker-compose.development.yml -->
```yaml
      # Generous budget on purpose: npm+node cold start can take ~40s under
      # memory pressure on the Mac (hard-won in the kind era — readiness may
      # gate traffic while warming, but slow starts must not fail the deploy).
      retries: 12
      start_period: 10s
```

**The gateway waits for its backends.** nginx resolves its `proxy_pass`
upstreams (facts/counter/image — the same service names, on the project's
default network) once at startup and never re-resolves, so the frontend must
not start before its backends are healthy:

<!-- source: .docker/docker-compose.development.yml -->
```yaml
    depends_on:
      # nginx resolves its proxy_pass upstreams (facts/counter/image) once at
      # startup and never re-resolves, so the backends must be up AND healthy
      # before the frontend starts — or nginx exits "host not found".
      facts:
        condition: service_healthy
      counter:
        condition: service_healthy
      image:
        condition: service_healthy
```

And every service carries `restart: unless-stopped`, which is what makes the
stacks survive a reboot of Docker Desktop (the resume section rides on this).

**What compose deliberately does NOT give you** (and why that is fine here):
no rolling updates (a redeploy recreates containers — the old ones stop
first), no rescheduling, no replica scaling behind one published port. That
is the honest trade this lab made: the guide showcases GitHub Actions, not
orchestration — when you need rolling deploys and self-healing replicas,
that is the point where Kubernetes (or Nomad, or Swarm) earns its keep.

## Private images: how GHCR credentials reach the deploy

The full credential flow, end to end:

1. A human creates a classic PAT with `read:packages` and stores it as the
   GitHub Actions secret `GHCR_PULL_TOKEN` (Settings → Secrets and variables
   → Actions). Why a PAT and not `GITHUB_TOKEN`: the deploy pulls images
   *between* pipelines — it needs credentials that outlive any job (a
   fine-grained PAT or robot account would be the org-scale equivalent).
2. On every deploy, the workflow hands the secret to the composite action
   via step env — masked in logs, unreadable to the action's own `inputs`
   (§21).
3. The action logs the Docker daemon in to GHCR with it (§25's
   `--password-stdin` snippet) — so a token revocation + secret update is
   picked up by the *next deploy*, with zero manual `docker login`.
4. `docker compose pull` (with the `IMG_PREFIX`/`IMG_TAG` knobs) then
   fetches the four private images; the final action step logs out again,
   even on failure (`if: always()`).

The site deploy (Deploy production) needs no runner-side login at all: its
cloud job SSHes to the VM and logs the *VM's* Docker in with
`GHCR_USER`/`GHCR_PULL_TOKEN` from the `production` environment's secrets,
then pulls the published `github-actions-guide-*` images there (Part II).

Locally, the same flow is two commands by hand — one login, then a deploy
that overrides the same knobs CD sets:

<!-- source: Taskfile.yml -->
```yaml
  deploy:
    desc: Bring up one environment stack (ENV=development|staging|production, default development) and wait for health. Local p0 images by default; CD-style GHCR images via IMG_PREFIX/IMG_TAG (requires a prior `docker login ghcr.io`).
```

## Branch and promotion flow

Three long-lived branches, PRs always in one direction:

<!-- concept -->
```text
feature ──PR──▶ development ──PR(merge commit)──▶ staging ──PR(merge commit)──▶ production
                 │ CI: tests+render+guide          │ Run workflow: Deploy       │ push fires CI's site arm:
                 │ + secrets-scan + e2e            │   staging (tag from        │ e2e ─► publish ─► prune
                 │ + build-push (lab images)       │   HEAD^2, runner-gated)    │ green CI ─► Deploy production
                 │ green CI ─► Deploy development  │                            │   (+approval) ─► SSH blue/green
                 │   (runner-gated: skips with     │                            │
                 │   a reason while offline)       │                            │
                 ▼                                 ▼                            ▼
          github-actions-development        github-actions-staging      https://githubactionsdevelopers-
          (Mac lab, :8080)                  (Mac lab, :8081)            guide.makbuilds.duckdns.org/
```

**The life of a commit:**

1. Push/PR to `development` → CI: three language test legs, three render
   legs, the snippet check, the secrets scan, and the site e2e gate; on
   *push* (not PR) also four multi-arch lab builds tagged `sha-<7>` +
   `development`, pushed to GHCR.
2. CI completes green on `development` → Deploy development fires
   automatically (`workflow_run`): its check-target job asks GitHub whether
   the lab runner is online. Offline — the usual state — the deploy is
   skipped with the loud explanation (§ above); online, the runner pulls
   the `sha-<7>` images and rolls the development lab (:8080). A manual
   Run workflow still works for deliberate runs (moving `development` tag).
3. Promotion = a PR from `development` → `staging`, merged with **"Create a
   merge commit"** (the HEAD^2 contract, above), then a manual Run workflow
   of Deploy staging: tag resolved from the merge commit's second parent —
   the exact images CI built for the development head. Same runner gate.
4. `staging` → `production` PR likewise; the merge *push* fires CI's site
   arm — e2e gate, vm-arch, publish ×4 (attested site images), ghcr-prune —
   and green CI then auto-triggers Deploy production, which parks in the
   environment's required-reviewer approval until a human clicks Approve,
   then SSHes the VM and flips blue/green. Rollback = dispatch Deploy
   production with an older `image_tag`.

**Promotion, precisely stated:** environments never rebuild; they *redeploy
already-tested image tags*, and each promotion's PR merge commit encodes
which build that is. That is what makes staging and production
bit-for-bit-what-development-was — and rollback is "dispatch the workflow
with an older `image_tag` input" (§6's override).

The one manual rule for the human: always merge promotion PRs with merge
commits (or fast-forward), never squash/rebase — the workflows' warnings and
the pull gate will catch you otherwise, loudly.

## The self-hosted runner

**What it is:** a native macOS process at `~/Development/temp/actions-runner`
(kept outside any git repo), named `mac-local`, labeled `deploy-local`,
started with `nohup` (`task runner-start` wraps this idempotently) — it
survives terminal closes but **dies on reboot** (no auto-restart; `task up`
checks and reminds you).

**Why native and not a container** (a deliberate plan amendment): the deploy
jobs run `docker compose` against the *Mac's* Docker daemon, and the stacks
publish their ports on the Mac's loopback. A runner inside Docker Desktop
would live in the VM network — a layer away from the Docker CLI and sockets
the user actually sees. The native process talks to the Mac exactly as a
developer does.

**What it runs:** only jobs whose labels match `runs-on: [self-hosted,
deploy-local]` — i.e., only the two lab deploy workflows' deploy jobs
(development and staging; the production site deploy runs on a cloud VM and
SSHes to the server — it never touches the runner). Its
working directory is a fresh checkout per job, and the deploy leaves nothing
behind on it but the pulled images (the GHCR login is logged out in the same
job; §25).

**Security posture** (recapping §10): private repo; PR-triggered CI is
cloud-only; the runner sees exactly one secret (the pull token, per-job env,
stdin-only, logged out before exit). What it *can* do is run any compose
file a maintainer merged — which is why the repo stays private, the
automatic path requires green CI, and the check-target job keeps
offline-runner runs from even queueing.

**In the GitHub UI:** Settings → Actions → Runners shows it Idle (running),
Active (executing), or Offline (process down — the post-reboot state until
you restart it; Part II's resume section covers the fix).

## Resume after a reboot (and after two years)

State that survives: the three compose stacks (their containers carry
`restart: unless-stopped`, so Docker Desktop starting is all it takes to
bring them back), the runner's registration/credentials on disk (no
re-registration or token re-entry — just start it), and the GitHub side
entirely.

State that dies: the runner *process* (nohup, not a service) and Docker
Desktop itself. So after any reboot:

<!-- concept -->
```console
$ task up            # docker check → stacks brought up + health-gated
                     #   → runner CHECKED → smoke ×3
$ task runner-start  # only if task up reported the runner down (idempotent)
```

**Returning after two years:** start with this file and
`agentic_development.md` (the project journal — current pipeline state,
pending tasks); then `git log --oneline` for the human history. The
bootstrap is still one command (`task up`; on a fresh machine, `brew install
go-task` and Docker Desktop first, then `task deploy-all` to build local
images). If the runner shows Offline in GitHub's UI despite
`task runner-start`, check Settings → Actions → Runners for its last-seen
time; if the registration was removed in the interim, re-register
(Settings → Actions → Runners → New self-hosted runner — the
download/configure/run script sequence; registration tokens expire after
~1h). If deploys queue but never start, the labels changed — note that the
*automatic* lab deploys don't queue at all while the runner is offline; they
skip with a reason in the check-target job's log, which is the expected
post-reboot state until you `task runner-start`. If images 404,
the PAT (secret `GHCR_PULL_TOKEN`) expired — classic PATs do; refresh and
run one deploy (its login step picks the new token up immediately). And
if you edit this guide, `task guide-check` (or a PR) will verify every
snippet you quote still exists.

---

*This guide is the project's single documentation file (two-file rule:
`GUIDE.md` + `agentic_development.md`). Snippet integrity is machine-checked
in CI: every `<!-- source: path -->` block in this file is verified to be an
ordered subsequence of that file's lines. The code is the source of truth —
if this guide and the repo ever disagree, fix the guide.*
