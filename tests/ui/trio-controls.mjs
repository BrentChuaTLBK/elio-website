export async function choose(page, quantities) {
  for (const [id, wanted] of quantities) {
    const tile = page.locator('[data-trio-add="' + id + '"]');
    const count = Number(await tile.getAttribute('data-count'));
    for (let n = count; n < wanted; n++) {
      if (await tile.isDisabled()) break;
      await tile.click();
    }
    for (let n = count; n > wanted; n--) {
      await page.locator('[data-trio-flavor="' + id + '"]').last().click();
    }
  }
}
