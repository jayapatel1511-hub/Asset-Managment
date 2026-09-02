/**
 * Phase 0 placeholder so App.tsx's new routes render something real instead of a blank screen
 * while their owning workstream builds the actual page (specs/REMAINING-WORK.md). Each page that
 * uses this deletes the import and this component entirely once it has real content — nothing
 * else in the app depends on this file, so removing the import from a screen is never a
 * cross-workstream edit.
 */
import { Text, Title2, tokens } from "@fluentui/react-components";

export function ComingSoon({ title, workstream, spec }: { title: string; workstream: string; spec: string }) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
      <Title2>{title}</Title2>
      <Text style={{ color: tokens.colorNeutralForeground3 }}>
        Not built yet — owned by {workstream}. See {spec}.
      </Text>
    </div>
  );
}
