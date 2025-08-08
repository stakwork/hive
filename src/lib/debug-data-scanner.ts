// Debug Data Scanner - Comprehensive testing utility for debug injection verification
// This utility scans all DOM elements and verifies debug data injection coverage

export interface DebugDataResult {
  element: Element;
  tagName: string;
  className: string;
  id: string;
  // Data attribute sources
  dataSource?: string;
  dataLine?: number;
  dataColumn?: number;
  // React fiber sources
  fiberSource?: {
    fileName?: string;
    lineNumber?: number;
    columnNumber?: number;
  };
  // Element positioning
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
    visible: boolean;
  };
  // Additional context
  textContent?: string;
  hasChildren: boolean;
  depth: number;
}

export interface ScanResults {
  totalElements: number;
  elementsWithDataAttrs: number;
  elementsWithFiberSources: number;
  elementsWithAnyDebugData: number;
  coverage: number; // percentage
  sourceFiles: Map<string, Set<number>>; // file -> line numbers
  results: DebugDataResult[];
  summary: {
    topSourceFiles: Array<{
      file: string;
      lineCount: number;
      elements: number;
    }>;
    missingDebugData: number;
    duplicateElements: number;
  };
}

/**
 * Extract React fiber debug source information from a DOM element
 * (Duplicated from dom-inspector.ts for standalone usage)
 */
function extractReactDebugSource(
  element: Element,
): { fileName?: string; lineNumber?: number; columnNumber?: number } | null {
  try {
    // Find React fiber key
    const fiberKey = Object.keys(element).find(
      (key) =>
        key.startsWith("__reactFiber$") ||
        key.startsWith("__reactInternalInstance$"),
    );

    if (!fiberKey) {
      return null;
    }

    // @ts-expect-error - Accessing React internals
    let fiber = element[fiberKey];
    let level = 0;

    // Get max traversal depth from env variable, default to 10
    const maxTraversalDepth =
      Number(process.env.NEXT_PUBLIC_REACT_FIBER_TRAVERSAL_DEPTH) || 10;

    // Helper to extract source from an object
    const extractSource = (
      source: {
        fileName?: string;
        lineNumber?: number;
        columnNumber?: number;
      } | null,
    ) => {
      if (!source) return null;
      return {
        fileName: source.fileName,
        lineNumber: source.lineNumber,
        columnNumber: source.columnNumber,
      };
    };

    // Traverse up the fiber tree to find debug source
    while (fiber && level < maxTraversalDepth) {
      // Check various locations where source info might be stored
      const source =
        fiber._debugSource ||
        fiber.memoizedProps?.__source ||
        fiber.pendingProps?.__source;

      if (source) {
        return extractSource(source);
      }

      // Go up the component tree
      fiber = fiber.return;
      level++;
    }

    return null;
  } catch (error) {
    console.error("Error extracting React debug source:", error);
    return null;
  }
}

/**
 * Get element depth in DOM tree
 */
function getElementDepth(element: Element): number {
  let depth = 0;
  let parent = element.parentElement;
  while (parent) {
    depth++;
    parent = parent.parentElement;
  }
  return depth;
}

/**
 * Check if element is visible
 */
function isElementVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);

  return (
    rect.width > 0 &&
    rect.height > 0 &&
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0"
  );
}

/**
 * Scan all DOM elements for debug data injection
 */
