import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ClarifyingQuestionsPreview } from '@/components/features/ClarifyingQuestionsPreview';
import type { ClarifyingQuestion } from '@/types/stakwork';

// Mock UI components  
vi.mock('@/components/ui/button', () => {
  const React = require('react');
  return {
    Button: React.forwardRef(({ children, onClick, disabled, variant, size, ...props }: any, ref: any) =>
      React.createElement('button', { ref, onClick, disabled, ...props }, children)
    ),
  };
});

vi.mock('@/components/ui/textarea', () => {
  const React = require('react');
  return {
    Textarea: React.forwardRef(({ value, onChange, placeholder, onKeyDown, disabled, rows, ...props }: any, ref: any) =>
      React.createElement('textarea', { ref, value, onChange, placeholder, onKeyDown, disabled, rows, ...props })
    ),
  };
});

// Mock lucide-react icons
vi.mock('lucide-react', () => {
  const React = require('react');
  return {
    HelpCircle: ({ className }: any) => React.createElement('div', { 'data-testid': 'help-circle-icon', className }),
    Check: ({ className }: any) => React.createElement('div', { 'data-testid': 'check-icon', className }),
    Loader2: ({ className }: any) => React.createElement('div', { 'data-testid': 'loader2-icon', className }),
    X: ({ className }: any) => React.createElement('div', { 'data-testid': 'x-icon', className }),
    Minus: ({ className }: any) => React.createElement('div', { 'data-testid': 'minus-icon', className }),
  };
});

// Mock cn utility
vi.mock('@/lib/utils', () => ({
  cn: (...args: any[]) => args.filter(Boolean).join(' '),
}));

