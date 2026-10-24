# AI defined section:

## Current state
- Repo Mayank-UK/github_actions (PRIVATE); environments development/staging/production (production protected). Secrets: repo GHCR_PULL_TOKEN
  (classic PAT read:packages); production-env VM_HOST/VM_USER/VM_PRIVATE_KEY/VM_HOST_FINGERPRINT/GHCR_USER/GHCR_PULL_TOKEN.
- Runner: native macOS process /Users/mak/Development/temp/actions-runner (mac-local, labels [self-hosted, deploy-local]; nohup'd, DIES on
  reboot — `task runner-start` idempotent). Outbound-only connection; no inbound ports, tunneling rejected as non-standard + unsafe.
- CD = plain DOCKER COMPOSE (kind/kubectl/kustomize/.k8s REMOVED 2026-10-22). App "cilab": facts Python :8000, counter Node :3000,
  image Go :8080, frontend nginx :80 proxying /api; real tests (pytest / node --test / go test).
- FOUR workflows only: CI + Deploy development/staging/production (teaching-named *.yaml; old site pair ci.yml+deploy-production.yml folded in and DELETED).
  - ci.yaml two tracks: lab (test-matrix/render/guide + build-push github-actions-* images, dev-push-gated) + site (secrets-scan; e2e
    image-smoke+Playwright on EVERY push/PR; vm-arch→publish→ghcr-prune for github-actions-guide-*, gated `push && refs/heads/production`).
    on: push [development, production] + bare pull_request + dispatch(skip-build also gates e2e); NO paths filter (§32 — every file feeds some job).
  - Deploy dev/staging: runner-gated LAB deploys (workflow_run CI-completed + dispatch). check-target: non-green → skip; GET runners API; offline
    → LOUD box ("task runner-start", re-run) + job SUCCEEDS (skip-with-reason). deploy: if runner_online=='true' || dispatch (dispatch always
    attempts), runs-on [self-hosted, deploy-local]. Staging workflow_run arm DORMANT — dispatch is the live path; HEAD^2 walk preserved verbatim.
  - deploy-production.yaml: THE production deploy (Oracle site; blue/green, flip-file, caddy, SSH, keep-5 prune intact): workflow_run
    [CI, branches [production]] + dispatch(required image_tag, gate ref==refs/heads/production). Local :8082 via `task deploy ENV=production`.
- deploy-env composite action: docker login ghcr.io (--password-stdin) → `compose pull` (loud gate on never-built tags BEFORE touching
  running containers) → `up -d --wait` (health gate) → smoke curl on env port → ::group summary → logout `if: always()`.
- Compose: .docker/docker-compose.<env>.yml, project github-actions-<env>, frontend loopback-only :8080/:8081/:8082; images ${IMG_PREFIX:-github-actions}/
  github-actions-<svc>:${IMG_TAG:-p0} (IMG_* named so the site pair's .docker/.env IMAGE_TAG=ci cannot leak); healthchecks per runtime (facts=python-urllib,
  slim has no wget; others busybox wget 127.0.0.1); frontend depends_on service_healthy ×3 (nginx fixes proxy_pass upstreams at startup); restart:
  unless-stopped. FULL-WORD env naming everywhere; staging/prod resolve images via HEAD^2 walk + dispatch override; dev dispatch moves `development` tag.
- Local flow: `task build` tags github-actions/github-actions-<svc>:p0 (ONE compose file serves local + CD); task up = docker check → up --wait ×3 → runner check → smoke; deploy-all = build + up ×3.
- Site pipeline (multi-service static): https://githubactionsdevelopersguide.mayankcodeworks.com from the Oracle VM (aarch64); compose pair
  docker-compose-prod.yml/.ci.yml + committed .docker/.env (IMAGE_TAG=ci); images github-actions-guide-{frontend,counter,facts,image} sha-<7> +
  moving production; e2e Playwright; setup DONE (secrets + caddy gadg snippet → platform/upstream.caddy). Domain → mayankcodeworks.com 2026-10-23 (301s).
