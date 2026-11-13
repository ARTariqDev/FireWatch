"use client";

import { useRef } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import Button from "./Button";

gsap.registerPlugin(useGSAP);

const contourPaths = [
  "M-60 168 C70 118 105 232 224 188 S365 91 498 148 615 221 744 165 872 89 1015 153 1134 239 1280 160",
  "M-60 194 C70 144 105 258 224 214 S365 117 498 174 615 247 744 191 872 115 1015 179 1134 265 1280 186",
  "M-60 220 C70 170 105 284 224 240 S365 143 498 200 615 273 744 217 872 141 1015 205 1134 291 1280 212",
  "M-60 246 C70 196 105 310 224 266 S365 169 498 226 615 299 744 243 872 167 1015 231 1134 317 1280 238",
  "M-60 272 C70 222 105 336 224 292 S365 195 498 252 615 325 744 269 872 193 1015 257 1134 343 1280 264",
  "M-60 298 C70 248 105 362 224 318 S365 221 498 278 615 351 744 295 872 219 1015 283 1134 369 1280 290",
];

const embers = [
  { left: "14%", top: "66%", delay: 0 },
  { left: "23%", top: "83%", delay: 0.6 },
  { left: "75%", top: "17%", delay: 1.1 },
  { left: "88%", top: "71%", delay: 0.3 },
  { left: "65%", top: "88%", delay: 1.5 },
  { left: "47%", top: "13%", delay: 0.9 },
];

