import { defineConfig, devices } from '@playwright/test';

/**
 * Browser E2E for the guide-site stack. The suite always drives a stack that
 * is ALREADY RUNNING under Docker (never starts one): in CI that is the
 * four-service production images + the CI override (frontend nginx published
 * on 127.0.0.1:8080); locally the same pair boots with the same command.
 *
 * No `webServer` block on purpose: the stack is externally managed. If it is
 * down, boot it from the repo root:
 *   docker network create gadg_frontend 2>/dev/null || true
 *   docker compose -f .docker/docker-compose-prod.yml \
 *     -f .docker/docker-compose.ci.yml up -d --wait
 */
export default defineConfig({
    testDir: '.',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    // Deterministic by design: a red e2e test is a wiring signal, and
    // re-rolling it throws the information away. Zero retries, one worker —
    // the specs share a single stack.
    retries: 0,
    workers: 1,
    fullyParallel: false,
    reporter: 'line',
    use: {
        baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8080',
        headless: true,
        trace: 'retain-on-failure',
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
