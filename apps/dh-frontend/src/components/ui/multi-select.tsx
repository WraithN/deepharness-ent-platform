/**
 * @file Custom multi-select dropdown component
 */

import { Check, ChevronUp, X } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

interface Option {
  value: string;
  label: string;
}

interface MultiSelectProps {
  options: Option[];
  value?: string[];
  defaultSelected?: string[];
  placeholder?: string;
  className?: string;
  triggerClassName?: string;
  onChange?: (selected: string[]) => void;
  disabled?: boolean;
  dropdownPosition?: 'top' | 'bottom';
}

const MultiSelect: React.FC<MultiSelectProps> = ({
  options,
  defaultSelected = [],
  value,
  placeholder = '请选择...',
  className,
  triggerClassName,
  onChange,
  disabled = false,
  dropdownPosition = 'bottom',
}) => {
  const [selectedOptions, setSelectedOptions] =
    useState<string[]>(defaultSelected);
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const toggleDropdown = () => {
    if (!disabled) setIsOpen((prev) => !prev);
  };

  useEffect(() => {
    if (selectedOptions.length && value && !value?.length) {
      onChange?.(defaultSelected);
    }
  }, [defaultSelected]);

  useEffect(() => {
    if (
      value?.length &&
      (value.length !== selectedOptions.length ||
        value.some((val) => !selectedOptions.includes(val)))
    ) {
      setSelectedOptions(value);
    }
  }, [value, selectedOptions]);

  const handleSelect = (optionValue: string) => {
    const newSelectedOptions = selectedOptions.includes(optionValue)
      ? selectedOptions.filter((value) => value !== optionValue)
      : [...selectedOptions, optionValue];

    setSelectedOptions(newSelectedOptions);
    onChange?.(newSelectedOptions);
  };

  const removeOption = (value: string) => {
    const newSelectedOptions = selectedOptions.filter((opt) => opt !== value);
    setSelectedOptions(newSelectedOptions);
    onChange?.(newSelectedOptions);
  };

  const selectedValuesText = selectedOptions.map(
    (value) => options.find((option) => option.value === value)?.label || ""
  );

  return (
    <div className={cn("relative w-full", className)} ref={containerRef}>
      {/* 触发框 */}
      <div
        onClick={toggleDropdown}
        className={cn(
          "group flex w-full items-center justify-between gap-2 rounded-lg border border-input bg-background px-3 py-2 shadow-sm transition-all",
          disabled
            ? 'cursor-not-allowed opacity-50'
            : 'cursor-pointer hover:border-input/80 hover:shadow-sm focus-within:border-ring focus-within:shadow-[0_0_0_3px_hsl(var(--ring)/0.08)]',
          triggerClassName,
        )}
      >
        <div className="flex flex-wrap items-center gap-2 flex-1">
          {selectedValuesText.length > 0 ? (
            selectedValuesText.map((text, index) => (
              <span
                key={index}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary"
              >
                {text}
                {!disabled && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeOption(selectedOptions[index]);
                    }}
                    className="text-primary/70 hover:text-primary transition-colors"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))
          ) : (
            <span className="text-sm text-muted-foreground">{placeholder}</span>
          )}
        </div>
        <ChevronUp
          className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
            isOpen ? "" : "rotate-180"
          }`}
        />
      </div>

      {/* 下拉面板 */}
      {isOpen && (
        <div
          className={`absolute left-0 right-0 z-50 rounded-lg border border-border bg-popover py-2 shadow-[0_-10px_24px_rgba(0,0,0,0.12),0_-2px_6px_rgba(0,0,0,0.08)] ${
            dropdownPosition === 'top'
              ? 'bottom-[calc(100%+8px)]'
              : 'top-[calc(100%+8px)]'
          }`}
          onClick={(e) => e.stopPropagation()}
        >
          {/* 向下小三角 */}
          <div
            className={`absolute left-4 h-3 w-3 bg-popover border-border rotate-45 ${
              dropdownPosition === 'top' ? '-bottom-1.5 border-r border-b' : '-top-1.5 border-l border-t'
            }`}
          />
          <div className="relative flex flex-col px-2">
            {options.map((option) => {
              const isSelected = selectedOptions.includes(option.value);
              return (
                <div
                  key={option.value}
                  className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    isSelected
                      ? "bg-primary/5 text-primary"
                      : "text-foreground hover:bg-muted"
                  }`}
                  onClick={() => handleSelect(option.value)}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check className="h-4 w-4" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelect;