export function scanDebugDataInjection(
  options: {
    includeInvisible?: boolean;
    maxElements?: number;
    verbose?: boolean;
  } = {},
): ScanResults {
  const {
    includeInvisible = false,
    maxElements = 10000,
    verbose = false,
  } = options;

  console.time("Debug Data Scan");

  // Get all elements in the document
  const allElements = Array.from(document.querySelectorAll("*"));
  const elementsToScan = allElements.slice(0, maxElements);

  const results: DebugDataResult[] = [];
  const sourceFiles = new Map<string, Set<number>>();
  let elementsWithDataAttrs = 0;
  let elementsWithFiberSources = 0;

  if (verbose) {
    console.log(`Scanning ${elementsToScan.length} elements for debug data...`);
  }

  for (const element of elementsToScan) {
    const rect = element.getBoundingClientRect();
    const isVisible = isElementVisible(element);

    // Skip invisible elements if requested
    if (!includeInvisible && !isVisible) {
      continue;
    }

    // Extract data attributes
    const dataSource =
      element.getAttribute("data-source") ||
      element.getAttribute("data-inspector-relative-path");
    const dataLineAttr =
      element.getAttribute("data-line") ||
      element.getAttribute("data-inspector-line");
    const dataColumnAttr =
      element.getAttribute("data-column") ||
      element.getAttribute("data-inspector-column");

    const dataLine = dataLineAttr ? parseInt(dataLineAttr, 10) : undefined;
    const dataColumn = dataColumnAttr
      ? parseInt(dataColumnAttr, 10)
      : undefined;

    // Extract React fiber debug source
    const fiberSource = extractReactDebugSource(element);

    // Track source files
    if (dataSource && dataLine) {
      if (!sourceFiles.has(dataSource)) {
        sourceFiles.set(dataSource, new Set());
      }
      sourceFiles.get(dataSource)!.add(dataLine);
      elementsWithDataAttrs++;
    }

    if (fiberSource?.fileName && fiberSource?.lineNumber) {
      if (!sourceFiles.has(fiberSource.fileName)) {
        sourceFiles.set(fiberSource.fileName, new Set());
      }
      sourceFiles.get(fiberSource.fileName)!.add(fiberSource.lineNumber);
      elementsWithFiberSources++;
    }

    // Only include elements that have some debug data
    const hasDebugData = !!(dataSource || fiberSource);

    if (hasDebugData || verbose) {
      const result: DebugDataResult = {
        element,
        tagName: element.tagName.toLowerCase(),
        className: element.className.toString(),
        id: element.id,
        dataSource: dataSource || undefined,
        dataLine,
        dataColumn,
        fiberSource: fiberSource || undefined,
        bounds: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height,
          visible: isVisible,
        },
        textContent: element.textContent?.slice(0, 100), // Truncate for readability
        hasChildren: element.children.length > 0,
        depth: getElementDepth(element),
      };

      results.push(result);
    }
  }

  // Calculate summary statistics
  const elementsWithAnyDebugData = new Set([
    ...results.filter((r) => r.dataSource).map((r) => r.element),
    ...results.filter((r) => r.fiberSource).map((r) => r.element),
  ]).size;

  const coverage = (elementsWithAnyDebugData / elementsToScan.length) * 100;

  // Top source files by line count and element count
  const topSourceFiles = Array.from(sourceFiles.entries())
    .map(([file, lines]) => ({
      file,
      lineCount: lines.size,
      elements: results.filter(
        (r) => r.dataSource === file || r.fiberSource?.fileName === file,
      ).length,
    }))
    .sort((a, b) => b.lineCount - a.lineCount)
    .slice(0, 10);

  const scanResults: ScanResults = {
    totalElements: elementsToScan.length,
    elementsWithDataAttrs,
    elementsWithFiberSources,
    elementsWithAnyDebugData,
    coverage,
    sourceFiles,
    results,
    summary: {
      topSourceFiles,
      missingDebugData: elementsToScan.length - elementsWithAnyDebugData,
      duplicateElements: results.length - elementsWithAnyDebugData, // Elements with both data and fiber sources
    },
  };

  console.timeEnd("Debug Data Scan");

  return scanResults;
}

/**
 * Pretty print scan results to console
 */
