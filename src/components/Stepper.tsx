import { Minus, Plus } from "lucide-react";
import s from "./Stepper.module.css";

interface StepperProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  decreaseLabel: string;
  increaseLabel: string;
  format: (value: number) => string;
}

/** Number stepper (maquette 09 « Taille ») : − value +, arrows also step when the value is focused. */
export function Stepper({ value, min, max, step, onChange, label, decreaseLabel, increaseLabel, format }: StepperProps) {
  const set = (v: number) => onChange(Math.min(max, Math.max(min, Math.round(v / step) * step)));
  return (
    <div className={s.stepper}>
      <button type="button" className={s.button} aria-label={decreaseLabel} disabled={value <= min} onClick={() => set(value - step)}>
        <Minus aria-hidden />
      </button>
      <div
        className={s.value}
        role="spinbutton"
        tabIndex={0}
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={format(value)}
        onKeyDown={(e) => {
          const delta = e.key === "ArrowUp" || e.key === "ArrowRight" ? step : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -step : 0;
          if (e.key === "Home") set(min);
          else if (e.key === "End") set(max);
          else if (delta) set(value + delta);
          else return;
          e.preventDefault();
        }}
      >
        {format(value)}
      </div>
      <button type="button" className={s.button} aria-label={increaseLabel} disabled={value >= max} onClick={() => set(value + step)}>
        <Plus aria-hidden />
      </button>
    </div>
  );
}
