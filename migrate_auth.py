#!/usr/bin/env python3
"""
Script to migrate from getServerSession(authOptions) to auth() in API routes
"""
import os
import re
from pathlib import Path

def migrate_file(file_path):
    """Migrate a single file from getServerSession to auth()"""
    with open(file_path, 'r') as f:
        content = f.read()
    
    original_content = content
    
    # Step 1: Replace import statement for getServerSession
    # Match: import { getServerSession } from "next-auth/next";
    # or: import { getServerSession } from "next-auth";
    content = re.sub(
        r'import\s*{\s*getServerSession\s*}\s*from\s*["\']next-auth(?:/next)?["\'];?',
        'import { auth } from "@/lib/auth";',
        content
    )
    
    # Step 2: Remove authOptions import
    # Match: import { authOptions } from "@/lib/auth/nextauth";
    content = re.sub(
        r'import\s*{\s*authOptions\s*}\s*from\s*["\']@/lib/auth/nextauth["\'];?\s*\n?',
        '',
        content
    )
    
    # Step 3: Replace getServerSession(authOptions) calls with auth()
    content = re.sub(
        r'getServerSession\s*\(\s*authOptions\s*\)',
        'auth()',
        content
    )
    
    # Step 4: Clean up any leftover authOptions references in imports if they were on same line
    # Match patterns like: import { authOptions, something } from ...
    content = re.sub(
        r'import\s*{\s*authOptions\s*,\s*',
        'import { ',
        content
    )
    content = re.sub(
        r'import\s*{\s*([^}]+),\s*authOptions\s*}',
        r'import { \1 }',
        content
    )
    
    # Only write if content changed
    if content != original_content:
        with open(file_path, 'w') as f:
            f.write(content)
        return True
    return False

def main():
    """Main migration function"""
    api_dir = Path('/workspaces/hive/src/app/api')
    
    # Find all route.ts files in api directory (excluding test files)
    route_files = []
    for root, dirs, files in os.walk(api_dir):
        # Skip test directories
        if '__tests__' in root or 'test' in root:
            continue
        for file in files:
            if file == 'route.ts' and not file.endswith('.test.ts'):
                route_files.append(Path(root) / file)
    
    print(f"Found {len(route_files)} route files")
    
    migrated_count = 0
    for file_path in sorted(route_files):
        try:
            if migrate_file(file_path):
                migrated_count += 1
                print(f"✓ Migrated: {file_path.relative_to('/workspaces/hive')}")
            else:
                print(f"○ No changes: {file_path.relative_to('/workspaces/hive')}")
        except Exception as e:
            print(f"✗ Error migrating {file_path.relative_to('/workspaces/hive')}: {e}")
    
    print(f"\nMigration complete: {migrated_count}/{len(route_files)} files updated")

if __name__ == '__main__':
    main()
