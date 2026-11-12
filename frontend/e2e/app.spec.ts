import { expect, test } from "@playwright/test";

const shot = (name: string) => `test-results/screens/${test.info().project.name}-${name}.png`;

test("voice call: spoken question -> grounded spoken answer with sources", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Talk to your documents" })).toBeVisible();
  await page.screenshot({ path: shot("1-welcome") });

  await page.getByRole("button", { name: "Start voice conversation" }).first().click();
  await expect(page.getByRole("button", { name: "End call" })).toBeVisible();
  // The fake mic plays "Which university did Bill study at?"; expect a grounded answer.
  await expect(page.getByText(/Riara/i).first()).toBeVisible({ timeout: 60_000 });
  const call = page.getByRole("dialog", { name: "Voice call" });
  await expect(call.getByRole("button", { name: /Bill_Mageni_CV/ })).toBeVisible({ timeout: 15_000 });
  await page.screenshot({ path: shot("2-call") });

  await call.getByRole("button", { name: /Bill_Mageni_CV/ }).click();
  await expect(page.getByText("Passages used for this answer")).toBeVisible();
  await page.screenshot({ path: shot("3-source") });
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "End call" }).click();
  await expect(page.getByText(/Riara/i).first()).toBeVisible();
  await page.screenshot({ path: shot("4-thread-after-call") });
});

test("typed question -> text answer from documents", async ({ page }) => {
  await page.goto("/");
  const box = page.getByRole("textbox").first();
  await box.fill("What programming languages does Bill know?");
  await box.press("Enter");
  await expect(page.getByText(/Python/).first()).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: shot("5-typed") });
});

test("documents screen loads", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Documents/ }).click();
  await expect(page.getByRole("heading", { name: "Your documents" })).toBeVisible();
  await expect(page.getByText(/Loading/)).toBeHidden({ timeout: 20_000 });
  await page.screenshot({ path: shot("6-documents"), fullPage: true });
});

test("documents: upload via UI -> ready -> delete", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop", "one project is enough (shared Azure index)");
  test.setTimeout(300_000); // free Search tier: on-demand indexer runs at most every 180 s
  await page.goto("/");
  await page.getByRole("button", { name: /Documents/ }).click();
  const name = "e2e-upload-note.txt";
  await page.locator('input[type="file"]').setInputFiles({ name, mimeType: "text/plain", buffer: Buffer.from("E2E test note: the office plant is called Ferdinand.") });
  const row = page.getByRole("listitem").filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: 20_000 });
  await expect(row.getByText("Ready")).toBeVisible({ timeout: 240_000 });
  await page.screenshot({ path: shot("7-uploaded"), fullPage: true });
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: `Delete ${name}` }).click();
  await expect(row).toBeHidden({ timeout: 20_000 });
});
