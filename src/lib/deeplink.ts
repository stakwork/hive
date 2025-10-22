/**
 * Attempts to open a Sphinx call via deeplink, with automatic browser fallback
 * @param callUrl - The full browser call URL (e.g., https://call.livekit.io/...)
 */
export function openSphinxCall(callUrl: string): void {
  const deeplinkUrl = `sphinx.chat://?action=call&link=${encodeURIComponent(callUrl)}`;

  // Track if the page loses focus (indicates app opened)
  let appOpened = false;
  const startTime = Date.now();

  const onBlur = () => {
    appOpened = true;
  };

  const onVisibilityChange = () => {
    if (document.hidden) {
      appOpened = true;
    }
  };

  window.addEventListener('blur', onBlur);
  document.addEventListener('visibilitychange', onVisibilityChange);

  // Try to open the deeplink
  window.location.href = deeplinkUrl;

  // Fallback to browser after checking if app opened
  setTimeout(() => {
    window.removeEventListener('blur', onBlur);
    document.removeEventListener('visibilitychange', onVisibilityChange);

    const elapsedTime = Date.now() - startTime;

    // If less than 2 seconds elapsed and page didn't lose focus, app likely didn't open
    if (!appOpened && elapsedTime < 2100) {
      window.open(callUrl, '_blank', 'noopener,noreferrer');
    }
  }, 2000);
}
