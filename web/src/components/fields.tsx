import type { ReactNode } from "react";

type TextFieldProps = {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  hint?: string;
  prefix?: string;
  suffix?: string;
  inputMode?: "decimal" | "numeric" | "text";
  placeholder?: string;
};

/** A labelled text input. Errors are linked with aria-describedby and marked invalid. */
export function TextField({
  id,
  label,
  value,
  onChange,
  error,
  hint,
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
      <label htmlFor={id} className="block text-sm font-medium">
        {label}
      </label>
      <div
        className={`mt-1 flex items-center rounded-lg border bg-white px-3 focus-within:ring-2 focus-within:ring-emerald-600 ${
          error ? "border-red-700" : "border-stone-300"
        }`}
      >
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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          onChange={(e) => onChange(e.target.value)}
        />
        {suffix && (
          <span className="ml-1 text-stone-500" aria-hidden="true">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <p id={`${id}-hint`} className="mt-1 text-xs text-stone-600">
          {hint}
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