export function logScanResults(
  results: ScanResults,
  options: {
    includeDetails?: boolean;
    includeElementList?: boolean;
  } = {},
) {
  const { includeDetails = true, includeElementList = false } = options;

  console.group("🔍 Debug Data Injection Scan Results");

  // Summary
  console.log(`📊 Summary:`);
  console.log(`  Total Elements Scanned: ${results.totalElements}`);
  console.log(
    `  Elements with Data Attributes: ${results.elementsWithDataAttrs}`,
  );
  console.log(
    `  Elements with Fiber Sources: ${results.elementsWithFiberSources}`,
  );
  console.log(
    `  Elements with Any Debug Data: ${results.elementsWithAnyDebugData}`,
  );
  console.log(`  Coverage: ${results.coverage.toFixed(2)}%`);
  console.log(
    `  Missing Debug Data: ${results.summary.missingDebugData} elements`,
  );

  if (includeDetails) {
    // Source files
    console.log(`\n📁 Source Files (${results.sourceFiles.size} files):`);
    results.summary.topSourceFiles.forEach((file, index) => {
      console.log(`  ${index + 1}. ${file.file}`);
      console.log(`     Lines: ${file.lineCount}, Elements: ${file.elements}`);
    });

    // Coverage analysis
    const coverageColor =
      results.coverage > 80
        ? "green"
        : results.coverage > 50
          ? "orange"
          : "red";
    console.log(`\n📈 Coverage Analysis:`);
    console.log(
      `%c  ${results.coverage.toFixed(2)}% of elements have debug data`,
      `color: ${coverageColor}; font-weight: bold`,
    );

    if (results.coverage < 100) {
      console.log(
        `  ⚠️  ${results.summary.missingDebugData} elements are missing debug data`,
      );

      // Show some examples of elements without debug data
      const elementsWithoutDebugData = results.results.filter(
        (r) => !r.dataSource && !r.fiberSource,
      );
      if (elementsWithoutDebugData.length > 0) {
        console.log(`  Examples of elements without debug data:`);
        elementsWithoutDebugData.slice(0, 5).forEach((r) => {
          console.log(
            `    ${r.tagName}${r.className ? "." + r.className.split(" ")[0] : ""}${r.id ? "#" + r.id : ""}`,
          );
        });
      }
    }
  }

  if (includeElementList) {
    console.log(`\n📋 Element Details:`);
    console.table(
      results.results.map((r) => ({
        tag: r.tagName,
        class: r.className.split(" ")[0] || "",
        id: r.id || "",
        dataSource: r.dataSource || "",
        dataLine: r.dataLine || "",
        fiberFile: r.fiberSource?.fileName?.split("/").pop() || "",
        fiberLine: r.fiberSource?.lineNumber || "",
        visible: r.bounds.visible,
        depth: r.depth,
      })),
    );
  }

  console.groupEnd();

  return results;
}

/**
 * Run a quick scan and log results - for console usage
 */
export function quickDebugScan(verbose = false) {
  const results = scanDebugDataInjection({ verbose, maxElements: 5000 });
  return logScanResults(results, {
    includeDetails: true,
    includeElementList: verbose,
  });
}

/**
 * Export scan results as JSON for further analysis
 */
export function exportScanResults(results: ScanResults) {
  const exportData = {
    timestamp: new Date().toISOString(),
    url: window.location.href,
    userAgent: navigator.userAgent,
    ...results,
    // Convert Map to object for JSON serialization
    sourceFiles: Object.fromEntries(
      Array.from(results.sourceFiles.entries()).map(([file, lines]) => [
        file,
        Array.from(lines),
      ]),
    ),
    // Remove element references for JSON serialization
    results: results.results.map((r) => ({
      ...r,
      element: `${r.tagName}${r.className ? "." + r.className.split(" ")[0] : ""}${r.id ? "#" + r.id : ""}`,
    })),
  };

  const dataStr = JSON.stringify(exportData, null, 2);
  const dataUri =
    "data:application/json;charset=utf-8," + encodeURIComponent(dataStr);

  const exportFileDefaultName = `debug-scan-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.json`;

  const linkElement = document.createElement("a");
  linkElement.setAttribute("href", dataUri);
  linkElement.setAttribute("download", exportFileDefaultName);
  linkElement.click();

  console.log("📥 Scan results exported to:", exportFileDefaultName);
}

// Make functions available globally for console usage
if (typeof window !== "undefined") {
  // @ts-expect-error - Adding to window for console access
  window.debugScan = {
    scan: scanDebugDataInjection,
    log: logScanResults,
    quick: quickDebugScan,
    export: exportScanResults,
  };

  console.log("🔧 Debug scanner available globally:");
  console.log("  debugScan.quick() - Run quick scan and log results");
  console.log("  debugScan.quick(true) - Run verbose quick scan");
  console.log("  debugScan.scan() - Run full scan");
  console.log("  debugScan.log(results) - Log scan results");
  console.log("  debugScan.export(results) - Export results to JSON");
}
