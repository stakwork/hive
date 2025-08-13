import {
  SiReact,
  SiPython,
  SiGo,
  SiRubyonrails,
  SiTypescript,
  SiSwift,
  SiKotlin,
  SiRust,
  SiOpenjdk,
  SiAngular,
  SiSvelte
} from 'react-icons/si';

export interface SupportedLanguage {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

export const SUPPORTED_LANGUAGES: Record<string, SupportedLanguage> = {
  golang: {
    name: 'Golang',
    icon: SiGo,
    color: 'text-cyan-500'
  },
  react: {
    name: 'React',
    icon: SiReact,
    color: 'text-blue-500'
  },
  rails: {
    name: 'Ruby on Rails',
    icon: SiRubyonrails,
    color: 'text-red-600'
  },
  typescript: {
    name: 'TypeScript',
    icon: SiTypescript,
    color: 'text-blue-600'
  },
  python: {
    name: 'Python',
    icon: SiPython,
    color: 'text-yellow-500'
  },
  swift: {
    name: 'Swift',
    icon: SiSwift,
    color: 'text-orange-500'
  },
  kotlin: {
    name: 'Kotlin',
    icon: SiKotlin,
    color: 'text-purple-500'
  },
  rust: {
    name: 'Rust',
    icon: SiRust,
    color: 'text-orange-600'
  },
  java: {
    name: 'Java',
    icon: SiOpenjdk,
    color: 'text-red-500'
  },
  angular: {
    name: 'Angular',
    icon: SiAngular,
    color: 'text-red-600'
  },
  svelte: {
    name: 'Svelte',
    icon: SiSvelte,
    color: 'text-orange-500'
  }
} as const;

// Default display order for onboarding
export const DEFAULT_LANGUAGE_ORDER = [
  'golang',
  'react', 
  'rails',
  'typescript',
  'python',
  'swift',
  'kotlin',
  'rust',
  'java',
  'angular',
  'svelte'
] as const;

// Type helpers
export type LanguageId = keyof typeof SUPPORTED_LANGUAGES;

// Helper functions
export const getLanguagesByIds = (ids: string[]): SupportedLanguage[] => {
  return ids
    .map(id => SUPPORTED_LANGUAGES[id])
    .filter(Boolean);
};