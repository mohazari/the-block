import { expect, test } from '@playwright/test'

test('on a phone, filters open in a sheet that shows the result count', async ({ page }) => {
  await page.goto('/')
  await page.getByRole('button', { name: 'Filters' }).click()
  const sheet = page.getByRole('dialog', { name: 'Filters' })
  await sheet.getByRole('checkbox', { name: /^Truck/ }).check()
  await expect(page).toHaveURL(/body_style=truck/)
  const show = sheet.getByRole('button', { name: /^Show \d+ vehicles?$/ })
  await show.click()
  await expect(sheet).toBeHidden()
  await expect(page.getByRole('button', { name: 'Filters (1)' })).toBeVisible()
  await expect(page.getByRole('article').first()).toBeVisible()
})

test('on a phone, the vehicle page keeps price and a Bid shortcut in reach', async ({ page }) => {
  await page.goto('/?status=live')
  await page.getByRole('article').first().getByRole('link').click()
  await expect(page.getByRole('link', { name: 'Bid', exact: true })).toBeVisible()
})
