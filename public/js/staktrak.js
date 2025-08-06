"use strict";
var userBehaviour = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __getOwnPropSymbols = Object.getOwnPropertySymbols;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __propIsEnum = Object.prototype.propertyIsEnumerable;
  var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
  var __spreadValues = (a, b) => {
    for (var prop in b || (b = {}))
      if (__hasOwnProp.call(b, prop))
        __defNormalProp(a, prop, b[prop]);
    if (__getOwnPropSymbols)
      for (var prop of __getOwnPropSymbols(b)) {
        if (__propIsEnum.call(b, prop))
          __defNormalProp(a, prop, b[prop]);
      }
    return a;
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // src/index.ts
  var src_exports = {};
  __export(src_exports, {
    default: () => src_default
  });

  // src/utils.ts
  var getTimeStamp = () => Date.now();
  var isInputOrTextarea = (element) => element.tagName === "INPUT" || element.tagName === "TEXTAREA" || element.isContentEditable;
  var generateSelectorStrategies = (element) => {
    var _a;
    const htmlEl = element;
    const tagName = element.tagName.toLowerCase();
    const fallbacks = [];
    const testId = (_a = htmlEl.dataset) == null ? void 0 : _a.testid;
    if (testId) {
      return {
        primary: `[data-testid="${testId}"]`,
        fallbacks: [],
        tagName,
        text: getElementText(element),
        ariaLabel: htmlEl.getAttribute("aria-label") || void 0,
        title: htmlEl.getAttribute("title") || void 0,
        role: htmlEl.getAttribute("role") || void 0
      };
    }
    const id = htmlEl.id;
    if (id && /^[a-zA-Z][\w-]*$/.test(id)) {
      return {
        primary: `#${id}`,
        fallbacks: [],
        tagName,
        text: getElementText(element),
        ariaLabel: htmlEl.getAttribute("aria-label") || void 0,
        title: htmlEl.getAttribute("title") || void 0,
        role: htmlEl.getAttribute("role") || void 0
      };
    }
    const text = getElementText(element);
    if (text && (tagName === "button" || tagName === "a" || htmlEl.getAttribute("role") === "button")) {
      const textSelector = generateTextBasedSelector(element, text);
      if (textSelector) {
        fallbacks.push(textSelector);
      }
    }
    const ariaLabel = htmlEl.getAttribute("aria-label");
    if (ariaLabel) {
      fallbacks.push(`[aria-label="${ariaLabel}"]`);
    }
    const role = htmlEl.getAttribute("role");
    if (role && text) {
      fallbacks.push(`[role="${role}"]`);
    }
    const classSelector = generateClassBasedSelector(element);
    if (classSelector && classSelector !== tagName) {
      fallbacks.push(classSelector);
    }
    if (tagName === "input") {
      const type = element.type;
      const name = element.name;
      if (type)
        fallbacks.push(`input[type="${type}"]`);
      if (name)
        fallbacks.push(`input[name="${name}"]`);
    }
    const contextualSelector = generateContextualSelector(element);
    if (contextualSelector) {
      fallbacks.push(contextualSelector);
    }
    const xpath = generateXPath(element);
    const primary = fallbacks.length > 0 ? fallbacks[0] : tagName;
    return {
      primary,
      fallbacks: fallbacks.slice(1),
      // Remove primary from fallbacks
      text,
      ariaLabel: ariaLabel || void 0,
      title: htmlEl.getAttribute("title") || void 0,
      role: role || void 0,
      tagName,
      xpath
    };
  };
  var getElementText = (element) => {
    var _a;
    const htmlEl = element;
    if (element.tagName === "BUTTON" || element.tagName === "A") {
      const text = (_a = htmlEl.textContent) == null ? void 0 : _a.trim();
      if (text && text.length > 0 && text.length < 100) {
        return text;
      }
    }
    if (element.tagName === "INPUT") {
      const input = element;
      return input.placeholder || input.value || void 0;
    }
    return void 0;
  };
  var generateTextBasedSelector = (element, text) => {
    const tagName = element.tagName.toLowerCase();
    const cleanText = text.replace(/"/g, '\\"').trim();
    if (cleanText.length === 0 || cleanText.length > 50)
      return null;
    if (tagName === "button") {
      return `button:has-text("${cleanText}")`;
    }
    if (tagName === "a") {
      return `a:has-text("${cleanText}")`;
    }
    if (element.getAttribute("role") === "button") {
      return `[role="button"]:has-text("${cleanText}")`;
    }
    return null;
  };
  var generateClassBasedSelector = (element) => {
    const tagName = element.tagName.toLowerCase();
    const classList = element.classList;
    if (!classList.length)
      return tagName;
    const safeClasses = Array.from(classList).filter((cls) => {
      if (cls.includes("_") && cls.match(/[0-9a-f]{6}/))
        return false;
      if (cls.includes("module__"))
        return false;
      if (cls.includes("emotion-"))
        return false;
      if (cls.includes("css-"))
        return false;
      if (cls.length > 30)
        return false;
      return /^[a-zA-Z][a-zA-Z0-9-]*$/.test(cls);
    });
    if (safeClasses.length === 0)
      return tagName;
    const limitedClasses = safeClasses.slice(0, 3);
    return `${tagName}.${limitedClasses.join(".")}`;
  };
  var generateContextualSelector = (element) => {
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    if (!parent)
      return null;
    if (tagName === "button" && parent.tagName === "NAV") {
      return "nav button";
    }
    if (tagName === "button" && (parent.tagName === "HEADER" || parent.closest("header"))) {
      return "header button";
    }
    if ((tagName === "input" || tagName === "button") && parent.closest("form")) {
      return `form ${tagName}`;
    }
    return null;
  };
  var generateXPath = (element) => {
    if (element.id) {
      return `//*[@id="${element.id}"]`;
    }
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE) {
      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) {
          index++;
        }
        sibling = sibling.previousElementSibling;
      }
      const tagName = current.tagName.toLowerCase();
      const part = index > 1 ? `${tagName}[${index}]` : tagName;
      parts.unshift(part);
      current = current.parentElement;
      if (parts.length > 10)
        break;
    }
    return "/" + parts.join("/");
  };
  var createClickDetail = (e) => {
    const target = e.target;
    const selectors = generateSelectorStrategies(target);
    return {
      x: e.clientX,
      y: e.clientY,
      timestamp: getTimeStamp(),
      selectors,
      elementInfo: {
        tagName: target.tagName.toLowerCase(),
        id: target.id || void 0,
        className: target.className || void 0,
        attributes: getElementAttributes(target)
      }
    };
  };
  var getElementAttributes = (element) => {
    const attrs = {};
    const htmlEl = element;
    const importantAttrs = [
      "type",
      "name",
      "role",
      "aria-label",
      "title",
      "placeholder",
      "value"
    ];
    importantAttrs.forEach((attr) => {
      const value = htmlEl.getAttribute(attr);
      if (value)
        attrs[attr] = value;
    });
    return attrs;
  };
  var getElementSelector = (element) => {
    const strategies = generateSelectorStrategies(element);
    return strategies.primary;
  };
  var filterClickDetails = (clickDetails, assertions, config) => {
    if (!clickDetails.length)
      return [];
    let filtered = config.filterAssertionClicks ? clickDetails.filter(
      (click) => !assertions.some(
        (assertion) => Math.abs(click.timestamp - assertion.timestamp) < 1e3 && (click.selectors.primary.includes(assertion.selector) || assertion.selector.includes(click.selectors.primary) || click.selectors.fallbacks.some(
          (f) => f.includes(assertion.selector) || assertion.selector.includes(f)
        ))
      )
    ) : clickDetails;
    const clicksBySelector = {};
    filtered.forEach((click) => {
      const key = click.selectors.primary;
      if (!clicksBySelector[key])
        clicksBySelector[key] = [];
      clicksBySelector[key].push(click);
    });
    const result = [];
    Object.values(clicksBySelector).forEach((clicks) => {
      clicks.sort((a, b) => a.timestamp - b.timestamp);
      let lastClick = null;
      clicks.forEach((click) => {
        if (!lastClick || click.timestamp - lastClick.timestamp > config.multiClickInterval) {
          result.push(click);
        }
        lastClick = click;
      });
    });
    return result.sort((a, b) => a.timestamp - b.timestamp);
  };

  // src/debug.ts
  function rectsIntersect(rect1, rect2) {
    return !(rect1.x + rect1.width < rect2.x || rect2.x + rect2.width < rect1.x || rect1.y + rect1.height < rect2.y || rect2.y + rect2.height < rect1.y);
  }
  function isReactDevModeActive() {
    try {
      const allElements = Array.from(document.querySelectorAll("*"));
      for (const element of allElements) {
        const fiberKey = Object.keys(element).find(
          (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
        );
        if (fiberKey) {
          return true;
        }
      }
      return false;
    } catch (error) {
      console.error("Error checking React dev mode:", error);
      return false;
    }
  }
  function extractReactDebugSource(element) {
    var _a, _b;
    try {
      const fiberKey = Object.keys(element).find(
        (key) => key.startsWith("__reactFiber$") || key.startsWith("__reactInternalInstance$")
      );
      if (!fiberKey) {
        return null;
      }
      let fiber = element[fiberKey];
      let level = 0;
      const maxTraversalDepth = Number(process.env.NEXT_PUBLIC_REACT_FIBER_TRAVERSAL_DEPTH) || 10;
      const extractSource = (source) => {
        if (!source)
          return null;
        return {
          fileName: source.fileName,
          lineNumber: source.lineNumber,
          columnNumber: source.columnNumber
        };
      };
      while (fiber && level < maxTraversalDepth) {
        const source = fiber._debugSource || ((_a = fiber.memoizedProps) == null ? void 0 : _a.__source) || ((_b = fiber.pendingProps) == null ? void 0 : _b.__source);
        if (source) {
          return extractSource(source);
        }
        fiber = fiber.return;
        level++;
      }
      return null;
    } catch (error) {
      console.error("Error extracting React debug source:", error);
      return null;
    }
  }
  function debugMsg(data) {
    var _a, _b;
    const { messageId, coordinates } = data;
    try {
      const sourceFiles = [];
      const processedFiles = /* @__PURE__ */ new Map();
      let elementsToProcess = [];
      if (coordinates.width === 0 && coordinates.height === 0) {
        const element = document.elementFromPoint(coordinates.x, coordinates.y);
        if (element) {
          elementsToProcess = [element];
          let parent = element.parentElement;
          while (parent && parent !== document.body) {
            elementsToProcess.push(parent);
            parent = parent.parentElement;
          }
        }
      } else {
        const allElements = document.querySelectorAll("*");
        elementsToProcess = Array.from(allElements).filter((el) => {
          const rect = el.getBoundingClientRect();
          return rectsIntersect(
            {
              x: rect.left,
              y: rect.top,
              width: rect.width,
              height: rect.height
            },
            coordinates
          );
        });
      }
      for (const element of elementsToProcess) {
        const dataSource = element.getAttribute("data-source") || element.getAttribute("data-inspector-relative-path");
        const dataLine = element.getAttribute("data-line") || element.getAttribute("data-inspector-line");
        if (dataSource && dataLine) {
          const lineNum = parseInt(dataLine, 10);
          if (!processedFiles.has(dataSource) || !((_a = processedFiles.get(dataSource)) == null ? void 0 : _a.has(lineNum))) {
            if (!processedFiles.has(dataSource)) {
              processedFiles.set(dataSource, /* @__PURE__ */ new Set());
            }
            processedFiles.get(dataSource).add(lineNum);
            let fileEntry = sourceFiles.find((f) => f.file === dataSource);
            if (!fileEntry) {
              fileEntry = { file: dataSource, lines: [] };
              sourceFiles.push(fileEntry);
            }
            fileEntry.lines.push(lineNum);
          }
        } else {
          const debugSource = extractReactDebugSource(element);
          if (debugSource && debugSource.fileName && debugSource.lineNumber) {
            const fileName = debugSource.fileName;
            const lineNum = debugSource.lineNumber;
            if (!processedFiles.has(fileName) || !((_b = processedFiles.get(fileName)) == null ? void 0 : _b.has(lineNum))) {
              if (!processedFiles.has(fileName)) {
                processedFiles.set(fileName, /* @__PURE__ */ new Set());
              }
              processedFiles.get(fileName).add(lineNum);
              let fileEntry = sourceFiles.find((f) => f.file === fileName);
              if (!fileEntry) {
                fileEntry = { file: fileName, lines: [] };
                sourceFiles.push(fileEntry);
              }
              fileEntry.lines.push(lineNum);
              const tagName = element.tagName.toLowerCase();
              const className = element.className ? `.${element.className.split(" ")[0]}` : "";
              fileEntry.context = `${tagName}${className}`;
            }
          }
        }
      }
      sourceFiles.forEach((file) => {
        file.lines.sort((a, b) => a - b);
      });
      window.parent.postMessage(
        {
          type: "staktrak-debug-response",
          messageId,
          success: true,
          sourceFiles
        },
        "*"
      );
    } catch (error) {
      console.error("Error processing debug request:", error);
      window.parent.postMessage(
        {
          type: "staktrak-debug-response",
          messageId,
          success: false,
          error: error instanceof Error ? error.message : "Unknown error",
          sourceFiles: []
        },
        "*"
      );
    }
  }

  // src/index.ts
  var defaultConfig = {
    userInfo: true,
    clicks: true,
    mouseMovement: false,
    mouseMovementInterval: 1,
    mouseScroll: true,
    timeCount: true,
    clearAfterProcess: true,
    windowResize: true,
    visibilitychange: true,
    keyboardActivity: true,
    formInteractions: true,
    touchEvents: true,
    audioVideoInteraction: true,
    customEventRegistration: true,
    inputDebounceDelay: 2e3,
    multiClickInterval: 300,
    filterAssertionClicks: true,
    processData: (results) => console.log(results)
  };
  var UserBehaviorTracker = class {
    constructor() {
      this.config = defaultConfig;
      this.results = this.createEmptyResults();
      this.memory = {
        mousePosition: [0, 0, 0],
        inputDebounceTimers: {},
        selectionMode: false,
        assertionDebounceTimer: null,
        assertions: [],
        mutationObserver: null,
        mouseInterval: null,
        listeners: [],
        alwaysListeners: []
      };
      this.isRunning = false;
    }
    createEmptyResults() {
      return {
        pageNavigation: [],
        clicks: { clickCount: 0, clickDetails: [] },
        keyboardActivities: [],
        mouseMovement: [],
        mouseScroll: [],
        inputChanges: [],
        focusChanges: [],
        visibilitychanges: [],
        windowSizes: [],
        formElementChanges: [],
        touchEvents: [],
        audioVideoInteractions: [],
        assertions: []
      };
    }
    makeConfig(newConfig) {
      this.config = __spreadValues(__spreadValues({}, this.config), newConfig);
      return this;
    }
    listen() {
      this.setupMessageHandling();
      this.setupPageNavigation();
      window.parent.postMessage({ type: "staktrak-setup" }, "*");
      this.checkDebugInfo();
    }
    start() {
      this.cleanup();
      this.resetResults();
      this.setupEventListeners();
      this.isRunning = true;
      return this;
    }
    resetResults() {
      this.memory.assertions = [];
      this.results = this.createEmptyResults();
      if (this.config.userInfo) {
        this.results.userInfo = {
          url: document.URL,
          userAgent: navigator.userAgent,
          platform: navigator.platform,
          windowSize: [window.innerWidth, window.innerHeight]
        };
      }
      if (this.config.timeCount) {
        this.results.time = {
          startedAt: getTimeStamp(),
          completedAt: 0,
          totalSeconds: 0
        };
      }
    }
    cleanup() {
      this.memory.listeners.forEach((cleanup) => cleanup());
      this.memory.listeners = [];
      if (this.memory.mutationObserver) {
        this.memory.mutationObserver.disconnect();
        this.memory.mutationObserver = null;
      }
      if (this.memory.mouseInterval) {
        clearInterval(this.memory.mouseInterval);
        this.memory.mouseInterval = null;
      }
      Object.values(this.memory.inputDebounceTimers).forEach(
        (timer) => clearTimeout(timer)
      );
      this.memory.inputDebounceTimers = {};
      if (this.memory.assertionDebounceTimer) {
        clearTimeout(this.memory.assertionDebounceTimer);
        this.memory.assertionDebounceTimer = null;
      }
      if (this.memory.selectionMode) {
        this.setSelectionMode(false);
      }
    }
    setupEventListeners() {
      if (this.config.clicks) {
        const clickHandler = (e) => {
          this.results.clicks.clickCount++;
          const clickDetail = createClickDetail(e);
          this.results.clicks.clickDetails.push(clickDetail);
          const target = e.target;
          if (target.tagName === "INPUT" && (target.type === "checkbox" || target.type === "radio")) {
            this.results.formElementChanges.push({
              elementSelector: clickDetail.selectors.primary,
              type: target.type,
              checked: target.checked,
              value: target.value,
              timestamp: getTimeStamp()
            });
          }
        };
        document.addEventListener("click", clickHandler);
        this.memory.listeners.push(
          () => document.removeEventListener("click", clickHandler)
        );
      }
      if (this.config.mouseScroll) {
        const scrollHandler = () => {
          this.results.mouseScroll.push([
            window.scrollX,
            window.scrollY,
            getTimeStamp()
          ]);
        };
        window.addEventListener("scroll", scrollHandler);
        this.memory.listeners.push(
          () => window.removeEventListener("scroll", scrollHandler)
        );
      }
      if (this.config.mouseMovement) {
        const mouseMoveHandler = (e) => {
          this.memory.mousePosition = [e.clientX, e.clientY, getTimeStamp()];
        };
        document.addEventListener("mousemove", mouseMoveHandler);
        this.memory.mouseInterval = setInterval(() => {
          if (this.memory.mousePosition[2] + 500 > getTimeStamp()) {
            this.results.mouseMovement.push(this.memory.mousePosition);
          }
        }, this.config.mouseMovementInterval * 1e3);
        this.memory.listeners.push(() => {
          document.removeEventListener("mousemove", mouseMoveHandler);
          if (this.memory.mouseInterval) {
            clearInterval(this.memory.mouseInterval);
            this.memory.mouseInterval = null;
          }
        });
      }
      if (this.config.windowResize) {
        const resizeHandler = () => {
          this.results.windowSizes.push([
            window.innerWidth,
            window.innerHeight,
            getTimeStamp()
          ]);
        };
        window.addEventListener("resize", resizeHandler);
        this.memory.listeners.push(
          () => window.removeEventListener("resize", resizeHandler)
        );
      }
      if (this.config.visibilitychange) {
        const visibilityHandler = () => {
          this.results.visibilitychanges.push([
            document.visibilityState,
            getTimeStamp()
          ]);
        };
        document.addEventListener("visibilitychange", visibilityHandler);
        this.memory.listeners.push(
          () => document.removeEventListener("visibilitychange", visibilityHandler)
        );
      }
      if (this.config.keyboardActivity) {
        const keyHandler = (e) => {
          if (!isInputOrTextarea(e.target)) {
            this.results.keyboardActivities.push([e.key, getTimeStamp()]);
          }
        };
        document.addEventListener("keypress", keyHandler);
        this.memory.listeners.push(
          () => document.removeEventListener("keypress", keyHandler)
        );
      }
      if (this.config.formInteractions) {
        this.setupFormInteractions();
      }
      if (this.config.touchEvents) {
        const touchHandler = (e) => {
          if (e.touches.length > 0) {
            const touch = e.touches[0];
            this.results.touchEvents.push({
              type: "touchstart",
              x: touch.clientX,
              y: touch.clientY,
              timestamp: getTimeStamp()
            });
          }
        };
        document.addEventListener("touchstart", touchHandler);
        this.memory.listeners.push(
          () => document.removeEventListener("touchstart", touchHandler)
        );
      }
    }
    setupFormInteractions() {
      const attachFormListeners = (element) => {
        const htmlEl = element;
        if (htmlEl.tagName === "INPUT" || htmlEl.tagName === "SELECT" || htmlEl.tagName === "TEXTAREA") {
          const inputEl = htmlEl;
          if (inputEl.type === "checkbox" || inputEl.type === "radio" || htmlEl.tagName === "SELECT") {
            const changeHandler = () => {
              const selector = getElementSelector(htmlEl);
              if (htmlEl.tagName === "SELECT") {
                const selectEl = htmlEl;
                const selectedOption = selectEl.options[selectEl.selectedIndex];
                this.results.formElementChanges.push({
                  elementSelector: selector,
                  type: "select",
                  value: selectEl.value,
                  text: (selectedOption == null ? void 0 : selectedOption.text) || "",
                  timestamp: getTimeStamp()
                });
              } else {
                this.results.formElementChanges.push({
                  elementSelector: selector,
                  type: inputEl.type,
                  checked: inputEl.checked,
                  value: inputEl.value,
                  timestamp: getTimeStamp()
                });
              }
            };
            htmlEl.addEventListener("change", changeHandler);
          } else {
            const inputHandler = () => {
              const selector = getElementSelector(htmlEl);
              const elementId = inputEl.id || selector;
              if (this.memory.inputDebounceTimers[elementId]) {
                clearTimeout(this.memory.inputDebounceTimers[elementId]);
              }
              this.memory.inputDebounceTimers[elementId] = setTimeout(() => {
                this.results.inputChanges.push({
                  elementSelector: selector,
                  value: inputEl.value,
                  timestamp: getTimeStamp(),
                  action: "complete"
                });
                delete this.memory.inputDebounceTimers[elementId];
              }, this.config.inputDebounceDelay);
              this.results.inputChanges.push({
                elementSelector: selector,
                value: inputEl.value,
                timestamp: getTimeStamp(),
                action: "intermediate"
              });
            };
            const focusHandler = (e) => {
              const selector = getElementSelector(htmlEl);
              this.results.focusChanges.push({
                elementSelector: selector,
                type: e.type,
                timestamp: getTimeStamp()
              });
              if (e.type === "blur") {
                const elementId = inputEl.id || selector;
                if (this.memory.inputDebounceTimers[elementId]) {
                  clearTimeout(this.memory.inputDebounceTimers[elementId]);
                  delete this.memory.inputDebounceTimers[elementId];
                }
                this.results.inputChanges.push({
                  elementSelector: selector,
                  value: inputEl.value,
                  timestamp: getTimeStamp(),
                  action: "complete"
                });
              }
            };
            htmlEl.addEventListener("input", inputHandler);
            htmlEl.addEventListener("focus", focusHandler);
            htmlEl.addEventListener("blur", focusHandler);
          }
        }
      };
      document.querySelectorAll("input, select, textarea").forEach(attachFormListeners);
      this.memory.mutationObserver = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
          mutation.addedNodes.forEach((node) => {
            if (node.nodeType === 1) {
              attachFormListeners(node);
              node.querySelectorAll("input, select, textarea").forEach(attachFormListeners);
            }
          });
        });
      });
      this.memory.mutationObserver.observe(document.body, {
        childList: true,
        subtree: true
      });
      this.memory.listeners.push(() => {
        if (this.memory.mutationObserver) {
          this.memory.mutationObserver.disconnect();
          this.memory.mutationObserver = null;
        }
      });
    }
    setupPageNavigation() {
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
      const recordStateChange = (type) => {
        this.results.pageNavigation.push({
          type,
          url: document.URL,
          timestamp: getTimeStamp()
        });
        window.parent.postMessage(
          { type: "staktrak-page-navigation", data: document.URL },
          "*"
        );
      };
      history.pushState = (...args) => {
        originalPushState.apply(history, args);
        recordStateChange("pushState");
      };
      history.replaceState = (...args) => {
        originalReplaceState.apply(history, args);
        recordStateChange("replaceState");
      };
      const popstateHandler = () => {
        recordStateChange("popstate");
      };
      window.addEventListener("popstate", popstateHandler);
      this.memory.alwaysListeners.push(
        () => window.removeEventListener("popstate", popstateHandler)
      );
    }
    setupMessageHandling() {
      if (this.memory.alwaysListeners.length > 0)
        return;
      const messageHandler = (event) => {
        var _a;
        if (!((_a = event.data) == null ? void 0 : _a.type))
          return;
        switch (event.data.type) {
          case "staktrak-start":
            this.resetResults();
            this.start();
            break;
          case "staktrak-stop":
            this.stop();
            break;
          case "staktrak-enable-selection":
            this.setSelectionMode(true);
            break;
          case "staktrak-disable-selection":
            this.setSelectionMode(false);
            break;
          case "staktrak-add-assertion":
            if (event.data.assertion) {
              this.memory.assertions.push({
                type: event.data.assertion.type || "hasText",
                selector: event.data.assertion.selector,
                value: event.data.assertion.value || "",
                timestamp: getTimeStamp()
              });
            }
            break;
          case "staktrak-debug-request":
            debugMsg({
              messageId: event.data.messageId,
              coordinates: event.data.coordinates
            });
        }
      };
      window.addEventListener("message", messageHandler);
      this.memory.alwaysListeners.push(
        () => window.removeEventListener("message", messageHandler)
      );
    }
    checkDebugInfo() {
      setTimeout(() => {
        if (isReactDevModeActive()) {
          window.parent.postMessage({ type: "staktrak-debug-init" }, "*");
        }
      }, 1500);
    }
    setSelectionMode(isActive) {
      var _a;
      this.memory.selectionMode = isActive;
      if (isActive) {
        document.body.classList.add("staktrak-selection-active");
        const mouseUpHandler = () => {
          const selection = window.getSelection();
          if (selection == null ? void 0 : selection.toString().trim()) {
            const text = selection.toString();
            let container = selection.getRangeAt(0).commonAncestorContainer;
            if (container.nodeType === 3)
              container = container.parentNode;
            if (this.memory.assertionDebounceTimer)
              clearTimeout(this.memory.assertionDebounceTimer);
            this.memory.assertionDebounceTimer = setTimeout(() => {
              const selector = getElementSelector(container);
              const assertion = {
                type: "hasText",
                selector,
                value: text,
                timestamp: getTimeStamp()
              };
              this.memory.assertions.push(assertion);
              window.parent.postMessage(
                { type: "staktrak-selection", text, selector },
                "*"
              );
            }, 300);
          }
        };
        document.addEventListener("mouseup", mouseUpHandler);
        this.memory.listeners.push(
          () => document.removeEventListener("mouseup", mouseUpHandler)
        );
      } else {
        document.body.classList.remove("staktrak-selection-active");
        (_a = window.getSelection()) == null ? void 0 : _a.removeAllRanges();
      }
      window.parent.postMessage(
        {
          type: `staktrak-selection-mode-${isActive ? "started" : "ended"}`
        },
        "*"
      );
    }
    processResults() {
      if (this.config.timeCount && this.results.time) {
        this.results.time.completedAt = getTimeStamp();
        this.results.time.totalSeconds = (this.results.time.completedAt - this.results.time.startedAt) / 1e3;
      }
      this.results.clicks.clickDetails = filterClickDetails(
        this.results.clicks.clickDetails,
        this.memory.assertions,
        this.config
      );
      this.results.assertions = this.memory.assertions;
      window.parent.postMessage(
        { type: "staktrak-results", data: this.results },
        "*"
      );
      this.config.processData(this.results);
      if (this.config.clearAfterProcess) {
        this.resetResults();
      }
    }
    stop() {
      if (!this.isRunning) {
        console.log("StakTrak is not running");
        return this;
      }
      this.cleanup();
      this.processResults();
      this.isRunning = false;
      return this;
    }
    result() {
      return this.results;
    }
    showConfig() {
      return this.config;
    }
    addAssertion(type, selector, value = "") {
      this.memory.assertions.push({
        type,
        selector,
        value,
        timestamp: getTimeStamp()
      });
    }
  };
  var userBehaviour = new UserBehaviorTracker();
  var initializeStakTrak = () => {
    userBehaviour.makeConfig({
      processData: (results) => console.log("StakTrak recording processed:", results)
    }).listen();
  };
  document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", initializeStakTrak) : initializeStakTrak();
  var src_default = userBehaviour;
  return __toCommonJS(src_exports);
})();
