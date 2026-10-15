import { SegmentedPills } from '../ui/SegmentedPills';
import {
  HORIZON_OPTIONS,
  type Horizon,
} from '../../services/salesAnalytics';
import { StyleSheet } from 'react-native';
import { spacing } from '../../constants/theme';

export function TimeHorizonFilter({
  horizon,
  onChange,
}: {
  horizon: Horizon;
  onChange: (h: Horizon) => void;
}) {
  return (
    <SegmentedPills
      tabs={HORIZON_OPTIONS}
      activeTab={horizon}
      onChange={onChange}
      style={filterStyles.rail}
    />
  );
}


const filterStyles = StyleSheet.create({
  rail: {
    marginTop: 0,
    marginBottom: spacing['4xl'],
  },
});

