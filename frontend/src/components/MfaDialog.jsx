import { useState, useEffect, useRef } from 'react';
import PropTypes from 'prop-types';

/**
 * MFA Dialog Component
 * 
 * Displays a modal dialog for entering MFA verification code
 * Features:
 * - 6-digit code input with auto-formatting
 * - Countdown timer showing time remaining
 * - Error display with retry option
 * - Submit/Cancel actions
 * - Keyboard support (Enter/Escape)
 */
const MfaDialog = ({
  isOpen,
  onSubmit,
  onCancel,
  loading,
  error,
  provider,
  expiresAt
}) => {
  const [code, setCode] = useState('');
  const [timeRemaining, setTimeRemaining] = useState(0);
  const inputRef = useRef(null);

  // Calculate and update time remaining
  useEffect(() => {
    if (!isOpen || !expiresAt) return;

    const updateTimer = () => {
      const now = new Date();
      const expires = new Date(expiresAt);
      const remaining = Math.max(0, Math.floor((expires - now) / 1000));
      setTimeRemaining(remaining);

      if (remaining === 0) {
        // Session expired
        onCancel();
      }
    };

    // Update immediately
    updateTimer();

    // Update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [isOpen, expiresAt, onCancel]);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      setCode('');
    }
  }, [isOpen]);

  // Handle code input - only allow digits
  const handleCodeChange = (e) => {
    const value = e.target.value.replace(/\D/g, '');
    if (value.length <= 6) {
      setCode(value);
    }
  };

  // Handle form submission
  const handleSubmit = (e) => {
    e.preventDefault();
    if (code.length === 6 && !loading) {
      onSubmit(code);
    }
  };

  // Handle keyboard events
  const handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      onCancel();
    }
  };

  // Format time remaining as MM:SS
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm"
      onClick={onCancel}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-modal="true"
      aria-labelledby="mfa-dialog-title"
    >
      <div
        className="bg-forest-mid rounded-mise-lg shadow-mise-lg p-6 max-w-md w-full mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="mb-6">
          <h2 id="mfa-dialog-title" className="text-2xl font-display font-bold text-cream mb-2">
            Verification Required
          </h2>
          <p className="text-sage-light">
            Enter the 6-digit verification code sent to your {provider} account
          </p>
        </div>

        {/* Timer */}
        <div className="mb-4 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-2">
          <span className="text-sm text-blue-800">Time remaining:</span>
          <span className="font-mono text-lg font-semibold text-blue-900">
            {formatTime(timeRemaining)}
          </span>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          {/* Code Input */}
          <div className="mb-6">
            <label htmlFor="mfa-code" className="block text-sm font-medium text-sage-light mb-2">
              Verification Code
            </label>
            <input
              ref={inputRef}
              id="mfa-code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength="6"
              value={code}
              onChange={handleCodeChange}
              disabled={loading}
              className={`input text-center text-2xl font-mono tracking-widest ${
                error
                  ? 'border-[var(--color-error)] focus:border-[var(--color-error)]'
                  : ''
              } ${loading ? 'opacity-50 cursor-not-allowed' : ''}`}
              placeholder="000000"
              aria-invalid={error ? 'true' : 'false'}
              aria-describedby={error ? 'mfa-error' : undefined}
            />
            <p className="mt-2 text-xs text-gray-500 text-center">
              Enter the 6-digit code
            </p>
          </div>

          {/* Error Message */}
          {error && (
            <div
              id="mfa-error"
              className="mb-4 p-3 bg-[var(--color-error)]/10 border border-[var(--color-error)] rounded-mise-md"
              role="alert"
            >
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="flex-1 btn btn-ghost disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={code.length !== 6 || loading}
              className="flex-1 btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? (
                <span className="flex items-center justify-center">
                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Verifying...
                </span>
              ) : (
                'Verify'
              )}
            </button>
          </div>
        </form>

        {/* Help Text */}
        <div className="mt-4 text-center">
          <p className="text-xs text-sage-light">
            Didn't receive a code? Check your email or phone for the verification code.
          </p>
        </div>
      </div>
    </div>
  );
};

MfaDialog.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onSubmit: PropTypes.func.isRequired,
  onCancel: PropTypes.func.isRequired,
  loading: PropTypes.bool,
  error: PropTypes.string,
  provider: PropTypes.string.isRequired,
  expiresAt: PropTypes.oneOfType([
    PropTypes.string,
    PropTypes.instanceOf(Date)
  ])
};

MfaDialog.defaultProps = {
  loading: false,
  error: null,
  expiresAt: null
};

export default MfaDialog;

