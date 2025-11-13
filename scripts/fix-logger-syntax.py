#!/usr/bin/env python3
"""
Fix double brace syntax errors in logger calls.
Changes logger.error("msg", { { x }}) to logger.error("msg", { x })
And changes logger.error("msg", { data.error }) to logger.error("msg", { error: data.error })
"""

import re
import subprocess
from pathlib import Path
from typing import List

def find_files_with_errors(root_dir: Path) -> List[Path]:
    """Find all TypeScript files with double brace errors"""
    try:
        # Find files with {{ pattern
        result1 = subprocess.run(
            ['rg', '-l', r'logger\.(error|warn|info|debug).*\{\s*\{', str(root_dir / 'src')],
            capture_output=True,
            text=True,
            check=False
        )
        files1 = set(Path(f.strip()) for f in result1.stdout.strip().split('\n') if f.strip())
        
        # Find files with property access in object literals like { data.error }
        result2 = subprocess.run(
            ['rg', '-l', r'logger\.(error|warn|info|debug).*\{[^}]*\.[^}]*\}', str(root_dir / 'src')],
            capture_output=True,
            text=True,
            check=False
        )
        files2 = set(Path(f.strip()) for f in result2.stdout.strip().split('\n') if f.strip())
        
        return list(files1 | files2)
    except Exception as e:
        print(f"Error finding files: {e}")
        return []

def fix_logger_syntax(content: str) -> tuple[str, int]:
    """
    Fix logger syntax errors.
    """
    replacements = 0
    
    # Fix pattern: { { x: value }), ... } -> { x: value, ... }
    # This handles the double brace issue
    pattern1 = r'(logger\.(error|warn|info|debug)\([^,]+,\s*)\{\s*\{([^}]+)\}\s*,([^}]+)\}'
    
    def replace1(match):
        nonlocal replacements
        replacements += 1
        return f'{match.group(1)}{{ {match.group(3)}, {match.group(4)} }}'
    
    content = re.sub(pattern1, replace1, content)
    
    # Fix pattern: { data.error } -> { error: data.error }
    # Match logger.METHOD("...", { identifier.property })
    pattern2 = r'(logger\.(error|warn|info|debug)\([^,]+,\s*)\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z_][a-zA-Z0-9_]*)\s*\}'
    
    def replace2(match):
        nonlocal replacements
        replacements += 1
        prop = match.group(4)
        full_path = f'{match.group(3)}.{match.group(4)}'
        return f'{match.group(1)}{{ {prop}: {full_path} }}'
    
    content = re.sub(pattern2, replace2, content)
    
    # Fix pattern: { distance.toFixed(1) } -> { distance: distance.toFixed(1) }
    pattern3 = r'(logger\.(error|warn|info|debug)\([^,]+,\s*)\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\.([a-zA-Z0-9_]+\([^)]*\))\s*\}'
    
    def replace3(match):
        nonlocal replacements
        replacements += 1
        var_name = match.group(3)
        method_call = f'{var_name}.{match.group(4)}'
        return f'{match.group(1)}{{ {var_name}: {method_call} }}'
    
    content = re.sub(pattern3, replace3, content)
    
    return content, replacements

def process_file(file_path: Path) -> tuple[bool, int]:
    """Process a single file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        new_content, replacements = fix_logger_syntax(original_content)
        
        if replacements > 0:
            with open(file_path, 'w', encoding='utf-8') as f:
                f.write(new_content)
            return True, replacements
        
        return False, 0
        
    except Exception as e:
        print(f"Error processing {file_path}: {e}")
        return False, 0

def main():
    root_dir = Path('/workspaces/hive')
    
    print("Finding TypeScript files with logger syntax errors...")
    files = find_files_with_errors(root_dir)
    print(f"Found {len(files)} files with potential errors\n")
    
    modified_count = 0
    total_replacements = 0
    
    for file_path in files:
        modified, replacements = process_file(file_path)
        if modified:
            modified_count += 1
            total_replacements += replacements
            print(f"✓ {file_path.relative_to(root_dir)} - {replacements} fixes")
    
    print(f"\n{'='*60}")
    print(f"Modified {modified_count} files")
    print(f"Total fixes: {total_replacements}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
