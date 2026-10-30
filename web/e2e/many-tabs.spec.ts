import { expect, test } from '@playwright/test'

// Browsers allow about six open connections per site. With a live stream per tab, enough tabs
// would queue a new tab's requests forever ("Loading vehicles…"), so all tabs share one stream
// through a SharedWorker.
test('eight tabs open at once all load the run list and stay live', async ({ context }) => {
  const pages = []
  for (let i = 0; i < 8; i++) {
    const page = await context.newPage()
    await page.goto('/')
    await expect(page.getByText(/^\d+ vehicles$/)).toBeVisible()
    pages.push(page)
  }
  for (const page of pages) {
    await expect(page.getByText('Live', { exact: true })).toBeVisible()
  }
})
