// Exercise the real responsive menu rather than forcing clicks on hidden links.
export async function navigateDashboard(page, view) {
  const navigation = page.locator('#dashboard-navigation');
  const toggle = navigation.locator('summary');
  if (await toggle.isVisible() && !(await navigation.evaluate(el => el.open))) {
    await toggle.click();
  }
  await page.locator(`#admin-nav [data-view="${view}"]`).click();
}
