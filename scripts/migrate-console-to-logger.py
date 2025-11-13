#!/usr/bin/env python3
"""
Migrate console.log/warn/error/info/debug to logger utility
Excludes test files and node_modules
"""

import re
import os
import sys
from pathlib import Path
from typing import List, Tuple

def find_files_with_console(root_dir: Path) -> List[Path]:
    """Find all TypeScript files with console statements"""
    import subprocess
    
    try:
        result = subprocess.run(
            [
                'rg', 'console\\.(log|info|warn|error|debug)',
                '-g', '*.ts',
                '-g', '*.tsx',
                '-g', '!*.test.ts',
                '-g', '!*.spec.ts',
                '-g', '!**/__tests__/**',
                '-g', '!node_modules',
                '-g', '!.next',
                '-g', '!dist',
                '-g', '!build',
                '-l',
                str(root_dir / 'src')
            ],
            capture_output=True,
            text=True,
            check=False
        )
        
        if result.returncode == 0:
            return [Path(f) for f in result.stdout.strip().split('\n') if f]
        return []
    except FileNotFoundError:
        print("Error: ripgrep (rg) not found. Please install it first.")
        sys.exit(1)

def get_import_path(file_path: Path, root_dir: Path) -> str:
    """Determine the correct import path for logger"""
    # Always use @/lib/logger for consistency with project setup
    return "@/lib/logger"

def add_logger_import(content: str, import_path: str) -> str:
    """Add logger import if not already present"""
    if 'from ' in content and 'logger' in content:
        # Already has logger import
        return content
    
    # Find the last import statement
    lines = content.split('\n')
    last_import_idx = -1
    
    for i, line in enumerate(lines):
        if line.strip().startswith('import '):
            last_import_idx = i
    
    import_statement = f'import {{ logger }} from "{import_path}";'
    
    if last_import_idx >= 0:
        # Insert after last import
        lines.insert(last_import_idx + 1, import_statement)
    else:
        # No imports, add at top (after any comments)
        insert_idx = 0
        for i, line in enumerate(lines):
            if line.strip() and not line.strip().startswith('//') and not line.strip().startswith('/*'):
                insert_idx = i
                break
        lines.insert(insert_idx, import_statement)
    
    return '\n'.join(lines)

def get_context_name(file_path: Path) -> str:
    """Get a meaningful context name from file path"""
    # Remove extension and get just the filename
    name = file_path.stem
    # Get parent directory name for context
    parent = file_path.parent.name
    
    if parent in ['src', 'lib', 'components', 'hooks', 'services', 'stores', 'utils']:
        return name
    return f"{parent}/{name}"

def migrate_console_statements(content: str, context: str) -> Tuple[str, int]:
    """Replace console statements with logger calls"""
    replacements = 0
    
    # Pattern 1: console.error("message")
    pattern1 = r'console\.(error|warn|info|debug)\s*\(\s*["\']([^"\']+)["\']\s*\)'
    def repl1(match):
        nonlocal replacements
        replacements += 1
        level = match.group(1)
        if level == 'log':
            level = 'debug'
        message = match.group(2)
        return f'logger.{level}("{message}", "{context}")'
    content = re.sub(pattern1, repl1, content)
    
    # Pattern 2: console.log("message", data)
    pattern2 = r'console\.(log|error|warn|info|debug)\s*\(\s*["\']([^"\']+)["\']\s*,\s*([^)]+)\)'
    def repl2(match):
        nonlocal replacements
        replacements += 1
        level = match.group(1)
        if level == 'log':
            level = 'debug'
        message = match.group(2)
        data = match.group(3).strip()
        return f'logger.{level}("{message}", "{context}", {{ {data} }})'
    content = re.sub(pattern2, repl2, content)
    
    # Pattern 3: console.log(variable) -> logger.debug("Log", "Context", { data: variable })
    pattern3 = r'console\.(log|error|warn|info|debug)\s*\(\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\)'
    def repl3(match):
        nonlocal replacements
        replacements += 1
        level = match.group(1)
        if level == 'log':
            level = 'debug'
        var_name = match.group(2)
        return f'logger.{level}("Debug output", "{context}", {{ {var_name} }})'
    content = re.sub(pattern3, repl3, content)
    
    # Pattern 4: console.log with template literals
    pattern4 = r'console\.(log|error|warn|info|debug)\s*\(\s*`([^`]+)`\s*\)'
    def repl4(match):
        nonlocal replacements
        replacements += 1
        level = match.group(1)
        if level == 'log':
            level = 'debug'
        message = match.group(2)
        return f'logger.{level}(`{message}`, "{context}")'
    content = re.sub(pattern4, repl4, content)
    
    return content, replacements

def process_file(file_path: Path, root_dir: Path) -> Tuple[bool, int]:
    """Process a single file"""
    try:
        # Read file
        with open(file_path, 'r', encoding='utf-8') as f:
            content = f.read()
        
        original_content = content
        
        # Get context name
        context = get_context_name(file_path)
        
        # Add logger import if needed
        import_path = get_import_path(file_path, root_dir)
        content = add_logger_import(content, import_path)
        
        # Migrate console statements
        content, replacements = migrate_console_statements(content, context)
        
        # Only write if changes were made
        if content != original_content:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(content)
            return True, replacements
        
        return False, 0
        
    except Exception as e:
        print(f"  ❌ Error processing {file_path}: {e}")
        return False, 0

def main():
    root_dir = Path(__file__).parent.parent
    
    print("🔍 Finding files with console statements...")
    files = find_files_with_console(root_dir)
    
    if not files:
        print("✅ No files with console statements found!")
        return
    
    total_files = len(files)
    print(f"📝 Found console statements in {total_files} files\n")
    
    modified = 0
    total_replacements = 0
    
    for i, file_path in enumerate(files, 1):
        rel_path = file_path.relative_to(root_dir)
        print(f"[{i}/{total_files}] Processing: {rel_path}")
        
        success, replacements = process_file(file_path, root_dir)
        
        if success:
            print(f"  ✓ Replaced {replacements} console statements")
            modified += 1
            total_replacements += replacements
        else:
            print(f"  ⏭ Skipped (no changes needed)")
    
    print("\n" + "="*50)
    print("✅ Migration complete!")
    print("="*50)
    print(f"  📊 Total files: {total_files}")
    print(f"  ✓ Modified: {modified}")
    print(f"  🔄 Total replacements: {total_replacements}")
    print(f"  ⏭ Skipped: {total_files - modified}")
    print("\n🔍 Checking for remaining console statements...")
    
    # Check remaining
    remaining = find_files_with_console(root_dir)
    if remaining:
        print(f"⚠️  {len(remaining)} files still have console statements")
        print("   These may require manual migration due to complex patterns:")
        for f in remaining[:10]:
            print(f"   - {f.relative_to(root_dir)}")
        if len(remaining) > 10:
            print(f"   ... and {len(remaining) - 10} more")
    else:
        print("🎉 All console statements have been migrated!")

if __name__ == '__main__':
    main()
