export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { handleAppBoot } = await import("./lib/app-release");
    await handleAppBoot();
  }
}
