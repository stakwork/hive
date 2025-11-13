#!/usr/bin/env python3
"""
Remove the manual context parameter from logger calls.
Changes logger.error("msg", "Context", {data}) to logger.error("msg", {data})
"""

import re
import subprocess
from pathlib import Path
from typing import List

def find_files_with_logger(root_dir: Path) -> List[Path]:
    """Find all TypeScript files with logger calls"""
    try:
        result = subprocess.run(
            [
                'rg',
                '--type', 'ts',
                '--files-with-matches',
                r'logger\.(error|warn|info|debug)',
                str(root_dir / 'src')
            ],
            capture_output=True,
            text=True,
            check=True
        )
        files = [Path(f.strip()) for f in result.stdout.strip().split('\n') if f.strip()]
        return files
    except subprocess.CalledProcessError:
        return []

def remove_context_param(content: str) -> tuple[str, int]:
    """
    Remove the context parameter from logger calls.
    
    Patterns to handle:
    1. logger.error("msg", "Context", {data}) -> logger.error("msg", {data})
    2. logger.warn("msg", "Context") -> logger.warn("msg")
    3. logger.info(`msg`, "Context", {data}) -> logger.info(`msg`, {data})
    """
    
    replacements = 0
    
    # Pattern: logger.METHOD("message", "Context", metadata)
    # Captures: (logger.error/warn/info/debug)("message", "Context", metadata)
    pattern1 = r'(logger\.(error|warn|info|debug)\([^,]+),\s*["\'][^"\']+["\']\s*,\s*(\{[^}]+\})\)'
    
    def replace1(match):
        nonlocal replacements
        replacements += 1
        return f'{match.group(1)}, {match.group(3)})'
    
    content = re.sub(pattern1, replace1, content)
    
    # Pattern: logger.METHOD("message", "Context") with no metadata
    pattern2 = r'(logger\.(error|warn|info|debug)\([^,]+),\s*["\'][^"\']+["\']\s*\)'
    
    def replace2(match):
        nonlocal replacements
        replacements += 1
        return f'{match.group(1)})'
    
    content = re.sub(pattern2, replace2, content)
    
    return content, replacements

def process_file(file_path: Path) -> tuple[bool, int]:
    """Process a single file"""
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            original_content = f.read()
        
        new_content, replacements = remove_context_param(original_content)
        
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
    
    print("Finding TypeScript files with logger calls...")
    files = find_files_with_logger(root_dir)
    print(f"Found {len(files)} files with logger calls\n")
    
    modified_count = 0
    total_replacements = 0
    
    for file_path in files:
        modified, replacements = process_file(file_path)
        if modified:
            modified_count += 1
            total_replacements += replacements
            print(f"✓ {file_path.relative_to(root_dir)} - {replacements} replacements")
    
    print(f"\n{'='*60}")
    print(f"Modified {modified_count} files")
    print(f"Total replacements: {total_replacements}")
    print(f"{'='*60}")

if __name__ == "__main__":
    main()
