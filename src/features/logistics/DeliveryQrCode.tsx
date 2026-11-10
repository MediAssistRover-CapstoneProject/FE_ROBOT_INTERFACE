import qrcode from 'qrcode-generator';
import { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

export function DeliveryQrCode({ payload, size }: { payload: string; size: number }) {
  const { modules, path } = useMemo(() => {
    const qr = qrcode(0, 'M');
    qr.addData(payload, 'Byte');
    qr.make();

    const modules = qr.getModuleCount();
    const pixels: string[] = [];
    for (let row = 0; row < modules; row += 1) {
      for (let col = 0; col < modules; col += 1) {
        if (qr.isDark(row, col)) pixels.push(`M${col + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { modules, path: pixels.join('') };
  }, [payload]);

  const dimension = modules + 8;
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${dimension} ${dimension}`} accessible accessibilityLabel="Mã QR xác thực giao nhận">
      <Rect width={dimension} height={dimension} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
