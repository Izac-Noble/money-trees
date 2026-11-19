import type { ReactNode } from "react";
import { describeTerm } from "../lib/term";
import type { TermUnit } from "../lib/storage";

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  /** Shown only when the caller decides it should be (see useTouched). */
  error?: string;
  hint?: string;
  required?: boolean;
  prefix?: string;
  suffix?: string;
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
};

/** "(required)" in the label, so users know up front what's needed. */
function FieldLabel({
  htmlFor,
  id,
  label,
  required,
}: {
  htmlFor?: string;
  id?: string;
  label: string;
  required?: boolean;
}) {
  const content = (
    <>
      {label}
      {required && <span className="ml-1 text-xs font-normal text-stone-600">(required)</span>}
    </>
  );
  return htmlFor ? (
    <label htmlFor={htmlFor} id={id} className="block text-sm font-medium">
      {content}
    </label>
  ) : (
    <span id={id} className="block text-sm font-medium">
      {content}
    </span>
  );
}

function boxClass(error: string | undefined): string {
  return `flex items-center rounded-lg bg-white px-3 focus-within:ring-2 focus-within:ring-emerald-600 ${
    error ? "border-2 border-red-700" : "border border-stone-300"
  }`;
}

/** A labelled text input. Errors are linked with aria-describedby and marked invalid. */
export function TextField({
  id,
  label,
  value,
  onChange,
  onBlur,
  error,
  hint,
  required,
  prefix,
  suffix,
  inputMode = "decimal",
  placeholder,
}: TextFieldProps) {
  const describedBy = [hint ? `${id}-hint` : null, error ? `${id}-error` : null]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} required={required} />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-stone-600">
          {hint}
        </p>
      )}
      <div className={`mt-1 ${boxClass(error)}`}>
        {prefix && (
          <span className="mr-1 text-stone-500" aria-hidden="true">
            {prefix}
          </span>
        )}
        <input
          id={id}
          type="text"
          inputMode={inputMode}
          autoComplete="off"
          className="w-full min-w-0 bg-transparent py-2 outline-none"
          value={value}
          placeholder={placeholder}
          aria-required={required || undefined}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
        />
        {suffix && (
          <span className="ml-1 text-stone-500" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {error && <FieldMessage id={`${id}-error`}>{error}</FieldMessage>}
    </div>
  );
}

type TermFieldProps = {
  id: string;
  label: string;
  value: string;
  unit: TermUnit;
  onChange: (value: string) => void;
  onUnitChange: (unit: TermUnit) => void;
  onBlur?: () => void;
  error?: string;
  hint?: string;
  required?: boolean;
};

/**
 * One number plus a visible Years / Months toggle, with the conversion shown under
 * the field ("= 48 months"). Used for the loan term and each debt's time left.
 */
export function TermField({
  id,
  label,
  value,
  unit,
  onChange,
  onUnitChange,
  onBlur,
  error,
  hint,
  required,
}: TermFieldProps) {
  const conversion = error ? null : describeTerm(value, unit);
  const describedBy = [
    hint ? `${id}-hint` : null,
    conversion ? `${id}-conversion` : null,
    error ? `${id}-error` : null,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="min-w-0">
      <FieldLabel htmlFor={id} label={label} required={required} />
      {hint && (
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-stone-600">
          {hint}
        </p>
      )}
      <div className="mt-1 flex gap-2">
        <div className={`min-w-0 flex-1 ${boxClass(error)}`}>
          <input
            id={id}
            type="text"
            inputMode={unit === "years" ? "numeric" : "numeric"}
            autoComplete="off"
            className="w-full min-w-0 bg-transparent py-2 outline-none"
            value={value}
            aria-required={required || undefined}
            aria-invalid={error ? true : undefined}
            aria-describedby={describedBy || undefined}
            onChange={(e) => onChange(e.target.value)}
            onBlur={onBlur}
          />
        </div>
        <div
          role="group"
          aria-label={`${label} unit`}
          className="flex shrink-0 overflow-hidden rounded-lg border border-stone-300"
        >
          {(["years", "months"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={unit === option}
              className={`px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-emerald-700 ${
                unit === option
                  ? "bg-emerald-800 text-white"
                  : "bg-white text-stone-800 hover:bg-stone-50"
              }`}
              onClick={() => onUnitChange(option)}
            >
              {option === "years" ? "Years" : "Months"}
            </button>
          ))}
        </div>
      </div>
      {conversion && (
        <p id={`${id}-conversion`} className="mt-1 text-xs text-stone-600">
          {conversion}
        </p>
      )}
      {error && <FieldMessage id={`${id}-error`}>{error}</FieldMessage>}
    </div>
  );
}

/** An error message under a field. The "Error:" prefix means color isn't the only signal. */
export function FieldMessage({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={id} className="mt-1 text-sm text-red-800">
      <span className="font-semibold">Error: </span>
      {children}
    </p>
  );
}

export function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-stone-200 bg-white p-3">
      <dt className="text-xs text-stone-600">{label}</dt>
      <dd className="mt-1 text-lg font-semibold break-words">{value}</dd>
    </div>
  );
}
