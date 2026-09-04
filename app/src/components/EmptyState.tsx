import type { ReactNode } from "react";
import { Glyph, type GlyphName } from "./Glyph";

export function EmptyState({
  title,
  icon,
  children,
}: {
  title?: string;
  icon?: GlyphName;
  children?: ReactNode;
}) {
  return (
    <div className="ams-empty">
      {icon && (
        <span className="ams-empty-ico">
          <Glyph name={icon} size={24} className="ams-ico-lg" />
        </span>
      )}
      {title && <h3>{title}</h3>}
      {children && <div>{children}</div>}
    </div>
  );
}
