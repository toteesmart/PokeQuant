import type { ReactNode } from 'react';
import { GlassSheet } from '../ui';

export const OrganizerModalSheet = function OrganizerModalSheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <GlassSheet
      title={title}
      onClose={onClose}
      keyboardAware
      scrollProps={{ keyboardShouldPersistTaps: 'handled' }}
    >
      {children}
    </GlassSheet>
  );
};
