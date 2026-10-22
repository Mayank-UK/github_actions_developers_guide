import { expect, test } from '@playwright/test';

/**
 * The homepage is the guide itself: index.html fetches /GUIDE.md and renders
 * it client-side with the vendored marked + highlight.js. These specs pin
 * that the real content actually rendered — not the "#load-state" stub, not
 * an error card — and that the page stays silent on the browser console.
 */

test('the guide homepage renders its markdown content', async ({ page }) => {
    await page.goto('/');

    // The renderer replaces the #load-state stub with the guide's own h1
    // (GUIDE.md's title line). If the fetch or the renderer failed, this h1
    // never appears and the error card would be visible instead.
    await expect(
        page.getByRole('heading', {
            level: 1,
            name: 'GitHub Actions A–Z — a complete course, taught from a real pipeline',
        }),
    ).toBeVisible();

    // The loading stub must be GONE — content.innerHTML replaced it.
    await expect(page.locator('#load-state')).toHaveCount(0);

    // The auto-generated TOC is built from the RENDERED headings (h1/h2/h3):
    // a populated sidebar proves the markdown became real DOM, end to end.
    // The guide has dozens of sections; anything this small means the render
    // died partway (e.g. the known literal-<script> swallow bug).
    await expect(page.locator('#toc-list a')).not.toHaveCount(0);
    const tocLinks = await page.locator('#toc-list a').count();
    test.info().annotations.push({ type: 'note', description: `toc links: ${tocLinks}` });
    expect(tocLinks, 'TOC should list dozens of sections').toBeGreaterThan(20);

    // Spot-check real guide content in the main region: both Part headings.
    const main = page.locator('main.content');
    await expect(
        main.getByRole('heading', { name: 'Part I — Fundamentals A–Z' }),
    ).toBeVisible();
    await expect(
        main.getByRole('heading', { name: 'Part II — The Project', exact: false }),
    ).toBeVisible();
});

test('the homepage logs zero console errors', async ({ page }) => {
    const problems: string[] = [];
    page.on('console', (message) => {
        if (message.type() === 'error') {
            problems.push(`console.error: ${message.text()}`);
        }
    });
    page.on('pageerror', (error) => {
        problems.push(`pageerror: ${error.message}`);
    });

    await page.goto('/');

    // Wait for the render to COMPLETE before judging the console: the h1
    // proves the fetch + marked + TOC pass ran; a beat more lets highlight.js
    // finish over the (large) guide.
    await expect(
        page.getByRole('heading', { level: 1, name: /GitHub Actions A–Z/ }),
    ).toBeVisible();
    await page.waitForTimeout(1_000);

    expect(problems, 'expected a clean console on the rendered guide').toEqual([]);
});
