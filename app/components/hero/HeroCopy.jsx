"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Button from "../Button";
import { prefersReducedMotion } from "../globe/geo";
import { playCopyIn, playCopyOut } from "./copyMotion";

gsap.registerPlugin(useGSAP);

// Headline, supporting copy and the primary action. Slides away while the globe takes over.
function HeroCopy({ phase, onViewHotspots }) {
  const rootRef = useRef(null);
  const hasMounted = useRef(false);
  const expanded = phase === "flying" || phase === "country";

  useGSAP(
    () => {
      const root = rootRef.current;
      const firstRun = !hasMounted.current;
      hasMounted.current = true;

      if (prefersReducedMotion()) {
        gsap.set(root, { visibility: expanded ? "hidden" : "visible" });
      } else if (expanded) {
        playCopyOut(root);
      } else {
        playCopyIn(root, firstRun ? 0.15 : 0);
      }
    },
    { scope: rootRef, dependencies: [expanded] },
  );

  return (
    <div ref={rootRef} className="hero-copy" id="top">
      <div className="hero-kicker" data-copy-part>
        <span className="kicker-rule" />
        <span>THERMAL INTELLIGENCE</span>
        <span className="kicker-index">/ 01</span>
      </div>

      <h1 className="hero-title" id="firewatch-title">
        <span className="hero-title-line">
          <span data-title-line>Before the</span>
        </span>
        <span className="hero-title-line">
          <span data-title-line className="title-italic">smoke,</span>
        </span>
        <span className="hero-title-line">
          <span data-title-line className="title-signal">there&apos;s a signal.</span>
        </span>
      </h1>

      <p className="hero-description" data-copy-part>
        Fire leaves a thermal signature before it leaves a skyline. Firewatch fuses MODIS and
        VIIRS detections into an earlier, clearer picture of emerging heat.
      </p>

      <div className="hero-actions" data-copy-part>
        <Button
          text={phase === "locating" ? "Locating you…" : "View Hotspots"}
          onClick={onViewHotspots}
          disabled={phase !== "orbit"}
        />
        <a
          className="hero-text-link"
          href="https://firms.modaps.eosdis.nasa.gov/map/"
          target="_blank"
          rel="noreferrer"
        >
          EXPLORE NASA FIRMS <span aria-hidden="true">↗</span>
        </a>
      </div>

      <div className="hero-specs" data-copy-part>
        <div className="hero-spec">
          <span className="spec-value">375<span>m</span></span>
          <span className="spec-label">VIIRS PIXEL SCALE</span>
        </div>
        <span className="spec-divider" />
        <div className="hero-spec">
          <span className="spec-value">24<span>h</span></span>
          <span className="spec-label">LIVE DETECTION WINDOW</span>
        </div>
        <span className="spec-footnote">THERMAL ANOMALY PRODUCTS</span>
      </div>
    </div>
  );
}

export default HeroCopy;
