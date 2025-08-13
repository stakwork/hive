import React from 'react';
import { LanguageShowcase } from '@/components/ui/language-showcase';
import { DEFAULT_LANGUAGE_ORDER } from '@/lib/constants/languages';

export const LanguageSupport: React.FC = () => {
  return (
    <LanguageShowcase
      languages={DEFAULT_LANGUAGE_ORDER}
      title="Language support"
      showSeparator={true}
      size="md"
      layout="horizontal"
      spacing="normal"
      className="mb-4"
    />
  );
};