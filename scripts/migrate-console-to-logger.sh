#!/bin/bash

# Script to migrate console.log/warn/error/info/debug to logger utility
# Excludes test files and node_modules

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

echo "🔍 Finding files with console statements..."

# Get list of files with console statements (excluding tests and node_modules)
FILES=$(rg "console\.(log|info|warn|error|debug)" \
  -g '*.ts' \
  -g '*.tsx' \
  -g '!*.test.ts' \
  -g '!*.spec.ts' \
  -g '!**/__tests__/**' \
  -g '!node_modules' \
  -g '!.next' \
  -g '!dist' \
  -g '!build' \
  "$PROJECT_ROOT/src/" \
  -l | sort)

TOTAL_FILES=$(echo "$FILES" | wc -l)
echo "📝 Found console statements in $TOTAL_FILES files"

CURRENT=0
MODIFIED=0
SKIPPED=0

for FILE in $FILES; do
  CURRENT=$((CURRENT + 1))
  echo ""
  echo "[$CURRENT/$TOTAL_FILES] Processing: ${FILE#$PROJECT_ROOT/}"
  
  # Skip if file already imports logger
  if grep -q "from.*['\"].*logger['\"]" "$FILE" 2>/dev/null; then
    echo "  ✓ Already has logger import"
  else
    # Determine import path based on file location
    RELATIVE_PATH=$(realpath --relative-to="$(dirname "$FILE")" "$PROJECT_ROOT/src/lib/logger.ts")
    IMPORT_PATH=$(echo "$RELATIVE_PATH" | sed 's/\.ts$//' | sed 's|^\.\./||' | sed 's|^|@/|' | sed 's|src/||')
    
    # For files in src/lib, use relative import
    if [[ "$FILE" == *"/src/lib/"* ]]; then
      DEPTH=$(echo "${FILE#$PROJECT_ROOT/src/lib/}" | tr -cd '/' | wc -c)
      REL_IMPORT=""
      for ((i=0; i<DEPTH; i++)); do
        REL_IMPORT="../$REL_IMPORT"
      done
      IMPORT_PATH="${REL_IMPORT}logger"
    else
      IMPORT_PATH="@/lib/logger"
    fi
    
    # Add import after last import statement
    if grep -q "^import" "$FILE"; then
      # Find the last import line and add after it
      LAST_IMPORT_LINE=$(grep -n "^import" "$FILE" | tail -1 | cut -d: -f1)
      sed -i "${LAST_IMPORT_LINE}a import { logger } from \"${IMPORT_PATH}\";" "$FILE"
      echo "  + Added logger import: ${IMPORT_PATH}"
    else
      # No imports, add at the top
      sed -i "1i import { logger } from \"${IMPORT_PATH}\";" "$FILE"
      echo "  + Added logger import at top"
    fi
  fi
  
  # Count console statements before
  BEFORE_COUNT=$(grep -c "console\." "$FILE" 2>/dev/null || echo "0")
  
  if [ "$BEFORE_COUNT" -eq 0 ]; then
    echo "  ℹ No console statements to replace"
    SKIPPED=$((SKIPPED + 1))
    continue
  fi
  
  # Create backup
  cp "$FILE" "${FILE}.bak"
  
  # Determine context from file path
  CONTEXT=$(basename "$(dirname "$FILE")")/$(basename "$FILE" | sed 's/\.[^.]*$//')
  
  # Replace console.error with logger.error
  # Pattern: console.error("message", data) -> logger.error("message", "Context", { data })
  # Pattern: console.error("message") -> logger.error("message", "Context")
  
  # Simple messages with string literals
  perl -i -pe 's/console\.error\("([^"]+)"\);/logger.error("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.error\('\''([^'\'']+)'\''\);/logger.error("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.error\(`([^`]+)`\);/logger.error("$1", "'"$CONTEXT"'");/g' "$FILE"
  
  # Messages with data - convert to object syntax
  perl -i -pe 's/console\.error\("([^"]+)",\s*([^)]+)\);/logger.error("$1", "'"$CONTEXT"'", { data: $2 });/g' "$FILE"
  perl -i -pe 's/console\.error\('\''([^'\'']+)'\'',\s*([^)]+)\);/logger.error("$1", "'"$CONTEXT"'", { data: $2 });/g' "$FILE"
  
  # Replace console.warn with logger.warn
  perl -i -pe 's/console\.warn\("([^"]+)"\);/logger.warn("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.warn\('\''([^'\'']+)'\''\);/logger.warn("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.warn\(`([^`]+)`\);/logger.warn("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.warn\("([^"]+)",\s*([^)]+)\);/logger.warn("$1", "'"$CONTEXT"'", { data: $2 });/g' "$FILE"
  
  # Replace console.log with logger.debug
  perl -i -pe 's/console\.log\("([^"]+)"\);/logger.debug("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.log\('\''([^'\'']+)'\''\);/logger.debug("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.log\(`([^`]+)`\);/logger.debug("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.log\("([^"]+)",\s*([^)]+)\);/logger.debug("$1", "'"$CONTEXT"'", { data: $2 });/g' "$FILE"
  
  # Replace console.info with logger.info  
  perl -i -pe 's/console\.info\("([^"]+)"\);/logger.info("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.info\('\''([^'\'']+)'\''\);/logger.info("$1", "'"$CONTEXT"'");/g' "$FILE"
  perl -i -pe 's/console\.info\(`([^`]+)`\);/logger.info("$1", "'"$CONTEXT"'");/g' "$FILE"
  
  # Replace console.debug with logger.debug
  perl -i -pe 's/console\.debug\("([^"]+)"\);/logger.debug("$1", "'"$CONTEXT"'");/g' "$FILE"
  
  # Count console statements after
  AFTER_COUNT=$(grep -c "console\." "$FILE" 2>/dev/null || echo "0")
  REPLACED=$((BEFORE_COUNT - AFTER_COUNT))
  
  if [ "$REPLACED" -gt 0 ]; then
    echo "  ✓ Replaced $REPLACED console statements"
    MODIFIED=$((MODIFIED + 1))
    rm "${FILE}.bak"
  else
    echo "  ⚠ No automatic replacements (complex patterns detected)"
    echo "    Please review manually: $FILE"
    mv "${FILE}.bak" "$FILE"
    SKIPPED=$((SKIPPED + 1))
  fi
done

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ Migration complete!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  📊 Total files: $TOTAL_FILES"
echo "  ✓ Modified: $MODIFIED"
echo "  ⏭ Skipped: $SKIPPED"
echo ""
echo "🔍 Remaining console statements:"
rg "console\.(log|info|warn|error|debug)" \
  -g '*.ts' \
  -g '*.tsx' \
  -g '!*.test.ts' \
  -g '!*.spec.ts' \
  -g '!**/__tests__/**' \
  -g '!node_modules' \
  -g '!.next' \
  "$PROJECT_ROOT/src/" \
  --count-matches | head -20 || echo "  🎉 None found!"
echo ""
echo "⚠️  Note: Complex console statements may require manual migration"
echo "   Check files with remaining console.* calls"
