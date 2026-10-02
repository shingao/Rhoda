import type { CSSProperties } from "react";
import s from "./Slider.module.css";

interface SliderProps {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  label: string;
  valueText: string;
}

/** Range slider (maquette 09 « Largeur de colonne »): accent fill up to the handle. */
export function Slider({ value, min, max, step, onChange, label, valueText }: SliderProps) {
  const fill = { "--slider-fill": `${((value - min) / (max - min)) * 100}%` } as CSSProperties;
  return (
    <input
      type="range"
      className={s.slider}
      style={fill}
      min={min}
      max={max}
      step={step}
      value={value}
      aria-label={label}
      aria-valuetext={valueText}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
}
