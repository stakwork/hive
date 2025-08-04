// src/playwright-generator.ts
function generatePlaywrightTest(url, trackingData) {
  var _a;
  if (!trackingData) return generateEmptyTest(url);
  const { clicks, inputChanges, assertions, userInfo, formElementChanges } =
    trackingData;
  if (
    !((_a = clicks == null ? void 0 : clicks.clickDetails) == null
      ? void 0
      : _a.length) &&
    !(inputChanges == null ? void 0 : inputChanges.length) &&
    !(assertions == null ? void 0 : assertions.length) &&
    !(formElementChanges == null ? void 0 : formElementChanges.length)
  ) {
    return generateEmptyTest(url);
  }
  return `import { test, expect } from '@playwright/test';
    
  test('User interaction replay', async ({ page }) => {
    // Navigate to the page
    await page.goto('${url}');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // Set viewport size to match recorded session
    await page.setViewportSize({ 
      width: ${userInfo.windowSize[0]}, 
      height: ${userInfo.windowSize[1]} 
    });
  
  ${generateUserInteractions(
    clicks,
    inputChanges,
    trackingData.focusChanges,
    assertions,
    formElementChanges,
  )}
  
    await page.waitForTimeout(432);
  });`;
}
function generateEmptyTest(url) {
  return `import { test, expect } from '@playwright/test';
  
  test('Empty test template', async ({ page }) => {
    // Navigate to the page
    await page.goto('${url}');
    
    // Wait for page to load
    await page.waitForLoadState('networkidle');
    
    // No interactions were recorded
    console.log('No user interactions to replay');
  });`;
}
function generateUserInteractions(
  clicks,
  inputChanges,
  focusChanges,
  assertions = [],
  formElementChanges = [],
) {
  var _a;
  const allEvents = [];
  const processedSelectors = /* @__PURE__ */ new Set();
  const formElementTimestamps = {};
  if (formElementChanges == null ? void 0 : formElementChanges.length) {
    const formElementsBySelector = {};
    formElementChanges.forEach((change) => {
      const selector = change.elementSelector;
      if (!formElementsBySelector[selector])
        formElementsBySelector[selector] = [];
      formElementsBySelector[selector].push(change);
    });
    Object.entries(formElementsBySelector).forEach(([selector, changes]) => {
      changes.sort((a, b) => a.timestamp - b.timestamp);
      if (changes[0].type === "checkbox" || changes[0].type === "radio") {
        const latestChange = changes[changes.length - 1];
        allEvents.push({
          type: "form",
          formType: latestChange.type,
          selector: latestChange.elementSelector,
          value: latestChange.value,
          checked: latestChange.checked,
          timestamp: latestChange.timestamp,
          isUserAction: true,
        });
        formElementTimestamps[selector] = latestChange.timestamp;
      } else if (changes[0].type === "select") {
        let lastValue = null;
        changes.forEach((change) => {
          if (change.value !== lastValue) {
            allEvents.push({
              type: "form",
              formType: change.type,
              selector: change.elementSelector,
              value: change.value,
              text: change.text,
              timestamp: change.timestamp,
              isUserAction: true,
            });
            formElementTimestamps[selector] = change.timestamp;
            lastValue = change.value;
          }
        });
      }
      processedSelectors.add(selector);
    });
  }
  if (
    (_a = clicks == null ? void 0 : clicks.clickDetails) == null
      ? void 0
      : _a.length
  ) {
    clicks.clickDetails.forEach((clickDetail) => {
      const [x, y, selector, timestamp] = clickDetail;
      const shouldSkip =
        processedSelectors.has(selector) ||
        Object.entries(formElementTimestamps).some(
          ([formSelector, formTimestamp]) => {
            return (
              (selector.includes(formSelector) ||
                formSelector.includes(selector)) &&
              Math.abs(timestamp - formTimestamp) < 500
            );
          },
        );
      if (!shouldSkip) {
        allEvents.push({
          type: "click",
          x,
          y,
          selector,
          timestamp,
          isUserAction: true,
        });
      }
    });
  }
  if (inputChanges == null ? void 0 : inputChanges.length) {
    const completedInputs = inputChanges.filter(
      (change) => change.action === "complete" || !change.action,
    );
    completedInputs.forEach((change) => {
      if (
        !processedSelectors.has(change.elementSelector) &&
        !change.elementSelector.includes('type="checkbox"') &&
        !change.elementSelector.includes('type="radio"')
      ) {
        allEvents.push({
          type: "input",
          selector: change.elementSelector,
          value: change.value,
          timestamp: change.timestamp,
          isUserAction: true,
        });
      }
    });
  }
  if (assertions == null ? void 0 : assertions.length) {
    assertions.forEach((assertion) => {
      const text = assertion.value || "";
      const isShortText = text.length < 4;
      if (!isShortText && text.trim().length > 0) {
        allEvents.push({
          type: "assertion",
          assertionType: assertion.type,
          selector: assertion.selector,
          value: assertion.value,
          timestamp: assertion.timestamp,
          isUserAction: false,
        });
      }
    });
  }
  allEvents.sort((a, b) => a.timestamp - b.timestamp);
  const uniqueEvents = [];
  const processedFormActions = /* @__PURE__ */ new Set();
  allEvents.forEach((event) => {
    if (event.type === "form") {
      const eventKey = `${event.formType}-${event.selector}-${event.checked !== void 0 ? event.checked : event.value}`;
      if (!processedFormActions.has(eventKey)) {
        uniqueEvents.push(event);
        processedFormActions.add(eventKey);
      }
    } else {
      uniqueEvents.push(event);
    }
  });
  let code = "";
  let lastUserActionTimestamp = null;
  uniqueEvents.forEach((event, index) => {
    if (index > 0) {
      const prevEvent = uniqueEvents[index - 1];
      if (event.isUserAction) {
        let waitTime = 0;
        if (lastUserActionTimestamp) {
          waitTime = event.timestamp - lastUserActionTimestamp;
        } else if (prevEvent.isUserAction) {
          waitTime = event.timestamp - prevEvent.timestamp;
        }
        waitTime = Math.max(100, Math.min(5e3, waitTime));
        if (waitTime > 100) {
          code += `  await page.waitForTimeout(${waitTime});

`;
        }
      }
    }
    switch (event.type) {
      case "click":
        const playwrightSelector = convertToPlaywrightSelector(event.selector);
        code += `  // Click on element: ${event.selector}
`;
        code += `  await page.click('${playwrightSelector}');

`;
        lastUserActionTimestamp = event.timestamp;
        break;
      case "input":
        const inputSelector = convertToPlaywrightSelector(event.selector);
        const escapedInputValue = escapeTextForAssertion(event.value);
        code += `  // Fill input: ${event.selector}
`;
        code += `  await page.fill('${inputSelector}', '${escapedInputValue}');

`;
        lastUserActionTimestamp = event.timestamp;
        break;
      case "form":
        const formSelector = convertToPlaywrightSelector(event.selector);
        if (event.formType === "checkbox" || event.formType === "radio") {
          if (event.checked) {
            code += `  // Check ${event.formType}: ${event.selector}
`;
            code += `  await page.check('${formSelector}');

`;
          } else {
            code += `  // Uncheck ${event.formType}: ${event.selector}
`;
            code += `  await page.uncheck('${formSelector}');

`;
          }
        } else if (event.formType === "select") {
          const escapedSelectValue = escapeTextForAssertion(event.value);
          code += `  // Select option: ${event.text || event.value} in ${event.selector}
`;
          code += `  await page.selectOption('${formSelector}', '${escapedSelectValue}');

`;
        }
        lastUserActionTimestamp = event.timestamp;
        break;
      case "assertion":
        const assertionSelector = convertToPlaywrightSelector(event.selector);
        switch (event.assertionType) {
          case "isVisible":
            code += `  // Assert element is visible: ${event.selector}
`;
            code += `  await expect(page.locator('${assertionSelector}')).toBeVisible();

`;
            break;
          case "hasText":
            const genericSelectors = [
              "div",
              "p",
              "span",
              "h1",
              "h2",
              "h3",
              "h4",
              "h5",
              "h6",
            ];
            const isGenericSelector = genericSelectors.includes(event.selector);
            if (isGenericSelector) {
              const cleanedText = cleanTextForGetByText(event.value);
              const isShortText =
                cleanedText.length < 10 || cleanedText.split(" ").length <= 2;
              code += `  // Assert element contains text: ${event.selector}
`;
              if (isShortText) {
                code += `  await expect(page.locator('${event.selector}').filter({ hasText: '${cleanedText}' })).toBeVisible();

`;
              } else {
                code += `  await expect(page.getByText('${cleanedText}', { exact: false })).toBeVisible();

`;
              }
            } else {
              const escapedText = escapeTextForAssertion(event.value);
              code += `  // Assert element contains text: ${event.selector}
`;
              code += `  await expect(page.locator('${assertionSelector}')).toContainText('${escapedText}');

`;
            }
            break;
          case "isChecked":
            code += `  // Assert checkbox/radio is checked: ${event.selector}
`;
            code += `  await expect(page.locator('${assertionSelector}')).toBeChecked();

`;
            break;
          case "isNotChecked":
            code += `  // Assert checkbox/radio is not checked: ${event.selector}
`;
            code += `  await expect(page.locator('${assertionSelector}')).not.toBeChecked();

`;
            break;
        }
        break;
    }
  });
  return code;
}
function escapeTextForAssertion(text) {
  if (!text) return "";
  return text
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .trim();
}
function cleanTextForGetByText(text) {
  if (!text) return "";
  return text.replace(/\s+/g, " ").replace(/\n+/g, " ").trim();
}
function convertToPlaywrightSelector(cssSelector) {
  if (!cssSelector) return "";
  let selector = cssSelector;
  if (selector.includes("[data-testid=")) {
    const match = selector.match(/\[data-testid="([^"]+)"\]/);
    if (match) return `[data-testid="${match[1]}"]`;
  }
  if (selector.includes("html>body>")) {
    selector = selector.replace("html>body>", "");
  }
  const parts = selector.split(">");
  if (parts.length > 2) {
    selector = parts.slice(-2).join(" ");
  }
  const idMatch = selector.match(/#([a-zA-Z0-9_-]+)/);
  if (idMatch) return `#${idMatch[1]}`;
  return selector;
}
function isTextAmbiguous(text) {
  if (!text) return true;
  if (text.length < 6) return true;
  if (text.split(/\s+/).length <= 2) return true;
  return false;
}
if (typeof window !== "undefined") {
  window.PlaywrightGenerator = {
    generatePlaywrightTest,
    convertToPlaywrightSelector,
    escapeTextForAssertion,
    cleanTextForGetByText,
    isTextAmbiguous,
  };
  console.log("PlaywrightGenerator loaded and attached to window object");
}
export {
  cleanTextForGetByText,
  escapeTextForAssertion,
  generatePlaywrightTest,
  isTextAmbiguous,
};
