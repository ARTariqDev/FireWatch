"use client";

import { useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";

gsap.registerPlugin(useGSAP);

const HOVER_SCALE = 1.035;

const Button = ({
  text,
  onClick,
  disabled = false,
  color = "#ff6a32",
  textColor = "#150b06",
  glowColor = "#ffe3d1",
  rippleColor = "rgba(21,11,6,0.22)",
}) => {
  const btnRef = useRef(null);
  const glowRef = useRef(null);
  const motionRef = useRef(null);
  const isActiveRef = useRef(false);
  const nextRippleId = useRef(0);
  const [ripples, setRipples] = useState([]);

  useGSAP(
    (_, contextSafe) => {
      const button = btnRef.current;
      const glow = glowRef.current;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

      const settle = contextSafe((active) => {
        gsap.to(button, {
          scale: active ? HOVER_SCALE : 1,
          y: active ? -2 : 0,
          duration: active ? 0.2 : 0.24,
          ease: active ? "power2.out" : "power2.inOut",
          overwrite: "auto",
        });
        gsap.to(glow, {
          opacity: active ? 0.9 : 0,
          scale: active ? 1 : 0.94,
          duration: 0.22,
          ease: "power2.out",
          overwrite: "auto",
        });
      });

      const press = contextSafe(() => {
        gsap
          .timeline({ defaults: { overwrite: "auto" } })
          .to(button, { scale: 0.96, y: 0, duration: 0.08, ease: "power1.in" })
          .to(button, {
            scale: isActiveRef.current ? HOVER_SCALE : 1,
            y: isActiveRef.current ? -2 : 0,
            duration: 0.38,
            ease: "back.out(2)",
          });
      });

      motionRef.current = { settle, press };
      return () => {
        motionRef.current = null;
      };
    },
    { scope: btnRef },
  );

  const setActive = (active) => {
    isActiveRef.current = active && !disabled;
    motionRef.current?.settle(isActiveRef.current);
  };

  const handlePointerMove = (e) => {
    if (e.pointerType !== "mouse") return;
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty("--x", `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty("--y", `${e.clientY - rect.top}px`);
  };

  const handlePointerLeave = (e) => {
    e.currentTarget.style.setProperty("--x", "50%");
    e.currentTarget.style.setProperty("--y", "50%");
    setActive(e.currentTarget.matches(":focus-visible"));
  };

  const handleClick = (e) => {
    if (disabled) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const isKeyboardClick = e.detail === 0;
    const x = isKeyboardClick ? rect.width / 2 : e.clientX - rect.left;
    const y = isKeyboardClick ? rect.height / 2 : e.clientY - rect.top;

    onClick?.();
    motionRef.current?.press();
    setRipples((prev) => [...prev, { id: nextRippleId.current++, x, y }]);
  };

  return (
    <button
      ref={btnRef}
      type="button"
      disabled={disabled}
      onPointerEnter={() => setActive(true)}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
      onFocus={(e) => e.currentTarget.matches(":focus-visible") && setActive(true)}
      onBlur={() => setActive(false)}
      onClick={handleClick}
      className="relative isolate inline-flex min-h-12 cursor-pointer items-center justify-center overflow-hidden rounded-lg px-7 py-3 font-semibold shadow-[0_10px_26px_rgba(255,106,50,0.2)] transition-shadow duration-300 hover:shadow-[0_12px_30px_rgba(255,106,50,0.34)] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-orange-300 disabled:cursor-wait disabled:opacity-60 disabled:shadow-none"
      style={{ background: color }}
    >
      <span
        ref={glowRef}
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-10 scale-95 rounded-[inherit] border-2 opacity-0"
        style={{
          borderColor: glowColor,
          maskImage: "radial-gradient(130px at var(--x, 50%) var(--y, 50%), white 0%, transparent 70%)",
          WebkitMaskImage: "radial-gradient(130px at var(--x, 50%) var(--y, 50%), white 0%, transparent 70%)",
          boxShadow: `0 0 12px ${glowColor}`,
        }}
      />

      {ripples.map((ripple) => (
        <span
          key={ripple.id}
          aria-hidden="true"
          className="button-ripple pointer-events-none absolute z-0 rounded-full"
          style={{
            left: ripple.x - 50,
            top: ripple.y - 50,
            width: 100,
            height: 100,
            backgroundColor: rippleColor,
          }}
          onAnimationEnd={() =>
            setRipples((prev) => prev.filter((item) => item.id !== ripple.id))
          }
        />
      ))}

      <span
        className="relative z-20 text-sm uppercase tracking-[0.18em] sm:text-base"
        style={{ color: textColor }}
      >
        {text}
      </span>
    </button>
  );
};

export default Button;
