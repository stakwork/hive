import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * Utility function to merge and deduplicate class names safely.
 * Combines clsx for conditional classes and tailwind-merge for Tailwind CSS conflict resolution.
 * 
 * @param inputs - Class values that can be strings, objects, arrays, or conditional expressions
 * @returns Merged and deduplicated class string
 * 
 * @example
 * cn('px-2 py-1', 'text-red-500') // 'px-2 py-1 text-red-500'
 * cn('px-2', { 'py-1': true, 'text-red-500': false }) // 'px-2 py-1' 
 * cn('px-2 px-4', 'py-1 py-2') // 'px-4 py-2' (Tailwind conflicts resolved)
 * cn(null, undefined, '', 'px-2') // 'px-2' (falsy values filtered)
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export default cn;