- GUIDE.md = two-part markdown SSoT SERVED by the frontend at / (vendored marked@12 + hljs@11, no CDN; /api/* proxied for inline live demos).
  Snippet invariant "code is the source of truth": every snippet captioned `source: <path>`; scripts/check_snippets.py in CI verifies snippets
  AND fails raw <script>/<style>/<template> outside fences. Re-taught for the current shape; 90/90 green (2026-10-24).
- UMAMI ANALYTICS (2026-10-24, development 3b206bb + 92f087d): umami.mayankcodeworks.com, website_id c0114b9d-f04b-4416-ad19-2c3f3316322b;
  static placeholder swap like kdg (__UMAMI_*__ tokens; unset builds drop the beacon line); analytics.js event queue (mount-time events held
  until the beacon loads — cold deep-links covered); events topic-open{topic} (TOC + demo submit) · external-link{target}; UMAMI_* repo-level
  GitHub Variables (never environment-scoped); site-track ci.yaml builds only. README.md is NEW and SUPERSEDES the two-.md rule (see below).
- Umami data-distinct-id (2026-10-25): inline pre-beacon snippet in index.html + demo.html mints a localStorage UUID (mcw_vid) onto the beacon tag → Umami
  identify() dedupes visitors across IP churn; self-guards (SCRIPT tagName + data-website-id) so it inert-no-ops in builds that delete the __UMAMI_SRC__ line.
  Verified by Dockerfile sed swap/delete simulation + node guard sim (/tmp/verify-gadg/verify.log); runtime check pending post-deploy.
- Verified 2026-10-22/24: actionlint 0 ×4 workflows; compose config -q all; TODO/FIXME clean (logs /tmp/verify-gadg-four.log, /tmp/verify-gadg-compose.log); plan phases → devlog.md.

## Failure registry (2026-10-10 session — read BEFORE touching pipelines; each line: symptom -> root cause -> rule)
1. Zero Actions runs on first repo push -> paths-filtered workflows don't fire on a repo's very first push (no diff base) -> next matching push triggers; don't debug the workflow.
2. `bad substitution` on self-hosted runner -> macOS /bin/bash is 3.2; bash-4isms (${VAR,,}) die there but pass on ubuntu -> workflow shell stays POSIX-safe (tr + ${SHA:0:7}); bash-3.2-test snippets.
3. Browser hangs forever on *.local -> macOS reserves .local for Bonjour/mDNS -> local hostnames use .test + `task hosts`; never .local.
4. workflow_run deploy used wrong commit -> github.sha is the DEFAULT branch's commit, not the run's -> use github.event.workflow_run.head_sha (+ github.sha fallback only for dispatch).
5. CrashLoop + conn-refused npm pods; two deploys fast-failed pre-apply -> 8GB Mac memory-thrash (8.3/9.2GB swap): node cold start ~40s vs liveness kill @35s; kind API TLS timeouts under load -> probe budgets 80s (counter), retry deploys when pressure-flaked; reboot before lab sessions; (the "QEMU corrupted npm layer" theory was WRONG — trees were identical; verify before blaming the builder).
6. Guide rendered 20% (huge gap) -> literal `<script>` in prose passes through innerHTML -> browser swallows the rest -> escape raw tags in prose; renderer blanket-escapes script/style/template; checker fails raw tags outside fences.
7. Action pinned to nonexistent SHA (43-char checkout; setup-python f894 vs e894) -> actionlint cannot validate SHA existence; GitHub resolver is the only oracle -> verify pins by grepping the KNOWN-GOOD pin already in the file (same action elsewhere).
8. Manual Run-workflow deployed a docs-only sha -> images never built (paths filter) -> dispatch deploys the moving `development` tag, not branch HEAD.
9. staging->production deploy ImagePullBackOff on sha-0f45c91 -> HEAD^2 of a chained promotion is another MERGE COMMIT (never built) -> resolution now descends second parents, stopping at a commit reachable from origin/development (deploy-staging/production, 2026-10-10).
10. Frontend image shipped without demo.html -> Dockerfile COPY listed files by name -> COPY by glob (app/frontend/*.html) when the dir grows.
11. `node --test app/counter` hangs -> bare dir arg = entry point on Node 22 -> always the glob form "app/counter/*.test.js".
12. Deploy jobs queued forever -> runner lacked the `deploy-local` label -> config.sh --labels deploy-local (or add via UI); runner DIES on reboot -> `task up`.
13. GitHub API: PR merge = PUT (POST 404s misleadingly); env pending-deployment APPROVE endpoint 404s on personal accounts -> UI click is the only approval path there.
14. kind ingress 503/unreachable -> ingress-nginx kind manifest node-selects os=linux only; hostPort lives on the control plane -> patch nodeSelector ingress-ready=true (in Taskfile `ingress`).
- USER FILE RULE (2026-10-10): originally exactly TWO .md files — agentic_development.md + GUIDE.md; all teaching/setup/resume docs live in
  GUIDE.md only. SUPERSEDED (2026-10-24): README.md per the user's README-per-repo instruction; devlog.md added as the AI-section archive (bookkeeping only).

## Active tasks
- ⏳ Watch the consolidation push land live (new CI shape; Deploy development should skip-with-reason while the runner is offline; workflow history wiped to watch from scratch).
- ⏳ Production promotion PR + approval click through the NEW flow (publish chain → workflow_run deploy) — not yet exercised.
- Optional follow-ups: requirements-dev.txt; Docker-Hub-variant exercise.

# Developer defined section:

- Project requirements
    - I want to practice CICD pipeline workflow using github actions, please build a flow the most industry standard way, I usually keep branches development, staging, and production. Do whatever is the best practice like storing credentials encrypted way, uses, etc, whatever is the industry standard, later just tell me what needs to be done from my side. I had also downloaded a fork of a tutor teaching github actions "devops-directive-github-actions-course" present alongside this projects folder
    - Include GitHub Actions fundamentals taught A–Z in a written guide (express_developers_guide teaching style: concept → GitHub-UI where-to-click → code snippet), covering secrets, cache, artifacts, environments, matrix, etc. — every snippet quoted from OUR project files, and the project itself in its own separate "Project" section of the guide ⏳
    - We will have similar app like we have as a sample for devops/kubernetes .The whole app will be containerized and orchestrated using kubernetes like my other apps express_developers_guide, devops/kubernetes, etc, right now I am not sure where will I deploy, but my goal was to expose my local setup to outside internet which is then used by github actions to deploy, not sure if this is possible
    - You will write yaml files for all this setup

- Generic instructions:
    - Follow the most standard approach in industry, I don't want custom hack and slash solutions
    - Update the status markers: ✅ done · 🚧 in progress · ⏳ pending for the tasks

- Development tasks:
    - First write the plan here what you are going to do, then I will approve ✅ (approved 2026-10-10)
    - After you are done, you can guide me what I need to setup my manually like github secrets, cloud account creation and configs, etc ⏳
