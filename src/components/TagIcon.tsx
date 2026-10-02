import { Hash } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";

interface TagIconProps {
  /** Lucide icon name chosen for the tag; none = `hash`. */
  name: string | undefined;
  className?: string;
  style?: React.CSSProperties;
}

/** Icon of a tag: the chosen Lucide icon, loaded on demand, or a hash sign. */
export function TagIcon({ name, className, style }: TagIconProps) {
  if (!name) return <Hash className={className} style={style} aria-hidden />;
  return <DynamicIcon name={name as IconName} className={className} style={style} aria-hidden fallback={() => <Hash className={className} style={style} aria-hidden />} />;
}
