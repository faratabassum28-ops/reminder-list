import React, { useId } from "react";

// Certificate Studio mark — a certificate with a ribbon seal. Rose tile, matching the accent used inside the app. Pure SVG.
export default function CertificatesLogo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Certificate Studio">
      <defs>
        <linearGradient id={`cs-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#e5628f" />
          <stop offset="1" stopColor="#9d1f4b" />
        </linearGradient>
        <linearGradient id={`cs-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#cs-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#cs-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      {/* the certificate */}
      <rect x="9" y="12" width="30" height="22" rx="3" fill="#fff" fillOpacity=".93" />
      <path d="M14 18.500h20M14 23h13" stroke="#9d1f4b" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <path d="M14 28.500h7" stroke="#9d1f4b" strokeOpacity=".3" strokeWidth="2" strokeLinecap="round" />
      {/* seal with ribbon tails */}
      <path d="M30.500 34.500 29 42l4-2.200 4 2.200-1.500-7.500Z" fill="#f5b942" />
      <circle cx="33" cy="30.500" r="5.600" fill="#f5b942" stroke="#fff" strokeWidth="1.600" />
      <path d="m30.500 30.500 1.800 1.800 3.200-3.400" fill="none" stroke="#9d1f4b" strokeWidth="1.800" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
