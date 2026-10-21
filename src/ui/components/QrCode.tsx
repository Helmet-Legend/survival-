/**
 * QR code dessiné dans le téléphone (aucun service en ligne) : modules noirs
 * sur fond blanc, marge réglementaire de 4 modules pour une lecture fiable.
 */
import qrcode from 'qrcode-generator';
import React, { useMemo } from 'react';
import Svg, { Path, Rect } from 'react-native-svg';

const QUIET_ZONE = 4;

export function QrCode(props: { text: string; size: number }) {
  const { path, count } = useMemo(() => {
    // Type 0 : la plus petite version qui contient le texte ; correction M.
    const qr = qrcode(0, 'M');
    qr.addData(props.text, 'Byte');
    qr.make();
    const n = qr.getModuleCount();
    let d = '';
    for (let row = 0; row < n; row++) {
      for (let col = 0; col < n; col++) {
        if (qr.isDark(row, col)) {
          d += `M${col + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`;
        }
      }
    }
    return { path: d, count: n + QUIET_ZONE * 2 };
  }, [props.text]);

  return (
    <Svg
      width={props.size}
      height={props.size}
      viewBox={`0 0 ${count} ${count}`}
      accessibilityLabel="QR code d’association"
    >
      <Rect width={count} height={count} fill="#FFFFFF" />
      <Path d={path} fill="#000000" />
    </Svg>
  );
}
