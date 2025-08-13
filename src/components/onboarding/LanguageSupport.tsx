import React from 'react';
import { Separator } from "@/components/ui/separator";
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

interface LanguageItem {
  name: string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}

const languages: LanguageItem[] = [
  {
    name: 'Golang',
    icon: SiGo,
    color: 'text-cyan-500'
  },
  {
    name: 'React',
    icon: SiReact,
    color: 'text-blue-500'
  },
  {
    name: 'Ruby on Rails',
    icon: SiRubyonrails,
    color: 'text-red-600'
  },
  {
    name: 'TypeScript',
    icon: SiTypescript,
    color: 'text-blue-600'
  },
  {
    name: 'Python',
    icon: SiPython,
    color: 'text-yellow-500'
  },
  {
    name: 'Swift',
    icon: SiSwift,
    color: 'text-orange-500'
  },
  {
    name: 'Kotlin',
    icon: SiKotlin,
    color: 'text-purple-500'
  },
  {
    name: 'Rust',
    icon: SiRust,
    color: 'text-orange-600'
  },
  {
    name: 'Java',
    icon: SiOpenjdk,
    color: 'text-red-500'
  },
  {
    name: 'Angular',
    icon: SiAngular,
    color: 'text-red-600'
  },
  {
    name: 'Svelte',
    icon: SiSvelte,
    color: 'text-orange-500'
  }
];

export const LanguageSupport = () => {
  return (
    <div className="text-center mb-4">
      <Separator className="w-16 mx-auto mb-4" />
      <p className="text-xs text-muted-foreground mb-3">
      Language support
      </p>
      <div className="flex justify-center items-center space-x-4">
        {languages.map((language) => {
          const IconComponent = language.icon;
          return (
            <div
              key={language.name}
              className="opacity-60 hover:opacity-100 transition-opacity"
              title={language.name}
            >
              <IconComponent className={`w-5 h-5 ${language.color}`} />
            </div>
          );
        })}
      </div>
    </div>
  );
};