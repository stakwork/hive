import React from 'react';
import { cn } from '@/lib/utils';
import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  DEFAULT_LANGUAGE_ORDER,
  getLanguagesByIds
} from '@/lib/constants/languages';

export interface LanguageShowcaseProps {
  /** Array of language IDs to display. Defaults to all supported languages */
  languages?: readonly string[];
  /** Title text to display above icons */
  title?: string;
  /** Description text (optional) */
  description?: string;
  /** Layout style */
  layout?: 'horizontal' | 'grid';
  /** Icon size */
  size?: 'sm' | 'md' | 'lg';
  /** Whether to show language names as labels */
  showLabels?: boolean;
  /** Maximum number of items to display */
  maxItems?: number;
  /** Whether to show separator above title */
  showSeparator?: boolean;
  /** Additional CSS classes */
  className?: string;
  /** Spacing between icons */
  spacing?: 'tight' | 'normal' | 'loose';
}

export const LanguageShowcase: React.FC<LanguageShowcaseProps> = ({
  languages = DEFAULT_LANGUAGE_ORDER,
  title,
  description,
  layout = 'horizontal',
  size = 'md',
  showLabels = false,
  maxItems,
  showSeparator = false,
  className,
  spacing = 'normal'
}) => {
  const displayLanguages = getLanguagesByIds(
    maxItems ? [...languages].slice(0, maxItems) : [...languages]
  );

  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-5 h-5',
    lg: 'w-6 h-6'
  };

  const spacingClasses = {
    tight: layout === 'horizontal' ? 'space-x-2' : 'gap-2',
    normal: layout === 'horizontal' ? 'space-x-4' : 'gap-4',
    loose: layout === 'horizontal' ? 'space-x-6' : 'gap-6'
  };

  const gridCols = Math.min(displayLanguages.length, 6);

  if (displayLanguages.length === 0) {
    return null;
  }

  return (
    <div className={cn('text-center', className)}>
      {showSeparator && title && (
        <Separator className="w-16 mx-auto mb-4" />
      )}
      
      {title && (
        <p className="text-xs text-muted-foreground mb-3">{title}</p>
      )}
      
      {description && (
        <p className="text-sm text-muted-foreground mb-4">{description}</p>
      )}
      
      <div className={cn(
        'flex justify-center items-center',
        layout === 'horizontal' 
          ? spacingClasses[spacing]
          : `grid grid-cols-${gridCols} ${spacingClasses[spacing]}`
      )}>
        {displayLanguages.map((language) => {
          const IconComponent = language.icon;
          const content = (
            <div
              className={cn(
                'opacity-60 hover:opacity-100 transition-opacity',
                showLabels && 'flex flex-col items-center space-y-1'
              )}
            >
              <IconComponent 
                className={cn(sizeClasses[size], language.color)} 
              />
              {showLabels && (
                <span className="text-xs text-muted-foreground text-center">
                  {language.name}
                </span>
              )}
            </div>
          );

          if (showLabels) {
            return (
              <div key={language.id}>
                {content}
              </div>
            );
          }

          return (
            <Tooltip key={language.id}>
              <TooltipTrigger asChild>
                {content}
              </TooltipTrigger>
              <TooltipContent>
                <p>{language.name}</p>
              </TooltipContent>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};