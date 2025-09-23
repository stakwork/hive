import React from 'react';
import { getIcon, getArtifactIcon, getAgentIcon } from '@/lib/icons';

describe('icons', () => {
  describe('getIcon', () => {
    it('should return Code icon for "code" icon type', () => {
      const result = getIcon('code');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
    });

    it('should return Bot icon for "agent" icon type', () => {
      const result = getIcon('agent');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
    });

    it('should return Phone icon for "call" icon type', () => {
      const result = getIcon('call');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
    });

    it('should return MessageSquare icon for "message" icon type', () => {
      const result = getIcon('message');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
    });

    it('should be case insensitive', () => {
      const lowerResult = getIcon('code');
      const upperResult = getIcon('CODE');
      const mixedResult = getIcon('Code');
      
      expect(lowerResult).not.toBeNull();
      expect(upperResult).not.toBeNull();
      expect(mixedResult).not.toBeNull();
      
      expect(React.isValidElement(lowerResult)).toBe(true);
      expect(React.isValidElement(upperResult)).toBe(true);
      expect(React.isValidElement(mixedResult)).toBe(true);
    });

    it('should return null for unknown icon type', () => {
      const result = getIcon('unknown');
      expect(result).toBeNull();
    });

    it('should return null for undefined icon type', () => {
      const result = getIcon(undefined as any);
      expect(result).toBeNull();
    });

    it('should return null for null icon type', () => {
      const result = getIcon(null as any);
      expect(result).toBeNull();
    });

    it('should apply custom className', () => {
      const result = getIcon('code', 'h-8 w-8 text-blue-500');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-8');
      expect(result?.props.className).toContain('w-8');
      expect(result?.props.className).toContain('text-blue-500');
    });

    it('should use default className when none provided', () => {
      const result = getIcon('code');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
    });
  });

  describe('getArtifactIcon', () => {
    it('should return icon with h-5 w-5 flex-shrink-0 className for valid icon type', () => {
      const result = getArtifactIcon('code');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-5');
      expect(result?.props.className).toContain('w-5');
      expect(result?.props.className).toContain('flex-shrink-0');
    });

    it('should return null for unknown icon type', () => {
      const result = getArtifactIcon('unknown');
      expect(result).toBeNull();
    });

    it('should work with all valid icon types', () => {
      const validTypes = ['code', 'agent', 'call', 'message'];
      
      validTypes.forEach(iconType => {
        const result = getArtifactIcon(iconType);
        
        expect(result).not.toBeNull();
        expect(React.isValidElement(result)).toBe(true);
        expect(result?.props.className).toContain('h-5');
        expect(result?.props.className).toContain('w-5');
        expect(result?.props.className).toContain('flex-shrink-0');
      });
    });
  });

  describe('getAgentIcon', () => {
    it('should return Bot icon with default className', () => {
      const result = getAgentIcon();
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-4');
      expect(result?.props.className).toContain('w-4');
      expect(result?.props.className).toContain('flex-shrink-0');
    });

    it('should return Bot icon with custom className', () => {
      const result = getAgentIcon('h-6 w-6 text-green-500');
      
      expect(result).not.toBeNull();
      expect(React.isValidElement(result)).toBe(true);
      expect(result?.props.className).toContain('h-6');
      expect(result?.props.className).toContain('w-6');
      expect(result?.props.className).toContain('text-green-500');
    });

    it('should always return Bot icon regardless of other parameters', () => {
      const result1 = getAgentIcon();
      const result2 = getAgentIcon('custom-class');
      
      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(React.isValidElement(result1)).toBe(true);
      expect(React.isValidElement(result2)).toBe(true);
    });
  });
});