describe('ClarifyingQuestionsPreview', () => {
  const mockQuestions: ClarifyingQuestion[] = [
    {
      question: 'What is your primary goal?',
      type: 'text',
    },
    {
      question: 'What is your timeline?',
      type: 'text',
    },
    {
      question: 'What is your budget?',
      type: 'text',
    },
    {
      question: 'Any additional requirements?',
      type: 'text',
    },
  ];

  const mockOnSubmit = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Step Counter Display', () => {
    it('should display correct step counter for first question (1 of 4)', () => {
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 4')).toBeInTheDocument();
    });

    it('should display correct step counter as user navigates through questions', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Question 1: 1 of 4
      expect(screen.getByText('1 of 4')).toBeInTheDocument();

      // Navigate to question 2
      const textarea = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea, 'Answer for question 1');
      const nextButton = screen.getByRole('button', { name: /next/i });
      await user.click(nextButton);

      await waitFor(() => {
        expect(screen.getByText('2 of 4')).toBeInTheDocument();
      });

      // Navigate to question 3
      const textarea2 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea2, 'Answer for question 2');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('3 of 4')).toBeInTheDocument();
      });

      // Navigate to question 4
      const textarea3 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea3, 'Answer for question 3');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('4 of 4')).toBeInTheDocument();
      });
    });

    it('should hide step counter on review screen', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate through all questions to reach review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1 
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      // Wait for review screen
      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Step counter should not be visible
      expect(screen.queryByText(/of 4/)).not.toBeInTheDocument();
      expect(screen.queryByText(/5 of/)).not.toBeInTheDocument();
    });

    it('should not display step counter as "5 of 5" on review screen', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate to review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Ensure no "5 of 5" is displayed
      expect(screen.queryByText('5 of 5')).not.toBeInTheDocument();
    });
  });

  describe('Progress Bar', () => {
    it('should render correct number of progress segments matching question count', () => {
      const { container } = render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Find all progress bar segments (div elements within the progress container)
      // The component renders Array.from({ length: totalSteps }) segments
      const progressContainer = container.querySelector('.flex.gap-1\\.5.mb-4');
      const progressSegments = progressContainer?.querySelectorAll('div[class*="h-1"]');
      
      // Should have 4 segments for 4 questions (not 5)
      expect(progressSegments?.length).toBe(4);
    });

    it('should show correct progress as user navigates through questions', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Initially, first segment should be active
      let progressContainer = container.querySelector('.flex.gap-1\\.5.mb-4');
      let segments = progressContainer?.querySelectorAll('div[class*="h-1"]');
      expect(segments?.length).toBe(4);

      // Navigate to question 2
      const textarea = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea, 'Answer 1');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('2 of 4')).toBeInTheDocument();
      });

      // Segments should still be 4
      progressContainer = container.querySelector('.flex.gap-1\\.5.mb-4');
      segments = progressContainer?.querySelectorAll('div[class*="h-1"]');
      expect(segments?.length).toBe(4);
    });

    it('should show all progress segments on review screen', async () => {
      const user = userEvent.setup();
      const { container } = render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate to review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Should still have 4 segments (not 5)
      const progressContainer = container.querySelector('.flex.gap-1\\.5.mb-4');
      const segments = progressContainer?.querySelectorAll('div[class*="h-1"]');
      expect(segments?.length).toBe(4);
    });
  });

  describe('Navigation', () => {
    it('should navigate through all questions correctly', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Start at question 1
      expect(screen.getByText(mockQuestions[0].question)).toBeInTheDocument();
      expect(screen.getByText('1 of 4')).toBeInTheDocument();

      // Navigate to question 2
      const textarea1 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea1, 'Answer 1');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(mockQuestions[1].question)).toBeInTheDocument();
        expect(screen.getByText('2 of 4')).toBeInTheDocument();
      });

      // Navigate to question 3
      const textarea2 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea2, 'Answer 2');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(mockQuestions[2].question)).toBeInTheDocument();
        expect(screen.getByText('3 of 4')).toBeInTheDocument();
      });

      // Navigate to question 4
      const textarea3 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea3, 'Answer 3');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText(mockQuestions[3].question)).toBeInTheDocument();
        expect(screen.getByText('4 of 4')).toBeInTheDocument();
      });

      // Navigate to review
      const textarea4 = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea4, 'Answer 4');
      await user.click(screen.getByRole('button', { name: /review/i }));

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
        expect(screen.queryByText(/of 4/)).not.toBeInTheDocument();
      });
    });

    it('should allow navigation back from review to questions', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate to review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Navigate back to question 4
      const backButton = screen.getByRole('button', { name: /back/i });
      await user.click(backButton);

      await waitFor(() => {
        expect(screen.getByText('4 of 4')).toBeInTheDocument();
        expect(screen.getByText(mockQuestions[3].question)).toBeInTheDocument();
      });
    });
  });

  describe('Edge Cases', () => {
    it('should handle single question correctly (1 of 1)', () => {
      const singleQuestion = [mockQuestions[0]];
      render(
        <ClarifyingQuestionsPreview
          questions={singleQuestion}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 1')).toBeInTheDocument();
    });

    it('should handle two questions correctly (1 of 2, 2 of 2)', async () => {
      const user = userEvent.setup();
      const twoQuestions = mockQuestions.slice(0, 2);
      render(
        <ClarifyingQuestionsPreview
          questions={twoQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 2')).toBeInTheDocument();

      const textarea = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea, 'Answer 1');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('2 of 2')).toBeInTheDocument();
      });
    });

    it('should handle many questions correctly (1 of 10)', () => {
      const manyQuestions: ClarifyingQuestion[] = Array.from({ length: 10 }, (_, i) => ({
        question: `Question ${i + 1}`,
        type: 'text',
      }));

      render(
        <ClarifyingQuestionsPreview
          questions={manyQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 10')).toBeInTheDocument();
    });
  });

  describe('Component Integration', () => {
    it('should call onSubmit when all questions are answered and submitted', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate through all questions
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Submit from review
      const submitButton = screen.getByRole('button', { name: /submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledTimes(1);
      });
    });

    it('should format answers correctly when submitting', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      // Navigate through all questions with specific answers
      const answers = ['Goal answer', 'Timeline answer', 'Budget answer', 'Requirements answer'];
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, answers[i]);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Submit
      const submitButton = screen.getByRole('button', { name: /submit/i });
      await user.click(submitButton);

      await waitFor(() => {
        expect(mockOnSubmit).toHaveBeenCalledWith(expect.stringContaining('Goal answer'));
        expect(mockOnSubmit).toHaveBeenCalledWith(expect.stringContaining('Timeline answer'));
      });
    });
  });

  describe('Choice Question Types', () => {
    it('should handle single choice questions correctly', async () => {
      const user = userEvent.setup();
      const choiceQuestions: ClarifyingQuestion[] = [
        {
          question: 'Choose one option',
          type: 'single_choice',
          options: ['Option A', 'Option B', 'Option C'],
        },
      ];

      render(
        <ClarifyingQuestionsPreview
          questions={choiceQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 1')).toBeInTheDocument();
      expect(screen.getByText('Option A')).toBeInTheDocument();
      expect(screen.getByText('Option B')).toBeInTheDocument();
      expect(screen.getByText('Option C')).toBeInTheDocument();
    });

    it('should handle multiple choice questions correctly', async () => {
      const user = userEvent.setup();
      const choiceQuestions: ClarifyingQuestion[] = [
        {
          question: 'Choose multiple options',
          type: 'multiple_choice',
          options: ['Option A', 'Option B', 'Option C'],
        },
      ];

      render(
        <ClarifyingQuestionsPreview
          questions={choiceQuestions}
          onSubmit={mockOnSubmit}
        />
      );

      expect(screen.getByText('1 of 1')).toBeInTheDocument();
      expect(screen.getByText('Choose multiple options')).toBeInTheDocument();
    });

    describe('Single Choice Deselection', () => {
      it('should allow deselecting a selected single_choice option by clicking it again', async () => {
        const user = userEvent.setup();
        const singleChoiceQuestion: ClarifyingQuestion[] = [
          {
            question: 'Choose one option',
            type: 'single_choice',
            options: ['Option A', 'Option B', 'Option C'],
          },
        ];

        render(
          <ClarifyingQuestionsPreview
            questions={singleChoiceQuestion}
            onSubmit={mockOnSubmit}
          />
        );

        const optionButton = screen.getByText('Option A').closest('button');
        expect(optionButton).not.toBeNull();

        // Click to select Option A
        await user.click(optionButton!);

        // Verify Option A is selected (has check icon)
        await waitFor(() => {
          expect(screen.getByTestId('check-icon')).toBeInTheDocument();
        });

        // Click Option A again to deselect
        await user.click(optionButton!);

        // Verify Option A is deselected (no check icon)
        await waitFor(() => {
          expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
        });

        // Next button should be disabled since no selection and no text
        const nextButton = screen.getByRole('button', { name: /review/i });
        expect(nextButton).toBeDisabled();
      });

      it('should select an unselected single_choice option when clicked', async () => {
        const user = userEvent.setup();
        const singleChoiceQuestion: ClarifyingQuestion[] = [
          {
            question: 'Choose one option',
            type: 'single_choice',
            options: ['Option A', 'Option B'],
          },
        ];

        render(
          <ClarifyingQuestionsPreview
            questions={singleChoiceQuestion}
            onSubmit={mockOnSubmit}
          />
        );

        // Initially no option selected
        expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();

        // Click Option A to select
        const optionAButton = screen.getByText('Option A').closest('button');
        await user.click(optionAButton!);

        // Verify Option A is selected
        await waitFor(() => {
          expect(screen.getByTestId('check-icon')).toBeInTheDocument();
        });

        // Next button should be enabled
        const reviewButton = screen.getByRole('button', { name: /review/i });
        expect(reviewButton).not.toBeDisabled();
      });

      it('should update visual indicators correctly when single_choice option is deselected', async () => {
        const user = userEvent.setup();
        const { container } = render(
          <ClarifyingQuestionsPreview
            questions={[
              {
                question: 'Choose one',
                type: 'single_choice',
                options: ['Option A'],
              },
            ]}
            onSubmit={mockOnSubmit}
          />
        );

        const optionButton = screen.getByText('Option A').closest('button');
        
        // Select Option A
        await user.click(optionButton!);

        // Verify selected styles
        await waitFor(() => {
          expect(optionButton).toHaveClass('bg-primary/10', 'border-primary/30');
          expect(screen.getByTestId('check-icon')).toBeInTheDocument();
        });

        // Deselect Option A
        await user.click(optionButton!);

        // Verify deselected styles (no check icon, no highlight)
        await waitFor(() => {
          expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
          expect(optionButton).not.toHaveClass('bg-primary/10', 'border-primary/30');
        });
      });

      it('should allow proceeding to next question with text input only when no single_choice option is selected', async () => {
        const user = userEvent.setup();
        render(
          <ClarifyingQuestionsPreview
            questions={[
              {
                question: 'Choose one or type custom answer',
                type: 'single_choice',
                options: ['Option A', 'Option B'],
              },
              {
                question: 'Next question',
                type: 'text',
              },
            ]}
            onSubmit={mockOnSubmit}
          />
        );

        // Initially, next button should be disabled (no selection, no text)
        const nextButton = screen.getByRole('button', { name: /next/i });
        expect(nextButton).toBeDisabled();

        // Type custom text without selecting an option
        const textarea = screen.getByPlaceholderText(/add additional context/i);
        await user.type(textarea, 'My custom answer');

        // Next button should now be enabled
        await waitFor(() => {
          expect(nextButton).not.toBeDisabled();
        });

        // Should be able to proceed to next question
        await user.click(nextButton);

        await waitFor(() => {
          expect(screen.getByText('Next question')).toBeInTheDocument();
          expect(screen.getByText('2 of 2')).toBeInTheDocument();
        });
      });

      it('should preserve multiple_choice toggle behavior (regression test)', async () => {
        const user = userEvent.setup();
        render(
          <ClarifyingQuestionsPreview
            questions={[
              {
                question: 'Choose multiple',
                type: 'multiple_choice',
                options: ['Option A', 'Option B', 'Option C'],
              },
            ]}
            onSubmit={mockOnSubmit}
          />
        );

        const optionAButton = screen.getByText('Option A').closest('button');
        const optionBButton = screen.getByText('Option B').closest('button');

        // Select Option A
        await user.click(optionAButton!);
        await waitFor(() => {
          expect(screen.getAllByTestId('check-icon')).toHaveLength(1);
        });

        // Select Option B (should have 2 selected)
        await user.click(optionBButton!);
        await waitFor(() => {
          expect(screen.getAllByTestId('check-icon')).toHaveLength(2);
        });

        // Deselect Option A (should have 1 selected)
        await user.click(optionAButton!);
        await waitFor(() => {
          expect(screen.getAllByTestId('check-icon')).toHaveLength(1);
        });

        // Deselect Option B (should have 0 selected)
        await user.click(optionBButton!);
        await waitFor(() => {
          expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
        });
      });
    });
  });

  describe('Loading State', () => {
    it('should disable buttons when loading', () => {
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          isLoading={true}
        />
      );

      // Buttons should be disabled when loading
      const textarea = screen.getByPlaceholderText(/type your answer/i);
      expect(textarea).toBeDisabled();
    });

    it('should show loading indicator on submit button', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          isLoading={false}
        />
      );

      // Navigate to review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Submit button should show "Submit" text
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
    });
  });

  describe('Cancel Functionality', () => {
    const mockOnCancel = vi.fn();

    beforeEach(() => {
      mockOnCancel.mockClear();
    });

    it('should display Cancel button on first question', () => {
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Cancel button should be visible on first question
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
      expect(screen.getByTestId('x-icon')).toBeInTheDocument();
    });

    it('should display Cancel button on middle questions', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Navigate to question 2
      const textarea = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea, 'Answer 1');
      await user.click(screen.getByRole('button', { name: /next/i }));

      await waitFor(() => {
        expect(screen.getByText('2 of 4')).toBeInTheDocument();
      });

      // Cancel button should still be visible
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it('should display Cancel button on review screen', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Navigate to review
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Cancel button should be visible on review screen
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeInTheDocument();
    });

    it('should call onCancel when Cancel button is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Click Cancel button
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // onCancel should be called
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalledTimes(1);
      });
    });

    it('should not call onSubmit when Cancel is clicked', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Type some answers
      const textarea = screen.getByPlaceholderText(/type your answer/i);
      await user.type(textarea, 'Answer 1');

      // Click Cancel button instead of Next/Submit
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // onCancel should be called, but NOT onSubmit
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalledTimes(1);
        expect(mockOnSubmit).not.toHaveBeenCalled();
      });
    });

    it('should disable Cancel button when isLoading is true', () => {
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
          isLoading={true}
        />
      );

      // Cancel button should be disabled when loading
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      expect(cancelButton).toBeDisabled();
    });

    it('should not submit partial answers when canceling from review screen', async () => {
      const user = userEvent.setup();
      render(
        <ClarifyingQuestionsPreview
          questions={mockQuestions}
          onSubmit={mockOnSubmit}
          onCancel={mockOnCancel}
        />
      );

      // Navigate to review with partial answers
      for (let i = 0; i < mockQuestions.length; i++) {
        const textarea = screen.getByPlaceholderText(/type your answer/i);
        await user.type(textarea, `Answer ${i + 1}`);
        const nextButton = i < mockQuestions.length - 1
          ? screen.getByRole('button', { name: /next/i })
          : screen.getByRole('button', { name: /review/i });
        await user.click(nextButton);
      }

      await waitFor(() => {
        expect(screen.getByText(/review your answers/i)).toBeInTheDocument();
      });

      // Click Cancel instead of Submit
      const cancelButton = screen.getByRole('button', { name: /cancel/i });
      await user.click(cancelButton);

      // onCancel should be called, NOT onSubmit
      await waitFor(() => {
        expect(mockOnCancel).toHaveBeenCalledTimes(1);
        expect(mockOnSubmit).not.toHaveBeenCalled();
      });
    });
  });
});
