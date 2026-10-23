import { useEffect, useState } from 'react';
export function NumberField({
  label,
  value,
  onChange,
  min = -100000,
  max = 100000,
  step = 50,
  unit = 'mm',
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
}) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(Math.round(value * 100) / 100)), [value]);
  const finish = () => {
    const n = Number(text);
    if (text.trim() && Number.isFinite(n) && n >= min && n <= max) {
      if (n !== value) onChange(n);
    } else setText(String(value));
  };
  return (
    <label className="field">
      <span>
        {label}
        <small>{unit}</small>
      </span>
      <input
        aria-label={label}
        aria-description={unit}
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={finish}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <label className="field">
      <span>{label}</span>
      <input
        value={text}
        maxLength={150}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== value) onChange(text);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur();
        }}
      />
    </label>
  );
}
export function Section({
  title,
  children,
  extra,
}: {
  title: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}) {
  return (
    <section className="section">
      <div className="section-title">
        <h3>{title}</h3>
        {extra}
      </div>
      {children}
    </section>
  );
}
