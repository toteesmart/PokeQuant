import { GlassSheet } from './ui';
import { AddAssetForm } from './AddAssetForm';

type AddAssetModalProps = {
  visible: boolean;
  onClose: () => void;
};

export function AddAssetModal({ visible, onClose }: AddAssetModalProps) {
  if (!visible) return null;

  return (
    <GlassSheet
      title="Add a card by hand"
      onClose={onClose}
      keyboardAware
      scrollProps={{
        keyboardDismissMode: 'interactive',
        keyboardShouldPersistTaps: 'handled',
      }}
    >
      <AddAssetForm onComplete={onClose} onCancel={onClose} />
    </GlassSheet>
  );
}
