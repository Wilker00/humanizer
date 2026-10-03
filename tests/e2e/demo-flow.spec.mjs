import { test, expect } from '@playwright/test';

test('the complete demo path works without external runtime requests', async ({ page }) => {
  const pageErrors = [];
  const externalRequests = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => {
    const url = new URL(request.url());
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '127.0.0.1') {
      externalRequests.push(request.url());
    }
  });

  await page.goto('/');
  await expect(page).toHaveTitle(/Humanizer/);
  expect(pageErrors, 'startup should not throw').toEqual([]);
  await expect(page.locator('#v-home')).toHaveClass(/\bon\b/);
  await expect(page.getByRole('button', { name: 'Humanizer home' })).toBeVisible();
  await expect(page.locator('.hero-portrait')).toBeVisible();
  await expect.poll(() => page.locator('.hero-portrait').evaluate(image => image.naturalWidth)).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => window.Tone?.version)).toBe('14.8.49');

  await page.getByRole('button', { name: 'Start a song' }).first().click();
  await expect(page.locator('#v-record')).toHaveClass(/\bon\b/);
  await page.getByRole('button', { name: 'Use demo idea' }).click();
  await expect(page.locator('#sTitle')).toHaveText('Your idea, in three parts', { timeout: 5_000 });
  await expect(page.locator('#mS')).toContainText('notes');
  await expect(page.locator('#mB')).toContainText('BPM');

  await page.getByRole('button', { name: 'Open workspace' }).click();
  await expect(page.locator('#v-work')).toHaveClass(/\bon\b/);
  await expect(page.locator('#pname')).toHaveValue('Idea 1');
  await expect(page.locator('#trackStrip .trow')).toHaveCount(5);
  await expect(page.locator('#tab-sound')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#tab-sound').focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#tab-lyrics')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#t-lyrics')).toBeVisible();

  await page.getByRole('button', { name: 'Producer' }).click();
  await expect(page.locator('#v-producer')).toHaveClass(/\bon\b/);
  await expect(page.locator('#p-mix input')).not.toHaveCount(0);
  await expect(page.locator('#prodPosition')).toHaveText('1.1.1');
  await page.locator('#prodLoop').click();
  await expect(page.locator('#prodLoop')).toHaveAttribute('aria-pressed', 'true');
  const pan = page.locator('#p-mix article.opt').nth(1).getByRole('slider', { name: /Pan/ });
  await expect(pan).toBeVisible();
  await pan.evaluate(input => {
    input.value = '-0.5';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#prodLoop').click();
  await page.locator('#prodSeek').evaluate(input => {
    input.value = '7.9375';
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#prodPlay').click();
  await expect(page.locator('#prodPlay')).toHaveText('Stop');
  await expect(page.locator('#prodPlay')).toHaveText('Play', { timeout: 2_000 });
  await page.locator('#prodHome').click();
  await expect(page.locator('#prodPosition')).toHaveText('1.1.1');
  await page.locator('#prodLoop').click();
  await page.locator('#prodTabs').getByRole('tab', { name: 'Arrange' }).click();
  await expect(page.locator('#p-arrange .clip-card')).not.toHaveCount(0);
  await page.locator('#p-arrange .clip-card').first().getByRole('button', { name: 'Lock', exact: true }).click();
  await expect(page.locator('#p-arrange .clip-card').first()).toHaveClass(/\blocked\b/);
  await page.locator('#prodTabs').getByRole('tab', { name: 'Deliver' }).click();
  await expect(page.locator('#p-deliver')).toBeVisible();
  for (const label of ['WAV', 'Stems', 'MIDI', 'Share pack']) {
    await expect(page.locator('#p-deliver').getByRole('button', { name: label, exact: true })).toBeVisible();
  }

  await page.getByRole('button', { name: 'Save' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Projects' }).click();
  await expect(page.locator('#cards .card:not(.new)')).toHaveCount(1);
  await page.locator('#cards .card:not(.new)').click();
  await expect(page.locator('#pname')).toHaveValue('Idea 1');
  await page.getByRole('button', { name: 'Producer' }).click();
  await expect(page.locator('#prodLoop')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#prodTabs').getByRole('tab', { name: 'Mix' }).click();
  await expect(page.locator('#p-mix article.opt').nth(1).getByRole('slider', { name: /Pan/ })).toHaveValue('-0.5');

  expect(externalRequests).toEqual([]);
  expect(pageErrors).toEqual([]);
});

test('the landing page fits a phone viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.locator('.hero-copy h1')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start a song' }).first()).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
