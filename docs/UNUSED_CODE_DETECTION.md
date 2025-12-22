# Unused Code Detection

This project uses [knip](https://knip.dev/) to detect unused files, exports, dependencies, and more.

## Usage

### Check for unused code locally

```bash
npm run lint:unused
```

This will scan your codebase and report:
- Unused files
- Unused exports
- Unused dependencies
- Unused types
- Duplicate exports
- And more...

### Check only production dependencies

```bash
npm run lint:unused:production
```

This checks only production code, ignoring dev dependencies and test files.

### Run all linters

```bash
npm run lint:all
```

This runs both ESLint and knip checks.

## Configuration

The knip configuration is in `knip.json`. It's configured to:

- Scan `src/` and `scripts/` directories
- Ignore test files and build outputs
- Support Next.js app structure
- Exclude type definition packages from unused dependency checks

## GitHub Actions

The unused code check runs automatically on:
- Push to `main` or `develop` branches
- Pull requests to `main` or `develop` branches

If unused code is detected, the CI will fail and comment on the PR.

## Fixing Issues

When knip reports unused code:

1. **Unused exports**: Remove the export or mark it as used if it's part of your public API
2. **Unused files**: Delete the file or add it to entry points in `knip.json`
3. **Unused dependencies**: Remove from `package.json` with `npm uninstall <package>`
4. **False positives**: Add to the `ignore` array in `knip.json`

## Example Output

```
✓ 125 files
✓ 892 exports
✓ 67 dependencies
✖ 3 unused files
✖ 12 unused exports
✖ 2 unused dependencies
```

## Tips

- Run `npm run lint:unused` before committing
- Use `// @ts-expect-error` or `// eslint-disable-next-line` sparingly
- Keep your codebase clean by removing unused code regularly
- Some exports might be used externally - use `ignoreExportsUsedInFile` option

## Resources

- [knip Documentation](https://knip.dev/)
- [knip Configuration Options](https://knip.dev/reference/configuration)
