import { requireNativeView } from 'expo';
import * as React from 'react';

import type { PcsLidarArViewProps } from './PcsLidarAr.types';

// 'PcsLidarAr' MUST equal Name("PcsLidarAr") in PcsLidarArModule.swift.
const NativeView: React.ComponentType<PcsLidarArViewProps & { ref?: React.Ref<any> }> =
  requireNativeView('PcsLidarAr');

const PcsLidarArView = React.forwardRef<any, PcsLidarArViewProps>((props, ref) => {
  return <NativeView ref={ref} {...props} />;
});

PcsLidarArView.displayName = 'PcsLidarArView';

export default PcsLidarArView;