function Hero() {
  const heroRef = useRef(null);
  const sweepRef = useRef(null);
  const scanTimelineRef = useRef(null);

  useGSAP(
    () => {
      const hero = heroRef.current;
      const sweep = sweepRef.current;
      const signalPlate = hero?.querySelector("[data-signal-plate]");

      if (!hero || !sweep || !signalPlate) return;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const intro = gsap.timeline({ defaults: { ease: "power3.out" } });

      intro
        .fromTo(
          "[data-title-line]",
          { yPercent: 118, rotateX: -68, skewY: 7 },
          {
            yPercent: 0,
            rotateX: 0,
            skewY: 0,
            duration: 1.15,
            stagger: 0.12,
            ease: "power4.out",
          },
        )
        .fromTo(
          "[data-intro-copy]",
          { clipPath: "inset(0 100% 0 0)" },
          {
            clipPath: "inset(0 0% 0 0)",
            duration: 0.7,
            stagger: 0.12,
            ease: "power2.inOut",
          },
          "-=0.6",
        )
        .fromTo(
          signalPlate,
          {
            clipPath: "inset(0 0 0 100%)",
            rotateY: -10,
            x: 34,
            transformPerspective: 1100,
          },
          {
            clipPath: "inset(0 0 0 0)",
            rotateY: 0,
            x: 0,
            duration: 1.15,
            ease: "power4.inOut",
          },
          0.18,
        )
        .fromTo(
          "[data-panel-ui]",
          { y: 18, rotateX: 12, transformPerspective: 700 },
          { y: 0, rotateX: 0, duration: 0.65, stagger: 0.08 },
          "-=0.52",
        )
        .fromTo(
          "[data-contour]",
          { strokeDashoffset: 1 },
          { strokeDashoffset: 0, duration: 1.7, stagger: 0.1, ease: "power2.out" },
          0.2,
        )
        .fromTo(
          "[data-hotspot]",
          { scale: 0.2, transformOrigin: "50% 50%" },
          {
            scale: 1,
            duration: 0.55,
            stagger: 0.15,
            ease: "back.out(2.4)",
          },
          "-=0.9",
        );

      scanTimelineRef.current = gsap
        .timeline({ paused: true, repeat: -1 })
        .to(sweep, {
          rotation: 360,
          duration: 14,
          ease: "none",
          transformOrigin: "50% 50%",
        });
      scanTimelineRef.current.play(0.35);

      gsap.to("[data-orbit-pulse]", {
        scale: 1.45,
        opacity: 0.12,
        duration: 1.8,
        stagger: 0.5,
        repeat: -1,
        yoyo: true,
        ease: "sine.inOut",
        transformOrigin: "50% 50%",
      });

      gsap.to("[data-ember]", {
        y: -24,
        x: 7,
        opacity: 0,
        duration: 2.8,
        stagger: { each: 0.28, from: "random" },
        repeat: -1,
        ease: "power1.out",
      });

      return () => {
        scanTimelineRef.current = null;
      };
    },
    { scope: heroRef },
  );

  const replayScan = () => {
    scanTimelineRef.current?.restart();
  };

  return (
    <main className="firewatch-shell">
      <section
        ref={heroRef}
        className="firewatch-hero"
        aria-labelledby="firewatch-title"
      >
        <div className="hero-atmosphere" aria-hidden="true">
          <div className="hero-grid" />
          <div className="hero-heat-glow" />
          <svg
            className="hero-contours"
            viewBox="0 0 1280 420"
            preserveAspectRatio="xMidYMid slice"
          >
            <g fill="none" stroke="currentColor">
              {contourPaths.map((path) => (
                <path key={path} data-contour pathLength="1" d={path} />
              ))}
            </g>
          </svg>
          {embers.map((ember) => (
            <i
              key={`${ember.left}-${ember.top}`}
              data-ember
              className="hero-ember"
              style={{
                left: ember.left,
                top: ember.top,
                animationDelay: `${ember.delay}s`,
              }}
            />
          ))}
          <div className="hero-vignette" />
        </div>

        <div className="firewatch-frame">
          <header className="hero-nav">
            <a className="firewatch-brand" href="#top" aria-label="Firewatch home">
              <span className="brand-mark" aria-hidden="true">
                <svg viewBox="0 0 32 36" fill="none">
                  <path
                    d="M17.8 2.5c1.1 6.4-5.8 8.3-3.1 14.2 1.5-2.2 3.3-3.5 5.3-4.1 5.4 4.5 7.3 8.4 6.2 13.1-1 4.6-5.1 7.8-10.4 7.8S5.7 29.7 5.7 24.3c0-4.6 2.1-8 6.1-11.4-.2 4.5.7 6.3 2.7 7.1C11.5 12.8 18.3 9.2 17.8 2.5Z"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinejoin="round"
                  />
                </svg>
              </span>
              <span className="brand-wordmark">FIREWATCH</span>
              <span className="brand-divider" />
              <span className="brand-descriptor">EARLY SIGNAL SYSTEM</span>
            </a>

            <a
              className="nav-reference"
              href="https://firms.modaps.eosdis.nasa.gov/map/"
              target="_blank"
              rel="noreferrer"
            >
              NASA FIRMS <span aria-hidden="true">↗</span>
            </a>
          </header>

          <div className="hero-main-grid" id="top">
            <div className="hero-copy">
              <div className="hero-kicker" data-intro-copy>
                <span className="kicker-rule" />
                <span>THERMAL INTELLIGENCE</span>
                <span className="kicker-index">/ 01</span>
              </div>

              <h1 className="hero-title" id="firewatch-title">
                <span className="hero-title-line">
                  <span data-title-line>Before the</span>
                </span>
                <span className="hero-title-line">
                  <span data-title-line className="title-italic">
                    smoke,
                  </span>
                </span>
                <span className="hero-title-line">
                  <span data-title-line className="title-signal">
                    there&apos;s a signal.
                  </span>
                </span>
              </h1>

              <p className="hero-description" data-intro-copy>
                Fire leaves a thermal signature before it leaves a skyline.
                Firewatch fuses MODIS and VIIRS detections into an earlier,
                clearer picture of emerging heat.
              </p>

              <div className="hero-actions" data-intro-copy>
                <Button text="Replay satellite pass" onClick={replayScan} />
                <a
                  className="hero-text-link"
                  href="https://firms.modaps.eosdis.nasa.gov/map/"
                  target="_blank"
                  rel="noreferrer"
                >
                  EXPLORE NASA FIRMS <span aria-hidden="true">↗</span>
                </a>
              </div>

              <div className="hero-specs" data-intro-copy>
                <div className="hero-spec">
                  <span className="spec-value">375<span>m</span></span>
                  <span className="spec-label">VIIRS PIXEL SCALE</span>
                </div>
                <span className="spec-divider" />
                <div className="hero-spec">
                  <span className="spec-value">02<span> / ORBITS</span></span>
                  <span className="spec-label">MODIS + VIIRS</span>
                </div>
                <span className="spec-footnote">THERMAL ANOMALY PRODUCTS</span>
              </div>
            </div>

            <div
              className="signal-plate"
              data-signal-plate
              role="img"
              aria-label="Illustrative satellite heat-signal visualization with a rotating scan and clustered anomaly markers"
            >
              <div className="signal-plate-head" data-panel-ui>
                <div>
                  <span className="plate-eyebrow">ORBITAL VIEW</span>
                  <span className="plate-title">Thermal event field</span>
                </div>
                <span className="plate-status">
                  <i /> SIGNAL PREVIEW
                </span>
              </div>

              <div className="signal-canvas">
                <div className="canvas-coordinate coordinate-top" data-panel-ui>
                  <span>MODIS / VIIRS</span>
                  <span>37° 46&apos; N — 119° 35&apos; W</span>
                </div>

                <svg
                  className="signal-map"
                  viewBox="0 0 420 420"
                  fill="none"
                  aria-hidden="true"
                >
                  <defs>
                    <radialGradient id="heat-core">
                      <stop stopColor="#FFF1C2" />
                      <stop offset=".18" stopColor="#FFB23D" />
                      <stop offset=".55" stopColor="#F04424" stopOpacity=".72" />
                      <stop offset="1" stopColor="#D32219" stopOpacity="0" />
                    </radialGradient>
                    <linearGradient id="scan-fill" x1="210" y1="210" x2="397" y2="210">
                      <stop stopColor="#FF4F27" stopOpacity=".02" />
                      <stop offset="1" stopColor="#FF5D2A" stopOpacity=".24" />
                    </linearGradient>
                    <pattern
                      id="map-grid"
                      width="42"
                      height="42"
                      patternUnits="userSpaceOnUse"
                    >
                      <path d="M42 0H0V42" stroke="#D8D0C2" strokeOpacity=".09" />
                    </pattern>
                  </defs>

                  <rect width="420" height="420" fill="url(#map-grid)" />
                  <g className="map-topography" stroke="#BDAE9A">
                    <path d="M-20 116c48-35 77-37 113-10 38 29 62 26 96-3 40-35 70-32 104 0 37 34 66 40 112 6" />
                    <path d="M-18 134c48-35 77-37 113-10 38 29 62 26 96-3 40-35 70-32 104 0 37 34 66 40 112 6" />
                    <path d="M-16 152c48-35 77-37 113-10 38 29 62 26 96-3 40-35 70-32 104 0 37 34 66 40 112 6" />
                    <path d="M-24 295c50-32 93-36 128-7 32 27 62 29 99-2s72-36 107-3 69 36 123 0" />
                    <path d="M-22 313c50-32 93-36 128-7 32 27 62 29 99-2s72-36 107-3 69 36 123 0" />
                    <path d="M-20 331c50-32 93-36 128-7 32 27 62 29 99-2s72-36 107-3 69 36 123 0" />
                    <path d="M97-20c-5 54 12 86 43 114 30 28 33 60 4 91-25 27-32 57-10 89s29 72 8 142" />
                    <path d="M114-18c-5 54 12 86 43 114 30 28 33 60 4 91-25 27-32 57-10 89s29 72 8 142" />
                    <path d="M131-16c-5 54 12 86 43 114 30 28 33 60 4 91-25 27-32 57-10 89s29 72 8 142" />
                  </g>

                  <circle cx="210" cy="210" r="152" className="map-range" />
                  <circle cx="210" cy="210" r="104" className="map-range map-range-inner" />
                  <path d="M210 35v350M35 210h350" className="map-crosshair" />

                  <g ref={sweepRef}>
                    <path
                      d="M210 210V40A170 170 0 0 1 380 210H210Z"
                      fill="url(#scan-fill)"
                    />
                    <path
                      d="M210 210V40"
                      stroke="#FF8751"
                      strokeOpacity=".85"
                      strokeWidth="1.2"
                    />
                  </g>

                  <g className="heat-cluster">
                    <circle
                      data-orbit-pulse
                      cx="268"
                      cy="153"
                      r="24"
                      stroke="#FF633B"
                      strokeWidth="1"
                      opacity=".5"
                    />
                    <circle
                      data-orbit-pulse
                      cx="268"
                      cy="153"
                      r="37"
                      stroke="#FF633B"
                      strokeWidth="1"
                      opacity=".28"
                    />
                    <circle
                      data-hotspot
                      cx="268"
                      cy="153"
                      r="28"
                      fill="url(#heat-core)"
                    />
                    <circle
                      data-hotspot
                      cx="267"
                      cy="152"
                      r="4.5"
                      fill="#FFF2C9"
                    />
                    <circle
                      data-hotspot
                      cx="287"
                      cy="173"
                      r="3"
                      fill="#FF8A3D"
                    />
                    <circle
                      data-hotspot
                      cx="246"
                      cy="169"
                      r="2.5"
                      fill="#FF8A3D"
                    />
                    <path
                      d="M268 116v16m0 42v16m37-37h-16m-42 0h-16"
                      stroke="#FFD4A0"
                      strokeWidth="1"
                      opacity=".8"
                    />
                  </g>

                  <g className="map-ticks" stroke="#E9DDD0">
                    <path d="M210 28v8m0 348v8M28 210h8m348 0h8" />
                    <path d="M81 81l6 6m246 246 6 6m0-258-6 6M87 333l-6 6" />
                  </g>
                </svg>

                <div className="canvas-coordinate coordinate-bottom" data-panel-ui>
                  <span>37.76° N / 119.59° W</span>
                  <span>ILLUSTRATIVE SIGNAL</span>
                </div>

                <div className="anomaly-callout" data-panel-ui>
                  <span className="callout-line" />
                  <span className="callout-dot" />
                  <div>
                    <span>CLUSTER DETECTED</span>
                    <strong>Thermal anomaly</strong>
                    <small>3 illustrative pixels</small>
                  </div>
                </div>
              </div>

              <div className="signal-plate-foot" data-panel-ui>
                <span className="foot-label">FUSED SENSOR LAYERS</span>
                <span className="sensor-pair">
                  <i className="sensor-modis" /> MODIS
                  <b>+</b>
                  <i className="sensor-viirs" /> VIIRS
                </span>
                <span className="foot-mark">FW / 01</span>
              </div>
            </div>
          </div>

          <footer className="hero-footer">
            <span>SEE THE HEAT BEFORE IT HAS A NAME.</span>
            <span>EARTH OBSERVATION / FIRE INTELLIGENCE</span>
            <a href="#firewatch-title" aria-label="Back to top">
              SCROLL TO EXPLORE <span aria-hidden="true">↓</span>
            </a>
          </footer>
        </div>
      </section>
    </main>
  );
}

export default Hero;
