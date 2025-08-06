# DOM Inspector & Debug Features

The DOM Inspector is a powerful development tool in Hive that helps identify React components and analyze their source mappings when working with browser artifacts. It provides both interactive debugging capabilities and comprehensive diagnostic tools.

## Overview

The DOM Inspector works by injecting source mapping information into React components during development. This allows you to:

- Identify which React component corresponds to any DOM element
- View the exact source file and line number for components
- Debug component hierarchies and structures
- Analyze debug data injection coverage across your application

## Enabling Debug Mode

### Prerequisites

Debug mode requires Babel transformation instead of Turbopack:

```bash
npm run dev:debug
```

This enables the `@react-dev-inspector/babel-plugin` which injects source mapping data into your React components.

### Environment Variables

```env
# Required for debug mode
NEXT_PUBLIC_DEBUG_MODE=true

# Optional: Enable debug scanner UI button
NEXT_PUBLIC_DEBUG_SCANNER_ENABLED=false
```

## Interactive Debug Features

### Activating Debug Mode

1. Run `npm run dev:debug`
2. Navigate to any task with browser artifacts
3. Click the Bug icon in the browser panel toolbar
4. Debug mode overlay will appear on the browser preview

### Click Mode

**Usage**: Click directly on any element in the browser preview

**What happens**:
- Identifies the specific React component at that exact location
- Extracts source file path and line number
- Sends debug information to the chat input as an attachment
- Shows component hierarchy if multiple components overlap

**Best for**: Identifying specific components, buttons, text elements, or small UI pieces

### Selection Mode  

**Usage**: Click and drag to select a rectangular area

**What happens**:
- Analyzes ALL components within the selected rectangle
- Collects source mapping from every React component in that region
- Aggregates results by source file with line numbers
- Sends comprehensive debug report to chat

**Best for**: Analyzing component composition in layouts, forms, or complex UI sections

### Debug Information Format

Debug results include:
- **Source file path**: Relative path from project root
- **Line numbers**: Specific lines where components are defined  
- **Component context**: Element type and CSS classes for identification
- **Coordinates**: Click point or selection area for reference

## Technical Implementation

### Source Mapping Injection

The system uses two methods to inject debug information:

1. **Data Attributes** (Primary)
   ```html
   <div data-inspector-relative-path="src/components/ui/button.tsx" 
        data-inspector-line="45">
   ```

2. **React Fiber Properties** (Fallback)
   ```javascript
   fiber._debugSource = {
     fileName: "src/components/ui/button.tsx",
     lineNumber: 45,
     columnNumber: 12
   }
   ```

### Cross-iframe Communication

Debug functionality works across iframe boundaries using `postMessage` API:

1. Parent frame sends debug request with coordinates
2. Iframe receives request and scans DOM elements
3. Source mapping is extracted and processed
4. Results are sent back to parent frame
5. Debug artifact is created and attached to chat

## Debug Data Scanner

### Purpose

The Debug Data Scanner is a diagnostic tool that verifies debug data injection is working correctly across your entire application. It provides coverage analysis and identifies potential issues with source mapping.

### Console Access

Available in browser console when running debug mode:

```javascript
// Quick coverage summary
debugScan.quick()

// Verbose output with details
debugScan.quick(true)

// Full programmatic access
const results = debugScan.scan()
debugScan.log(results)
debugScan.export(results)  // Download JSON report
```

### Coverage Analysis

#### Interpreting Results

**Good Coverage: 30-60%**
```
Total Elements Scanned: 225
Elements with Debug Data: 92
Coverage: 40.89%
Source files found: 5
```

This indicates healthy debug injection - React components have source mapping while non-React DOM elements (text nodes, pure HTML) don't.

**Key Metrics**:
- **Coverage percentage**: Proportion of elements with debug data
- **Source files count**: Should match visible component files
- **Elements breakdown**: Data attributes vs React fiber sources

#### Expected Elements WITHOUT Debug Data

Normal elements that won't have source mapping:
- Text nodes and whitespace
- Pure HTML elements not created by React
- Third-party library components  
- CSS pseudo-elements
- Dynamically injected content
- SVG elements
- Style and script tags

#### Warning Signs

**Red Flags**:
- Coverage < 10% (Babel plugin not working)
- 0 source files found (Debug injection broken)
- All components at line 1 (Source maps misconfigured)
- Only node_modules paths (Build configuration issue)

### UI Scanner Button

When `NEXT_PUBLIC_DEBUG_SCANNER_ENABLED=true`:

1. Magnifying glass icon appears in browser toolbar
2. Click to trigger comprehensive scan
3. Results logged to console
4. Falls back to direct scan if cross-iframe communication fails

## Troubleshooting

### Debug Mode Not Working

**Check Prerequisites**:
1. Running `npm run dev:debug` (not `npm run dev`)  
2. `NEXT_PUBLIC_DEBUG_MODE=true` in environment
3. Babel configuration includes `@react-dev-inspector/babel-plugin`

**Verify Installation**:
```bash
npm list @react-dev-inspector/babel-plugin
```

**Manual Verification**:
1. Open React DevTools
2. Select a component  
3. Look for `_debugSource` in component data
4. Right-click element → Inspect → Look for `data-inspector-*` attributes

### Low Scanner Coverage

**Common Causes**:
- Turbopack mode instead of Babel (`npm run dev` vs `npm run dev:debug`)
- Missing Babel plugin configuration
- Components not properly instrumented

**Diagnostic Steps**:
```javascript
// Check what types of elements are missing debug data
debugScan.quick(true)  // Look at examples in output
```

### Cross-iframe Issues  

**Symptoms**: "Direct scan fallback" message in console

**Solutions**:
1. Check for CORS errors in browser console
2. Verify iframe and parent on same origin  
3. Use direct console commands instead of UI button

## Advanced Usage

### Custom Scanning
```javascript
// Include hidden elements and scan more elements
const results = debugScan.scan({
  includeInvisible: true,
  maxElements: 5000,
  verbose: true
})

// Filter for specific patterns
const reactComponents = results.results.filter(r => r.dataSource || r.fiberSource)
```

### Integration with Testing
```javascript
// Add coverage checks to test suite
describe('Debug Data Injection', () => {
  it('should have adequate coverage', () => {
    const results = debugScan.scan()
    expect(results.coverage).toBeGreaterThan(20)
    expect(results.sourceFiles.size).toBeGreaterThan(0)
  })
})
```

### Performance Considerations

- Scanner defaults to 10,000 element limit
- Typical scan time: 5-50ms
- Use `maxElements` option for large pages
- Invisible elements skipped by default

## Development Workflow

### Typical Debug Session

1. **Setup**: Run `npm run dev:debug`
2. **Navigate**: Go to task with browser artifacts  
3. **Activate**: Click Bug icon to enable debug mode
4. **Investigate**: Click/drag on problematic elements
5. **Analyze**: Review source files and line numbers in chat
6. **Verify**: Use `debugScan.quick()` to check overall coverage

### Best Practices

- Use click mode for specific element identification
- Use selection mode for analyzing component layouts
- Run scanner periodically to verify debug injection health
- Keep debug mode disabled in production builds
- Export scanner results for debugging build issues