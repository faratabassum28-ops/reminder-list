import React, { useId } from "react";

// Order Analytics mark — a parcel with rising bars. Emerald tile, matching the Order Analytics accent inside the app. Pure SVG.
export default function OrdersLogo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="Order Analytics">
      <defs>
        <linearGradient id={`or-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#3fc58d" />
          <stop offset="1" stopColor="#13694b" />
        </linearGradient>
        <linearGradient id={`or-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#or-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#or-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      {/* parcel */}
      <path d="M10 18.500 24 11l14 7.500v13L24 39l-14-7.500v-13Z" fill="#fff" fillOpacity=".92" />
      <path d="M10 18.500 24 26l14-7.500M24 26v13" fill="none" stroke="#13694b" strokeOpacity=".35" strokeWidth="1.600" strokeLinejoin="round" />
      {/* rising bars on the front face */}
      <path d="M16 33v-3M20.500 34.500V28M25 33V25" transform="translate(0 -1)" stroke="#13694b" strokeWidth="2.600" strokeLinecap="round" />
    </svg>
  );
}
