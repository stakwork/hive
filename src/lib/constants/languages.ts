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
  id: string;
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  category: 'frontend' | 'backend' | 'mobile' | 'systems';
}

export const SUPPORTED_LANGUAGES: Record<string, SupportedLanguage> = {
  golang: {
    id: 'golang',
    name: 'Golang',
    icon: SiGo,
    color: 'text-cyan-500',
    category: 'backend'
  },
  react: {
    id: 'react',
    name: 'React',
    icon: SiReact,
    color: 'text-blue-500',
    category: 'frontend'
  },
  rails: {
    id: 'rails',
    name: 'Ruby on Rails',
    icon: SiRubyonrails,
    color: 'text-red-600',
    category: 'backend'
  },
  typescript: {
    id: 'typescript',
    name: 'TypeScript',
    icon: SiTypescript,
    color: 'text-blue-600',
    category: 'frontend'
  },
  python: {
    id: 'python',
    name: 'Python',
    icon: SiPython,
    color: 'text-yellow-500',
    category: 'backend'
  },
  swift: {
    id: 'swift',
    name: 'Swift',
    icon: SiSwift,
    color: 'text-orange-500',
    category: 'mobile'
  },
  kotlin: {
    id: 'kotlin',
    name: 'Kotlin',
    icon: SiKotlin,
    color: 'text-purple-500',
    category: 'mobile'
  },
  rust: {
    id: 'rust',
    name: 'Rust',
    icon: SiRust,
    color: 'text-orange-600',
    category: 'systems'
  },
  java: {
    id: 'java',
    name: 'Java',
    icon: SiOpenjdk,
    color: 'text-red-500',
    category: 'backend'
  },
  angular: {
    id: 'angular',
    name: 'Angular',
    icon: SiAngular,
    color: 'text-red-600',
    category: 'frontend'
  },
  svelte: {
    id: 'svelte',
    name: 'Svelte',
    icon: SiSvelte,
    color: 'text-orange-500',
    category: 'frontend'
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
export type LanguageCategory = SupportedLanguage['category'];

// Helper functions
export const getLanguageById = (id: string): SupportedLanguage | undefined => {
  return SUPPORTED_LANGUAGES[id];
};

export const getLanguagesByCategory = (category: LanguageCategory): SupportedLanguage[] => {
  return Object.values(SUPPORTED_LANGUAGES).filter(lang => lang.category === category);
};

export const getLanguagesByIds = (ids: string[]): SupportedLanguage[] => {
  return ids
    .map(id => SUPPORTED_LANGUAGES[id])
    .filter(Boolean);
};