import { expect, test } from '@playwright/test'

test('on a wide screen the run list is a table: text columns, then figures, evenly spaced', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await page.goto('/')
  const row = page.getByRole('article').first()
  await expect(row).toBeVisible()

  // Column labels in order, left to right; the reserve sits under the price, not in a column.
  const header = page.locator('[aria-hidden="true"]', { hasText: 'Current bid' }).first()
  const labels = ['Vehicle', 'Condition', 'Location', 'Odometer', 'Current bid', 'Ends']
  const xs = []
  for (const label of labels) {
    xs.push((await header.getByText(label, { exact: true }).boundingBox())!.x)
  }
  expect([...xs].sort((a, b) => a - b)).toEqual(xs)
  await expect(header.getByText('Reserve', { exact: true })).toHaveCount(0)
  await expect(row.getByText(/^(Reserve met|Reserve not met|No reserve)$/)).toBeVisible()

  // The time column shows just the time under its "Ends" header; "Ends in" stays for screen
  // readers only (visually hidden: a 1px box).
  await expect(row.getByText(/^\d+[dhms] \d+[hms]$|^\d+s$/)).toBeVisible()
  expect(
    (await row.getByText('Ends in', { exact: true }).boundingBox())!.width,
  ).toBeLessThanOrEqual(1)

  // Compact rows: name and trim share a line.
  const name = (await row.getByRole('heading').boundingBox())!
  const trim = (await row
    .getByRole('heading')
    .locator('xpath=following-sibling::span')
    .boundingBox())!
  expect(Math.abs(trim.y + trim.height - (name.y + name.height))).toBeLessThan(4)
  expect(trim.x).toBeGreaterThan(name.x + name.width)
})
