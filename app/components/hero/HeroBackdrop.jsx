"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { prefersReducedMotion } from "../globe/geo";

gsap.registerPlugin(useGSAP);

const CONTOUR_COUNT = 6;
const contourPaths = Array.from({ length: CONTOUR_COUNT }, (_, index) => {
  const y = 26 * index;
  return `M-60 ${168 + y} C70 ${118 + y} 105 ${232 + y} 224 ${188 + y} S365 ${91 + y} 498 ${148 + y} 615 ${221 + y} 744 ${165 + y} 872 ${89 + y} 1015 ${153 + y} 1134 ${239 + y} 1280 ${160 + y}`;
});

const embers = [
  { left: "14%", top: "66%" },
  { left: "23%", top: "83%" },
  { left: "47%", top: "13%" },
  { left: "88%", top: "71%" },
  { left: "65%", top: "88%" },
  { left: "75%", top: "17%" },
];

// Drawn terrain contours and drifting embers behind the globe.
function HeroBackdrop() {
  const rootRef = useRef(null);

  useGSAP(
    () => {
      if (prefersReducedMotion()) return;

      gsap.fromTo(
        "[data-contour]",
        { strokeDashoffset: 1 },
        { strokeDashoffset: 0, duration: 2, stagger: 0.12, ease: "power2.out" },
      );
      gsap.to("[data-contour-group]", {
        x: 26,
        duration: 9,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
      });
      gsap.to("[data-ember]", {
        y: -26,
        x: 8,
        opacity: 0,
        duration: 2.8,
        stagger: { each: 0.3, from: "random" },
        repeat: -1,
        ease: "power1.out",
      });
    },
    { scope: rootRef },
  );

  return (
    <div ref={rootRef} className="hero-backdrop" aria-hidden="true">
      <div className="hero-grid" />
      <svg className="hero-contours" viewBox="0 0 1280 420" preserveAspectRatio="xMidYMid slice">
        <g data-contour-group fill="none" stroke="currentColor">
          {contourPaths.map((path) => (
            <path key={path} data-contour pathLength="1" strokeDasharray="1" d={path} />
          ))}
        </g>
      </svg>
      {embers.map((ember) => (
        <i key={`${ember.left}-${ember.top}`} data-ember className="hero-ember" style={ember} />
      ))}
      <div className="hero-vignette" />
    </div>
  );
}

export default HeroBackdrop;
