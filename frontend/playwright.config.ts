import path from "node:path";
import { defineConfig, devices } from "@playwright/test";

// Runs against the backend serving the built frontend (scripts/verify.sh --e2e starts it).
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  retries: 0,
  use: {
    baseURL: process.env.BASE_URL ?? "http://localhost:8000",
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${path.resolve("e2e/question.wav")}%noloop`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    },
  },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"], browserName: "chromium" } },
    { name: "desktop", use: { viewport: { width: 1280, height: 800 }, browserName: "chromium" } },
  ],
});
