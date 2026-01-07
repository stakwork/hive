import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useForm } from 'react-hook-form';

// Global state to track modal visibility
let modalOpenCallback: ((workflowId: string, workflowVersionId: string, position: { x: number; y: number }) => void) | null = null;
let modalCloseCallback: (() => void) | null = null;
let modalSubmitCallback: ((responseData: any, contextData: ContextData) => void) | null = null;

interface ContextData {
  workflowId: string | null;
  workflowVersionId: string | null;
  position: { x: number; y: number };
}

interface FormData {
  jsonInput: string;
}

interface SubmitStatus {
  type: 'error' | 'success';
  message: string;
}

interface ImportNodeModalProps {
  onSubmitSuccess?: (responseData: any, contextData: ContextData) => void;
}

// Function to open the modal from anywhere
export function openImportNodeModal(workflowId: string, workflowVersionId: string, position: { x: number; y: number }): boolean {
  if (modalOpenCallback) {
    modalOpenCallback(workflowId, workflowVersionId, position);
    return true;
  }
  return false;
}

// Function to close the modal from anywhere
export function closeImportNodeModal(): boolean {
  if (modalCloseCallback) {
    modalCloseCallback();
    return true;
  }
  return false;
}

// The Modal component that will be rendered via Portal
const ImportNodeModal = ({ onSubmitSuccess = undefined }: ImportNodeModalProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitStatus, setSubmitStatus] = useState<SubmitStatus | null>(null);
  const [contextData, setContextData] = useState<ContextData>({
    workflowId: null,
    workflowVersionId: null,
    position: { x: 0, y: 0 }
  });
  const [portalContainer] = useState(() => document.createElement('div'));

  const {
    register,
    handleSubmit,
    formState: { errors },
    reset
  } = useForm<FormData>({
    defaultValues: {
      jsonInput: ''
    }
  });

  // Register global callbacks
  useEffect(() => {
    modalOpenCallback = (workflowId, workflowVersionId, position) => {
      setContextData({
        workflowId,
        workflowVersionId,
        position
      });
      setIsOpen(true);
    };

    modalCloseCallback = () => setIsOpen(false);
    modalSubmitCallback = onSubmitSuccess || null;

    return () => {
      modalOpenCallback = null;
      modalCloseCallback = null;
      modalSubmitCallback = null;
    };
  }, [onSubmitSuccess]);

  // Reset form when modal closes
  useEffect(() => {
    if (!isOpen) {
      reset();
      setSubmitStatus(null);
    }
  }, [isOpen, reset]);

  // Add portal container to body
  useEffect(() => {
    document.body.appendChild(portalContainer);

    return () => {
      try {
        // Check if the element is still in the document
        if (document.body.contains(portalContainer)) {
          document.body.removeChild(portalContainer);
        }
      } catch (error) {
        console.warn("Error removing portal container:", error);
      }
    };
  }, [portalContainer]);

  // Add styles to document head
  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = `
      .import-modal-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background-color: rgba(0, 0, 0, 0.5);
        display: flex;
        justify-content: center;
        align-items: center;
        z-index: 99999;
      }

      .import-modal-content {
        background: white;
        border-radius: 8px;
        padding: 20px;
        width: 500px;
        max-width: 90%;
        box-shadow: 0 5px 15px rgba(0, 0, 0, 0.3);
        position: relative;
        z-index: 100000;
      }

      .import-modal-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-bottom: 20px;
        padding-bottom: 10px;
        border-bottom: 1px solid #eee;
      }

      .import-modal-header h3 {
        margin: 0;
      }

      .import-close-btn {
        background: none;
        border: none;
        font-size: 24px;
        cursor: pointer;
        padding: 0;
        color: #666;
      }

      .import-form-group {
        margin-bottom: 20px;
      }

      .import-form-group label {
        display: block;
        margin-bottom: 8px;
        font-weight: bold;
      }

      .import-form-group textarea {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: 4px;
        font-family: monospace;
        resize: vertical;
      }

      .import-error-input {
        border-color: #d32f2f !important;
      }

      .import-error-message {
        color: #d32f2f;
        margin-top: 5px;
        font-size: 0.875rem;
      }

      .import-status-message {
        margin-bottom: 15px;
        padding: 10px;
        border-radius: 4px;
      }

      .import-status-message.import-error {
        color: #d32f2f;
        background-color: #ffebee;
      }

      .import-status-message.import-success {
        color: #388e3c;
        background-color: #e8f5e9;
      }

      .import-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 10px;
        margin-top: 20px;
      }

      .import-modal-footer button {
        padding: 8px 16px;
        border-radius: 4px;
        cursor: pointer;
        font-weight: bold;
      }

      .import-cancel-btn {
        background-color: #f5f5f5;
        border: 1px solid #ddd;
        color: #333;
      }

      .import-submit-btn {
        background-color: #1976d2;
        border: 1px solid #1565c0;
        color: white;
      }

      .import-submit-btn:disabled {
        background-color: #90caf9;
        border-color: #64b5f6;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);

    return () => {
      try {
        if (document.head.contains(style)) {
          document.head.removeChild(style);
        }
      } catch (error) {
        console.warn("Error removing style element:", error);
      }
    };
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
  }, []);

  const handleFormSubmit = useCallback(async (data: FormData) => {
    setIsSubmitting(true);
    setSubmitStatus(null);

    try {
      // Validate JSON input
      const parsedJson = JSON.parse(data.jsonInput);
      let plusX = 0;

      parsedJson.forEach((json: any) => {
        json['position'] = { x: contextData.position['x'] + plusX, y: contextData.position['y'] };
        plusX += 200;
      });

      try {
        // Construct URL with workflow IDs if available
        const url = `/admin/workflows/${contextData.workflowId}/steps/import`;
        const body = {
          steps: parsedJson,
          workflowVersionId: contextData.workflowVersionId,
        };

        // Send the request
        const response = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!response.ok) {
          throw new Error(`Server responded with status: ${response.status}`);
        }

        const responseData = await response.json();

        console.log("responseData", responseData);

        if (responseData.data.valid) {
          setSubmitStatus({ type: 'success', message: 'Node imported successfully!' });

          // Call success callback if provided
          if (modalSubmitCallback) {
            modalSubmitCallback(responseData, contextData);
          }

          // Optional: close modal after successful submission
          setTimeout(handleClose, 2000);
        } else {
          setSubmitStatus({ type: 'error', message: responseData.data.errors });
        }
      } catch (fetchError: any) {
        console.log("fetchError", fetchError);
        setSubmitStatus({
          type: 'error',
          message: `Failed to submit: ${fetchError.message}`
        });
      }
    } catch {
      setSubmitStatus({
        type: 'error',
        message: 'Invalid JSON format. Please check your input.'
      });
    } finally {
      setIsSubmitting(false);
    }
  }, [contextData, handleClose]);

  // Modal content
  const renderModalContent = () => {
    if (!isOpen) return null;

    return (
      <div
        className="import-modal-overlay"
        onClick={(e: React.MouseEvent<HTMLDivElement>) => {
          // Close modal when clicking outside
          if ((e.target as HTMLElement).className === 'import-modal-overlay') {
            handleClose();
          }
        }}
      >
        <div className="import-modal-content">
          <div className="import-modal-header">
            <h3>Import Node from JSON</h3>
            <button className="import-close-btn" onClick={handleClose}>×</button>
          </div>

          <form onSubmit={handleSubmit(handleFormSubmit)}>
            <div className="import-form-group">
              <label htmlFor="jsonInput">Paste your JSON:</label>
              <textarea
                id="jsonInput"
                rows={8}
                placeholder=''
                autoFocus={true}
                className={errors.jsonInput ? "import-error-input" : ""}
                {...register('jsonInput', {
                  required: 'JSON input is required',
                  validate: value => {
                    try {
                      JSON.parse(value);
                      return true;
                    } catch {
                      return "Please enter valid JSON";
                    }
                  }
                })}
              />
              {errors.jsonInput && (
                <div className="import-error-message">{errors.jsonInput.message}</div>
              )}
            </div>

            {submitStatus && (
              <div className={`import-status-message import-${submitStatus.type}`}>
                {submitStatus.message}
              </div>
            )}

            <div className="import-modal-footer">
              <button
                type="button"
                className="import-cancel-btn"
                onClick={handleClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="import-submit-btn"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Importing...' : 'Import'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };

  // Always render the portal, but content may be null
  return createPortal(
    renderModalContent(),
    portalContainer
  );
};

// Export modal component to be mounted at the application root
export default ImportNodeModal;
