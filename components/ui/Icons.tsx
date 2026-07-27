import React from 'react';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { Occasion } from '../../lib/mock/data';

export function BoltIcon({ size = 24, color = '#FFB800' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M13 2.5L5 13.2h5.6L9.4 21.5l9-11.2h-6.2l.8-7.8z" fill={color} />
    </Svg>
  );
}

export function HomeIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Path
        d="M4 10.5L12 4l8 6.5V20a1 1 0 01-1 1h-5v-6h-4v6H5a1 1 0 01-1-1v-9.5z"
        stroke={color}
        strokeWidth={1.9}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

export function BookingsIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="3.4" y="5.6" width="17.2" height="14.4" rx="3" stroke={color} strokeWidth={1.9} />
      <Path d="M3.4 10h17.2" stroke={color} strokeWidth={1.9} />
      <Path d="M8 3v4M16 3v4" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
    </Svg>
  );
}

export function WalletIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Rect x="3" y="6" width="18" height="13" rx="3" stroke={color} strokeWidth={1.9} />
      <Path d="M15 12.5h3" stroke={color} strokeWidth={1.9} strokeLinecap="round" />
      <Path d="M3 9.5h18" stroke={color} strokeWidth={1.9} />
    </Svg>
  );
}

export function ProfileIcon({ color }: { color: string }) {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="8.5" r="3.6" stroke={color} strokeWidth={1.9} />
      <Path
        d="M5 20c.9-3.4 3.6-5.2 7-5.2s6.1 1.8 7 5.2"
        stroke={color}
        strokeWidth={1.9}
        strokeLinecap="round"
      />
    </Svg>
  );
}

// Occasion icons ported from the design canvas
export function OccasionIcon({ occasion, size = 19 }: { occasion: Occasion; size?: number }) {
  switch (occasion) {
    case 'Wedding':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="9.6" cy="15" r="4.6" stroke="#E8A33D" strokeWidth={2.2} />
          <Circle cx="15.4" cy="15" r="4.6" stroke="#F2C14E" strokeWidth={2.2} />
          <Path d="M12.5 4.2l2.1 2.6-2.1 2.3-2.1-2.3z" fill="#6FD3E0" />
          <Path d="M10.4 6.8h4.2" stroke="#fff" strokeWidth={1} strokeLinecap="round" />
        </Svg>
      );
    case 'Events':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="3.4" y="5.6" width="17.2" height="14.4" rx="3" fill="#FFD98A" />
          <Path d="M3.4 8.6c0-1.7 1.3-3 3-3h11.2c1.7 0 3 1.3 3 3v1.8H3.4V8.6z" fill="#E8863D" />
          <Rect x="7.2" y="2.8" width="2" height="4.2" rx="1" fill="#B96A20" />
          <Rect x="14.8" y="2.8" width="2" height="4.2" rx="1" fill="#B96A20" />
          <Circle cx="9" cy="14.2" r="1.5" fill="#EF6F7E" />
          <Circle cx="15" cy="14.2" r="1.5" fill="#6FD3E0" />
        </Svg>
      );
    case 'Portraits':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="2.6" y="6.8" width="18.8" height="13.4" rx="3.2" fill="#F2C14E" />
          <Path d="M8.6 6.8l1.3-2.2h4.2l1.3 2.2H8.6z" fill="#B96A20" />
          <Circle cx="12" cy="13.4" r="4.4" fill="#FFF3D0" />
          <Circle cx="12" cy="13.4" r="2.5" fill="#E8863D" />
          <Circle cx="18" cy="10" r="1" fill="#fff" />
        </Svg>
      );
    case 'Social':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Rect x="6" y="2.4" width="12" height="19.2" rx="3" fill="#6FD3E0" />
          <Rect x="7.8" y="5.2" width="8.4" height="12.2" rx="1.6" fill="#EAFBFD" />
          <Path
            d="M12 15.2s-3-1.9-3-3.9a1.6 1.6 0 013-.8 1.6 1.6 0 013 .8c0 2-3 3.9-3 3.9z"
            fill="#EF6F7E"
          />
          <Circle cx="12" cy="19.4" r="1" fill="#EAFBFD" />
        </Svg>
      );
    case 'Family':
      return (
        <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
          <Circle cx="7.4" cy="8" r="3" fill="#E8863D" />
          <Path d="M2.6 19.4c.7-2.9 2.5-4.4 4.8-4.4s4.1 1.5 4.8 4.4H2.6z" fill="#F2A05C" />
          <Circle cx="16.6" cy="8" r="3" fill="#8ED7A6" />
          <Path d="M12.2 19.4c.7-2.9 2.2-4.4 4.4-4.4s3.9 1.5 4.6 4.4h-9z" fill="#A9E4BC" />
          <Circle cx="12" cy="12.6" r="2.3" fill="#F2C14E" />
          <Path d="M8.6 19.4c.5-2.1 1.7-3.2 3.4-3.2s2.9 1.1 3.4 3.2H8.6z" fill="#FFD98A" />
        </Svg>
      );
  }
}
