import { expect, test, type Page } from '@playwright/test'

/** Where the condition report sits relative to the photos: beside them, or under them. */
const photosOf = (page: Page) =>
  page
    .getByRole('article')
    .filter({ has: page.getByRole('heading', { level: 1 }) })
    .locator('figure')
const headingOf = (page: Page, name: string) =>
  page.getByRole('article').getByRole('heading', { level: 2, name, exact: true })

async function conditionPlacement(page: Page) {
  const photos = (await photosOf(page).boundingBox())!
  const condition = (await headingOf(page, 'Condition').boundingBox())!
  if (condition.y >= photos.y + photos.height) return 'under'
  if (condition.x >= photos.x + photos.width) return 'beside'
  return 'overlapping'
}

test('the condition report sits beside the photos when there is room, under them when not', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const row = page.getByRole('article').first()
  const name = (await row.getByRole('heading').textContent())!.trim()
  await row.getByRole('link', { name }).click()
  await expect(page.getByRole('heading', { level: 1, name })).toBeVisible()

  // A wide screen: photos, condition and bid panel side by side; specs below them.
  await expect.poll(() => conditionPlacement(page)).toBe('beside')
  const photos = (await photosOf(page).boundingBox())!
  const condition = (await headingOf(page, 'Condition').boundingBox())!
  const bidding = page.getByRole('complementary', { name: 'Bidding' })
  const bid = (await bidding.boundingBox())!
  expect(bid.x).toBeGreaterThan(condition.x + condition.width)
  expect(Math.abs(bid.y - photos.y)).toBeLessThan(2) // the bid column starts at the top row
  const specs = (await headingOf(page, 'Specs').boundingBox())!
  expect(specs.y).toBeGreaterThan(photos.y + photos.height)

  // Docking Lane takes the room: the condition report goes back under the photos.
  await page.getByRole('button', { name: /Ask Lane/ }).click()
  await expect(page.getByRole('dialog', { name: 'Lane' })).toBeVisible()
  await expect.poll(() => conditionPlacement(page)).toBe('under')

  // A smaller screen without Lane: under the photos too.
  await page.getByRole('button', { name: 'Close Lane' }).click()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect.poll(() => conditionPlacement(page)).toBe('under')

  // The bid column runs the grid's full height, so its sticky panel can travel and stay in view
  // however long the column about the car is.
  const heights = await page
    .getByRole('complementary', { name: 'Bidding' })
    .evaluate((aside) => [aside.clientHeight, aside.parentElement!.clientHeight])
  expect(heights[0]).toBe(heights[1])
})
