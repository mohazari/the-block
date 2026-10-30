import { expect, test } from '@playwright/test'

// Lane against the fake Codex the e2e API runs with: it searches live auctions and recommends
// the first one it finds.
test('a buyer asks Lane for a car and opens its pick', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: /Ask Lane/ }).click()
  const lane = page.getByRole('dialog', { name: 'Lane' })

  await lane.getByRole('textbox', { name: 'Message Lane' }).fill('Something live, please')
  await lane.getByRole('textbox', { name: 'Message Lane' }).press('Enter')
  await expect(
    lane.getByRole('listitem').filter({ hasText: 'Something live, please' }),
  ).toBeVisible()
  await expect(lane.getByText("Here's one to look at.").first()).toBeVisible()

  const pick = lane.getByRole('list', { name: "Lane's picks" }).getByRole('article')
  await expect(pick).toHaveCount(1)
  await expect(pick).toContainText('First match.')
  await expect(pick).toContainText('Ends in')
  const name = (await pick.getByRole('heading').textContent())!.trim()

  // Lane stays docked beside the page while the buyer opens the car.
  await pick.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
  await expect(lane).toBeVisible()

  // The search behind the pick opens in the run list.
  await lane.getByRole('link', { name: 'Show this search in the run list' }).click()
  await expect(page).toHaveURL(/status=live/)
})
