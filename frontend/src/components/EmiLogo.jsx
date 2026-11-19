import React, { useId } from "react";

// EMI Manager mark — a rupee on a card with instalment ticks. Indigo tile, matching the accent used inside the app. Pure SVG.
export default function EmiLogo({ size = 34, className = "" }) {
  const uid = useId().replace(/:/g, "");
  return (
    <svg className={"logo " + className} width={size} height={size} viewBox="0 0 48 48" role="img" aria-label="EMI Manager">
      <defs>
        <linearGradient id={`em-bg-${uid}`} x1="0" y1="0" x2="48" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#6d8cf0" />
          <stop offset="1" stopColor="#2c3f9e" />
        </linearGradient>
        <linearGradient id={`em-shine-${uid}`} x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".24" />
          <stop offset=".55" stopColor="#fff" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#em-bg-${uid})`} />
      <rect width="48" height="48" rx="14" fill={`url(#em-shine-${uid})`} />
      <rect x=".75" y=".75" width="46.5" height="46.5" rx="13.25" fill="none" stroke="#fff" strokeOpacity=".2" strokeWidth="1.5" />
      {/* the card */}
      <rect x="8.500" y="12" width="31" height="24" rx="4" fill="#fff" fillOpacity=".93" />
      {/* rupee */}
      <path d="M17 17.500h10M17 21h10M17 17.500c5 0 7 1.400 7 3.500s-2.200 3.500-7 3.500l7 6" fill="none" stroke="#2c3f9e" strokeWidth="2.200" strokeLinecap="round" strokeLinejoin="round" />
      {/* instalment ticks: two paid, one to come */}
      <circle cx="31.500" cy="30.500" r="1.800" fill="#2c9a6a" />
      <circle cx="35.500" cy="30.500" r="1.800" fill="#2c9a6a" />
      <circle cx="31.500" cy="25.500" r="1.800" fill="#2c3f9e" fillOpacity=".25" />
      <circle cx="35.500" cy="25.500" r="1.800" fill="#2c3f9e" fillOpacity=".25" />
    </svg>
  );
}
