import { expect, test } from '@playwright/test'

test('a buyer finds a vehicle, bids on it, and tracks it in My bids', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Run list' })).toBeVisible()
  await expect(page.getByText('200 vehicles')).toBeVisible()

  // Search narrows the list and lands in the URL.
  await page.getByRole('searchbox', { name: 'Search inventory' }).fill('bronco')
  await expect(page).toHaveURL(/q=bronco/)
  const rows = page.getByRole('article')
  await expect(rows.first()).toContainText('Bronco')

  // Open a live auction without Buy Now.
  await page.getByRole('searchbox', { name: 'Search inventory' }).fill('')
  await page.getByRole('checkbox', { name: /Live now/ }).check()
  const row = rows.filter({ hasText: 'Ends in' }).filter({ hasNotText: 'Buy Now' }).first()
  const title = (await row.getByRole('heading').textContent())!.trim()
  await row.getByRole('link', { name: title }).click()
  await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible()

  // Two-step bid at the minimum.
  const panel = page.getByRole('complementary', { name: 'Bidding' })
  const place = panel.getByRole('button', { name: /^Place bid \$/ })
  const amount = (await place.textContent())!.replace('Place bid ', '')
  await place.click()
  await panel.getByRole('button', { name: `Confirm ${amount} bid` }).click()
  await expect(panel.getByText("You're the high bidder.")).toBeVisible()
  await expect(panel.getByRole('listitem').first()).toContainText('You')

  // Back returns to the filtered run list, where the row now shows the lead.
  await page.getByRole('link', { name: 'Run list' }).click()
  await expect(page).toHaveURL(/status=live/)
  await expect(rows.filter({ hasText: title }).first()).toContainText("You're winning")

  // My bids lists it under Winning.
  await page.getByRole('link', { name: 'My bids' }).click()
  const winning = page.locator('section', { has: page.getByRole('heading', { name: /Winning/ }) })
  await expect(winning.getByRole('article', { name: title })).toContainText(
    `Your top bid ${amount}`,
  )
})

test('a bid below the minimum cannot be sent', async ({ page }) => {
  await page.goto('/?status=live')
  await page.getByRole('article').first().getByRole('link').click()
  const panel = page.getByRole('complementary', { name: 'Bidding' })
  await panel.getByLabel('Or enter an amount').fill('100')
  await expect(panel.getByText(/The minimum bid is/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Place bid' })).toBeDisabled()
})
