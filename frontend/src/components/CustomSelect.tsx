import React, { useEffect, useRef, useState } from 'react';

export interface SelectOption {
  value: string;
  label: string;
  badge?: string;
  badgeColor?: string;
  icon?: React.ReactNode;
}

interface CustomSelectProps {
  id: string;
  value: string;
  options: SelectOption[];
  onChange: (val: string) => void;
  placeholder?: string;
}

export const CustomSelect: React.FC<CustomSelectProps> = ({
  id,
  value,
  options,
  onChange,
  placeholder = 'Select an option',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      setIsOpen(false);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setIsOpen((prev) => !prev);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currentIndex = options.findIndex((opt) => opt.value === value);
        if (currentIndex < options.length - 1) {
          onChange(options[currentIndex + 1].value);
        }
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      } else {
        const currentIndex = options.findIndex((opt) => opt.value === value);
        if (currentIndex > 0) {
          onChange(options[currentIndex - 1].value);
        }
      }
    }
  };

  return (
    <div className="custom-select-container" ref={containerRef}>
      {/* Hidden native select for standard accessibility and automated test compatibility */}
      <select
        id={id}
        aria-hidden="true"
        tabIndex={-1}
        className="accessible-hidden-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>

      <div
        className={`custom-select-trigger ${isOpen ? 'open' : ''} ${value ? 'has-value' : ''}`}
        onClick={() => setIsOpen((prev) => !prev)}
        onKeyDown={handleKeyDown}
        role="button"
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-controls={`${id}-popup`}
        tabIndex={0}
      >
        <div className="custom-select-value">
          {selectedOption ? (
            <div className="custom-select-item-content">
              {selectedOption.icon && (
                <span className="custom-select-icon">{selectedOption.icon}</span>
              )}
              <span className="custom-select-text">{selectedOption.label}</span>
              {selectedOption.badge && (
                <span
                  className="custom-select-chip"
                  style={{ backgroundColor: selectedOption.badgeColor || 'var(--bg-hover)' }}
                >
                  {selectedOption.badge}
                </span>
              )}
            </div>
          ) : (
            <span className="custom-select-placeholder">{placeholder}</span>
          )}
        </div>
        <div className={`custom-select-arrow ${isOpen ? 'up' : 'down'}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M2.5 4.5L6 8L9.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      </div>

      {isOpen && (
        <div className="custom-select-dropdown" id={`${id}-popup`} role="listbox">
          {options.map((opt) => {
            const isSelected = opt.value === value;
            return (
              <div
                key={opt.value}
                className={`custom-select-option ${isSelected ? 'selected' : ''}`}
                onClick={() => {
                  onChange(opt.value);
                  setIsOpen(false);
                }}
                role="option"
                aria-selected={isSelected}
              >
                <div className="custom-select-item-content">
                  {opt.icon && <span className="custom-select-icon">{opt.icon}</span>}
                  <span className="custom-select-text">{opt.label}</span>
                  {opt.badge && (
                    <span
                      className="custom-select-chip"
                      style={{ backgroundColor: opt.badgeColor || 'var(--bg-hover)' }}
                    >
                      {opt.badge}
                    </span>
                  )}
                </div>
                {isSelected && (
                  <span className="custom-select-check">
                    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                      <path
                        d="M2.5 6L5 8.5L9.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
