import { useEffect } from 'react';
import { View } from 'react-native';
import SyncTestRunner from './src/engine/SyncTestRunner';

export default function App() {
  useEffect(() => {
    SyncTestRunner.runAll('test_vendor_01')
      .then(() => {
        console.log('====== HEADLESS SYNC TEST COMPLETE ======');
      })
      .catch((error) => {
        console.error('====== HEADLESS SYNC TEST FAILED ======', error);
      });
  }, []);

  return <View style={{ flex: 1, backgroundColor: '#0e1117' }} />;
}
